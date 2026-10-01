import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, call, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let admin: Session; let owner: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); const org = await makeOrg(admin); owner = await makeUser('OWNER', { orgId: org.id }); });

const good = (o: Record<string, unknown> = {}) => ({ kind: 'contact', name: 'Ama Mensah', email: `ama.${uniq()}@example.org`, message: 'We run a shea cooperative and want a health check.', consent: true, ...o });

describe('public enquiries', () => {
  it('accepts a valid enquiry without signing in and stores it', async () => {
    const b = good();
    const r = await call('POST', '/public/inquiries', { body: b });
    expect(r.status).toBe(200);
    expect(r.data.received).toBe(true);
    const [row] = await db().select().from(schema.inquiries).where(eq(schema.inquiries.email, (b.email as string).toLowerCase()));
    expect(row.status).toBe('New');
    expect(row.consent).toBe(true);
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('requires consent and a real message', async () => {
    expect((await call('POST', '/public/inquiries', { body: good({ consent: false }) })).status).toBe(400);
    const short = await call('POST', '/public/inquiries', { body: good({ message: 'hi' }) });
    expect(short.status).toBe(400);
    expect(short.error.details.message).toBeTruthy();
  });
  it('accepts a newsletter signup with only an email and consent', async () => {
    const r = await call('POST', '/public/inquiries', { body: { kind: 'newsletter', email: `n.${uniq()}@example.org`, consent: true } });
    expect(r.status).toBe(200);
  });
  it('answers success but stores nothing when the honeypot is filled', async () => {
    const b = good({ website: 'http://spam.example' });
    const r = await call('POST', '/public/inquiries', { body: b });
    expect(r.status).toBe(200);
    const rows = await db().select().from(schema.inquiries).where(eq(schema.inquiries.email, (b.email as string).toLowerCase()));
    expect(rows.length).toBe(0);
  });
  it('collapses a repeat from the same address within a day', async () => {
    const b = good();
    await call('POST', '/public/inquiries', { body: b });
    await call('POST', '/public/inquiries', { body: b });
    const rows = await db().select().from(schema.inquiries).where(eq(schema.inquiries.email, (b.email as string).toLowerCase()));
    expect(rows.length).toBe(1);
  });
  it('rate limits one address after a handful of requests', async () => {
    const h = { 'x-forwarded-for': '203.0.113.' + (1 + Math.floor(Math.random() * 200)) };
    let last = 200;
    for (let i = 0; i < 8; i++) last = (await call('POST', '/public/inquiries', { headers: h, body: good() })).status;
    expect(last).toBe(429);
  });
  it('lets only an administrator read or change enquiries', async () => {
    expect((await call('GET', '/inquiries')).status).toBe(401);
    expect((await api(owner).get('/inquiries')).status).toBe(403);
    const list = await api(admin).get('/inquiries?pageSize=5');
    expect(list.status).toBe(200);
    const id = list.data.items[0].id;
    expect((await api(owner).patch(`/inquiries/${id}`, { status: 'Handled' })).status).toBe(403);
    const ok = await api(admin).patch(`/inquiries/${id}`, { status: 'Handled' });
    expect(ok.status).toBe(200);
    expect(ok.data.status).toBe('Handled');
  });
});
