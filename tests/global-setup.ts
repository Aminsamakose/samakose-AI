import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';

/** Every run starts from an empty database built by the real migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/samakose_test';
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), 'migrations') });
  await pool.end();
  fs.rmSync(path.resolve(process.cwd(), '.test-storage'), { recursive: true, force: true });
}
