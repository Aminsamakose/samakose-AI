/**
 * Phase 1 of the Resource Library: schema, RBAC and the service layer only. No API routes exist
 * yet (Phase 2), so these tests call the services directly with a hand-built Ctx, the same shape
 * api()/dispatch() builds from a session internally.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db/client';
import { hashPassword } from '@/lib/crypto';
import type { Ctx, AuthUser } from '@/lib/context';
import type { Role } from '@/db/schema';
import * as authors from '@/services/library-authors';
import * as lib from '@/services/library';
import * as ent from '@/services/entitlements';
import { ApiError } from '@/lib/errors';
import { uniq } from './helpers';

let hash: string | null = null;
async function makeCtx(role: Role): Promise<Ctx> {
  hash ??= await hashPassword('Correct-Horse-Battery-42');
  const email = `${role.toLowerCase()}-${uniq()}@test.samakose.test`;
  const [u] = await db().insert(schema.users).values({ email, name: `${role} ${uniq()}`, role, passwordHash: hash }).returning();
  const user: AuthUser = {
    id: u.id, email: u.email, name: u.name, role: u.role, primaryRole: u.role, orgId: null,
    programmeIds: [], mfaEnabled: false, mfaVerified: true, sessionId: 'test', mustChangePassword: false, approvalStatus: 'approved', profileRequired: false
  };
  return { user, ip: '10.0.0.1', requestId: `test-${randomUUID()}`, db: db(), after: () => {} };
}

const asApiError = (e: unknown) => e instanceof ApiError ? e : (() => { throw e; })();

describe('Resource Library: authors', () => {
  it('creates, reads and updates an author; a content editor may write but not delete', async () => {
    const admin = await makeCtx('ADMIN'), editor = await makeCtx('CONTENT_EDITOR');
    const a = await authors.createAuthor(admin, { name: 'Amin Yahaya', title: 'Founder, Samakose' });
    expect(a.name).toBe('Amin Yahaya');
    const updated = await authors.updateAuthor(editor, a.id, { bio: 'Business Doctor' });
    expect(updated.bio).toBe('Business Doctor');
    await expect(authors.deleteAuthor(editor, a.id)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to delete an author who has resources on the Library', async () => {
    const admin = await makeCtx('ADMIN');
    const a = await authors.createAuthor(admin, { name: `Author ${uniq()}` });
    await lib.createResource(admin, { title: `Guide ${uniq()}`, authorId: a.id, summary: 'A guide', body: 'Body text' });
    await expect(authors.deleteAuthor(admin, a.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('Resource Library: editorial workflow', () => {
  let adminCtx: Ctx, editorCtx: Ctx, authorId: string;
  beforeAll(async () => {
    adminCtx = await makeCtx('ADMIN'); editorCtx = await makeCtx('CONTENT_EDITOR');
    authorId = (await authors.createAuthor(adminCtx, { name: `Author ${uniq()}` })).id;
  });

  it('only an administrator or site manager may set a price; a content editor cannot', async () => {
    await expect(lib.createResource(editorCtx, { title: `Priced ${uniq()}`, authorId, summary: 's', body: 'b', priceGhs: 50 }))
      .rejects.toMatchObject({ status: 403 });
    const r = await lib.createResource(adminCtx, { title: `Priced ${uniq()}`, authorId, summary: 's', body: 'b', priceGhs: 50 });
    expect(r.priceGhs).toBe(50);
    expect(r.isFree).toBe(false);
  });

  it('free by default, draft to in-review to published, with a unique slug', async () => {
    const title = `How to price a product ${uniq()}`;
    const r = await lib.createResource(editorCtx, { title, authorId, summary: 'Pricing basics', body: 'Set a price that covers cost plus margin.' });
    expect(r.isFree).toBe(true);
    expect(r.status).toBe('Draft');
    const dup = await lib.createResource(editorCtx, { title, authorId, summary: 'Another one', body: 'Different body' });
    expect(dup.slug).not.toBe(r.slug);

    const submitted = await lib.submitResource(editorCtx, r.id);
    expect(submitted.status).toBe('In review');
    // The editor who drafted it may not approve their own submission (four-eyes).
    await expect(lib.decideResource(editorCtx, r.id, { decision: 'Published' })).rejects.toMatchObject({ status: 403 });
    const published = await lib.decideResource(adminCtx, r.id, { decision: 'Published' });
    expect(published.status).toBe('Published');
    expect(published.publishedAt).toBeTruthy();

    const pub = await lib.publicGet(adminCtx, r.slug);
    expect(pub.body).toContain('Set a price');
    expect(pub.locked).toBe(false);
  });

  it('a priced resource is listed publicly without its body or file', async () => {
    const r = await lib.createResource(adminCtx, { title: `Premium guide ${uniq()}`, authorId, summary: 'A paid guide', body: 'Secret content', priceGhs: 25 });
    await lib.submitResource(adminCtx, r.id);
    const other = await makeCtx('ADMIN');
    await lib.decideResource(other, r.id, { decision: 'Published' });
    const pub = await lib.publicGet(adminCtx, r.slug);
    expect(pub.locked).toBe(true);
    expect(pub.body).toBeNull();
    expect(pub.priceGhs).toBe(25);
  });

  it('cannot be edited or deleted once published; archiving is the only way to retire it', async () => {
    const r = await lib.createResource(adminCtx, { title: `Archivable ${uniq()}`, authorId, summary: 's', body: 'b' });
    await lib.submitResource(adminCtx, r.id);
    const other = await makeCtx('ADMIN');
    const pub = await lib.decideResource(other, r.id, { decision: 'Published' });
    await expect(lib.updateResource(adminCtx, pub.id, { title: 'changed' })).rejects.toMatchObject({ status: 422 });
    await expect(lib.deleteResource(adminCtx, pub.id)).rejects.toMatchObject({ status: 409 });
    const archived = await lib.archiveResource(adminCtx, pub.id);
    expect(archived.status).toBe('Archived');
  });
});

describe('Resource Library: entitlements', () => {
  it('a free resource needs no entitlement; a priced one does, until granted', async () => {
    const admin = await makeCtx('ADMIN');
    const a = await authors.createAuthor(admin, { name: `Author ${uniq()}` });
    const free = await lib.createResource(admin, { title: `Free ${uniq()}`, authorId: a.id, summary: 's', body: 'b' });
    const priced = await lib.createResource(admin, { title: `Priced ${uniq()}`, authorId: a.id, summary: 's', body: 'b', priceGhs: 10 });
    const reader = await makeCtx('EXECUTIVE');
    expect(await ent.hasEntitlement(reader, reader.user!.id, free.id)).toBe(true);
    expect(await ent.hasEntitlement(reader, reader.user!.id, priced.id)).toBe(false);
    const grant = await ent.grantEntitlement(admin, { userId: reader.user!.id, resourceId: priced.id, grantedVia: 'admin_grant', grantedBy: admin.user!.id });
    expect(grant.ok).toBe(true);
    expect(await ent.hasEntitlement(reader, reader.user!.id, priced.id)).toBe(true);
    // Granting twice is a no-op, not a duplicate.
    const again = await ent.grantEntitlement(admin, { userId: reader.user!.id, resourceId: priced.id, grantedVia: 'admin_grant', grantedBy: admin.user!.id });
    expect(again.already).toBe(true);
  });

  it('only a role with library_entitlements:create may grant, and revoking restores the lock', async () => {
    const admin = await makeCtx('ADMIN'), editor = await makeCtx('CONTENT_EDITOR');
    const a = await authors.createAuthor(admin, { name: `Author ${uniq()}` });
    const priced = await lib.createResource(admin, { title: `Priced ${uniq()}`, authorId: a.id, summary: 's', body: 'b', priceGhs: 10 });
    const reader = await makeCtx('EXECUTIVE');
    await expect(ent.grantEntitlement(editor, { userId: reader.user!.id, resourceId: priced.id, grantedVia: 'admin_grant' })).rejects.toMatchObject({ status: 403 });
    const grant = await ent.grantEntitlement(admin, { userId: reader.user!.id, resourceId: priced.id, grantedVia: 'admin_grant' });
    await ent.revokeEntitlement(admin, grant.id);
    expect(await ent.hasEntitlement(reader, reader.user!.id, priced.id)).toBe(false);
  });
});

describe('Resource Library: drafting agent', () => {
  it('drafts a resource proposal without saving anything', async () => {
    const editor = await makeCtx('CONTENT_EDITOR');
    const draft = await lib.draftResource(editor, { topic: 'Keeping simple cash records', dimension: 'Records, Data and Systems' });
    expect(draft.title.length).toBeGreaterThan(0);
    expect(draft.body.length).toBeGreaterThan(0);
  });
});
