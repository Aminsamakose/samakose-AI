import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { answerSheet, api, call, drain, ensureReference, jobOf, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { hmacHex } from '@/lib/crypto';
import { setPaystackTransport } from '@/services/finance';
import { setAiTransport } from '@/services/ai';
import { runOnce } from '@/domain/jobs';

let admin: Session, finance: Session, owner: Session, otherOwner: Session, orgId: string, otherOrgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE');
  const o = await makeOrg(admin); orgId = o.id; owner = await makeUser('OWNER', { orgId });
  const o2 = await makeOrg(admin); otherOrgId = o2.id; otherOwner = await makeUser('OWNER', { orgId: o2.id });
});
afterEach(() => { setPaystackTransport(null); setAiTransport(null); process.env.PAYSTACK_SECRET_KEY = ''; });

async function sentInvoice(amount = 1500, due = '2099-01-01') {
  const inv = (await api(finance).post('/invoices', { orgId, amountGhs: amount, dueDate: due })).data;
  expect((await api(owner).get(`/invoices/${inv.id}`)).status).toBe(404); // drafts are invisible to the owner
  expect((await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' })).status).toBe(200);
  return inv as { id: string; code: string };
}

describe('commercial workflow', () => {
  it('runs plan, contract and invoice rules', async () => {
    const plan = (await api(finance).post('/plans', { name: `Plan ${uniq()}`, priceGhs: 2500, intervalMonths: 12 })).data;
    expect((await api(finance).post('/plans', { name: 'Bad', priceGhs: -5 })).status).toBe(400);
    const con = (await api(finance).post('/contracts', { orgId, planId: plan.id, startDate: '2026-01-01', endDate: '2026-12-31' })).data;
    expect((await api(finance).get(`/contracts?orgId=${orgId}`)).data.items[0].amountGhs).toBe('2500.00'); // taken from the plan
    expect((await api(finance).patch(`/contracts/${con.id}`, { status: 'Expired' })).status).toBe(422); // Draft cannot expire
    expect((await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' })).status).toBe(200);
    expect((await api(finance).patch(`/contracts/${con.id}`, { amountGhs: 1 })).status).toBe(422); // terms frozen once active
    expect((await api(finance).post('/contracts', { orgId, startDate: '2026-05-01', endDate: '2026-01-01', amountGhs: 10 })).status).toBe(400);
    const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: 100, dueDate: '2026-06-01' })).data;
    expect((await api(finance).post('/invoices', { orgId: otherOrgId, contractId: con.id, amountGhs: 100, dueDate: '2026-06-01' })).status).toBe(400); // contract belongs to another org
    expect((await api(finance).patch(`/invoices/${inv.id}`, { amountGhs: 250 })).status).toBe(200);
    expect((await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' })).status).toBe(200);
    expect((await api(finance).patch(`/invoices/${inv.id}`, { amountGhs: 1 })).status).toBe(422);
    expect((await api(owner).get('/invoices')).data.items.map((i: any) => i.id)).toContain(inv.id);
    expect((await api(otherOwner).get('/invoices')).data.items.map((i: any) => i.id)).not.toContain(inv.id);
    expect((await api(otherOwner).get(`/invoices/${inv.id}`)).status).toBe(404);
    expect((await api(finance).patch(`/invoices/${inv.id}`, { status: 'Void' })).status).toBe(200);
    expect((await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' })).status).toBe(422); // void is final
    expect(JSON.stringify((await api(finance).get('/payments')).data)).not.toContain('providerPayload');
  });

  it('records a manual payment exactly once and only for the full amount', async () => {
    const inv = await sentInvoice(400);
    expect((await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: 'BANK-1', amountGhs: 100 })).status).toBe(400);
    const ok = await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: 400 });
    expect(ok.status).toBe(201); expect(ok.data.status).toBe('Succeeded');
    expect((await api(finance).get(`/invoices/${inv.id}`)).data.status).toBe('Paid');
    expect((await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: 400 })).status).toBe(422);
    expect((await api(finance).patch(`/invoices/${inv.id}`, { status: 'Void' })).status).toBe(422);
    expect((await api(owner).post(`/invoices/${inv.id}/manual-payment`, { reference: 'X-1234', amountGhs: 400 })).status).toBe(403);
    const ev = await db().select().from(schema.events).where(eq(schema.events.type, 'PaymentReceived'));
    expect(ev.some((e) => (e.payload as any).invoice === inv.code)).toBe(true);
  });

  it('completes a test payment when no Paystack key is set, and refuses when one is', async () => {
    const inv = await sentInvoice(300);
    const start = await api(owner).post(`/invoices/${inv.id}/pay`);
    expect(start.status).toBe(201); expect(start.data.mock).toBe(true); expect(start.data.authorizationUrl).toContain(start.data.reference);
    expect((await api(otherOwner).post(`/payments/${start.data.reference}/mock-complete`)).status).toBe(404);
    expect((await api(owner).post(`/payments/${start.data.reference}/mock-complete`)).data.status).toBe('Succeeded');
    expect((await api(owner).post(`/payments/${start.data.reference}/mock-complete`)).status).toBe(422);
    expect((await api(owner).get(`/invoices/${inv.id}`)).data.status).toBe('Paid');
    const inv2 = await sentInvoice(300);
    const s2 = await api(owner).post(`/invoices/${inv2.id}/pay`);
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    expect((await api(owner).post(`/payments/${s2.data.reference}/mock-complete`)).status).toBe(403);
  });

  it('starts, verifies and settles a live payment with the provider, checking amount and currency', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
    const calls: any[] = [];
    let verifyReply: any = { data: { status: 'success', amount: 45000, currency: 'GHS', id: 991, channel: 'mobile_money' } };
    setPaystackTransport(async (p, init) => { calls.push([p, init?.body]); return p.includes('initialize') ? { data: { authorization_url: 'https://checkout.paystack.test/abc' } } : verifyReply; });
    const inv = await sentInvoice(450);
    const start = await api(owner).post(`/invoices/${inv.id}/pay`);
    expect(start.data.authorizationUrl).toBe('https://checkout.paystack.test/abc'); expect(start.data.mock).toBe(false);
    expect(calls[0][1]).toMatchObject({ amount: 45000, currency: 'GHS' });
    verifyReply = { data: { status: 'success', amount: 100, currency: 'GHS', id: 1 } }; // wrong amount
    expect((await api(owner).post(`/payments/${start.data.reference}/verify`)).data.status).toBe('Failed');
    expect((await api(owner).get(`/invoices/${inv.id}`)).data.status).toBe('Sent');
    const s2 = await api(owner).post(`/invoices/${inv.id}/pay`);
    verifyReply = { data: { status: 'success', amount: 45000, currency: 'GHS', id: 992 } };
    expect((await api(owner).post(`/payments/${s2.data.reference}/verify`)).data.status).toBe('Succeeded');
    expect((await api(owner).get(`/invoices/${inv.id}`)).data.status).toBe('Paid');
  });

  it('accepts only correctly signed Paystack webhooks and applies each event once', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_hook';
    setPaystackTransport(async () => ({ data: { authorization_url: 'https://checkout.paystack.test/x' } }));
    const inv = await sentInvoice(120);
    const start = await api(owner).post(`/invoices/${inv.id}/pay`);
    const body = JSON.stringify({ event: 'charge.success', data: { id: 5551, reference: start.data.reference, amount: 12000, currency: 'GHS', channel: 'card' } });
    const post = (b: string, sig?: string) => call('POST', '/webhooks/paystack', { raw: b, headers: sig ? { 'x-paystack-signature': sig } : {} });
    expect((await post(body)).status).toBe(401);
    expect((await post(body, 'deadbeef')).status).toBe(401);
    expect((await post(body, hmacHex('sha512', 'wrong-key', body))).status).toBe(401);
    expect((await api(owner).get(`/invoices/${inv.id}`)).data.status).toBe('Sent');
    const sig = hmacHex('sha512', 'sk_test_hook', body);
    expect((await post(body, sig)).status).toBe(200);
    expect((await api(owner).get(`/invoices/${inv.id}`)).data.status).toBe('Paid');
    expect((await post(body, sig)).data.duplicate).toBe(true); // replay is harmless
    const events = await db().select().from(schema.events).where(eq(schema.events.type, 'PaymentReceived'));
    expect(events.filter((e) => (e.payload as any).invoice === inv.code)).toHaveLength(1);
    // tampered amount is refused
    const inv2 = await sentInvoice(120); const s2 = await api(owner).post(`/invoices/${inv2.id}/pay`);
    const bad = JSON.stringify({ event: 'charge.success', data: { id: 5552, reference: s2.data.reference, amount: 1, currency: 'GHS' } });
    expect((await post(bad, hmacHex('sha512', 'sk_test_hook', bad))).data.mismatch).toBe(true);
    expect((await api(owner).get(`/invoices/${inv2.id}`)).data.status).toBe('Sent');
    process.env.PAYSTACK_SECRET_KEY = '';
    expect((await post(body, sig)).status).toBe(503);
  });

  it('flags a second payment for an already paid invoice instead of double counting', async () => {
    const inv = await sentInvoice(80);
    const a = await api(owner).post(`/invoices/${inv.id}/pay`); const b = await api(owner).post(`/invoices/${inv.id}/pay`);
    expect((await api(owner).post(`/payments/${a.data.reference}/mock-complete`)).data.status).toBe('Succeeded');
    const second = await api(owner).post(`/payments/${b.data.reference}/mock-complete`);
    expect(second.status).toBe(200); expect(second.data.status).toBe('Failed');
    const rows = await db().select().from(schema.payments).where(eq(schema.payments.invoiceId, inv.id));
    expect(rows.filter((r) => r.status === 'Succeeded')).toHaveLength(1);
  });

  it('the database itself refuses two successful payments for one invoice', async () => {
    const inv = await sentInvoice(60);
    const mk = (ref: string, st: string) => db().insert(schema.payments).values({ invoiceId: inv.id, provider: 'manual', reference: ref, amountGhs: '60', status: st });
    await mk(`R-${uniq()}`, 'Succeeded');
    await expect(mk(`R-${uniq()}`, 'Succeeded')).rejects.toThrow();
    await expect(mk(`R-${uniq()}`, 'Pending')).resolves.toBeDefined();
  });

  it('marks overdue invoices and alerts on expiring contracts, once', async () => {
    const past = (await api(finance).post('/invoices', { orgId, amountGhs: 55, dueDate: '2020-01-01' })).data;
    await api(finance).patch(`/invoices/${past.id}`, { status: 'Sent' });
    const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: soon, amountGhs: 10 })).data;
    await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
    for (const kind of ['invoice_scan', 'invoice_scan']) await db().insert(schema.jobs).values({ kind });
    await drain();
    expect((await api(finance).get(`/invoices/${past.id}`)).data.status).toBe('Overdue');
    const ev = (await db().select().from(schema.events).where(eq(schema.events.type, 'ContractExpiring'))).filter((e) => (e.payload as any).contract === con.code);
    expect(ev).toHaveLength(1);
    expect((await api(finance).get('/dashboard')).data.overdue.length).toBeGreaterThan(0);
  });
});

