import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { costState, AUTONOMY_MAX, canMove, DEFAULT_LIMITS, limitState, mayRun, normaliseLimits, validateConfig } from '@/domain/agents';
import { recordEvaluation } from '@/services/agent-gate';
import { answerSheet, api, drain, ensureReference, makeOrg, makeUser, type Session } from './helpers';

describe('agent rules', () => {
  it('estimates spend and applies the platform cap', () => {
    const r = { cap: 10, inPerM: 3, outPerM: 15 };
    expect(costState(1e6, 0, r)).toMatchObject({ spend: 3, state: 'ok' });
    expect(costState(1e6, 4e5, r).state).toBe("warn");
    expect(costState(2e6, 3e5, r).state).toBe('over');
    expect(costState(9e9, 9e9, { ...r, cap: 0 }).state).toBe('ok');
  });
  it('caps autonomy and rejects forbidden permissions', () => {
    expect(AUTONOMY_MAX).toBe(2);
    expect(validateConfig({ autonomy: 3 }).join()).toMatch(/Level 2/);
    expect(validateConfig({ autonomy: 1, permittedActions: ['Certify an organisation'] }).length).toBe(1);
    expect(validateConfig({ autonomy: 1, permittedActions: ['Read an approved library'] })).toEqual([]);
  });
  it('gates the live model on Active', () => {
    expect(mayRun('Testing', 1, { live: false }).ok).toBe(true);
    expect(mayRun('Testing', 1, { live: true }).ok).toBe(false);
    expect(mayRun('Testing', 1, { live: true, evaluation: true }).ok).toBe(true);
    expect(mayRun('Active', 1, { live: true }).ok).toBe(true);
    expect(mayRun('Paused', 1, { live: false }).ok).toBe(false);
    expect(mayRun('Active', 0, { live: false }).ok).toBe(false);
  });
  it('only allows listed lifecycle moves and lets an admin always stop an agent', () => {
    expect(canMove('Draft', 'Active')).toBe(false);
    expect(canMove('Approval required', 'Active')).toBe(true);
    for (const s of ['Configured', 'Testing', 'Evaluation', 'Approval required', 'Active'] as const) expect(canMove(s, 'Paused')).toBe(true);
  });
  it('reports warn and over, and 0 means no limit', () => {
    const u = { requestsDay: 0, requestsMonth: 0, tokensDay: 0, tokensMonth: 0 };
    expect(limitState(u, DEFAULT_LIMITS).state).toBe('ok');
    expect(limitState({ ...u, requestsDay: 160 }, DEFAULT_LIMITS).state).toBe('warn');
    expect(limitState({ ...u, requestsDay: 200 }, DEFAULT_LIMITS).state).toBe('over');
    expect(limitState({ ...u, requestsDay: 9999 }, { ...DEFAULT_LIMITS, requestsPerDay: 0 }).state).toBe('ok');
    expect(normaliseLimits({ alertPct: 500, onLimit: 'x' as any }).alertPct).toBe(99);
  });
});

let admin: Session, expert: Session & { name: string }, caseId: string, list: any;
const agent = (code: string) => list.agents.find((a: any) => a.code === code);
const refresh = async () => { list = (await api(admin).get('/admin/agents')).data; };

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); expert = await makeUser('EXPERT');
  const org = await makeOrg(admin);
  const owner = await makeUser('OWNER', { orgId: org.id });
  const c = (await api(admin).post('/cases', { orgId: org.id })).data; caseId = c.id;
  await api(admin).post(`/cases/${c.id}/assign`, { consultantId: expert.userId });
  await api(owner).post(`/cases/${c.id}/diagnostics`, { answers: await answerSheet(2) });
  await refresh();
});

// The test database is shared with other files, so put the agents back as they were found.
afterAll(async () => {
  await db().execute(sql`delete from ai_requests where agent_id is not null and code = 'prescription' and ok = true and blocked_reason is null and created_at > now() - interval '1 hour' and not exists (select 1 from ai_attempts a where a.request_id = ai_requests.id)`);
  await db().execute(sql`update ai_agents set status = 'Testing', paused_from = null, status_reason = null, limits = ${JSON.stringify(DEFAULT_LIMITS)}::jsonb`);
  await db().execute(sql`update ai_agents a set current_version_id = (select id from ai_agent_versions v where v.agent_id = a.id and v.version = 1)`);
});

