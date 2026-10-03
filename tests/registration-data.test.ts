import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, closeDb } from '@/db/client';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
const fails = async (sql: string, p: unknown[] = []) => { try { await q(sql, p); return null; } catch (e: any) { return String(e.message); } };

describe('registration routing data (migration 0019)', () => {
  let userId = ''; let noticeId = ''; let disabilityNoticeId = ''; let grantId = ''; let disabilityGrantId = '';
  const email = `reg-data-${Date.now()}@example.test`;

  beforeAll(async () => {
    userId = (await q(`insert into users (email, name, role) values ($1, 'Reg Data Test', 'ADMIN') returning id`, [email])).rows[0].id;
    noticeId = (await q(`insert into consent_notices (purpose, country_code, version, text, status) values ('demographics','GH',900,'test wording','Published') returning id`)).rows[0].id;
    disabilityNoticeId = (await q(`insert into consent_notices (purpose, country_code, version, text, status) values ('disability','GH',900,'test wording','Published') returning id`)).rows[0].id;
    grantId = (await q(`insert into consents (user_id, notice_id, action, source) values ($1,$2,'granted','profile') returning id`, [userId, noticeId])).rows[0].id;
    disabilityGrantId = (await q(`insert into consents (user_id, notice_id, action, source) values ($1,$2,'granted','profile') returning id`, [userId, disabilityNoticeId])).rows[0].id;
  });
  afterAll(async () => {
    // Consents are append-only, so the test notices are retired, not deleted, to leave the test database usable.
    await q(`update consent_notices set status='Retired' where version=900`);
    await closeDb();
  });

  it('ships Ghana with its sixteen regions and country-aware settings', async () => {
    const c = (await q(`select * from country_settings where country_code='GH'`)).rows[0];
    expect(c.currency).toBe('GHS'); expect(c.youth_max_age).toBe(35); expect(c.level_labels).toEqual(['Region', 'District', 'Community']);
    expect((await q(`select count(*)::int n from geo_units where country_code='GH' and level=1`)).rows[0].n).toBe(16);
  });

  it('rejects a country code that is not two capital letters, and a youth age outside 15 to 45', async () => {
    expect(await fails(`insert into country_settings (country_code,name,currency,phone_code) values ('gh2','X','X','+1')`)).toMatch(/country_code_iso2/);
    expect(await fails(`insert into country_settings (country_code,name,currency,phone_code,youth_max_age) values ('ZZ','X','X','+1',60)`)).toMatch(/country_youth_age_valid/);
  });

  it('keeps consent append-only: no edits, no deletes', async () => {
    expect(await fails(`update consents set action='withdrawn' where id=$1`, [grantId])).toMatch(/append-only/);
    expect(await fails(`delete from consents where id=$1`, [grantId])).toMatch(/append-only/);
    // A withdrawal is a new row.
    await q(`insert into consents (user_id, notice_id, action, source) values ($1,$2,'withdrawn','profile')`, [userId, noticeId]);
  });

  it('allows one published consent notice per purpose and country', async () => {
    expect(await fails(`insert into consent_notices (purpose, country_code, version, text, status) values ('demographics','GH',901,'again','Published')`)).toMatch(/consent_notice_one_published/);
  });

  it('refuses demographic data without a granted consent, or with a consent for another purpose', async () => {
    const org = (await q(`insert into organisations (name) values ('Reg Data Org') returning id`)).rows[0].id;
    const withdrawn = (await q(`insert into consents (user_id, notice_id, action, source) values ($1,$2,'withdrawn','profile') returning id`, [userId, noticeId])).rows[0].id;
    expect(await fails(`insert into demographic_profiles (subject_type, subject_id, category, consent_id) values ('organisation',$1,'demographics',$2)`, [org, withdrawn])).toMatch(/needs a recorded consent/);
    expect(await fails(`insert into demographic_profiles (subject_type, subject_id, category, consent_id) values ('organisation',$1,'disability',$2)`, [org, grantId])).toMatch(/different purpose/);
    await q(`insert into demographic_profiles (subject_type, subject_id, category, fields, consent_id) values ('organisation',$1,'disability','{"ownerHasDisability":"prefer_not_to_say"}',$2)`, [org, disabilityGrantId]);
    expect((await q(`select count(*)::int n from demographic_profiles where subject_id=$1`, [org])).rows[0].n).toBe(1);
  });

  it('allows only one published role mapping per framework, and publishing needs an approver', async () => {
    expect(await fails(`insert into role_mappings (framework_code, version, status, data) values ('SME360', 9001, 'Published', '{}')`)).toMatch(/role_mapping_published_needs_approval/);
    await q(`insert into role_mappings (framework_code, version, status, data, approved_by, approved_at) values ('SME360', 9001, 'Published', '{}', $1, now())`, [userId]);
    expect(await fails(`insert into role_mappings (framework_code, version, status, data, approved_by, approved_at) values ('SME360', 9002, 'Published', '{}', $1, now())`, [userId])).toMatch(/role_mapping_one_published/);
    await q(`update role_mappings set status='Retired' where framework_code='SME360' and version=9001`);
  });

  it('validates registration answers and organisation location fields', async () => {
    expect(await fails(`insert into registration_answers (user_id, platform, job_role, assessment_mode) values ($1,'SME360','OWNER','solo')`, [userId])).toMatch(/reg_mode_valid/);
    expect(await fails(`insert into registration_answers (user_id, platform, job_role, assessment_mode) values ($1,'OTHER','OWNER','self')`, [userId])).toMatch(/reg_platform_valid/);
    expect(await fails(`insert into organisations (name, urban_rural) values ('Bad Place','Suburb')`)).toMatch(/org_urban_rural_valid/);
    expect(await fails(`insert into organisations (name, country_code) values ('Bad Country','XX')`)).toMatch(/foreign key|country_settings/);
    const o = (await q(`insert into organisations (name) values ('Default Country Org') returning country_code`)).rows[0];
    expect(o.country_code).toBe('GH');
  });

  it('the application role owns every new table', async () => {
    const r = await q(`select tablename, tableowner from pg_tables where schemaname='public' and tablename in ('country_settings','geo_units','consent_notices','consents','registration_answers','role_mappings','demographic_profiles') and tableowner <> current_user`);
    // On a database without the app role, the owner is whoever ran the migrations; the rule is that it is the connecting role.
    expect(r.rows).toEqual([]);
  });
});
