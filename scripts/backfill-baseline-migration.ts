/**
 * One-time companion to the migrations/0000_baseline_squash.sql squash (see migrations/_archive/README.md).
 *
 * Run this exactly once against any database that already has the full schema from the old
 * 0001-0070 migration chain applied (i.e. any database that was migrated before this squash).
 * It tells Drizzle's own migration tracking table that the new single baseline migration is
 * already applied, so `npm run db:migrate` does not try to re-run it (which would fail with
 * "relation already exists", since the schema is already there).
 *
 * It is idempotent and safe to run on a brand-new, not-yet-migrated database too: in that case
 * it does nothing (the normal `db:migrate` run will apply the baseline for real), because it only
 * inserts the marker when the database already has tables from the old chain and does not already
 * have this exact hash recorded.
 *
 * Usage: DATABASE_URL=postgres://... npx tsx scripts/backfill-baseline-migration.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Set DATABASE_URL first.');

  const migrationsDir = path.join(process.cwd(), 'migrations');
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'));
  const entry = journal.entries[0];
  if (!entry || journal.entries.length !== 1) throw new Error('Expected exactly one journal entry (the baseline). Re-check migrations/meta/_journal.json.');
  const sql = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8');
  const hash = crypto.createHash('sha256').update(sql).digest('hex');
  const createdAt = entry.when;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await client.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);

    const { rows: existing } = await client.query('SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1', [hash]);
    if (existing.length) { console.log('Already marked as applied. Nothing to do.'); return; }

    const { rows: tables } = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users' LIMIT 1`);
    if (!tables.length) {
      console.log('This database has no existing schema (no "users" table) — it is not already migrated, so there is nothing to backfill. Run `npm run db:migrate` normally; it will apply the baseline for real.');
      return;
    }

    await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [hash, createdAt]);
    console.log(`Marked ${entry.tag} (hash ${hash.slice(0, 12)}…) as already applied. \`npm run db:migrate\` will now skip it and move straight to any later migrations.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
