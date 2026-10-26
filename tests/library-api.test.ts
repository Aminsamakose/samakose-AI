import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, call, ensureReference, makeUser, uniq, type Session } from './helpers';
import { hmacHex } from '@/lib/crypto';
import { setPaystackTransport } from '@/services/finance';
import { db, schema } from '@/db/client';

let admin: Session, editor: Session, owner: Session, authorId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); editor = await makeUser('CONTENT_EDITOR'); owner = await makeUser('EXPERT');
  authorId = (await api(admin).post('/library/authors', { name: `Author ${uniq()}` })).data.id;
});
afterEach(() => { setPaystackTransport(null); process.env.PAYSTACK_SECRET_KEY = ''; });

async function publishedFree() {
  const title = `Free guide ${uniq()}`;
  const draft = (await api(editor).post('/library/resources', { title, authorId, summary: 'A free guide', body: 'Full content here.' })).data;
  await api(editor).post(`/library/resources/${draft.id}/submit`, {});
  const pub = await api(admin).post(`/library/resources/${draft.id}/decision`, { decision: 'Published' });
  return pub.data;
}
async function publishedPremium(priceGhs = 15) {
  const title = `Premium guide ${uniq()}`;
  const draft = (await api(editor).post('/library/resources', { title, authorId, summary: 'A paid guide', body: 'Premium content.' })).data;
  // only an admin may set the price
  const admined = await api(admin).patch(`/library/resources/${draft.id}`, { priceGhs });
  expect(admined.status).toBe(200);
  await api(editor).post(`/library/resources/${draft.id}/submit`, {});
  const pub = await api(admin).post(`/library/resources/${draft.id}/decision`, { decision: 'Published' });
  return pub.data;
}

