import { beforeAll, describe, expect, it } from 'vitest';
import { api, auditActions, ensureReference, makeUser, uniq, type Session } from './helpers';
import { call } from './helpers';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { systemCtx } from '@/services/common';
import { promoteDue } from '@/services/content';
import { loadForTest } from './site-load';

let admin: Session, editor: Session, manager: Session, coach: Session, owner: Session;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); editor = await makeUser('CONTENT_EDITOR'); manager = await makeUser('SITE_MANAGER'); coach = await makeUser('COACH');
  const org = (await api(admin).post('/organisations', { name: `Org ${uniq()}`, type: 'SME', sector: 'Retail', region: 'Northern', district: 'Tamale', consent: true, consentBy: 'Test Owner' })).data;
  owner = await makeUser('OWNER', { orgId: org.id });
});

const faq = (q = 'What is a health check?') => ({ data: { question: q, answer: 'A structured look at how your business is doing.' } });
const mk = async (s: Session, kind: string, body: unknown) => (await api(s).post(`/admin/content/kind/${kind}`, body));

describe('website roles', () => {
  it('the content editor drafts and submits but cannot publish', async () => {
    const c = await mk(editor, 'faq', faq());
    expect(c.status).toBe(201);
    const id = c.data.id;
    expect((await api(editor).post(`/admin/content/${id}/submit`, {})).status).toBe(200);
    expect((await api(editor).post(`/admin/content/${id}/publish`, {})).status).toBe(403);
    expect((await api(editor).post(`/admin/content/${id}/archive`, {})).status).toBe(403);
  });
  it('the content editor can read but not change site settings', async () => {
    expect((await api(editor).get('/admin/content/kind/brand')).status).toBe(200);
    const doc = (await api(editor).get('/admin/content/kind/brand')).data.items[0];
    expect((await api(editor).put(`/admin/content/${doc.id}`, { data: { ...doc.data, tagline: 'Hacked' } })).status).toBe(403);
  });
  it('the site manager publishes and the public loader sees it', async () => {
    const q = `Question ${uniq()}`;
    const c = await mk(editor, 'faq', faq(q));
    expect((await api(manager).post(`/admin/content/${c.data.id}/publish`, { note: 'first' })).status).toBe(200);
    expect((await loadForTest()).faqs.some((f) => f.question === q)).toBe(true);
    expect(await auditActions(c.data.id)).toContain('content.publish');
  });
  it('website roles cannot reach clients, cases, users or finance', async () => {
    for (const s of [editor, manager]) for (const p of ['/cases', '/organisations', '/users', '/invoices', '/audit']) {
      expect((await api(s).get(p)).status, p).toBe(403);
    }
  });
  it('other staff and clients cannot use the content screens', async () => {
    for (const s of [coach, owner]) {
      expect((await api(s).get('/admin/content')).status).toBe(403);
      expect((await api(s).post('/admin/content/kind/faq', faq())).status).toBe(403);
    }
  });
  it('the dashboard for website roles has no client data', async () => {
    const d = (await api(editor).get('/dashboard')).data;
    expect(d.kind).toBe('website');
    expect(JSON.stringify(d)).not.toMatch(/organisations|cases/);
  });
});

