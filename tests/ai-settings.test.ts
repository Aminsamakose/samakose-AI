import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, ensureReference, makeUser, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { inArray } from 'drizzle-orm';
import { activeProvider, setAiConfig } from '@/services/ai-providers';
import { runAgent, setAiLiveOverride } from '@/services/ai';

let admin: Session, pm: Session, fin: Session;
const KEYS = ['AI_MODE', 'AI_PROVIDER', 'CLAUDE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); pm = await makeUser('PROGRAMME_MANAGER'); fin = await makeUser('FINANCE'); });
afterEach(async () => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals(); setAiLiveOverride(null);
  await db().delete(schema.rules).where(inArray(schema.rules.key, ['ai.provider', 'ai.claude_model', 'ai.openai_model', 'ai.openai_base_url'])); setAiConfig(null);
});

describe('AI provider settings screen', () => {
  it('only an administrator can read or change them', async () => {
    expect((await api(admin).get('/settings/ai')).status).toBe(200);
    expect((await api(pm).get('/settings/ai')).status).toBe(403);
    expect((await api(pm).put('/settings/ai', { provider: 'openai', confirm: true, reason: 'because we want to' })).status).toBe(403);
    expect((await api(fin).post('/settings/ai/test', {})).status).toBe(403);
  });
  it('switching needs confirmation and a reason, then takes effect and is audited; keys are never returned', async () => {
    process.env.OPENAI_API_KEY = 'sk-secret-value'; delete process.env.AI_PROVIDER;
    const s0 = (await api(admin).get('/settings/ai')).data; expect(s0.active).toBe('anthropic');
    expect(s0.providers.find((p: any) => p.id === 'openai').keySet).toBe(true); expect((await api(admin).get('/settings/ai')).text).not.toContain('sk-secret-value');
    const no = await api(admin).put('/settings/ai', { provider: 'openai' }); expect(no.status).toBe(400); expect(no.text).toContain('confirm'); expect(no.text).toContain('reason');
    expect((await api(admin).put('/settings/ai', { provider: 'openai', confirm: true, reason: 'short' })).status).toBe(400);
    const ok = await api(admin).put('/settings/ai', { provider: 'openai', openaiModel: 'gpt-test', confirm: true, reason: 'Compare cost and quality in a trial' });
    expect(ok.status).toBe(200); expect(ok.data.active).toBe('openai'); expect(ok.data.model).toBe('gpt-test'); expect(ok.data.host).toBe('api.openai.com');
    expect(activeProvider()).toBe('openai');
    const log = (await api(admin).get('/audit?action=settings.ai_provider_changed&pageSize=5')).data.items as any[]; expect(log.length).toBeGreaterThan(0);
    // saving the same provider again needs no confirmation
    expect((await api(admin).put('/settings/ai', { provider: 'openai', openaiModel: 'gpt-test-2' })).status).toBe(200);
  });
  it('rejects unsafe addresses and odd model names', async () => {
    for (const u of ['http://api.example.com/v1', 'https://localhost/v1', 'https://169.254.169.254/v1', 'https://user:pw@api.example.com/v1', 'not a url']) {
      expect((await api(admin).put('/settings/ai', { provider: 'openai-compatible', openaiBaseUrl: u, confirm: true, reason: 'testing the address check' })).status, u).toBe(400);
    }
    expect((await api(admin).put('/settings/ai', { provider: 'openai', openaiModel: 'bad model; drop', confirm: true, reason: 'testing the name check' })).status).toBe(400);
  });
  it('a live task goes to the provider chosen on the screen', async () => {
    process.env.AI_MODE = 'claude'; process.env.CLAUDE_API_KEY = 'ck'; process.env.OPENAI_API_KEY = 'ok';
    expect((await api(admin).put('/settings/ai', { provider: 'openai-compatible', openaiBaseUrl: 'https://gen.example.com/v1', openaiModel: 'gen-1', confirm: true, reason: 'Trial of another service' })).status).toBe(200);
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }); }));
    const t = await api(admin).post('/settings/ai/test', {}); expect(t.status).toBe(200); expect(t.data.ok).toBe(true); expect(urls).toEqual(['https://gen.example.com/v1/chat/completions']);
  });
  it('the test says plainly when the key is missing', async () => {
    delete process.env.OPENAI_API_KEY; process.env.AI_PROVIDER = 'openai';
    const t = await api(admin).post('/settings/ai/test', {}); expect(t.data.ok).toBe(false); expect(t.data.message).toContain('OPENAI_API_KEY');
  });
});