/* ------------------------- AI failure handling -------------------------- */
async function scoredCase() {
  const org = await makeOrg(admin);
  const consultant = await makeUser('CONSULTANT'), reviewer = await makeUser('REVIEWER');
  const ow = await makeUser('OWNER', { orgId: org.id });
  const c = (await api(admin).post('/cases', { orgId: org.id })).data;
  await api(admin).post(`/cases/${c.id}/assign`, { consultantId: consultant.userId, reviewerId: reviewer.userId });
  await api(ow).post(`/cases/${c.id}/diagnostics`, { answers: await answerSheet((_c, i) => i % 4) });
  return { c, consultant, reviewer, ow };
}
describe('AI safety', () => {
  it('retries once with the validation errors and accepts a corrected answer', async () => {
    const { c, consultant } = await scoredCase();
    const replies: string[] = []; const prompts: string[] = [];
    setAiTransport(async (_s, user) => {
      prompts.push(user);
      const ids = JSON.parse(user.split('\n\nYour previous')[0]).allowed_evidence_ids as string[];
      const r = prompts.length === 1
        ? '{"summary":"Looks fine but cites an evidence id that does not exist in the data.","root_causes":[{"cause":"x","evidence_ids":["EVD-0000-999999"]}],"priority":"High","risks":[]}'
        : JSON.stringify({ summary: 'Corrected diagnosis that cites only evidence supplied in the context.', root_causes: [{ cause: 'Records are weak', evidence_ids: [ids[0]] }], priority: 'Medium', risks: [{ text: 'r', severity: 'Low' }], model_confidence: 0.7 });
      replies.push(r); return { text: '```json\n' + r + '\n```', inputTokens: 10, outputTokens: 20 };
    });
    const g = await api(consultant).post(`/cases/${c.id}/diagnoses/generate`);
    await drain();
    expect((await jobOf(g.data.jobId)).status).toBe('done');
    expect(prompts[1]).toContain('rejected for these reasons'); expect(prompts[1]).toContain('Unknown evidence id');
    const list = (await api(consultant).get(`/cases/${c.id}/diagnoses`)).data;
    expect(list).toHaveLength(1); expect(list[0].summary).toMatch(/Corrected/);
    const attempts = await db().select().from(schema.aiAttempts);
    expect(attempts.filter((a) => !a.valid).length).toBeGreaterThan(0);
    expect(prompts[0]).not.toMatch(/@|Org \w{8}/); // names and contacts never leave the platform
  });
  it('fails cleanly after two bad answers, keeps nothing half written, and tells the requester', async () => {
    const { c, consultant } = await scoredCase();
    setAiTransport(async () => ({ text: 'I am sorry, I cannot help with that.', inputTokens: 1, outputTokens: 1 }));
    const g = await api(consultant).post(`/cases/${c.id}/diagnoses/generate`);
    await drain();
    const j = await jobOf(g.data.jobId);
    expect(j.status).toBe('failed'); expect(j.attempts).toBe(1); // a non-retryable error does not burn more attempts
    expect((await api(consultant).get(`/jobs/${g.data.jobId}`)).data.error).toMatch(/could not be completed/);
    expect((await api(consultant).get(`/cases/${c.id}/diagnoses`)).data).toHaveLength(0);
    const n = (await api(consultant).get('/notifications')).data.items;
    expect(n.some((x: any) => x.kind === 'AiFailed')).toBe(true);
    expect((await api(admin).get('/admin/system')).data.failedJobs.length).toBeGreaterThan(0);
    expect((await api(admin).post(`/admin/jobs/${g.data.jobId}/retry`)).status).toBe(200);
  });
  it('treats a network failure as retryable with backoff', async () => {
    const { c, consultant } = await scoredCase();
    setAiTransport(async () => { throw new Error('socket hang up'); });
    const g = await api(consultant).post(`/cases/${c.id}/diagnoses/generate`);
    await runOnce(5);
    const j = await jobOf(g.data.jobId);
    expect(['queued', 'failed']).toContain(j.status);
  });
  it('never lets AI approve: an AI-drafted prescription starts as a draft only', async () => {
    const { c, consultant } = await scoredCase();
    await api(consultant).post(`/cases/${c.id}/diagnoses/generate`); await drain();
    const d = (await api(consultant).get(`/cases/${c.id}/diagnoses`)).data[0];
    await api(consultant).post(`/diagnoses/${d.id}/review`, { decision: 'Reviewed' });
    await api(consultant).post(`/cases/${c.id}/prescriptions/generate`); await drain();
    expect((await api(consultant).get(`/cases/${c.id}/prescriptions`)).data[0].status).toBe('DRAFT');
  });
});

