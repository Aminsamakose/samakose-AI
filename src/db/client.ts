import { Pool, type PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as baseSchema from './schema';
import * as frameworkArchitectureSchema from './framework-architecture-schema';
import * as businessHealthRecordSchema from './business-health-record-schema';
import * as workspaceSchema from './programme-workspace-schema';
import * as workspaceConfigurationSchema from './programme-workspace-configuration-schema';
import * as cohortConfigurationSchema from './cohort-configuration-schema';
import * as deliveryOperationsSchema from './delivery-operations-schema';
import * as deliveryCoordinationSchema from './delivery-coordination-schema';
import * as programmeCalendarSchema from './programme-calendar-schema';
import * as providerAssignmentSchema from './provider-assignment-schema';

const schema = { ...baseSchema, ...frameworkArchitectureSchema, ...businessHealthRecordSchema, ...workspaceSchema, ...workspaceConfigurationSchema, ...cohortConfigurationSchema, ...deliveryOperationsSchema, ...deliveryCoordinationSchema, ...programmeCalendarSchema, ...providerAssignmentSchema };
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
    const p = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 5), idleTimeoutMillis: 20_000, connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10_000), statement_timeout: 30_000 });
    p.on('error', () => {});
    const connect = p.connect.bind(p) as (...a: any[]) => any;
    (p as any).connect = (...args: any[]) => {
      if (typeof args[0] === 'function') {
        const cb = args[0] as (err: unknown, client?: unknown, done?: unknown) => void;
        return connect((err: unknown, client: unknown, done: unknown) => err && isConnectFailure(err) ? connect(cb) : cb(err, client, done));
      }
      return connect().catch((e: unknown) => isConnectFailure(e) ? connect() : Promise.reject(e));
    };
    g.__pool = p;
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
