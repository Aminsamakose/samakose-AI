import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as baseSchema from './schema';
import * as workspaceSchema from './programme-workspace-schema';
import * as workspaceConfigurationSchema from './programme-workspace-configuration-schema';

const schema = { ...baseSchema, ...workspaceSchema, ...workspaceConfigurationSchema };
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

/** Connection-level failures only (never a failed statement): auth timeout, dropped connection, connect timeout. */
export function isConnectFailure(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null;
  const msg = String(x?.message ?? '');
  return x?.code === '08006' || x?.code === '57P01' || x?.code === 'ECONNRESET' || /EAUTHTIMEOUT|timeout exceeded when trying to connect|Connection terminated|ECONNRESET/i.test(msg);
}

export function pool(): Pool {
  const url = databaseUrl();
  if (!g.__pool || g.__poolUrl !== url) {
    g.__pool?.end().catch(() => undefined);
    g.__pool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
    g.__poolUrl = url;
  }
  return g.__pool;
}

export const schema = schema;
export function db() { return drizzle(pool(), { schema }); }
export type AppDb = Db;
export type AppTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return fn(db());
}

export async function withTransaction<T>(fn: (tx: AppTx) => Promise<T>): Promise<T> {
  return db().transaction(fn);
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool().query('select 1');
    return true;
  } catch (e) {
    if (isConnectFailure(e)) return false;
    throw e;
  }
}