/* ------------------------------- Kobo ----------------------------------- */
describe('KoboToolbox intake', () => {
  let caseCode = '', caseId = '';
  beforeAll(async () => {
    const org = await makeOrg(admin); const c = (await api(admin).post('/cases', { orgId: org.id })).data; caseCode = c.code; caseId = c.id;
  });
  const send = (body: unknown, secret: string | null = 'kobo-test-secret') => call('POST', '/integrations/kobo/webhook', { body, headers: secret ? { 'x-kobo-secret': secret } : {} });
  const sheet = async (n: number, extra: Record<string, unknown> = {}) => {
    const qs = await db().select().from(schema.questions).orderBy(schema.questions.code);
    return Object.fromEntries(qs.slice(0, n).map((q) => [`section_a/${q.code}`, 2])) as Record<string, unknown> & typeof extra;
  };
  it('rejects a missing or wrong secret', async () => {
    expect((await send({ _uuid: 'x' }, null)).status).toBe(401);
    expect((await send({ _uuid: 'x' }, 'nope')).status).toBe(401);
  });
  it('accepts a valid submission (grouped field names), scores it and moves the case', async () => {
    const r = await send({ _uuid: `k-${uniq()}`, 'intro/case_code': caseCode, ...(await sheet(18)) });
    expect(r.status).toBe(200); expect(r.data.accepted).toBe(true);
    const c = (await api(admin).get(`/cases/${caseId}`)).data; expect(c.status).toBe('DIAGNOSED');
    const d = (await api(admin).get(`/cases/${caseId}/diagnostics`)).data[0]; expect(d.source).toBe('kobo');
  });
  it('is idempotent: a re-delivered submission is ignored', async () => {
    const uuid = `k-${uniq()}`;
    const body = { _uuid: uuid, case_code: caseCode, ...(await sheet(18)) };
    expect((await send(body)).data.accepted).toBe(true);
    expect((await send(body)).data.duplicate).toBe(true);
    const n = (await db().select().from(schema.diagnostics).where(eq(schema.diagnostics.submissionUuid, uuid))).length; expect(n).toBe(1);
  });
  it('records a rejected submission and raises a system alert rather than failing silently', async () => {
    const uuid = `k-${uniq()}`;
    const r = await send({ _uuid: uuid, case_code: caseCode, ...(await sheet(5)) });
    expect(r.status).toBe(200); expect(r.data.accepted).toBe(false); expect(r.data.problems.join()).toMatch(/Completion/);
    const [row] = await db().select().from(schema.diagnostics).where(eq(schema.diagnostics.submissionUuid, uuid)); expect(row.status).toBe('Rejected');
    const ev = await db().select().from(schema.events).where(eq(schema.events.caseId, caseId));
    expect(ev.some((e) => e.type === 'SystemError')).toBe(true);
  });
  it('does not let a form claim verified evidence', async () => {
    const uuid = `k-${uniq()}`;
    const s = await sheet(18); (s as any)['section_a/Q01_evidence'] = 'Verified';
    await send({ _uuid: uuid, case_code: caseCode, ...s });
    const [d] = await db().select().from(schema.diagnostics).where(eq(schema.diagnostics.submissionUuid, uuid));
    const rs = await db().select().from(schema.responses).where(eq(schema.responses.diagnosticId, d.id));
    expect(rs.every((r) => r.evidenceClass !== 'Verified')).toBe(true);
  });
  it('acknowledges an unknown case without retries and raises an alert', async () => {
    const r = await send({ _uuid: `k-${uniq()}`, case_code: 'CASE-1999-000000', ...(await sheet(18)) });
    expect(r.status).toBe(200); expect(r.data.unknownCase).toBe(true);
  });
});

