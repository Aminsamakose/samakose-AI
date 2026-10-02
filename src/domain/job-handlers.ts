/** Background work. Each handler is idempotent enough to be retried. */
import { getReportText } from '@/services/switches';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, tx, schema } from '@/db/client';
import { registerJob } from './jobs';
import { emitEvent } from './events';
import { notifyUsers } from './notify';
import { audit } from '@/lib/audit';
import { sendMail } from '@/lib/mail';
import { AgentBlocked, NonRetryable, runAgent } from '@/services/ai';
import { latestDiagnosis, latestScore, loadRules, systemCtx } from '@/services/common';
import { validateDiagnosis, validatePrescription } from './logic';
import { mockBrief, mockDiagnosis, mockPrescription, mockReport, type BriefContext, type DiagnosisContext, type PrescriptionContext, type ReportContext } from './mockai';
import { koboPull } from '@/services/kobo';
import { questionsOf, versionForRow } from '@/services/frameworks';

async function fail(caseId: string | null, requestedBy: string | null, what: string, e: unknown) {
  await tx(async (t) => {
    const ctx = systemCtx(t, 'job');
    if (caseId) await emitEvent(ctx, 'SystemError', { caseId, payload: { message: `${what} failed: ${(e as Error).message}` } });
    if (requestedBy) await notifyUsers(ctx, [requestedBy], { kind: 'AiFailed', title: `${what} could not be prepared`, body: e instanceof AgentBlocked ? `${e.message}. Write it by hand, or ask an administrator.` : 'Try again, or write it by hand.', link: caseId ? `/cases/${caseId}` : undefined });
  });
}

/* ------------------------------ AI: diagnosis --------------------------- */
async function diagnosisContext(caseId: string): Promise<DiagnosisContext> {
  const ctx = systemCtx(db());
  const [cs] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId));
  const [org] = await db().select().from(schema.organisations).where(eq(schema.organisations.id, cs.orgId));
  const score = (await latestScore(ctx, caseId))!;
  // The questions the diagnostic was scored under, not the live bank, so later edits cannot change what the analysis sees.
  const qs = questionsOf(await versionForRow(db(), score.frameworkVersionId, org.type));
  const rs = await db().select().from(schema.responses).where(eq(schema.responses.diagnosticId, score.diagnosticId));
  const ev = await db().select().from(schema.evidence).where(and(eq(schema.evidence.caseId, caseId), inArray(schema.evidence.responseId, rs.map((r) => r.id))));
  const evBy = new Map(ev.map((e) => [e.responseId, e]));
  const weakest = rs.map((r) => ({ r, q: qs.find((x) => x.code === r.questionCode)!, e: evBy.get(r.id) })).filter((x) => x.q && x.e)
    .sort((a, b) => a.r.value - b.r.value || b.q.weight - a.q.weight).slice(0, 8)
    .map((x) => ({ question_code: x.q.code, question: x.q.text, dimension: x.q.dimension, value: x.r.value, evidence_class: x.e!.class, evidence_id: x.e!.code }));
  return {
    // No names, contacts or identifiers leave the platform. Only what the analysis needs.
    business: { type: org.type, sector: org.sector, region: org.region, size: org.size },
    overall: Number(score.overall), maturity: score.maturity, confidence_class: score.confidenceClass, dimensions: score.dimensions,
    weakest_answers: weakest, allowed_evidence_ids: weakest.map((w) => w.evidence_id)
  };
}
registerJob('ai_diagnosis', async ({ caseId }, job) => {
  const ctxData = await diagnosisContext(caseId);
  let out;
  try {
    out = await runAgent({ agent: 'diagnosis', caseId, requestedBy: job.requestedBy, context: ctxData, validate: (o) => validateDiagnosis(o, ctxData.allowed_evidence_ids), mock: () => mockDiagnosis(ctxData) });
  } catch (e) { if (e instanceof NonRetryable) await fail(caseId, job.requestedBy, 'The diagnosis', e); throw e; }
  const o: any = out.output;
  return tx(async (t) => {
    const ctx = systemCtx(t, 'job');
    const score = (await latestScore(ctx, caseId))!;
    const prev = await latestDiagnosis(ctx, caseId);
    const [d] = await t.insert(schema.diagnoses).values({ caseId, diagnosticId: score.diagnosticId, status: 'Draft', summary: o.summary, rootCauses: o.root_causes, priority: o.priority, risks: o.risks, modelConfidence: o.model_confidence === undefined ? null : Number(o.model_confidence).toFixed(2), aiRequestId: out.requestId, version: (prev?.version ?? 0) + 1, supersedesId: prev?.id ?? null, createdBy: job.requestedBy }).returning();
    if (o.risks.length) {
      await t.insert(schema.risks).values(o.risks.map((r: any) => ({ caseId, text: r.text, severity: r.severity })));
      await emitEvent(ctx, 'RiskDetected', { caseId, payload: { count: o.risks.length } });
    }
    await audit(ctx, 'diagnosis.drafted', 'diagnosis', d.id, undefined, { version: d.version, ai: out.requestCode, requestedBy: job.requestedBy }, caseId, 'HYBRID');
    if (job.requestedBy) await notifyUsers(ctx, [job.requestedBy], { kind: 'AiDone', title: 'The diagnosis draft is ready to review', link: `/cases/${caseId}` });
    return { diagnosisId: d.id, code: d.code };
  });
});

