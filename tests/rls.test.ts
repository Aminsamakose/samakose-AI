import { describe, it, expect, afterAll } from 'vitest';
import { pool, closeDb } from '@/db/client';

describe('hosted Postgres hardening', () => {
  afterAll(async () => { await closeDb(); });
  it('enables row level security on every public table', async () => {
    const r = await pool().query(`select tablename from pg_tables t join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace where t.schemaname = 'public' and not c.relrowsecurity`);
    expect(r.rows).toEqual([]);
  });
  it('the owner role the app uses still reads its tables', async () => {
    const r = await pool().query('select count(*)::int n from users');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(0);
  });
});