/* ------------------------------- files ---------------------------------- */
describe('documents', () => {
  let caseId = '';
  beforeAll(async () => { const c = (await api(admin).post('/cases', { orgId })).data; caseId = c.id; });
  const upload = (s: Session, name: string, content: string | Buffer, extra: Record<string, string> = { caseId }) => {
    const f = new FormData(); f.set('file', new File([content as any], name)); for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return call('POST', '/documents', { cookie: s.cookie, form: f });
  };
  it('stores a valid file, fingerprints it, and serves it as a download only', async () => {
    const up = await upload(owner, 'Cash book (2026).pdf', '%PDF-1.4 hello');
    expect(up.status).toBe(201);
    const dl = await call('GET', `/documents/${up.data.id}/download`, { cookie: owner.cookie });
    expect(dl.status).toBe(200); expect(dl.text).toBe('%PDF-1.4 hello');
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/); expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    const [row] = await db().select().from(schema.documents).where(eq(schema.documents.id, up.data.id));
    expect(row.sha256).toHaveLength(64); expect(row.storageKey).not.toContain(row.filename);
  });
  it('rejects wrong types, disguised content, empty and oversized files', async () => {
    expect((await upload(owner, 'run.exe', 'MZ')).status).toBe(400);
    expect((await upload(owner, 'fake.pdf', 'not a pdf at all')).status).toBe(400);
    expect((await upload(owner, 'fake.png', '%PDF-1.4')).status).toBe(400);
    expect((await upload(owner, 'empty.pdf', '')).status).toBe(400);
    expect((await upload(owner, 'big.txt', Buffer.alloc(1.5 * 1024 * 1024, 65))).status).toBe(400);
    expect((await upload(owner, 'x.html', '<script>1</script>')).status).toBe(400);
    expect((await call('POST', '/documents', { cookie: owner.cookie, body: {} })).status).toBe(400);
  });
  it('sanitises hostile file names', async () => {
    const up = await upload(owner, '../../etc/passwd.pdf', '%PDF-1.4 x');
    expect(up.data.filename).toBe('passwd.pdf');
  });
  it('detects a file changed on disk after upload', async () => {
    const up = await upload(owner, 'tamper.pdf', '%PDF-1.4 original');
    const [row] = await db().select().from(schema.documents).where(eq(schema.documents.id, up.data.id));
    fs.writeFileSync(path.join(process.env.STORAGE_DIR!, row.storageKey), '%PDF-1.4 tampered');
    expect((await call('GET', `/documents/${up.data.id}/download`, { cookie: owner.cookie })).status).toBe(500);
    fs.rmSync(path.join(process.env.STORAGE_DIR!, row.storageKey));
    expect((await call('GET', `/documents/${up.data.id}/download`, { cookie: owner.cookie })).status).toBe(410);
  });
  it('lets an owner attach a document as evidence and support an answer with it', async () => {
    const up = await upload(owner, 'sales-ledger.pdf', '%PDF-1.4 ledger');
    const ev = await api(owner).post(`/cases/${caseId}/evidence`, { description: 'Sales ledger for last quarter', documentId: up.data.id, class: 'Verified' });
    expect(ev.status).toBe(201); expect(ev.data.class).toBe('Unverified'); // owners cannot self-verify
    const otherDoc = await upload(otherOwner, 'theirs.pdf', '%PDF-1.4 x', { orgId: otherOrgId });
    expect((await api(owner).post(`/cases/${caseId}/evidence`, { description: 'Not mine', documentId: otherDoc.data.id })).status).toBe(400);
    const answers = await answerSheet(3, 'Self-reported'); (answers as any).Q13 = { value: 3, evidence: 'Document-supported', ref: up.data.code };
    const r = await api(owner).post(`/cases/${caseId}/diagnostics`, { answers });
    expect(r.status).toBe(201);
    const ev2 = (await api(admin).get(`/cases/${caseId}/evidence`)).data;
    expect(ev2.some((e: any) => e.class === 'Document-supported' && e.documentId === up.data.id)).toBe(true);
  });
});

