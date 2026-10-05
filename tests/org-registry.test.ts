import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db } from '@/db/client';
import { completeness, findDuplicates, normaliseName, normalisePhone } from '@/domain/org-registry';
import { MOVES_ON_MERGE, STAYS_ON_MERGE } from '@/services/orgs';

describe('domain: completeness and matching', () => {
  it('scores a thin record low and a full one at 100', () => {
    expect(completeness({ name: 'A' }).band).toBe('Thin');
    const full = completeness({ name: 'a', type: 'SME', sector: 's', region: 'r', district: 'd', size: 'Small', registrationNumber: 'x', tin: 'C0012345678', contactName: 'n', contactEmail: 'e', contactPhone: 'p', yearsOperating: 3, ownershipStructure: 'Sole', geoUnitId: 'g', consentAt: new Date() });
    expect(full.score).toBe(100); expect(full.missing).toEqual([]);
    expect(completeness({ name: 'A', tin: '  ' }).missing).toContain('Tax identification number');
  });
  it('normalises names and phones', () => {
    expect(normaliseName('Tamale Shea Enterprise Ltd.')).toBe(normaliseName('tamale  SHEA'));
    expect(normaliseName('Naah & Sons Limited')).toBe('naah and sons');
    expect(normalisePhone('+233 24 123 4567')).toBe(normalisePhone('0241234567'));
  });
  it('groups by identifier and does not repeat an identical set', () => {
    const r = (id: string, o: Record<string, any> = {}) => ({ id, code: id, name: id, region: 'Northern', tin: null, registrationNumber: null, contactEmail: null, contactPhone: null, caseCount: 0, ...o });
    const g = findDuplicates([r('a', { name: 'Shea Ltd', tin: 'C001-234' }), r('b', { name: 'Shea Limited', tin: 'c001234' }), r('c', { name: 'Other', contactEmail: 'x@y.com' }), r('d', { name: 'Else', contactEmail: 'X@y.com' })]);
    expect(g.find((x) => x.reason === 'tin')?.strength).toBe('certain');
    expect(g.filter((x) => x.ids.join() === 'a,b')).toHaveLength(1); // name rule does not repeat the TIN group
    expect(g.find((x) => x.reason === 'email')?.ids).toEqual(['c', 'd']);
  });
});

let admin: Session, pm: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); pm = await makeUser('PROGRAMME_MANAGER'); });

describe('TIN and registration number', () => {
  it('saves a normalised TIN, shows completeness, rejects a repeat', async () => {
    const tin = `C${Date.now()}`.slice(0, 12);
    const a = (await api(admin).post('/organisations', { name: `Reg ${uniq()}`, region: 'Northern', tin: tin.toLowerCase().replace(/(.)/, '$1 '), registrationNumber: 'RG-1', consent: true, consentBy: 'Owner' })).data.id;
    const d = (await api(admin).get(`/organisations/${a}`)).data;
    expect(d.tin).toBe(tin.toUpperCase()); expect(d.registrationNumber).toBe('RG-1'); expect(d.completeness.score).toBeGreaterThan(0);
    const dup = await api(admin).post('/organisations', { name: `Reg ${uniq()}`, region: 'Northern', tin, consent: true, consentBy: 'Owner' });
    expect(dup.status).toBe(400); expect(dup.text).toContain('tax identification');
    const b = (await makeOrg(admin)).id;
    expect((await api(admin).patch(`/organisations/${b}`, { tin })).status).toBe(400);
    expect((await api(admin).patch(`/organisations/${b}`, { tin: 'abc' })).status).toBe(400);
    expect((await api(admin).patch(`/organisations/${b}`, { tin: '' })).status).toBe(200);
  });
});