describe('content rules', () => {
  it('a testimonial cannot go live without verification and consent, and never appears unverified', async () => {
    const t = (await mk(manager, 'testimonial', { data: { quote: 'It helped us.', name: 'Ama Mensah', verified: false, consent: false } })).data;
    const r = await api(manager).post(`/admin/content/${t.id}/publish`, {});
    expect(r.status).toBe(400); expect(Object.keys(r.error.details ?? {})).toEqual(expect.arrayContaining(['verified', 'consent']));
    expect((await loadForTest()).testimonials.some((x) => x.name === 'Ama Mensah')).toBe(false);
  });
  it('a result needs a source and a verified flag', async () => {
    const s = (await mk(manager, 'stat', { data: { value: '38%', label: 'Improved score', source: '', verified: true } })).data;
    expect((await api(manager).post(`/admin/content/${s.id}/publish`, {})).status).toBe(400);
  });
  it('rejects unsafe links and bad addresses', async () => {
    const doc = (await api(manager).get('/admin/content/kind/social')).data.items[0];
    expect((await api(manager).put(`/admin/content/${doc.id}`, { data: { facebook: 'javascript:alert(1)' } })).status).toBe(400);
    expect((await api(manager).put(`/admin/content/${doc.id}`, { data: { facebook: 'http://insecure.example' } })).status).toBe(400);
    expect((await api(manager).put(`/admin/content/${doc.id}`, { data: { facebook: 'https://facebook.com/samakose' } })).status).toBe(200);
  });
  it('keeps history and restores an earlier version into the draft only', async () => {
    const c = (await mk(manager, 'faq', faq('Original?'))).data;
    await api(manager).post(`/admin/content/${c.id}/publish`, {});
    await api(manager).put(`/admin/content/${c.id}`, { data: { question: 'Changed?', answer: 'New answer.' } });
    await api(manager).post(`/admin/content/${c.id}/publish`, { note: 'wording' });
    const v = (await api(manager).get(`/admin/content/${c.id}/versions`)).data;
    expect(v.map((x: any) => x.version)).toEqual([2, 1]);
    const back = await api(manager).post(`/admin/content/${c.id}/restore`, { version: 1 });
    expect(back.data.data.question).toBe('Original?');
    expect(back.data.live.question).toBe('Changed?');
    expect(back.data.changed).toBe(true);
  });
  it('archived items disappear from the public site and can be deleted only after archiving', async () => {
    const q = `Archive me ${uniq()}`;
    const c = (await mk(manager, 'faq', faq(q))).data;
    await api(manager).post(`/admin/content/${c.id}/publish`, {});
    expect((await api(manager).del(`/admin/content/${c.id}`)).status).toBe(422);
    await api(manager).post(`/admin/content/${c.id}/archive`, {});
    expect((await loadForTest()).faqs.some((f) => f.question === q)).toBe(false);
    expect((await api(manager).del(`/admin/content/${c.id}`)).status).toBe(200);
  });
  it('a scheduled item goes live once its time has passed', async () => {
    const q = `Later ${uniq()}`;
    const c = (await mk(manager, 'faq', faq(q))).data;
    expect((await api(manager).post(`/admin/content/${c.id}/schedule`, { at: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    expect((await api(manager).post(`/admin/content/${c.id}/schedule`, { at: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(200);
    expect((await loadForTest()).faqs.some((f) => f.question === q)).toBe(false);
    await db().update(schema.contentDocs).set({ publishAt: new Date(Date.now() - 1000) }).where(eq(schema.contentDocs.id, c.id));
    expect((await loadForTest()).faqs.some((f) => f.question === q)).toBe(true);
    expect(await promoteDue(systemCtx(db()))).toBeGreaterThanOrEqual(1);
    const [row] = await db().select().from(schema.contentDocs).where(eq(schema.contentDocs.id, c.id));
    expect(row.status).toBe('Published'); expect(row.version).toBe(1);
  });
  it('the home page keeps every section even if the editor sends a partial list', async () => {
    const doc = (await api(manager).get('/admin/content/kind/home')).data.items[0];
    const r = await api(manager).put(`/admin/content/${doc.id}`, { data: { ...doc.data, sections: [{ id: 'contact', enabled: true }, { id: 'nonsense', enabled: true }] } });
    expect(r.status).toBe(200);
    const secs = r.data.data.sections as { id: string }[];
    expect(secs[0].id).toBe('contact'); expect(secs.length).toBe(8); expect(secs.some((s) => s.id === 'nonsense')).toBe(false);
  });
  it('duplicate article addresses are refused', async () => {
    const slug = `guide-${uniq()}`;
    const art = (t: string) => ({ data: { title: t, slug, summary: 'S', author: 'A', date: '2026-10-01', body: 'Body' } });
    expect((await mk(manager, 'article', art('One'))).status).toBe(201);
    expect((await mk(manager, 'article', art('Two'))).status).toBe(400);
  });
});