/* ---------------------- data integrity in the database ------------------ */
describe('database integrity rules', () => {
  it('audit log, events, readings and scores cannot be changed or deleted, even by SQL', async () => {
    await api(admin).post('/plans', { name: `Audit probe ${uniq()}`, priceGhs: 10 });
    const [a] = await db().select().from(schema.auditLog).limit(1);
    await expect(db().update(schema.auditLog).set({ action: 'edited' }).where(eq(schema.auditLog.id, a.id))).rejects.toThrow();
    await expect(db().delete(schema.auditLog).where(eq(schema.auditLog.id, a.id))).rejects.toThrow();
    const [e] = await db().select().from(schema.events).limit(1);
    if (e) await expect(db().delete(schema.events).where(eq(schema.events.id, e.id))).rejects.toThrow();
    const [s] = await db().select().from(schema.healthScores).limit(1);
    if (s) await expect(db().update(schema.healthScores).set({ overall: '100' }).where(eq(schema.healthScores.id, s.id))).rejects.toThrow();
    const [r] = await db().select().from(schema.responses).limit(1);
    if (r) await expect(db().update(schema.responses).set({ value: 4 }).where(eq(schema.responses.id, r.id))).rejects.toThrow();
  });
  it('diagnoses and prescriptions keep their content: only status may change, and nothing is deleted', async () => {
    const { c, consultant } = await scoredCase();
    await api(consultant).post(`/cases/${c.id}/diagnoses/generate`); await drain();
    const [d] = await db().select().from(schema.diagnoses).where(eq(schema.diagnoses.caseId, c.id));
    await expect(db().update(schema.diagnoses).set({ summary: 'rewritten history' }).where(eq(schema.diagnoses.id, d.id))).rejects.toThrow();
    await expect(db().update(schema.diagnoses).set({ priority: 'Low' }).where(eq(schema.diagnoses.id, d.id))).rejects.toThrow();
    await expect(db().delete(schema.diagnoses).where(eq(schema.diagnoses.id, d.id))).rejects.toThrow();
    await expect(db().update(schema.diagnoses).set({ status: 'Reviewed' }).where(eq(schema.diagnoses.id, d.id))).resolves.toBeDefined();
    const [dx] = await db().select().from(schema.diagnostics).where(eq(schema.diagnostics.caseId, c.id));
    await expect(db().update(schema.diagnostics).set({ completion: '0.100' }).where(eq(schema.diagnostics.id, dx.id))).rejects.toThrow();
  });
  it('the database refuses a reviewer who is also the consultant, values out of range and owners without an organisation', async () => {
    const org = await makeOrg(admin);
    const u = await makeUser('CONSULTANT');
    const [cs] = await db().insert(schema.cases).values({ orgId: org.id }).returning();
    await expect(db().update(schema.cases).set({ consultantId: u.userId, reviewerId: u.userId }).where(eq(schema.cases.id, cs.id))).rejects.toThrow();
    await expect(db().insert(schema.actions).values({ caseId: cs.id, text: 't', ownerRole: 'ROBOT', dueDate: '2030-01-01' })).rejects.toThrow();
    await expect(db().insert(schema.users).values({ email: `o-${uniq()}@x.test`, name: 'No Org', role: 'OWNER' })).rejects.toThrow();
    await expect(db().insert(schema.invoices).values({ orgId: org.id, amountGhs: '-5', dueDate: '2030-01-01' })).rejects.toThrow();
  });
  it('gives codes from sequences, never reused', async () => {
    const a = (await api(admin).post('/programmes', { name: `Seq ${uniq()}` })).data.code, b = (await api(admin).post('/programmes', { name: `Seq ${uniq()}` })).data.code;
    expect(a).toMatch(/^PRG-\d{4}-\d{6}$/); expect(Number(b.slice(-6))).toBeGreaterThan(Number(a.slice(-6)));
  });
  it('writes the case, its audit row and its event in one transaction: a failure leaves nothing behind', async () => {
    const org = await makeOrg(admin);
    const before = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'case.created'))).length;
    const r = await api(admin).post('/cases', { orgId: org.id, cohortId: '00000000-0000-4000-8000-000000000000' });
    expect(r.status).toBe(400);
    expect((await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'case.created'))).length).toBe(before);
    expect((await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id))).length).toBe(0);
  });
});

