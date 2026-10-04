import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ensureReference } from './helpers';
import { pool } from '@/db/client';

beforeAll(async () => { await ensureReference(); await pool().query(fs.readFileSync(path.resolve(process.cwd(), 'migrations/0027_intervention_library_v2.sql'), 'utf8')); });

describe('intervention library aligned to the live framework', () => {
  it('has at least three items for each dimension of the SME360 framework, and none on an old name', async () => {
    const bank = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'docs/frameworks/drafts/sme360-bank-v1-loadable.json'), 'utf8'));
    const dims = Array.from(new Set((bank.questions as any[]).map((q) => q.dimension)));
    expect(dims).toHaveLength(8);
    const { rows } = await pool().query('select dimension, count(*)::int n from library_items where active group by 1');
    const by = new Map(rows.map((r: any) => [r.dimension, r.n]));
    for (const d of dims) expect(by.get(d) ?? 0, d).toBeGreaterThanOrEqual(3);
    expect(rows.every((r: any) => dims.includes(r.dimension))).toBe(true);
  });
  it('keeps the original codes and is safe to run twice', async () => {
    await pool().query(fs.readFileSync(path.resolve(process.cwd(), 'migrations/0027_intervention_library_v2.sql'), 'utf8'));
    const { rows } = await pool().query(`select count(*)::int n from library_items where code ~ '^IVL-0(0[1-9]|1[0-9]|2[0-8])$'`);
    expect(rows[0].n).toBe(28);
  });
});