/* ----------------------------- AI: prescription ------------------------- */
registerJob('ai_prescription', async ({ caseId }, job) => {
  const ctx0 = systemCtx(db());
  const rules = await loadRules(db());
  const dgn = await latestDiagnosis(ctx0, caseId);
  const score = await latestScore(ctx0, caseId);
  if (!dgn || dgn.status !== 'Reviewed' || !score) throw new NonRetryable('The diagnosis must be reviewed first');
  const lib = await db().select().from(schema.libraryItems).where(eq(schema.libraryItems.active, true));
  const context: PrescriptionContext & { diagnosis: unknown; overall: number } = {
    diagnosis: { summary: dgn.summary, root_causes: dgn.rootCauses, priority: dgn.priority }, overall: Number(score.overall),
    weakest_dimensions: [...score.dimensions].sort((a, b) => a.value - b.value).slice(0, 3).map((d) => d.dimension),
    library: lib.map((l) => ({ id: l.code, title: l.title, dimension: l.dimension, description: l.description, typical_days: l.typicalDays })),
    limits: { min_days: Number(rules['prescription.min_days']), max_days: Number(rules['prescription.max_days']) }
  };
  let out;
  try {
    out = await runAgent({ agent: 'prescription', caseId, requestedBy: job.requestedBy, context, validate: (o) => validatePrescription(o, lib.map((l) => l.code), rules), mock: () => mockPrescription(context) });
  } catch (e) { if (e instanceof NonRetryable) await fail(caseId, job.requestedBy, 'The prescription', e); throw e; }
  return tx(async (t) => {
    const ctx = systemCtx(t, 'job');
    const [prev] = await t.select().from(schema.prescriptions).where(eq(schema.prescriptions.caseId, caseId)).orderBy(desc(schema.prescriptions.version)).limit(1);
    if (prev && ['DRAFT', 'IN REVIEW', 'RETURNED'].includes(prev.status)) throw new NonRetryable('An open prescription already exists for this case');
    const [p] = await t.insert(schema.prescriptions).values({ caseId, diagnosisId: dgn.id, status: 'DRAFT', items: (out.output as any).items, aiRequestId: out.requestId, version: (prev?.version ?? 0) + 1, supersedesId: prev?.id ?? null, createdBy: job.requestedBy }).returning();
    await audit(ctx, 'prescription.drafted', 'prescription', p.id, undefined, { version: p.version, ai: out.requestCode, requestedBy: job.requestedBy }, caseId, 'HYBRID');
    if (job.requestedBy) await notifyUsers(ctx, [job.requestedBy], { kind: 'AiDone', title: 'The prescription draft is ready to check', body: 'Edit if needed, then submit it for review.', link: `/cases/${caseId}` });
    return { prescriptionId: p.id, code: p.code };
  });
});

