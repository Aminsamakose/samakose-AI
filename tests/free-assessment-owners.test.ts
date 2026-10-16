import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, type Session } from './helpers';

let admin: Session, pm: Session, user2: Session;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  pm = await makeUser('PROGRAMME_MANAGER');
  user2 = await makeUser('ADMIN');
});

describe('free assessment lead owners (#129: admin-configurable, not hardcoded)', () => {
  it('starts empty', async () => {
    const r = await api(admin).get('/admin/free-assessment-owners');
    expect(r.status).toBe(200);
    expect(r.data).toEqual([]);
  });

  it('lets an administrator set the owner set, replacing it wholesale', async () => {
    const set = await api(admin).put('/admin/free-assessment-owners', { userIds: [admin.userId, user2.userId] });
    expect(set.status).toBe(200);
    expect(set.data.map((o: any) => o.userId).sort()).toEqual([admin.userId, user2.userId].sort());

    const replaced = await api(admin).put('/admin/free-assessment-owners', { userIds: [user2.userId] });
    expect(replaced.data.map((o: any) => o.userId)).toEqual([user2.userId]);

    const get = await api(admin).get('/admin/free-assessment-owners');
    expect(get.data).toHaveLength(1);
    expect(get.data[0].userId).toBe(user2.userId);
  });

  it('rejects a non-existent user id rather than silently storing a dangling reference', async () => {
    const r = await api(admin).put('/admin/free-assessment-owners', { userIds: ['00000000-0000-0000-0000-000000000000'] });
    expect(r.status).toBe(404);
  });

  it('non-administrators can read but not set the owner set', async () => {
    expect((await api(pm).get('/admin/free-assessment-owners')).status).toBe(200);
    expect((await api(pm).put('/admin/free-assessment-owners', { userIds: [] })).status).toBe(403);
  });

  it('clears the owner set with an empty list', async () => {
    const r = await api(admin).put('/admin/free-assessment-owners', { userIds: [] });
    expect(r.data).toEqual([]);
  });
});