describe('merge and unarchive', () => {
  it('only an administrator can see duplicates, merge or unarchive', async () => {
    const a = (await makeOrg(admin)).id; const b = (await makeOrg(admin)).id;
    expect((await api(pm).get('/organisations/duplicates')).status).toBe(403);
    expect((await api(pm).post(`/organisations/${a}/merge`, { intoId: b, reason: 'same business twice', confirm: true })).status).toBe(403);
    expect((await api(pm).post(`/organisations/${a}/unarchive`)).status).toBe(403);
  });
  it('finds a duplicate by name, merges it, moves the business and keeps the history', async () => {
    const nm = `Zuri Foods ${uniq()}`;
    const mk = async (name: string, extra: Record<string, unknown>) => (await api(admin).post('/organisations', { name, region: 'Northern', consent: true, consentBy: 'Owner', ...extra })).data.id as string;
    const keep = await mk(nm, {}); const dupe = await mk(`${nm} Ltd`, { sector: 'Grains', contactPhone: '0241234567', tin: `T${Date.now()}`.slice(0, 11) });
    const found = (await api(admin).get('/organisations/duplicates')).data.groups as any[];
    expect(found.some((g) => g.ids.includes(keep) && g.ids.includes(dupe))).toBe(true);
    const owner = await makeUser('OWNER', { orgId: dupe });
    const c = await api(admin).post('/cases', { orgId: dupe, startState: 'PROSPECT' }); expect(c.status).toBe(201);
    const bad = await api(admin).post(`/organisations/${dupe}/merge`, { intoId: keep, reason: 'x', confirm: true }); expect(bad.status).toBe(400);
    expect((await api(admin).post(`/organisations/${dupe}/merge`, { intoId: dupe, reason: 'same business twice', confirm: true })).status).toBe(400);
    const m = await api(admin).post(`/organisations/${dupe}/merge`, { intoId: keep, reason: 'Registered twice at intake', confirm: true });
    expect(m.status).toBe(200); expect(m.data.moved.cases).toBe(1); expect(m.data.moved.users).toBe(1);
    const k = (await api(admin).get(`/organisations/${keep}`)).data;
    expect(k.cases.map((x: any) => x.id)).toContain(c.data.id); expect(k.sector).toBe('Grains'); expect(k.contactPhone).toBe('0241234567'); expect(k.tin).toBeTruthy();
    expect((await api(admin).get(`/organisations/${dupe}`)).status).toBe(404);
    expect((await api(owner).get(`/organisations/${keep}`)).status).toBe(200);
    const row = (await db().execute(sql`select status, merged_into, tin from organisations where id=${dupe}`)).rows[0] as any;
    expect(row.status).toBe('Merged'); expect(row.merged_into).toBe(keep); expect(row.tin).toBeNull();
    expect(await auditActions(dupe)).toContain('organisation.merged');
    // a merged record cannot be brought back
    expect((await api(admin).post(`/organisations/${dupe}/unarchive`)).status).toBe(409);
  });
  it('restores an archived organisation, and refuses a name clash', async () => {
    const a = (await makeOrg(admin)).id;
    expect((await api(admin).post(`/organisations/${a}/unarchive`)).status).toBe(409);
    expect((await api(admin).del(`/organisations/${a}`)).status).toBe(200);
    const un = await api(admin).post(`/organisations/${a}/unarchive`); expect(un.status).toBe(200);
    expect((await api(admin).get(`/organisations/${a}`)).data.status).toBe('Active');
    expect(await auditActions(a)).toContain('organisation.unarchived');
    // archive again, then take the name with a new record
    const name = (await api(admin).get(`/organisations/${a}`)).data.name;
    await api(admin).del(`/organisations/${a}`);
    await api(admin).post('/organisations', { name, region: 'Northern', consent: true, consentBy: 'Owner' });
    expect((await api(admin).post(`/organisations/${a}/unarchive`)).status).toBe(409);
  });
});

describe('every org_id table is classified for merging', () => {
  it('no table that carries org_id is left unclassified', async () => {
    const t = ((await db().execute(sql`select table_name from information_schema.columns where table_schema='public' and column_name='org_id'`)).rows as any[]).map((r) => r.table_name);
    const known = new Set<string>([...MOVES_ON_MERGE, ...STAYS_ON_MERGE]);
    expect(t.filter((x) => !known.has(x))).toEqual([]);
  });
});