describe('Resource Library API', () => {
  it('lists a free resource publicly with its full body, no auth needed', async () => {
    const r = await publishedFree();
    const pub = await call('GET', `/library/public/resources/${r.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.data.locked).toBe(false);
    expect(pub.data.body).toContain('Full content');
    const list = await call('GET', '/library/public/resources');
    expect(list.data.map((x: any) => x.slug)).toContain(r.slug);
  });

  it('locks a premium resource’s body for an anonymous visitor and a signed-in, non-entitled user', async () => {
    const r = await publishedPremium();
    const anon = await call('GET', `/library/public/resources/${r.slug}`);
    expect(anon.data.locked).toBe(true);
    expect(anon.data.body).toBeNull();
    const asOwner = await api(owner).get(`/library/public/resources/${r.slug}`);
    expect(asOwner.data.locked).toBe(true);
  });

  it('refuses a content editor permission to price a resource, but allows an administrator', async () => {
    const draft = (await api(editor).post('/library/resources', { title: `T ${uniq()}`, authorId, summary: 's', body: 'b' })).data;
    expect((await api(editor).patch(`/library/resources/${draft.id}`, { priceGhs: 20 })).status).toBe(403);
    expect((await api(admin).patch(`/library/resources/${draft.id}`, { priceGhs: 20 })).status).toBe(200);
  });

  it('a non-staff role cannot create or edit a resource, only read', async () => {
    expect((await api(owner).post('/library/resources', { title: 'x', authorId, summary: 's', body: 'b' })).status).toBe(403);
    const r = await publishedFree();
    expect((await api(owner).get(`/library/resources/${r.id}`)).status).toBe(403); // staff-only detail view; public route is the one for readers
  });

  it('attaches and downloads a PDF, gated by entitlement for a premium resource', async () => {
    const title = `Premium guide ${uniq()}`;
    const draft = (await api(editor).post('/library/resources', { title, authorId, summary: 'A paid guide', body: 'Premium content.' })).data;
    await api(admin).patch(`/library/resources/${draft.id}`, { priceGhs: 10 });
    const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('test content')]);
    const form = new FormData();
    form.append('file', new File([pdfBytes], 'guide.pdf', { type: 'application/pdf' }));
    const uploaded = await call('POST', `/library/resources/${draft.id}/file`, { cookie: editor.cookie, form });
    expect(uploaded.status).toBe(200);
    await api(editor).post(`/library/resources/${draft.id}/submit`, {});
    const r = (await api(admin).post(`/library/resources/${draft.id}/decision`, { decision: 'Published' })).data;
    // Not entitled yet: download is refused.
    expect((await api(owner).get(`/library/resources/${r.id}/file`)).status).toBe(403);
    // An administrator grants an entitlement.
    const grant = await api(admin).post('/library/entitlements/grant', { userId: owner.userId, resourceId: r.id });
    expect(grant.status).toBe(200);
    const dl = await api(owner).get(`/library/resources/${r.id}/file`);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain('test content');
    // Revoke locks it again.
    await api(admin).post(`/library/entitlements/${grant.data.id}/revoke`, {});
    expect((await api(owner).get(`/library/resources/${r.id}/file`)).status).toBe(403);
  });

  it('drafts a resource proposal through the AI gateway without saving it', async () => {
    const r = await api(editor).post('/library/draft', { topic: 'Record-keeping basics for a market stall' });
    expect(r.status).toBe(200);
    expect(r.data.title.length).toBeGreaterThan(0);
  });

  it('runs a mock purchase end to end and grants the entitlement', async () => {
    const r = await publishedPremium(25);
    const start = await api(owner).post(`/library/resources/${r.id}/purchase`, {});
    expect(start.status).toBe(200);
    expect(start.data.mock).toBe(true);
    const status1 = await api(owner).get(`/library/purchases/${start.data.reference}/status`);
    expect(status1.data.status).toBe('Pending');
    const complete = await api(owner).post(`/library/purchases/${start.data.reference}/mock-complete`, {});
    expect(complete.status).toBe(200);
    const dl = await api(owner).get(`/library/resources/${r.id}/file`);
    expect(dl.status).toBe(404); // entitled, but no file was attached to this resource
    const status2 = await api(owner).get(`/library/purchases/${start.data.reference}/status`);
    expect(status2.data.status).toBe('Succeeded');
  });

  it('two concurrent mock-complete calls on the same purchase only ever grant one entitlement', async () => {
    // Without the pg_advisory_xact_lock in settle(), both calls could read status 'Pending' before
    // either transaction committed, each passing the "not already Succeeded" check and each granting
    // the entitlement - relying only on resource_entitlements' unique index to avoid a duplicate row,
    // which would surface as a crashed transaction rather than a clean idempotent response.
    const r = await publishedPremium(25);
    const start = await api(owner).post(`/library/resources/${r.id}/purchase`, {});
    expect(start.status).toBe(200);
    const [c1, c2] = await Promise.all([
      api(owner).post(`/library/purchases/${start.data.reference}/mock-complete`, {}),
      api(owner).post(`/library/purchases/${start.data.reference}/mock-complete`, {})
    ]);
    // settle() is idempotent once serialized by the lock, so both calls succeed (one genuinely
    // settles, the other sees it already Succeeded) - what matters is a single entitlement, not a 409.
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    const status2 = await api(owner).get(`/library/purchases/${start.data.reference}/status`);
    expect(status2.data.status).toBe('Succeeded');
    const ents = await db().select().from(schema.resourceEntitlements).where(eq(schema.resourceEntitlements.resourceId, r.id));
    expect(ents).toHaveLength(1);
  });

  it('starts a live purchase with Paystack and settles it only on a correctly signed webhook', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_lib';
    setPaystackTransport(async () => ({ data: { authorization_url: 'https://checkout.paystack.test/lib' } }));
    const r = await publishedPremium(30);
    const start = await api(owner).post(`/library/resources/${r.id}/purchase`, {});
    expect(start.data.mock).toBe(false);
    expect(start.data.authorizationUrl).toBe('https://checkout.paystack.test/lib');
    const body = JSON.stringify({ event: 'charge.success', data: { id: 777, reference: start.data.reference, amount: 3000, currency: 'GHS', channel: 'card' } });
    const post = (b: string, sig?: string) => call('POST', '/library/purchases/webhook', { raw: b, headers: sig ? { 'x-paystack-signature': sig } : {} });
    expect((await post(body, hmacHex('sha512', 'wrong', body))).status).toBe(401);
    expect((await api(owner).get(`/library/purchases/${start.data.reference}/status`)).data.status).toBe('Pending');
    const sig = hmacHex('sha512', 'sk_test_lib', body);
    expect((await post(body, sig)).status).toBe(200);
    expect((await api(owner).get(`/library/purchases/${start.data.reference}/status`)).data.status).toBe('Succeeded');
    expect((await post(body, sig)).data.duplicate).toBe(true);
  });
});
