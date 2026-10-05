import { beforeAll, describe, expect, it } from 'vitest';
import { api, call, ensureReference, makeUser, uniq, type Session } from './helpers';

const png = () => Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
let pm: Session, finance: Session, admin: Session, editor: Session;
beforeAll(async () => { await ensureReference(); pm = await makeUser('PROGRAMME_MANAGER'); finance = await makeUser('FINANCE'); admin = await makeUser('ADMIN'); editor = await makeUser('CONTENT_EDITOR'); });
const logo = (s: Session, id: string, name = 'logo.png', bytes = png()) => { const f = new FormData(); f.set('file', new File([new Uint8Array(bytes)], name)); return call('PUT', `/programmes/${id}/logo`, { cookie: s.cookie, form: f }); };

describe('programme profile', () => {
  it('saves the full profile, tidies the lists and returns it', async () => {
    const r = await api(admin).post('/programmes', { name: `Profile ${uniq()}`, funder: 'GIZ', summary: 'Helps shea groups reach buyers.', objective: 'Raise incomes of 500 shea groups.', eligibility: 'Registered groups in Northern Ghana.', sectors: ['Shea', ' Shea ', 'Maize', ''], regions: ['Northern', 'Savannah'], targetGroups: ['Women', 'Youth'], targetBusinesses: 500, partners: 'Global Shea Alliance', contactName: 'Ama Mensah', contactEmail: 'ama@example.org', website: 'https://programme.example.org' });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    const g = (await api(admin).get(`/programmes/${r.data.id}`)).data;
    expect(g).toMatchObject({ summary: 'Helps shea groups reach buyers.', targetBusinesses: 500, partners: 'Global Shea Alliance', contactEmail: 'ama@example.org', logoMediaId: null });
    expect(g.sectors).toEqual(['Shea', 'Maize']); expect(g.regions).toEqual(['Northern', 'Savannah']);
    const u = await api(admin).patch(`/programmes/${r.data.id}`, { objective: 'New objective', sectors: ['Cashew'], website: '' });
    expect(u.status).toBe(200);
    const g2 = (await api(admin).get(`/programmes/${r.data.id}`)).data;
    expect(g2.objective).toBe('New objective'); expect(g2.sectors).toEqual(['Cashew']); expect(g2.website).toBeNull(); expect(g2.summary).toBe('Helps shea groups reach buyers.');
  });
  it('rejects bad values', async () => {
    const base = { name: `Bad ${uniq()}` };
    expect((await api(admin).post('/programmes', { ...base, contactEmail: 'nope' })).status).toBe(400);
    expect((await api(admin).post('/programmes', { ...base, website: 'http://insecure.example.org' })).status).toBe(400);
    expect((await api(admin).post('/programmes', { ...base, targetBusinesses: -1 })).status).toBe(400);
    expect((await api(admin).post('/programmes', { ...base, summary: 'x'.repeat(301) })).status).toBe(400);
  });
  it('uploads, shows and removes a logo, and only people who can edit may', async () => {
    const id = (await api(admin).post('/programmes', { name: `Logo ${uniq()}` })).data.id;
    expect((await logo(finance, id)).status).toBe(403);
    expect((await logo(admin, id, 'logo.exe')).status).toBe(400);
    expect((await logo(admin, id, 'logo.png', Buffer.from('not a picture'))).status).toBe(400);
    const up = await logo(admin, id); expect(up.status, JSON.stringify(up.error)).toBe(200);
    const g = (await api(admin).get(`/programmes/${id}`)).data; expect(g.logoMediaId).toBe(up.data.logoMediaId);
    const { readMedia } = await import('@/services/media');
    expect((await readMedia(g.logoMediaId))?.mime).toBe('image/png');
    const blocked = await api(admin).del(`/admin/media/${g.logoMediaId}`);
    expect(blocked.status).toBe(422);
    expect((await api(admin).del(`/programmes/${id}/logo`)).status).toBe(200);
    expect((await api(admin).get(`/programmes/${id}`)).data.logoMediaId).toBeNull();
  });
});
