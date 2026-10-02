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
  admin = await makeUser('ADMIN'); editor = await makeUser('CONTENT_EDITOR'); manager = await makeUser('SITE_MANAGER'); coach = await makeUser('EXPERT');
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

const png = () => Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const upload = (s: Session, name: string, bytes: Buffer, fields: Record<string, string> = {}) => {
  const f = new FormData(); f.set('file', new File([new Uint8Array(bytes)], name)); for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return call('POST', '/admin/media', { cookie: s.cookie, form: f });
};

describe('media library', () => {
  it('uploads an image with a description and serves it publicly', async () => {
    const r = await upload(editor, 'logo.png', png(), { altText: 'Samakose logo', category: 'Logo' });
    expect(r.status).toBe(201); expect(r.data.url).toMatch(/^\/media\//);
    const { readMedia } = await import('@/services/media');
    const f = await readMedia(r.data.id);
    expect(f?.mime).toBe('image/png'); expect(f?.data.length).toBe(png().length);
  });
  it('requires a description for images and rejects wrong or unsafe files', async () => {
    expect((await upload(manager, 'a.png', png())).status).toBe(400);
    expect((await upload(manager, 'fake.png', Buffer.from('not an image at all'), { altText: 'x' })).status).toBe(400);
    expect((await upload(manager, 'x.svg', Buffer.from('<svg onload="alert(1)"/>'), { altText: 'x' })).status).toBe(400);
    expect((await upload(manager, 'run.html', Buffer.from('<script>1</script>'), { altText: 'x' })).status).toBe(400);
  });
  it('the editor can add files but not delete them; a file in use cannot be deleted', async () => {
    const r = (await upload(manager, 'use.png', png(), { altText: 'Used picture' })).data;
    expect((await api(editor).del(`/admin/media/${r.id}`)).status).toBe(403);
    const doc = (await api(manager).get('/admin/content/kind/seo')).data.items[0];
    const put = await api(manager).put(`/admin/content/${doc.id}`, { data: { ...doc.data, shareImage: r.url } });
    expect(put.status, JSON.stringify(put.error)).toBe(200);
    const blocked = await api(manager).del(`/admin/media/${r.id}`);
    expect(blocked.status).toBe(422);
    await api(manager).put(`/admin/content/${doc.id}`, { data: { ...doc.data, shareImage: '' } });
    expect((await api(manager).del(`/admin/media/${r.id}`)).status).toBe(200);
  });
  it('clients and other staff cannot reach the library', async () => {
    expect((await api(owner).get('/admin/media')).status).toBe(403);
    expect((await api(coach).get('/admin/media')).status).toBe(403);
  });
});

describe('command centre', () => {
  it('is for administrators only and reports counts without client detail', async () => {
    const r = await api(admin).get('/admin/command-centre');
    expect(r.status).toBe(200);
    expect(r.data.counts).toHaveProperty('pending_orgs'); expect(r.data.health).toHaveProperty('database');
    for (const s of [manager, editor, coach, owner]) expect((await api(s).get('/admin/command-centre')).status).toBe(403);
  });
});

describe('built-in text', () => {
  it('every default passes its own rules, so a first edit never fails on text the editor did not write', async () => {
    const { KINDS, validateData } = await import('@/domain/content-kinds');
    for (const k of KINDS.filter((x) => x.singleton)) {
      const v = validateData(k, k.defaults);
      expect(v.ok, `${k.id}: ${JSON.stringify((v as any).fields)}`).toBe(true);
    }
  });
});

describe('menu and brand colour', () => {
  it('refuses a brand colour that white text cannot be read on, and accepts a dark one', async () => {
    const doc = (await api(manager).get('/admin/content/kind/brand')).data.items[0];
    const light = await api(manager).put(`/admin/content/${doc.id}`, { data: { ...doc.data, primaryColour: '#c6f26b' } });
    expect(light.status).toBe(400); expect(light.error.details.primaryColour).toMatch(/contrast/i);
    expect((await api(manager).put(`/admin/content/${doc.id}`, { data: { ...doc.data, primaryColour: 'green' } })).status).toBe(400);
    const dark = await api(manager).put(`/admin/content/${doc.id}`, { data: { ...doc.data, primaryColour: '#0B3D91' } });
    expect(dark.status).toBe(200); expect(dark.data.data.primaryColour).toBe('#0b3d91');
    await api(manager).put(`/admin/content/${doc.id}`, { data: { ...doc.data, primaryColour: '' } });
  });
  it('validates the menu and publishes it to the public loader', async () => {
    const doc = (await api(manager).get('/admin/content/kind/navigation')).data.items[0];
    const bad = (m: string) => api(manager).put(`/admin/content/${doc.id}`, { data: { menu: m } });
    expect((await bad('Pricing')).status).toBe(400);
    expect((await bad('Evil | javascript:alert(1)')).status).toBe(400);
    expect((await bad(Array.from({ length: 11 }, (_, i) => `L${i} | /p${i}`).join('\n'))).status).toBe(400);
    expect((await bad('Home | /\nPricing | /pricing\nPartners | https://example.org/partners')).status).toBe(200);
    expect((await api(manager).post(`/admin/content/${doc.id}/publish`, {})).status).toBe(200);
    const nav = (await loadForTest()).nav;
    expect(nav.map((n) => n.label)).toEqual(['Home', 'Pricing', 'Partners']);
    await bad(doc.data.menu); await api(manager).post(`/admin/content/${doc.id}/publish`, {});
  });
});
