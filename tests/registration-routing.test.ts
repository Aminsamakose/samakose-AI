import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, ensureReference, PASSWORD, uniq } from './helpers';
import { db, pool, schema } from '@/db/client';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
const reg = (o: Record<string, unknown> = {}) => ({ name: 'Ama Mensah', email: `ama.${uniq()}@example.org`, password: PASSWORD, role: 'OWNER', orgName: 'Mensah Foods', orgType: 'AGRIFOOD', consent: true, ...o });
const userOf = async (email: string) => (await db().select().from(schema.users).where(eq(schema.users.email, email)))[0];
const consentsOf = async (id: string) => (await q(`select n.purpose, c.action, c.source, n.version from consents c join consent_notices n on n.id=c.notice_id where c.user_id=$1 order by n.purpose`, [id])).rows;
const ROUTING = { jobRole: 'OWNER', assessmentMode: 'team' };
let region = '';

beforeAll(async () => {
  await ensureReference();
  region = (await q(`select id from geo_units where country_code='GH' and level=1 and name='Northern'`)).rows[0].id;
});
afterAll(async () => { await q(`update consent_notices set status='Retired' where version >= 901`); await q(`delete from country_settings where country_code='QQ'`); });

describe('consent-first registration', () => {
  it('serves registration options: Ghana, 16 regions, role choices, and only Published wording', async () => {
    const r = await call('GET', '/auth/registration-options');
    expect(r.status).toBe(200); expect(r.data.country.code).toBe('GH'); expect(r.data.regions.length).toBe(16);
    expect(Object.keys(r.data.roles.SME360)).toContain('FINANCE'); expect(r.data.modes).toEqual(['self', 'team', 'hybrid']);
    expect(r.data.notices.every((n: any) => n.text)).toBe(true);
  });
  it('refuses a country that is not open, and a location from another country', async () => {
    expect((await call('GET', '/auth/registration-options?country=ZZ')).status).toBe(400);
    const b = reg({ countryCode: 'ZZ' }); expect((await call('POST', '/auth/register', { body: b })).status).toBe(400);
    await q(`insert into country_settings (country_code,name,currency,phone_code,active) values ('QQ','Test','XXX','+0',true) on conflict do nothing`);
    const b2 = reg({ countryCode: 'QQ', geoUnitId: region }); const r = await call('POST', '/auth/register', { body: b2 });
    expect(r.status).toBe(400); expect(r.error.fields?.geoUnitId ?? r.error.message).toBeTruthy();
  });

  it('with no Published notice nothing is recorded as consent and routing answers are not stored', async () => {
    await q(`update consent_notices set status='Retired' where status='Published' and purpose in ('account','assessment') and country_code='GH'`);
    const b = reg({ routing: ROUTING, consentPurposes: ['assessment'] }); expect((await call('POST', '/auth/register', { body: b })).status).toBe(200);
    const u = await userOf(b.email);
    expect(await consentsOf(u.id)).toEqual([]);
    expect((await q(`select 1 from registration_answers where user_id=$1`, [u.id])).rowCount).toBe(0);
  });

  describe('with Published notices', () => {
    beforeAll(async () => {
      await q(`insert into consent_notices (purpose,country_code,version,text,status) values ('account','GH',901,'account wording','Published'),('assessment','GH',901,'assessment wording','Published')`);
    });
    it('records consent against the exact wording, and the owner organisation gets country and location', async () => {
      const b = reg({ geoUnitId: region, routing: ROUTING, consentPurposes: ['assessment'] }); const rr = await call('POST', '/auth/register', { body: b }); expect(rr.status, JSON.stringify(rr.error)).toBe(200);
      const u = await userOf(b.email);
      expect(await consentsOf(u.id)).toEqual([{ purpose: 'account', action: 'granted', source: 'registration', version: 901 }, { purpose: 'assessment', action: 'granted', source: 'registration', version: 901 }]);
      const a = (await q(`select * from registration_answers where user_id=$1`, [u.id])).rows[0];
      expect(a.platform).toBe('AGRIFOOD360'); expect(a.job_role).toBe('OWNER'); expect(a.assessment_mode).toBe('team'); expect(a.suggestion_source).toBe('user');
      const o = (await q(`select country_code, geo_unit_id from organisations where id=$1`, [u.orgId])).rows[0];
      expect(o.country_code).toBe('GH'); expect(o.geo_unit_id).toBe(region);
    });
    it('without assessment consent, routing answers are not stored', async () => {
      const b = reg({ routing: ROUTING }); await call('POST', '/auth/register', { body: b });
      const u = await userOf(b.email);
      expect((await consentsOf(u.id)).map((c) => c.purpose)).toEqual(['account']);
      expect((await q(`select 1 from registration_answers where user_id=$1`, [u.id])).rowCount).toBe(0);
    });
    it('still refuses registration without the consent box', async () => {
      const r = await call('POST', '/auth/register', { body: reg({ consent: false }) }); expect(r.status).toBe(400);
    });
    it('validates the role against the platform, and needs a description for Other', async () => {
      const bad = await call('POST', '/auth/register', { body: reg({ orgType: 'SME', routing: { jobRole: 'PRODUCTION', assessmentMode: 'self' } }) });
      expect(bad.status).toBe(400);
      const other = await call('POST', '/auth/register', { body: reg({ routing: { jobRole: 'OTHER', assessmentMode: 'self' } }) });
      expect(other.status).toBe(400);
      const ok = reg({ routing: { jobRole: 'OTHER', jobRoleOther: 'Farm manager', assessmentMode: 'self' }, consentPurposes: ['assessment'] });
      expect((await call('POST', '/auth/register', { body: ok })).status).toBe(200);
      const a = (await q(`select job_role_other from registration_answers where user_id=$1`, [(await userOf(ok.email)).id])).rows[0];
      expect(a.job_role_other).toBe('Farm manager');
    });
  });
});