/* ------------------------------- AI: brief ------------------------------ */
registerJob('ai_brief', async ({ sessionId, caseId }, job) => {
  const [cs] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId));
  const [org] = await db().select().from(schema.organisations).where(eq(schema.organisations.id, cs.orgId));
  const score = await latestScore(systemCtx(db()), caseId);
  const acts = await db().select().from(schema.actions).where(eq(schema.actions.caseId, caseId));
  const today = new Date().toISOString().slice(0, 10);
  const [last] = await db().select().from(schema.coachingSessions).where(and(eq(schema.coachingSessions.caseId, caseId), eq(schema.coachingSessions.status, 'Held'))).orderBy(desc(schema.coachingSessions.scheduledAt)).limit(1);
  const kpis = await db().select().from(schema.kpis).where(eq(schema.kpis.caseId, caseId));
  const readings = kpis.length ? await db().select().from(schema.kpiReadings).where(inArray(schema.kpiReadings.kpiId, kpis.map((k) => k.id))).orderBy(schema.kpiReadings.readingDate) : [];
  const context: BriefContext = {
    org: org.name, status: cs.status, overall: score ? Number(score.overall) : null, maturity: score?.maturity ?? null,
    open_actions: acts.filter((a) => a.status !== 'Done').map((a) => a.text), overdue_actions: acts.filter((a) => a.status !== 'Done' && a.dueDate < today).map((a) => a.text),
    done_actions: acts.filter((a) => a.status === 'Done').length, last_session: last?.notes ?? null,
    kpis: kpis.map((k) => ({ name: k.name, latest: Number([...readings].reverse().find((r) => r.kpiId === k.id)?.value ?? NaN) || null, target: k.target === null ? null : Number(k.target) }))
  };
  let out;
  try {
    out = await runAgent({ agent: 'brief', caseId, requestedBy: job.requestedBy, context: { ...context, org: 'the business' }, validate: (o) => (typeof o?.brief === 'string' && o.brief.length > 20 ? [] : ['brief missing']), mock: () => mockBrief(context) });
  } catch (e) { if (e instanceof NonRetryable) await fail(caseId, job.requestedBy, 'The coaching brief', e); throw e; }
  await db().update(schema.coachingSessions).set({ brief: (out.output as any).brief, updatedAt: new Date() }).where(eq(schema.coachingSessions.id, sessionId));
  return { sessionId };
});

/* ------------------------------- AI: report ----------------------------- */
registerJob('ai_report', async ({ caseId }, job) => {
  const ctx0 = systemCtx(db());
  const score = await latestScore(ctx0, caseId);
  if (!score) throw new NonRetryable('No score to report on');
  const [cs] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId));
  const [org] = await db().select().from(schema.organisations).where(eq(schema.organisations.id, cs.orgId));
  const hist = await db().select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(desc(schema.healthScores.createdAt)).limit(2);
  const acts = await db().select().from(schema.actions).where(eq(schema.actions.caseId, caseId));
  const today = new Date().toISOString().slice(0, 10);
  const dgn = await latestDiagnosis(ctx0, caseId);
  const kpis = await db().select().from(schema.kpis).where(eq(schema.kpis.caseId, caseId));
  const readings = kpis.length ? await db().select().from(schema.kpiReadings).where(inArray(schema.kpiReadings.kpiId, kpis.map((k) => k.id))).orderBy(schema.kpiReadings.readingDate) : [];
  const context: ReportContext = {
    org: org.name, overall: Number(score.overall), maturity: score.maturity, confidence_class: score.confidenceClass, dimensions: score.dimensions,
    previous_overall: hist[1] ? Number(hist[1].overall) : null, evidence_share: score.evidenceShare,
    actions: { total: acts.length, done: acts.filter((a) => a.status === 'Done').length, overdue: acts.filter((a) => a.status !== 'Done' && a.dueDate < today).length },
    kpis: kpis.map((k) => { const last = [...readings].reverse().find((r) => r.kpiId === k.id); return { name: k.name, unit: k.unit, baseline: k.baseline === null ? null : Number(k.baseline), latest: last ? Number(last.value) : null, target: k.target === null ? null : Number(k.target) }; }),
    root_causes: dgn?.status === 'Reviewed' ? dgn.rootCauses.map((r) => r.cause) : []
  };
  let out;
  try {
    out = await runAgent({ agent: 'report', caseId, requestedBy: job.requestedBy, context: { ...context, org: 'the business' }, mock: () => mockReport(context),
      validate: (o) => (Array.isArray(o?.sections) && o.sections.length && o.sections.every((s: any) => s?.heading && s?.body) ? [] : ['sections must be a list of heading and body']) });
  } catch (e) { if (e instanceof NonRetryable) await fail(caseId, job.requestedBy, 'The report', e); throw e; }
  const backed = Math.round(((score.evidenceShare['Verified'] ?? 0) + (score.evidenceShare['Document-supported'] ?? 0)) * 100);
  return tx(async (t) => {
    const ctx = systemCtx(t, 'job');
    const wording = await getReportText(t);
    const sections = [...(out.output as any).sections] as { heading: string; body: string }[];
    if (wording['text.report_closing'].trim()) sections.push({ heading: 'About this report', body: wording['text.report_closing'].trim() });
    const title = wording['text.report_title'].replace(/\{\{\s*organisation\s*\}\}/g, org.name).trim() || `Progress report for ${org.name}`;
    const [r] = await t.insert(schema.reports).values({ caseId, title, content: sections, basis: { verified: backed, unverified: 100 - backed }, aiRequestId: out.requestId, createdBy: job.requestedBy }).returning();
    await audit(ctx, 'report.drafted', 'report', r.id, undefined, { ai: out.requestCode, requestedBy: job.requestedBy }, caseId, 'HYBRID');
    if (job.requestedBy) await notifyUsers(ctx, [job.requestedBy], { kind: 'AiDone', title: 'The report draft is ready', body: 'Edit if needed. A reviewer releases it to the owner.', link: `/cases/${caseId}` });
    return { reportId: r.id, code: r.code };
  });
});

