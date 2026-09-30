import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

type Db = NodePgDatabase<typeof schema>;
const g = globalThis as unknown as { __pool?: Pool; __db?: Db; __poolUrl?: string };

/** Forgives the usual paste mistakes: spaces, line breaks, surrounding quotes, or a leading "DATABASE_URL=". */
export function cleanDatabaseUrl(raw: string): string {
  return raw.trim().replace(/^DATABASE_URL\s*=\s*/i, '').trim().replace(/^['"]+|['"]+$/g, '').trim();
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const clean = cleanDatabaseUrl(url);
  if (!/^postgres(ql)?:\/\//i.test(clean)) throw new Error('DATABASE_URL must start with postgresql://');
  return clean;
}

export function pool(): Pool {
  const url = databaseUrl();
  if (!g.__pool || g.__poolUrl !== url) {
    g.__pool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10), idleTimeoutMillis: 30_000, statement_timeout: 30_000 });
    g.__poolUrl = url;
    g.__db = drizzle(g.__pool, { schema });
  }
  return g.__pool;
}

export function db(): Db {
  pool();
  return g.__db!;
}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/** Run work in one transaction. Everything inside commits or rolls back together. */
export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  return db().transaction(fn);
}

export async function closeDb() {
  if (g.__pool) { await g.__pool.end(); g.__pool = undefined; g.__db = undefined; }
}
export type { PoolClient };
export { schema };
