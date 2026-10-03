import { describe, it, expect } from 'vitest';
import { isConnectFailure, pool, closeDb } from '@/db/client';

describe('database connection resilience', () => {
  it('treats connection-level failures as retryable and statement errors as not', () => {
    expect(isConnectFailure({ code: '08006', message: '(EAUTHTIMEOUT) timeout while waiting for message' })).toBe(true);
    expect(isConnectFailure(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isConnectFailure({ code: '42501', message: 'permission denied for table ai_agents' })).toBe(false);
    expect(isConnectFailure({ code: '23505', message: 'duplicate key value' })).toBe(false);
  });

  it('retries a failed first connection once, for both query and transaction paths', async () => {
    await closeDb();
    const proto = (await import('pg')).Pool.prototype as any;
    const realConnect = proto.connect;
    let fails = 1;
    // The first connection attempt fails with the production error, then behaves normally.
    proto.connect = function (this: any, cb?: any) {
      if (fails > 0) { fails--; const e: any = new Error('(EAUTHTIMEOUT) timeout while waiting for message'); e.code = '08006'; return cb ? cb(e) : Promise.reject(e); }
      return realConnect.call(this, cb);
    };
    try {
      const p = pool() as any;
      const r = await p.query('select 1 as one');
      expect(r.rows[0].one).toBe(1);
      expect(fails).toBe(0); // the failure really happened and was retried
      fails = 1;
      const c = await p.connect(); // transaction path
      c.release();
      expect(fails).toBe(0);
    } finally { proto.connect = realConnect; await closeDb(); }
  });
});
