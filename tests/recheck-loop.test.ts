import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { api, drain, ensureReference, makeOrg, makeUser, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { canTransitionCase } from '@/domain/logic';

let admin: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });
const notes = (userId: string, kind: string) => db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, kind)));

describe('the re-check loop', () => {
  it('RE-ENTRY now has a way forward', () => {
    expect(canTransitionCase('RE-ENTRY', 'DIAGNOSTIC', { confirmed: true }).ok).toBe(true);
    expect(canTransitionCase('RE-ENTRY', 'DIAGNOSTIC', {}).ok).toBe(false);
  });
  it('reminds the owner and the team once when the last score is older than the interval', async () => {
    const org = await makeOrg(admin); const owner = await makeUser('OWNER', { orgId: org.id });
    const c = (await api(admin).post('/cases', { orgId: org.id })).data;
    const old = new Date(Date.now() - 400 * 864e5);
    await db().update(schema.cases).set({ status: 'MONITORING', createdAt: old }).where(eq(schema.cases.id, c.id));
    await db().insert(schema.jobs).values({ kind: 'recheck_scan' }); await drain();
    expect((await notes(owner.userId, 'RecheckDue')).length).toBe(1);
    await db().insert(schema.jobs).values({ kind: 'recheck_scan' }); await drain();
    expect((await notes(owner.userId, 'RecheckDue')).length).toBe(1);
  });
  it('tells administrators when an approved owner has no case', async () => {
    const org = await makeOrg(admin); const owner = await makeUser('OWNER', { orgId: org.id });
    await db().update(schema.users).set({ approvalStatus: 'approved', updatedAt: new Date(Date.now() - 5 * 864e5) }).where(eq(schema.users.id, owner.userId));
    await db().insert(schema.jobs).values({ kind: 'recheck_scan' }); await drain();
    const mine = (await db().select().from(schema.notifications).where(eq(schema.notifications.kind, 'CaseOwed'))).filter((n) => n.link === `/organisations/${org.id}`);
    expect(mine.length).toBeGreaterThan(0);
  });
});
