import { beforeAll, describe, expect, it } from 'vitest';
import { call, ensureReference } from './helpers';
import { pool } from '@/db/client';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
beforeAll(async () => { await ensureReference(); });

describe('Ghana districts', () => {
  it('loads 261 assemblies under the 16 regions, 6 of them Metropolitan, each with its source', async () => {
    const r = (await q(`select count(*)::int n, count(*) filter (where name like '% Metropolitan')::int metros, count(distinct parent_id)::int regions, count(*) filter (where source is null)::int nosrc from geo_units where country_code='GH' and level=2`)).rows[0];
    expect(r).toEqual({ n: 261, metros: 6, regions: 16, nosrc: 0 });
  });
  it('serves the districts of a region, and nothing for an unknown region', async () => {
    const r = await call('GET', '/auth/districts?region=Northern');
    expect(r.status).toBe(200); expect(r.data.districts).toHaveLength(16);
    expect(r.data.districts).toContain('Tamale Metropolitan'); expect(r.data.districts).toContain('Sagnarigu Municipal'); expect(r.data.districts).toContain('Karaga District');
    expect((await call('GET', '/auth/districts?region=Nowhere')).data.districts).toEqual([]);
    expect((await call('GET', '/auth/districts')).status).toBe(400);
  });
  it('the migration is safe to run twice', async () => {
    const sql = (await import('node:fs')).readFileSync('migrations/0020_ghana_districts.sql', 'utf8');
    await q(sql);
    expect((await q(`select count(*)::int n from geo_units where country_code='GH' and level=2`)).rows[0].n).toBe(261);
  });
  it('migration timestamps only ever increase, or a database that has run an earlier one would skip the new one', async () => {
    const j = JSON.parse((await import('node:fs')).readFileSync('migrations/meta/_journal.json', 'utf8')).entries as { when: number; tag: string }[];
    for (let i = 1; i < j.length; i++) expect(j[i].when, j[i].tag).toBeGreaterThan(j[i - 1].when);
  });
});