describe('identity changes on shared records', () => {
  it('a programme manager cannot rename someone else’s or an in-use organisation, but can edit other fields', async () => {
    const theirs = (await api(pm).post('/organisations', { name: `Mine ${uniq()}`, region: 'Northern', consent: true, consentBy: 'Owner' })).data.id as string;
    expect((await api(pm).patch(`/organisations/${theirs}`, { name: `Fixed typo ${uniq()}` })).status).toBe(200); // own record, no cases yet
    const shared = (await makeOrg(admin)).id;
    expect((await api(pm).patch(`/organisations/${shared}`, { name: 'Renamed by PM' })).status).toBe(403);
    expect((await api(pm).patch(`/organisations/${shared}`, { tin: 'GHA1234567' })).status).toBe(403);
    expect((await api(pm).patch(`/organisations/${shared}`, { sector: 'Cereals', contactName: 'New Contact' })).status).toBe(403); // contact details are hidden from them, so they cannot overwrite blind
    expect((await api(pm).patch(`/organisations/${shared}`, { sector: 'Cereals' })).status).toBe(200);
    expect((await api(pm).patch(`/organisations/${shared}`, { name: (await api(admin).get(`/organisations/${shared}`)).data.name })).status).toBe(200); // unchanged value is not a change
    expect((await api(admin).patch(`/organisations/${shared}`, { name: `Admin renamed ${uniq()}` })).status).toBe(200);
    expect((await api(admin).post('/cases', { orgId: theirs, startState: 'PROSPECT' })).status).toBe(201);
    expect((await api(pm).patch(`/organisations/${theirs}`, { name: `Late rename ${uniq()}` })).status).toBe(403);
  });
});

describe('expert and programme manager guardrails', () => {
  it('hides tax number and contacts on unclaimed organisations, shows them on own cases, and blocks edits and case opening', async () => {
    const { api, makeOrg, makeUser } = await import('./helpers');
    const admin = await makeUser('ADMIN'), expert = await makeUser('EXPERT'), other = await makeUser('EXPERT');
    const org = await makeOrg(admin);
    await api(admin).patch(`/organisations/${org.id}`, { tin: `TIN${Math.floor(Math.random() * 1e9)}`, contactName: 'Hidden Person', contactEmail: 'hidden@example.org', contactPhone: '0240000000' });
    const seen = (await api(expert).get(`/organisations/${org.id}`)).data;
    expect(seen.contactHidden).toBe(true); expect(seen.tin).toBeNull(); expect(seen.contactEmail).toBeNull(); expect(seen.contactName).toBeNull();
    const row = (await api(expert).get(`/organisations?q=${encodeURIComponent(org.code)}&pageSize=50`)).data.items.find((r: any) => r.id === org.id);
    expect(row.contactHidden).toBe(true); expect(row.contactPhone).toBeNull(); expect(row).not.toHaveProperty('mine');
    expect((await api(expert).patch(`/organisations/${org.id}`, { contactEmail: 'x@example.org' })).status).toBe(403);
    expect((await api(expert).patch(`/organisations/${org.id}`, { sector: 'Grains' })).status).toBe(200);
    expect((await api(expert).post('/cases', { orgId: org.id })).status).toBe(403);
    expect((await api(admin).get(`/organisations/${org.id}`)).data.tin).toBeTruthy();
    // a case opened by an administrator with this expert as lead makes the details visible to that expert only
    const c = (await api(admin).post('/cases', { orgId: org.id })).data;
    const { schema } = await import('@/db/client'); const { eq } = await import('drizzle-orm');
    await db().update(schema.cases).set({ consultantId: expert.userId }).where(eq(schema.cases.id, c.id));
    const after = (await api(expert).get(`/organisations/${org.id}`)).data;
    expect(after.contactHidden).toBeUndefined(); expect(after.contactEmail).toBe('hidden@example.org');
    expect((await api(other).get(`/organisations/${org.id}`)).status).toBeLessThan(500);
  });
  it('an expert may open a case only for an organisation they registered, or inside a programme they belong to', async () => {
    const { api, makeOrg, makeUser } = await import('./helpers');
    const admin = await makeUser('ADMIN'), expert = await makeUser('EXPERT');
    const mineOrg = (await api(expert).post('/organisations', { name: `Mine ${Date.now()}`, region: 'Northern', consent: true, consentBy: 'Owner' }));
    expect(mineOrg.status).toBeLessThan(300);
    expect((await api(expert).post('/cases', { orgId: mineOrg.data.id })).status).toBeLessThan(300);
    const prog = (await api(admin).post('/programmes', { name: `P ${Date.now()}`, startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 1000 })).data;
    await api(admin).patch(`/programmes/${prog.id}`, { status: 'Active' });
    const org = await makeOrg(admin);
    expect((await api(expert).post('/cases', { orgId: org.id, programmeId: prog.id })).status).toBe(403);
  });
});
