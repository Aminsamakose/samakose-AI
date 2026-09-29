import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A minimal path-style S3 stand-in, so the real AWS SDK code path runs end to end. */
const objects = new Map<string, Buffer>();
let server: http.Server; let endpoint = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (req.method === 'HEAD' && key.replace(/\/$/, '') === '/bucket') { res.writeHead(200).end(); return; }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body = Buffer.concat(chunks);
        // The SDK may send aws-chunked framing; strip it when present.
        if (/aws-chunked/.test(String(req.headers['content-encoding'])) || req.headers['x-amz-content-sha256'] === 'STREAMING-UNSIGNED-PAYLOAD-TRAILER' || String(req.headers['x-amz-content-sha256']).startsWith('STREAMING')) {
          const out: Buffer[] = []; let i = 0;
          while (i < body.length) {
            const nl = body.indexOf('\r\n', i); const size = parseInt(body.subarray(i, nl).toString().split(';')[0], 16);
            if (!size) break; out.push(body.subarray(nl + 2, nl + 2 + size)); i = nl + 2 + size + 2;
          }
          body = Buffer.concat(out);
        }
        objects.set(key, body); res.writeHead(200, { ETag: '"x"' }).end();
      });
      return;
    }
    if (req.method === 'GET') {
      const o = objects.get(key);
      if (!o) { res.writeHead(404, { 'content-type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>'); return; }
      res.writeHead(200, { 'content-length': o.length }).end(o); return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, { STORAGE_DRIVER: 's3', S3_BUCKET: 'bucket', S3_ENDPOINT: endpoint, S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_REGION: 'us-east-1' });
});
afterAll(async () => { delete process.env.STORAGE_DRIVER; await new Promise((r) => server.close(r)); });

describe('s3 storage driver', () => {
  it('stores and returns the exact bytes', async () => {
    const { storage } = await import('@/lib/storage');
    const data = Buffer.from('%PDF-1.4 evidence éè ' + 'x'.repeat(5000));
    await storage().put('2026/09/abc', data, 'application/pdf');
    const back = await storage().get('2026/09/abc');
    expect(back?.equals(data)).toBe(true);
  });
  it('returns null for a missing file', async () => {
    const { storage } = await import('@/lib/storage');
    expect(await storage().get('2026/09/none')).toBeNull();
  });
  it('reports health and location', async () => {
    const { storage } = await import('@/lib/storage');
    expect(await storage().health()).toBe('ok');
    expect(storage().location).toBe('s3://bucket');
  });
  it('lowers the default upload limit on Vercel only', async () => {
    const { env } = await import('@/lib/env');
    delete process.env.MAX_UPLOAD_MB; delete process.env.VERCEL;
    expect(env.maxUploadBytes).toBe(10 * 1048576);
    process.env.VERCEL = '1';
    expect(env.maxUploadBytes).toBe(4 * 1048576);
    delete process.env.VERCEL;
  });
});
