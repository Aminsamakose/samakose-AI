import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';

/** Every run starts from an empty database built by the real migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/samakose_test';
  // A fresh Postgres server (such as the CI service container) has no test database yet, so create it first.
  const u = new URL(url); const dbName = decodeURIComponent(u.pathname.slice(1)); u.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  try { if (!(await admin.query('select 1 from pg_database where datname = $1', [dbName])).rowCount) await admin.query(`create database "${dbName.replace(/"/g, '""')}"`); } finally { await admin.end(); }
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), 'migrations') });
  await pool.end();
  fs.rmSync(path.resolve(process.cwd(), '.test-storage'), { recursive: true, force: true });
}
