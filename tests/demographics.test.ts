import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { call, ensureReference, makeUser, makeOrg, api } from './helpers';
import { pool } from '@/db/client';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
/** Other test files retire high-numbered notices, so each test makes sure its own are Published. */
async function open(purposes = ['demographics', 'disability']) {
  for (const p of purposes) {
    await q(`update consent_notices set status='Retired' where purpose=$1 and country_code='GH' and status='Published' and version<>951`, [p]);
    await q(`insert into consent_notices (purpose,country_code,version,text,status) values ($1,'GH',951,$2,'Published') on conflict (purpose,country_code,version) do update set status='Published'`, [p, `${p} wording`]);
  }
}
const mine = async (s: any) => (await api(s).get('/me/demographics')).data;
const rowsOf = async (id: string) => (await q(`select category, fields from demographic_profiles where subject_id=$1 order by category`, [id])).rows;
const consentsOf = async (id: string) => (await q(`select n.purpose, c.action, c.source from consents c join consent_notices n on n.id=c.notice_id where c.user_id=$1 order by c.at, c.id`, [id])).rows;

let admin0: any;
beforeAll(async () => { await ensureReference(); admin0 = await makeUser('ADMIN'); });
const owner = async () => makeUser('OWNER', { orgId: (await makeOrg(admin0)).id });
afterAll(async () => { await q(`update consent_notices set status='Retired' where version=951`); });

describe('optional demographics and disability', () => {
  it('stores nothing and says so when no wording is Published', async () => {
    await q(`update consent_notices set status='Retired' where purpose in ('demographics','disability') and country_code='GH' and status='Published'`);
    const u = await owner();
    const r = await api(u).put('/me/demographics/demographics', { gender: 'Female', ageBand: '25-35' });
    expect(r.status).toBe(422); expect(await rowsOf(u.userId)).toEqual([]); expect(await consentsOf(u.userId)).toEqual([]);
  });

  it('saves under its own consent, recorded against the wording shown, and reads it back', async () => {
    await open(); const u = await owner();
    expect((await mine(u)).demographics.granted).toBe(false);
    expect((await api(u).put('/me/demographics/demographics', { gender: 'Female', ageBand: '25-35' })).status).toBe(200);
    expect(await consentsOf(u.userId)).toEqual([{ purpose: 'demographics', action: 'granted', source: 'profile' }]);
    const m = await mine(u); expect(m.demographics.granted).toBe(true); expect(m.demographics.fields).toEqual({ gender: 'Female', ageBand: '25-35' });
    expect(m.disability.granted).toBe(false);
  });

  it('disability needs its own separate consent and never rides on the demographics one', async () => {
    await open(); const u = await owner();
    await api(u).put('/me/demographics/demographics', { gender: 'Male', ageBand: '36-45' });
    expect((await rowsOf(u.userId)).map((r: any) => r.category)).toEqual(['demographics']);
    await api(u).put('/me/demographics/disability', { status: 'No' });
    expect((await consentsOf(u.userId)).map((c: any) => c.purpose)).toEqual(['demographics', 'disability']);
  });

  it('rejects answers outside the offered options', async () => {
    await open(); const u = await owner();
    const r = await api(u).put('/me/demographics/demographics', { gender: 'x', ageBand: '25-35' }); expect(r.status).toBe(400);
    expect((await api(u).put('/me/demographics/disability', {})).status).toBe(400);
    expect((await api(u).put('/me/demographics/other', { status: 'No' })).status).toBeGreaterThanOrEqual(400);
  });

  it('withdrawing writes a withdrawal row, deletes the answers and keeps the history', async () => {
    await open(); const u = await owner();
    await api(u).put('/me/demographics/disability', { status: 'Yes' });
    expect((await api(u).del('/me/demographics/disability')).status).toBe(200);
    expect(await rowsOf(u.userId)).toEqual([]);
    expect((await consentsOf(u.userId)).map((c: any) => c.action)).toEqual(['granted', 'withdrawn']);
    expect((await mine(u)).disability.granted).toBe(false);
    // Answering again after withdrawal is a fresh grant.
    await api(u).put('/me/demographics/disability', { status: 'No' });
    expect((await consentsOf(u.userId)).map((c: any) => c.action)).toEqual(['granted', 'withdrawn', 'granted']);
  });

  it('the database refuses an answer with no matching consent', async () => {
    await open(); const u = await owner();
    await api(u).put('/me/demographics/demographics', { gender: 'Female', ageBand: '18-24' });
    const c = (await q(`select id from consents where user_id=$1`, [u.userId])).rows[0].id;
    await expect(q(`insert into demographic_profiles (subject_type,subject_id,category,fields,consent_id) values ('user',$1,'disability','{}',$2)`, [u.userId, c])).rejects.toThrow();
  });

  it('audit records that a choice was made, never the answer', async () => {
    await open(); const u = await owner();
    await api(u).put('/me/demographics/disability', { status: 'Yes' });
    const a = (await q(`select action, "after", "before" from audit_log where entity_id=$1 and action like 'demographics.%'`, [u.userId])).rows;
    expect(a.map((r: any) => r.action)).toEqual(['demographics.disability_saved']);
    expect(JSON.stringify(a)).not.toMatch(/Yes/);
  });

  it('totals are for Administrator and Executive only, and small groups are hidden', async () => {
    await open();
    const admin = await makeUser('ADMIN'); const exec = await makeUser('EXECUTIVE');
    for (let i = 0; i < 5; i++) { const o = await owner(); await api(o).put('/me/demographics/demographics', { gender: 'Female', ageBand: '56+' }); }
    const lone = await owner(); await api(lone).put('/me/demographics/demographics', { gender: 'Prefer not to say', ageBand: 'Prefer not to say' });
    for (const s of [admin, exec]) {
      const r = await api(s).get('/admin/demographics'); expect(r.status).toBe(200);
      const min = r.data.minGroupSize;
      for (const row of [...r.data.demographics.gender, ...r.data.demographics.ageBand, ...r.data.disability.status]) expect(row.n === null || row.n >= min).toBe(true);
      expect(r.data.demographics.gender.find((x: any) => x.key === 'Female').n).toBeGreaterThanOrEqual(5);
    }
    // No names, emails or ids in the totals.
    expect(JSON.stringify((await api(admin).get('/admin/demographics')).data)).not.toMatch(/@|userId/);
    for (const role of ['EXPERT', 'REVIEWER', 'FINANCE', 'OWNER', 'FUNDER', 'PROGRAMME_MANAGER'] as const) {
      const s = role === 'OWNER' ? await owner() : await makeUser(role as any); expect((await api(s).get('/admin/demographics')).status, role).toBe(403);
    }
    expect((await call('GET', '/admin/demographics')).status).toBe(401);
  });

  it('a person only ever reads their own answers', async () => {
    await open(); const a = await owner(); const b = await owner();
    await api(a).put('/me/demographics/disability', { status: 'Yes' });
    expect((await mine(b)).disability.fields).toBeNull();
  });
});