/* ------------------------------ housekeeping ---------------------------- */
registerJob('send_emails', async () => {
  const pending = await db().select().from(schema.outboxEmails).where(and(eq(schema.outboxEmails.status, 'Pending'), lt(schema.outboxEmails.attempts, 5))).limit(50);
  let sent = 0, failed = 0;
  for (const m of pending) {
    try {
      await sendMail(m.to, m.subject, m.body);
      await db().update(schema.outboxEmails).set({ status: 'Sent', sentAt: new Date(), attempts: m.attempts + 1 }).where(eq(schema.outboxEmails.id, m.id)); sent++;
    } catch (e) {
      await db().update(schema.outboxEmails).set({ attempts: m.attempts + 1, lastError: String((e as Error).message).slice(0, 300), status: m.attempts + 1 >= 5 ? 'Failed' : 'Pending' }).where(eq(schema.outboxEmails.id, m.id)); failed++;
    }
  }
  return { sent, failed };
});

/** Actions past their date: one alert per action per due date. */
registerJob('overdue_scan', async () => {
  return tx(async (t) => {
    const ctx = systemCtx(t, 'scan');
    const rows = await t.select().from(schema.actions).where(and(sql`${schema.actions.status} <> 'Done'`, sql`${schema.actions.dueDate} < current_date`, sql`${schema.actions.overdueNotifiedAt} is null`)).for('update', { skipLocked: true }).limit(500);
    for (const a of rows) {
      await t.update(schema.actions).set({ overdueNotifiedAt: new Date() }).where(eq(schema.actions.id, a.id));
      await emitEvent(ctx, 'ActionOverdue', { caseId: a.caseId, payload: { text: a.text, code: a.code } });
    }
    return { flagged: rows.length };
  });
});

/** Invoices past their date become Overdue. Contracts ending within 30 days raise one alert. */
registerJob('invoice_scan', async () => {
  return tx(async (t) => {
    const ctx = systemCtx(t, 'scan');
    const upd = await t.update(schema.invoices).set({ status: 'Overdue', updatedAt: new Date() }).where(and(eq(schema.invoices.status, 'Sent'), sql`${schema.invoices.dueDate} < current_date`)).returning({ id: schema.invoices.id, code: schema.invoices.code });
    for (const i of upd) await audit(ctx, 'invoice.overdue', 'invoice', i.id, { status: 'Sent' }, { status: 'Overdue' });
    const expiring = await t.select().from(schema.contracts).where(and(eq(schema.contracts.status, 'Active'), sql`${schema.contracts.endDate} between current_date and current_date + 30`));
    let alerts = 0;
    for (const c of expiring) {
      const seen = await t.execute(sql`select 1 from events where type='ContractExpiring' and payload->>'contract' = ${c.code} and created_at > now() - interval '30 days' limit 1`);
      if (seen.rows.length) continue;
      await emitEvent(ctx, 'ContractExpiring', { orgId: c.orgId, payload: { contract: c.code } }); alerts++;
    }
    const ended = await t.update(schema.contracts).set({ status: 'Expired', updatedAt: new Date() }).where(and(eq(schema.contracts.status, 'Active'), sql`${schema.contracts.endDate} < current_date`)).returning({ id: schema.contracts.id });
    return { overdue: upd.length, expiringAlerts: alerts, expired: ended.length };
  });
});

registerJob('expire_sessions', async () => {
  const s = await db().execute(sql`delete from sessions where expires_at < now()`);
  const t = await db().execute(sql`delete from user_tokens where expires_at < now() - interval '7 days'`);
  const r = await db().execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
  return { sessions: s.rowCount, tokens: t.rowCount, rateLimits: r.rowCount };
});

registerJob('kobo_pull', async () => koboPull());

/** Website items whose scheduled time has passed go live, and the public pages refresh. */
registerJob('content_scan', async () => {
  const { promoteDue } = await import('@/services/content');
  return { promoted: await tx((t) => promoteDue(systemCtx(t as any))) };
});
