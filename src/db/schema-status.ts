import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from './client';

type JournalEntry = { tag: string; when: number };

const folder = () => path.join(process.cwd(), 'migrations');
const journal = (): JournalEntry[] => JSON.parse(fs.readFileSync(path.join(folder(), 'meta/_journal.json'), 'utf8')).entries;
const hashOf = (tag: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(folder(), `${tag}.sql`))).digest('hex');

/** Journal migrations whose hash is not in the applied set. Pure, so it is tested without a database. */
export function pendingMigrations(entries: JournalEntry[], appliedHashes: Set<string>, hash: (tag: string) => string): string[] {
  return entries.filter((e) => !appliedHashes.has(hash(e.tag))).map((e) => e.tag);
}

export type SchemaStatus = { ok: boolean; tracked: boolean; pending: string[]; misownedTables: string[] };

/**
 * Detects the two ways code and database drift apart: migrations that were never applied (the code then queries
 * columns or tables that do not exist), and tables the app role does not own (the app then gets "permission denied").
 * Read only. Cheap enough for a health check.
 */
export async function schemaStatus(): Promise<SchemaStatus> {
  const exists = (await db().execute(sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`)).rows[0] as { present: boolean };
  const own = (await db().execute(sql`select tablename from pg_tables where schemaname = 'public' and tableowner <> current_user order by 1`)).rows as { tablename: string }[];
  const misownedTables = own.map((r) => r.tablename);
  if (!exists.present) return { ok: false, tracked: false, pending: [], misownedTables };
  const applied = new Set(((await db().execute(sql`select hash from drizzle.__drizzle_migrations`)).rows as { hash: string }[]).map((r) => r.hash));
  const pending = pendingMigrations(journal(), applied, hashOf);
  return { ok: pending.length === 0 && misownedTables.length === 0, tracked: true, pending, misownedTables };
}
