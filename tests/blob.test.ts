import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, { data: Buffer; type: string }>();
const calls: any[] = [];
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string, data: Buffer, opts: any) => { calls.push(opts); store.set(key, { data, type: opts.contentType }); return { url: 'x' }; }),
  get: vi.fn(async (key: string) => {
    const o = store.get(key);
    if (!o) return null;
    return { stream: new Response(new Uint8Array(o.data)).body, blob: { size: o.data.length } };
  }),
  list: vi.fn(async () => ({ blobs: [] }))
}));

describe('vercel blob storage driver', () => {
  beforeEach(() => { process.env.STORAGE_DRIVER = 'blob'; store.clear(); calls.length = 0; });
  it('stores privately and returns the exact bytes', async () => {
    const { storage } = await import('@/lib/storage');
    const data = Buffer.from('%PDF-1.4 evidence éè ' + 'x'.repeat(5000));
    await storage().put('2026/09/abc', data, 'application/pdf');
    expect(calls[0].access).toBe('private');
    expect(calls[0].addRandomSuffix).toBe(false);
    expect((await storage().get('2026/09/abc'))?.equals(data)).toBe(true);
  });
  it('returns null for a missing file', async () => {
    const { storage } = await import('@/lib/storage');
    expect(await storage().get('2026/09/none')).toBeNull();
  });
  it('reports health and location', async () => {
    const { storage } = await import('@/lib/storage');
    expect(await storage().health()).toBe('ok');
    expect(storage().location).toContain('vercel-blob');
  });
  it('selects blob automatically when Vercel provides a token', async () => {
    delete process.env.STORAGE_DRIVER; process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
    const { env } = await import('@/lib/env');
    expect(env.storageDriver).toBe('blob');
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });
});
