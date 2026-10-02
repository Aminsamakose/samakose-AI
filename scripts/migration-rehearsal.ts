/**
 * Migration rehearsal and history.
 *
 *   rehearse  (default)  Creates a throwaway database on the server in ADMIN_DATABASE_URL, applies every migration from scratch,
 *                        checks that every public table has row level security, then drops the database. Safe to run any time.
 *   status               Shows which journal migrations are recorded in drizzle.__drizzle_migrations on DATABASE_URL.
 *   baseline --write     Records the journal migrations as already applied on DATABASE_URL, for a database that was migrated by hand.
 *                        Without --write it only prints what it would record. Run it once, after confirming the schema matches.
 *
 *   ADMIN_DATABASE_URL=postgres://user@host:5433/postgres npx tsx scripts/migration-rehearsal.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const folder = path.join(process.cwd(), 'migrations');
const journal: { entries: { tag: string; when: number }[] } = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'));
const hashOf = (tag: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, `${tag}.sql`))).digest('hex');
const withDb = (url: string, name: string) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const mode = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'rehearse';

async function rehearse() {
  const admin = process.env.ADMIN_DATABASE_URL; if (!admin) throw new Error('Set ADMIN_DATABASE_URL (a role that can create databases)');
  const name = `rehearsal_${Date.now()}`; const a = new Client({ connectionString: admin }); await a.connect();
  await a.query(`create database ${name}`);
  const t0 = Date.now(); const c = new Client({ connectionString: withDb(admin, name) }); await c.connect();
  try {
    await migrate(drizzle(c), { migrationsFolder: folder });
    const tables = (await c.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`)).rows;
    const noRls = tables.filter((t) => !t.relrowsecurity).map((t) => t.relname);
    const applied = (await c.query(`select count(*)::int n from drizzle.__drizzle_migrations`)).rows[0].n;
    console.log(`Applied ${applied} of ${journal.entries.length} migrations to a fresh database in ${Date.now() - t0} ms. ${tables.length} tables.`);
    if (applied !== journal.entries.length) throw new Error('Migration count mismatch');
    if (noRls.length) throw new Error(`Tables without row level security: ${noRls.join(', ')}`);
    console.log('Row level security is on for every public table. Rehearsal passed.');
  } finally { await c.end(); await a.query(`drop database if exists ${name}`); await a.end(); }
}

async function history(write: boolean) {
  const url = process.env.DATABASE_URL; if (!url) throw new Error('Set DATABASE_URL');
  const c = new Client({ connectionString: url }); await c.connect();
  try {
    await c.query('create schema if not exists drizzle');
    await c.query('create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)');
    const have = new Set((await c.query('select hash from drizzle.__drizzle_migrations')).rows.map((r) => r.hash));
    const todo = journal.entries.filter((e) => !have.has(hashOf(e.tag)));
    console.log(`${journal.entries.length - todo.length} recorded, ${todo.length} not recorded${todo.length ? ': ' + todo.map((e) => e.tag).join(', ') : ''}`);
    if (mode === 'baseline') {
      if (!write) { console.log('Dry run. Add --write to record them as already applied.'); return; }
      for (const e of todo) await c.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [hashOf(e.tag), e.when]);
      console.log(`Recorded ${todo.length} migrations.`);
    }
  } finally { await c.end(); }
}

(mode === 'rehearse' ? rehearse() : history(process.argv.includes('--write'))).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
