import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, tx, schema } from '@/db/client';
import { systemCtx } from '@/services/common';
import { scanIncompleteDiagnostics } from '@/services/sla';
import { api, ensureReference, makeOrg, makeUser, type Session } from './helpers';

const HOUR = 3_600_000;
const run = <T>(f: (ctx: ReturnType<typeof systemCtx>) => Promise<T>) => tx((t) => f(systemCtx(t as any, 'scan')));

let admin: Session, lead: Session, owner: Session, caseId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  lead = await makeUser('EXPERT');
  const org = await makeOrg(admin); owner = await makeUser('OWNER', { orgId: org.id });
  caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
  await api(admin).post(`/cases/${caseId}/assign`, { consultantId: lead.userId, coachId: null, reviewerId: null });
  await api(lead).put(`/cases/${caseId}/diagnostics/draft`, { answers: { A1: 2 } });
});

describe('incomplete-diagnostic reminders', () => {
  it('does nothing while the draft is fresh', async () => {
    const r = await run((ctx) => scanIncompleteDiagnostics(ctx, new Date()));
    expect(r.reminded).toBe(0);
    const [row] = await db().select().from(schema.diagnosticDrafts).where(eq(schema.diagnosticDrafts.caseId, caseId));
    expect(row.reminderTier).toBe(0);
  });

  it('escalates through three tiers as the draft goes stale, then stops (idempotent at each tier)', async () => {
    const t1 = new Date(Date.now() + 25 * HOUR);
    const first = await run((ctx) => scanIncompleteDiagnostics(ctx, t1));
    expect(first.reminded).toBe(1);
    const again = await run((ctx) => scanIncompleteDiagnostics(ctx, t1));
    expect(again.reminded).toBe(0); // same tier, not due again yet

    const t2 = new Date(Date.now() + 73 * HOUR);
    const second = await run((ctx) => scanIncompleteDiagnostics(ctx, t2));
    expect(second.reminded).toBe(1);

    const t3 = new Date(Date.now() + 169 * HOUR);
    const third = await run((ctx) => scanIncompleteDiagnostics(ctx, t3));
    expect(third.reminded).toBe(1);

    const [row] = await db().select().from(schema.diagnosticDrafts).where(eq(schema.diagnosticDrafts.caseId, caseId));
    expect(row.reminderTier).toBe(3);

    // Fully escalated: no further reminder, ever, for this same stale draft.
    const done = await run((ctx) => scanIncompleteDiagnostics(ctx, new Date(t3.getTime() + 1000 * HOUR)));
    expect(done.reminded).toBe(0);
  });

  it('saving the draft again resets the escalation to the top', async () => {
    await api(lead).put(`/cases/${caseId}/diagnostics/draft`, { answers: { A1: 3, A2: 4 } });
    const [row] = await db().select().from(schema.diagnosticDrafts).where(eq(schema.diagnosticDrafts.caseId, caseId));
    expect(row.reminderTier).toBe(0);
  });

  it('submitting the diagnostic deletes the draft, so no further reminder is ever generated for it', async () => {
    const { answerSheet } = await import('./helpers');
    const answers = await answerSheet(3, 'Self-reported');
    const submit = await api(lead).post(`/cases/${caseId}/diagnostics`, { answers });
    expect(submit.status).toBe(201);
    const rows = await db().select().from(schema.diagnosticDrafts).where(eq(schema.diagnosticDrafts.caseId, caseId));
    expect(rows.length).toBe(0);
    const after = await run((ctx) => scanIncompleteDiagnostics(ctx, new Date(Date.now() + 1000 * HOUR)));
    expect(after.reminded).toBe(0);
  });
});
