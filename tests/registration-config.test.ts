import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, ensureReference, makeUser, PASSWORD, uniq, type Session } from './helpers';
import { pool } from '@/db/client';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
const GOOD = 'I agree that Samakose may keep my details to run my account, as described in the privacy notice shown here.';
let admin: Session; let expert: Session; let exec: Session;

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); expert = await makeUser('EXPERT'); exec = await makeUser('EXECUTIVE');
  await q(`insert into country_settings (country_code,name,currency,phone_code,active) values ('QR','Test','XXX','+0',true) on conflict do nothing`);
});
afterAll(async () => {
  await q(`delete from consent_notices where country_code='QR'`); await q(`delete from country_settings where country_code='QR'`);
  await q(`delete from role_mappings where note like 'test-%'`);
  // Restore the shipped default if a test left a published mapping behind.
});

describe('consent notices (administrator)', () => {
  it('only the administrator can create, edit or publish; an executive can read', async () => {
    expect((await call('POST', '/admin/consent-notices', { cookie: expert.cookie, body: { purpose: 'account', countryCode: 'QR', text: GOOD } })).status).toBe(403);
    expect((await call('GET', '/admin/consent-notices?country=QR', { cookie: exec.cookie })).status).toBe(200);
    expect((await call('POST', '/admin/consent-notices', { cookie: exec.cookie, body: { purpose: 'account', countryCode: 'QR', text: GOOD } })).status).toBe(403);
  });
  it('creates drafts as versions, edits a draft, publishes one and retires the previous', async () => {
    const a = await call('POST', '/admin/consent-notices', { cookie: admin.cookie, body: { purpose: 'account', countryCode: 'QR', text: GOOD } });
    expect(a.status).toBe(201); expect(a.data.version).toBe(1); expect(a.data.status).toBe('Draft');
    const e = await call('PATCH', `/admin/consent-notices/${a.data.id}`, { cookie: admin.cookie, body: { text: GOOD + ' Edited.' } });
    expect(e.data.text).toMatch(/Edited/);
    expect((await call('POST', `/admin/consent-notices/${a.data.id}/publish`, { cookie: admin.cookie, body: {} })).data.status).toBe('Published');
    // Published wording is frozen.
    const frozen = await call('PATCH', `/admin/consent-notices/${a.data.id}`, { cookie: admin.cookie, body: { text: GOOD + ' Changed after publishing.' } });
    expect(frozen.status).toBe(422);
    const b = await call('POST', '/admin/consent-notices', { cookie: admin.cookie, body: { purpose: 'account', countryCode: 'QR', text: GOOD + ' Version two.' } });
    expect(b.data.version).toBe(2);
    await call('POST', `/admin/consent-notices/${b.data.id}/publish`, { cookie: admin.cookie, body: {} });
    const list = (await call('GET', '/admin/consent-notices?country=QR', { cookie: admin.cookie })).data.items;
    expect(list.filter((n: any) => n.status === 'Published').map((n: any) => n.version)).toEqual([2]);
    expect(list.find((n: any) => n.version === 1).status).toBe('Retired');
    const audit = (await q(`select action from audit_log where entity='consent_notice' and entity_id=$1`, [b.data.id])).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['consent_notice.created', 'consent_notice.published']));
  });
  it('rejects unknown purposes, closed countries and wording that is too short', async () => {
    expect((await call('POST', '/admin/consent-notices', { cookie: admin.cookie, body: { purpose: 'marketing', countryCode: 'QR', text: GOOD } })).status).toBe(400);
    expect((await call('POST', '/admin/consent-notices', { cookie: admin.cookie, body: { purpose: 'account', countryCode: 'ZZ', text: GOOD } })).status).toBe(400);
    expect((await call('POST', '/admin/consent-notices', { cookie: admin.cookie, body: { purpose: 'account', countryCode: 'QR', text: 'Too short' } })).status).toBe(400);
  });
});

describe('role mapping (administrator)', () => {
  const note = `test-${uniq()}`;
  it('starts a draft from the shipped default and refuses a mapping that names an unknown role', async () => {
    const d = await call('POST', '/admin/role-mappings', { cookie: admin.cookie, body: { frameworkCode: 'SME360', note } });
    expect(d.status).toBe(201); expect(d.data.status).toBe('Draft'); expect(Object.keys(d.data.data.map).length).toBeGreaterThan(20);
    const bad = JSON.parse(JSON.stringify(d.data.data)); bad.map[Object.keys(bad.map)[0]].primary = ['NOT_A_ROLE'];
    expect((await call('PATCH', `/admin/role-mappings/${d.data.id}`, { cookie: admin.cookie, body: { data: bad } })).status).toBe(400);
    expect((await call('POST', '/admin/role-mappings', { cookie: admin.cookie, body: { frameworkCode: 'XYZ' } })).status).toBe(400);
    expect((await call('POST', '/admin/role-mappings', { cookie: expert.cookie, body: { frameworkCode: 'SME360' } })).status).toBe(403);
  });
  it('publishing needs an approver, retires the previous version, and registration then uses the published roles', async () => {
    const d = await call('POST', '/admin/role-mappings', { cookie: admin.cookie, body: { frameworkCode: 'ESO360', note } });
    const edited = JSON.parse(JSON.stringify(d.data.data)); edited.roles.EXEC = 'Executive Director (test label)';
    await call('PATCH', `/admin/role-mappings/${d.data.id}`, { cookie: admin.cookie, body: { data: edited } });
    const p = await call('POST', `/admin/role-mappings/${d.data.id}/publish`, { cookie: admin.cookie, body: {} });
    expect(p.data.status).toBe('Published'); expect(p.data.approvedBy).toBeTruthy(); expect(p.data.approvedAt).toBeTruthy();
    expect((await call('PATCH', `/admin/role-mappings/${d.data.id}`, { cookie: admin.cookie, body: { note: 'x' } })).status).toBe(422);
    const opts = await call('GET', '/auth/registration-options');
    expect(opts.data.roles.ESO360.EXEC).toBe('Executive Director (test label)');
    const d2 = await call('POST', '/admin/role-mappings', { cookie: admin.cookie, body: { frameworkCode: 'ESO360', note } });
    await call('POST', `/admin/role-mappings/${d2.data.id}/publish`, { cookie: admin.cookie, body: {} });
    const list = (await call('GET', '/admin/role-mappings', { cookie: admin.cookie })).data.items.filter((m: any) => m.frameworkCode === 'ESO360');
    expect(list.filter((m: any) => m.status === 'Published').length).toBe(1);
    expect(list.find((m: any) => m.id === d.data.id).status).toBe('Retired');
    // Cleanup so other tests see the shipped default again.
    await q(`delete from role_mappings where note=$1`, [note]);
    expect((await call('GET', '/auth/registration-options')).data.roles.ESO360.EXEC).not.toMatch(/test label/);
  });
});
