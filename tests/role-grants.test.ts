import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, type Session } from './helpers';

let admin: Session, expert: Session, owner: Session;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  expert = await makeUser('EXPERT');
  const org = await makeOrg(admin);
  owner = await makeUser('OWNER', { orgId: org.id });
});

describe('additional roles (role grants)', () => {
  it('reports the primary role with no additional roles by default', async () => {
    const r = await api(expert).get('/me/roles');
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ primaryRole: 'EXPERT', activeRole: 'EXPERT', additionalRoles: [] });
  });

  it('refuses to request your own primary role', async () => {
    const r = await api(expert).post('/me/roles/request', { role: 'EXPERT' });
    expect(r.status).toBe(400);
  });

  it('refuses to switch to a role that was never requested', async () => {
    const r = await api(expert).post('/me/roles/switch', { role: 'REVIEWER' });
    expect(r.status).toBe(403);
  });

  it('non-admins cannot see or decide the request queue', async () => {
    const list = await api(expert).get('/role-grants');
    expect(list.status).toBe(403);
    const req = await api(expert).post('/me/roles/request', { role: 'REVIEWER' });
    expect(req.status).toBe(201);
    const decide = await api(expert).post(`/role-grants/${req.data.id}/approve`);
    expect(decide.status).toBe(403);
  });

  it('full lifecycle: request, appears in the admin queue, approve, switch, switch back', async () => {
    const req = await api(owner).post('/me/roles/request', { role: 'REVIEWER', note: 'Trained reviewer, see attached certificate' });
    expect(req.status).toBe(201);
    expect(req.data.status).toBe('pending');

    const dup = await api(owner).post('/me/roles/request', { role: 'REVIEWER' });
    expect(dup.status).toBe(409);

    const pending = await api(admin).get('/role-grants');
    expect(pending.status).toBe(200);
    expect(pending.data.find((x: any) => x.id === req.data.id)).toBeTruthy();

    const approve = await api(admin).post(`/role-grants/${req.data.id}/approve`);
    expect(approve.status).toBe(200);

    const again = await api(admin).post(`/role-grants/${req.data.id}/approve`);
    expect(again.status).toBe(409);

    const roles = await api(owner).get('/me/roles');
    expect(roles.data.additionalRoles).toEqual(['REVIEWER']);

    // Permissions before switching are still the owner's own.
    const meBefore = await api(owner).get('/auth/me');
    expect(meBefore.data.user.role).toBe('OWNER');
    expect(meBefore.data.primaryRole).toBe('OWNER');
    expect(meBefore.data.switchableRoles).toEqual(['REVIEWER']);

    const switchTo = await api(owner).post('/me/roles/switch', { role: 'REVIEWER' });
    expect(switchTo.status).toBe(200);
    expect(switchTo.data.role).toBe('REVIEWER');

    // The same cookie's session now acts as REVIEWER everywhere, with no new sign-in.
    const meAfter = await api(owner).get('/auth/me');
    expect(meAfter.data.user.role).toBe('REVIEWER');
    expect(meAfter.data.primaryRole).toBe('OWNER');

    const back = await api(owner).post('/me/roles/switch', { role: null });
    expect(back.status).toBe(200);
    expect(back.data.role).toBe('OWNER');
    const meFinal = await api(owner).get('/auth/me');
    expect(meFinal.data.user.role).toBe('OWNER');
  });

  it('a rejected request can be asked again', async () => {
    const r1 = await api(expert).post('/me/roles/request', { role: 'PROGRAMME_MANAGER' });
    expect(r1.status).toBe(201);
    const rej = await api(admin).post(`/role-grants/${r1.data.id}/reject`);
    expect(rej.status).toBe(200);
    const switchAttempt = await api(expert).post('/me/roles/switch', { role: 'PROGRAMME_MANAGER' });
    expect(switchAttempt.status).toBe(403);
    const r2 = await api(expert).post('/me/roles/request', { role: 'PROGRAMME_MANAGER' });
    expect(r2.status).toBe(201);
    expect(r2.data.id).toBe(r1.data.id); // reused the same row, reset to pending
    const approve = await api(admin).post(`/role-grants/${r2.data.id}/approve`);
    expect(approve.status).toBe(200);
    const switchOk = await api(expert).post('/me/roles/switch', { role: 'PROGRAMME_MANAGER' });
    expect(switchOk.status).toBe(200);
    await api(expert).post('/me/roles/switch', { role: null }); // leave the session clean for other tests
  });
});
