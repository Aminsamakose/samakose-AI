import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let admin: Session, pm: Session, fin: Session, prog: any;
beforeAll(async () => {
  await ensureReference(); admin = await makeUser('ADMIN'); fin = await makeUser('FINANCE');
  prog = (await api(admin).post('/programmes', { name: `Prog ${uniq()}`, startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 1000 })).data;
  await api(admin).patch(`/programmes/${prog.id}`, { status: 'Active' });
  pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [prog.id] });
});

describe('administrator views any dashboard', () => {
  it('shows each role its own dashboard read-only, audited, and only to an administrator', async () => {
    const org = await makeOrg(admin); const owner = await makeUser('OWNER', { orgId: org.id }); const exp = await makeUser('EXPERT'); const fun = await makeUser('FUNDER', { programmeIds: [prog.id] });
    for (const [u, kind] of [[owner, 'owner'], [exp, 'expert'], [fun, 'funder'], [fin, 'finance'], [pm, 'management']] as const) {
      const r = await api(admin).get(`/dashboard?as=${u.userId}`); expect(r.status, kind).toBe(200); expect(r.data.kind).toBe(kind); expect(r.data.viewingAs.id).toBe(u.userId);
    }
    expect((await api(admin).get(`/dashboard?as=${owner.userId}`)).data.case ?? null).toBeDefined();
    for (const s of [pm, exp, owner, fin]) expect((await api(s).get(`/dashboard?as=${owner.userId}`)).status).toBe(403);
    expect((await api(admin).get('/dashboard?as=00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api(admin).get('/dashboard?as=nope')).status).toBe(400);
    const log = await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, owner.userId));
    expect(log.map((l) => l.action)).toContain('dashboard.viewed_as');
    expect((await api(admin).get('/dashboard')).data.viewingAs).toBeUndefined();
  });
});