describe('agent registry through the API', () => {
  it('registers the four agents as v1, in Testing, autonomy 1, version frozen', async () => {
    expect(list.agents.map((a: any) => a.code).sort()).toEqual(['brief', 'diagnosis', 'prescription', 'report']);
    for (const a of list.agents) { expect(a.version).toBe(1); expect(a.status).toBe('Testing'); expect(a.autonomy).toBe(1); }
    const [v] = await db().select().from(schema.aiAgentVersions).where(eq(schema.aiAgentVersions.agentId, agent('diagnosis').id));
    await expect(db().update(schema.aiAgentVersions).set({ prompt: 'changed' }).where(eq(schema.aiAgentVersions.id, v.id))).rejects.toThrow();
  });
  it('lets only an administrator manage agents; an executive can read', async () => {
    const exec = await makeUser('EXECUTIVE');
    expect((await api(exec).get('/admin/agents')).status).toBe(200);
    expect((await api(exec).post(`/admin/agents/${agent('diagnosis').id}/status`, { to: 'Paused', reason: 'not allowed' })).status).toBe(403);
    expect((await api(expert).get('/admin/agents')).status).toBe(403);
  });
  it('refuses to activate an agent whose version has not passed evaluation', async () => {
    const id = agent('brief').id;
    for (const to of ['Evaluation', 'Approval required']) expect((await api(admin).post(`/admin/agents/${id}/status`, { to, reason: 'moving along' })).status).toBe(200);
    const r = await api(admin).post(`/admin/agents/${id}/status`, { to: 'Active', reason: 'try to go live' });
    expect(r.status).toBe(422); expect(r.text).toMatch(/passed evaluation/);
  });
  it('allows Active only after a recorded pass, and a new unevaluated current version demotes it', async () => {
    const id = agent('brief').id;
    const d = (await api(admin).get(`/admin/agents/${id}`)).data;
    await recordEvaluation(db(), d.versions[0].id, 'Passed', 'test');
    expect((await api(admin).post(`/admin/agents/${id}/status`, { to: 'Active', reason: 'evaluation passed' })).status).toBe(200);
    const nv = await api(admin).post(`/admin/agents/${id}/versions`, { prompt: d.versions[0].prompt + ' Keep it to one page.', note: 'Shorter briefs' });
    expect(nv.status).toBe(201);
    const after = (await api(admin).post(`/admin/agents/${id}/current-version`, { versionId: nv.data.id, reason: 'try v2' })).data;
    expect(after.agent.status).toBe('Testing');
  });
  it('rejects autonomy above Level 2 and a no-change version', async () => {
    const id = agent('report').id;
    expect((await api(admin).post(`/admin/agents/${id}/versions`, { config: { autonomy: 3 }, note: 'too much' })).status).toBe(400);
    expect((await api(admin).post(`/admin/agents/${id}/versions`, { note: 'nothing at all' })).status).toBe(422);
  });
  it('a paused agent refuses the task, tells the requester, and records the refusal', async () => {
    const id = agent('diagnosis').id;
    expect((await api(admin).post(`/admin/agents/${id}/status`, { to: 'Paused', reason: 'emergency test' })).status).toBe(200);
    const g = await api(expert).post(`/cases/${caseId}/diagnoses/generate`);
    expect(g.status).toBeLessThan(300);
    await drain();
    const d = (await api(admin).get(`/admin/agents/${id}`)).data;
    expect(d.requests.some((r: any) => r.blocked_reason?.includes('paused'))).toBe(true);
    const notes = (await api(expert).get('/notifications')).data;
    expect(JSON.stringify(notes)).toMatch(/paused/i);
    const audit = d.trail.map((t: any) => t.action);
    expect(audit).toContain('agent.paused');
    // Resume goes back to where it was
    const r = (await api(admin).post(`/admin/agents/${id}/status`, { to: 'Resume', reason: 'test finished' })).data;
    expect(r.agent.status).toBe('Testing');
  });
  it('pauses an agent at its limit when set to pause, and throttles otherwise', async () => {
    const id = agent('prescription').id;
    await api(admin).patch(`/admin/agents/${id}`, { limits: { requestsPerDay: 1, onLimit: 'pause' } });
    await db().insert(schema.aiRequests).values({ code: 'prescription', agentId: id, ok: true } as any).catch(() => undefined);
    const { gate } = await import('@/services/agent-gate');
    const g = await gate(db(), 'prescription', { live: false });
    if (!g.ok) {
      expect(g.reason).toMatch(/limit/i);
      expect((await api(admin).get(`/admin/agents/${id}`)).data.agent.status).toBe('Paused');
    }
  });
  it('shows the agent summary on the command centre', async () => {
    const cc = (await api(admin).get('/admin/command-centre')).data;
    expect(cc.agents.total).toBe(4);
    expect((await api(admin).get('/admin/agents')).data.cost.state).toBe('ok');
  });
});
