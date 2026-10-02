import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mockAssistant, validateReply } from '@/domain/assistant';
import { api, ensureReference, makeUser } from './helpers';

const bundle = JSON.parse(readFileSync('docs/website/faq-drafts-v1.json', 'utf8'));
const faqs = bundle.content.map((c: any) => c.data) as { question: string; answer: string }[];

describe('website FAQ drafts', () => {
  it('has a dozen or more, all as drafts, with no em dashes', () => {
    expect(faqs.length).toBeGreaterThanOrEqual(12);
    expect(bundle.content.every((c: any) => c.status === 'Draft')).toBe(true);
    expect(JSON.stringify(bundle)).not.toMatch(/[–—]/);
  });
  it('every answer is one the assistant is allowed to give', () => {
    for (const f of faqs) expect(validateReply({ reply: f.answer, handoff: false, sources: [] }), f.question).toEqual([]);
  });
  it('the assistant finds the right answer for typical questions', () => {
    const passages = faqs.map((f) => ({ title: f.question, text: f.answer }));
    expect(mockAssistant('how long does the health check take', passages).sources[0]).toMatch(/How long/);
    expect(mockAssistant('who can see my information', passages).sources[0]).toMatch(/Who can see/);
    expect(mockAssistant('how do I get started', passages).sources[0]).toMatch(/get started/);
  });
  it('passes the importer check and imports as drafts only', async () => {
    await ensureReference();
    const admin = await makeUser('ADMIN');
    const dry = await api(admin).post('/settings/config/import', { bundle, dryRun: true });
    expect(dry.status).toBe(200); expect(dry.data.drafts).toBe(faqs.length);
    expect((await api(admin).post('/settings/config/import', { bundle, dryRun: false })).status).toBe(200);
    const list = (await api(admin).get('/admin/content/kind/faq')).data;
    expect(list.items.filter((i: any) => faqs.some((f) => f.question === i.title)).every((i: any) => i.status === 'Draft')).toBe(true);
  });
});
