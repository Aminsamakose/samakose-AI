import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';

let admin: Session;

beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });

/** Walk a fresh workspace through the full governed lifecycle up to CONFIGURING. */
async function activateWorkspace(id: string) {
  for (const s of ['COMMERCIAL_REVIEW', 'INVOICED', 'PAYMENT_PENDING', 'APPROVED', 'CONFIGURING']) {
    const patched = await api(admin).patch(`/programme-workspaces/${id}`, { status: s });
    if (patched.status !== 200) throw new Error(`patch to ${s} failed: ${patched.status} ${patched.text}`);
  }
}

describe('provider assignment capacity', () => {
  it('a bad lifecycle transition is reported as 409, not as an opaque 500', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Lifecycle ${uniq()}` })).data;
    const ws = (await api(admin).post(`/programmes/${prog.id}/workspace`, {})).data;
    // DRAFT -> CONFIGURING skips the required COMMERCIAL_REVIEW/INVOICED/PAYMENT_PENDING/APPROVED steps.
    const bad = await api(admin).patch(`/programme-workspaces/${ws.id}`, { status: 'CONFIGURING' });
    expect(bad.status).toBe(409);
    expect(bad.error?.code).toBe('conflict');
  });

  it('activating two proposed assignments for a provider at max capacity 1 concurrently only lets one through', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Race ${uniq()}` })).data;
    const ws = (await api(admin).post(`/programmes/${prog.id}/workspace`, {})).data;
    await activateWorkspace(ws.id);
    const provider = await makeUser('EXPERT');
    await api(admin).post(`/programme-workspaces/${ws.id}/members`, { userId: provider.userId, role: 'EXPERT' });
    await api(admin).post(`/programme-workspaces/${ws.id}/provider-capacity`, { providerUserId: provider.userId, providerRole: 'EXPERT', maxActiveAssignments: 1 });

    // Capacity only gates ACTIVE load, so two PROPOSED assignments for the same provider may
    // both exist at once -- that is intended, not the race under test.
    const a1 = (await api(admin).post(`/programme-workspaces/${ws.id}/provider-assignments`, { providerUserId: provider.userId, providerRole: 'EXPERT' })).data;
    const a2 = (await api(admin).post(`/programme-workspaces/${ws.id}/provider-assignments`, { providerUserId: provider.userId, providerRole: 'EXPERT' })).data;
    expect(a1?.id).toBeTruthy();
    expect(a2?.id).toBeTruthy();

    // The real guard: activating both concurrently must not let both through a max=1 cap.
    const activate = (id: string) => api(admin).post(`/provider-assignments/${id}/status`, { status: 'ACTIVE' });
    const [r1, r2] = await Promise.all([activate(a1.id), activate(a2.id)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const summary = (await api(admin).get(`/programme-workspaces/${ws.id}/provider-capacity`)).data;
    const row = summary.find((r: any) => r.providerUserId === provider.userId);
    expect(row.activeAssignments).toBe(1);
  });
});
