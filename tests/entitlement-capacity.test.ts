import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let admin: Session;
let frameworkVersionId: string;

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  const [fw] = await db().insert(schema.frameworks).values({ name: `Test framework ${uniq()}`, code: `TFW-${uniq()}` }).returning();
  const [fv] = await db().insert(schema.frameworkVersions).values({ frameworkId: fw.id, version: 1, status: 'Published', questions: [], dimensions: [] }).returning();
  frameworkVersionId = fv.id;
});

async function workspaceWithEntitlements(entitlements: { key: string; limit: number | boolean }[]) {
  const prog = (await api(admin).post('/programmes', { name: `Entitlement ${uniq()}` })).data;
  const ws = (await api(admin).post(`/programmes/${prog.id}/workspace`, { configuration: { entitlements } })).data;
  return { prog, ws };
}

describe('workspace entitlement caps', () => {
  it('hitting a team-role capacity cap is reported as 409, not an opaque 500', async () => {
    const { ws } = await workspaceWithEntitlements([{ key: 'expert_capacity', limit: 1 }]);
    const p1 = await makeUser('PROGRAMME_MANAGER');
    const p2 = await makeUser('PROGRAMME_MANAGER');
    const first = await api(admin).post(`/programme-workspaces/${ws.id}/members`, { userId: p1.userId, role: 'EXPERT' });
    expect(first.status).toBe(201);
    const second = await api(admin).post(`/programme-workspaces/${ws.id}/members`, { userId: p2.userId, role: 'EXPERT' });
    expect(second.status).toBe(409);
    expect(second.error?.code).toBe('conflict');
  });

  it('two concurrent adds against a role capacity of 1 only let one through', async () => {
    const { ws } = await workspaceWithEntitlements([{ key: 'coach_capacity', limit: 1 }]);
    const p1 = await makeUser('PROGRAMME_MANAGER');
    const p2 = await makeUser('PROGRAMME_MANAGER');
    const [r1, r2] = await Promise.all([
      api(admin).post(`/programme-workspaces/${ws.id}/members`, { userId: p1.userId, role: 'COACH' }),
      api(admin).post(`/programme-workspaces/${ws.id}/members`, { userId: p2.userId, role: 'COACH' }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const usage = (await api(admin).get(`/programme-workspaces/${ws.id}/members`)).data;
    expect(usage.filter((x: any) => x.role === 'COACH' && x.active).length).toBe(1);
  });

  it('hitting the participant capacity cap is reported as 409, not an opaque 500', async () => {
    const { ws } = await workspaceWithEntitlements([{ key: 'participant_capacity', limit: 1 }]);
    const org1 = await makeOrg(admin);
    const org2 = await makeOrg(admin);
    const first = await api(admin).post(`/programme-workspaces/${ws.id}/participants`, { organisationId: org1.id });
    expect(first.status).toBe(201);
    const second = await api(admin).post(`/programme-workspaces/${ws.id}/participants`, { organisationId: org2.id });
    expect(second.status).toBe(409);
    expect(second.error?.code).toBe('conflict');
  });

  it('a disallowed configuration transition is reported as 409, not an opaque 500', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Config ${uniq()}` })).data;
    const ws = (await api(admin).post(`/programmes/${prog.id}/workspace`, {})).data;
    const draft = (await api(admin).post(`/programme-workspaces/${ws.id}/configurations`, {
      frameworkVersionId,
      objectives: [{ code: 'OBJ-1', title: 'Improve business health' }],
      eligibilityRules: { criteria: ['registered_business'] },
      deliveryModel: { cadence: 'weekly' },
      reporting: { frequency: 'monthly' },
    })).data;
    const submitted = await api(admin).post(`/programme-workspaces/${ws.id}/configurations/${draft.version}/submit`, {});
    expect(submitted.status).toBe(200);
    // SUBMITTED -> SUBMITTED is not a valid transition.
    const bad = await api(admin).post(`/programme-workspaces/${ws.id}/configurations/${draft.version}/submit`, {});
    expect(bad.status).toBe(409);
    expect(bad.error?.code).toBe('conflict');
  });
});