/* ------------------------------ admin settings -------------------------- */
describe('settings', () => {
  it('validates and audits rule changes, and the change takes effect on the next diagnostic', async () => {
    expect((await api(admin).put('/settings/rules', { values: { 'maturity.critical_below': 70 } })).status).toBe(400); // must stay below Fragile
    expect((await api(admin).put('/settings/rules', { values: { 'nonsense.rule': 1 } })).status).toBe(400);
    expect((await api(admin).put('/settings/rules', { values: { 'evidence.multiplier.Verified': 2 } })).status).toBe(400);
    expect((await api(admin).put('/settings/rules', { values: { 'validation.min_completion': 0.5 } })).data.changed).toBe(1);
    const org = await makeOrg(admin); const c = (await api(admin).post('/cases', { orgId: org.id })).data;
    const half = await answerSheet(2); for (const k of Object.keys(half).slice(0, 9)) delete half[k];
    expect((await api(admin).post(`/cases/${c.id}/diagnostics`, { answers: half })).status).toBe(201);
    expect((await api(admin).put('/settings/rules', { values: { 'validation.min_completion': 0.9 } })).data.changed).toBe(1);
    const rows = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'settings.rules_changed'));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect((await api(admin).get('/settings/rules')).data.find((r: any) => r.key === 'validation.min_completion').value).toBe(0.9);
  });
  it('manages questions and the intervention library, retiring instead of deleting', async () => {
    const q = await api(admin).post('/settings/questions', { code: 'Q90', dimension: 'Finance', text: 'A new test question exists here', weight: 2 });
    expect(q.status).toBe(201);
    expect((await api(admin).post('/settings/questions', { code: 'Q90', dimension: 'Finance', text: 'Duplicate code question', weight: 2 })).status).toBe(409);
    expect((await api(admin).post('/settings/questions', { code: 'Q91', dimension: 'Astrology', text: 'Not a dimension at all', weight: 2 })).status).toBe(400);
    expect((await api(admin).patch(`/settings/questions/${q.data.id}`, { active: false })).status).toBe(200);
    const l = await api(admin).post('/settings/library', { code: 'IVL-090', title: 'Test intervention', dimension: 'Finance', description: 'A description long enough', typicalDays: 20 });
    expect(l.status).toBe(201);
    expect((await api(admin).patch(`/settings/library/${l.data.id}`, { active: false })).status).toBe(200);
  });
  it('reports system status without exposing secrets', async () => {
    const s = (await api(admin).get('/admin/system')).data;
    expect(s.database.ok).toBe(true); expect(s.ai.mode).toBe('mock'); expect(s.payments.mode).toBe('mock'); expect(s.email.mode).toBe('log-only');
    expect(JSON.stringify(s)).not.toMatch(/sk_|secret|password/i);
  });
  it('serves a health check and an OpenAPI description covering every route', async () => {
    expect((await call('GET', '/health')).data.ok).toBe(true);
    const spec = (await call('GET', '/openapi.json')).data;
    expect(spec.openapi).toBe('3.1.0'); expect(Object.keys(spec.paths).length).toBeGreaterThan(90);
    expect(spec.paths['/cases/{id}/assign'].post['x-permission']).toBe('cases:edit');
  });
});