describe('next best action and region suggestion', () => {
  it('follows the assessment mode chosen at registration, without promising invitations', async () => {
    const u = await owner();
    const set = (m: string, role = 'OWNER') => q(`insert into registration_answers (user_id,platform,job_role,assessment_mode) values ($1,'SME360',$2,$3) on conflict (user_id) do update set assessment_mode=$3, job_role=$2`, [u.userId, role, m]);
    await set('self'); expect((await api(u).get('/me/next-step')).data.key).toBe('own_assessment');
    await set('hybrid'); expect((await api(u).get('/me/next-step')).data.key).toBe('expert_help');
    await set('team'); const t = (await api(u).get('/me/next-step')).data; expect(t.key).toBe('team_later'); expect(t.body).toMatch(/coming soon/);
  });
  it('offers the registration region as a suggestion and records whether it was confirmed or changed', async () => {
    const reg = (await q(`select id, name from geo_units where country_code='GH' and level=1 and name in ('Northern','Ashanti') order by name`)).rows; const ash = reg[0], north = reg[1];
    for (const [pick, expected] of [[north, 'confirmed'], [ash, 'changed']] as const) {
      const orgId = (await makeOrg(admin0)).id; await q(`update organisations set region=null, geo_unit_id=$1 where id=$2`, [north.id, orgId]);
      const ow = await makeUser('OWNER', { orgId }); await q(`update users set profile_required=true where id=$1`, [ow.userId]);
      const p = (await api(ow).get('/auth/profile')).data; expect(p.suggestedRegion).toBe('Northern');
      const body = { name: 'Sug Farms', type: 'SME', sector: 'Grains', region: pick.name, district: 'Tamale', size: '1-5', contactPhone: '0244000111', consent: true };
      expect((await api(ow).put('/auth/profile', body)).status).toBe(200);
      const a = (await q(`select "after" from audit_log where entity_id=$1 and action='user.profile_completed'`, [orgId])).rows[0].after;
      expect(a.regionSuggestion).toBe(expected);
      expect((await q(`select geo_unit_id from organisations where id=$1`, [orgId])).rows[0].geo_unit_id).toBe(pick.id);
    }
  });
});

describe('guards on how demographics are used', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  it('no scoring, diagnosis, report or expert code reads demographics', () => {
    const files = ['src/domain/logic.ts', 'src/services/clinical.ts', 'src/services/diagnostics.ts', 'src/services/reports.ts', 'src/services/evidence.ts', 'src/services/cases.ts', 'src/services/frameworks.ts', 'src/services/certificates.ts', 'src/domain/certification.ts'];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/demographic|disabilit/i);
  });
  it('only the demographics service and its routes touch the table', () => {
    const users = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && /demographicProfiles|demographic_profiles/.test(readFileSync(f, 'utf8')));
    expect(users.sort()).toEqual(['src/db/schema.ts', 'src/services/demographics.ts']);
  });
});
