import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeProvider, modelFor, providerHasKey, providerHost, transportFor } from '@/services/ai-providers';
import { aiIsLive, aiIsMock } from '@/services/ai';

const KEYS = ['AI_MODE', 'AI_PROVIDER', 'CLAUDE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL', 'CLAUDE_MODEL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.unstubAllGlobals(); });

describe('AI provider switch', () => {
  it('defaults to Claude and treats an unknown name as Claude', () => {
    delete process.env.AI_PROVIDER; expect(activeProvider()).toBe('anthropic');
    process.env.AI_PROVIDER = 'chatgpt-typo'; expect(activeProvider()).toBe('anthropic');
    process.env.AI_PROVIDER = 'OpenAI '; expect(activeProvider()).toBe('openai');
    process.env.AI_PROVIDER = 'openai-compatible'; expect(activeProvider()).toBe('openai-compatible');
  });
  it('live mode needs the key of the chosen provider, not of another', () => {
    process.env.AI_MODE = 'claude'; process.env.CLAUDE_API_KEY = 'ck'; delete process.env.OPENAI_API_KEY;
    process.env.AI_PROVIDER = 'anthropic'; expect(aiIsLive()).toBe(true); expect(aiIsMock()).toBe(false);
    process.env.AI_PROVIDER = 'openai'; expect(providerHasKey()).toBe(false); expect(aiIsLive()).toBe(false); expect(aiIsMock()).toBe(true);
    process.env.OPENAI_API_KEY = ' "ok" '; expect(aiIsLive()).toBe(true);
  });
  it('ignores a pinned Claude model on another provider and the reverse', () => {
    process.env.OPENAI_MODEL = 'gpt-test'; process.env.CLAUDE_MODEL = 'claude-test';
    expect(modelFor('claude-opus-x', 'openai')).toBe('gpt-test'); expect(modelFor('gpt-pinned', 'openai')).toBe('gpt-pinned'); expect(modelFor(null, 'openai')).toBe('gpt-test');
    expect(modelFor('claude-pinned', 'anthropic')).toBe('claude-pinned'); expect(modelFor('gpt-pinned', 'anthropic')).toBe('claude-test');
  });
  it('shows only the host a provider sends to', () => {
    process.env.AI_PROVIDER = 'anthropic'; expect(providerHost()).toBe('api.anthropic.com');
    process.env.AI_PROVIDER = 'openai-compatible'; process.env.OPENAI_BASE_URL = 'https://gen.example.com/v1/'; expect(providerHost()).toBe('gen.example.com');
  });
  it('sends the right request to each provider and reads the reply', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify(url.includes('anthropic') ? { content: [{ text: '{"a":1}' }], usage: { input_tokens: 5, output_tokens: 7 } } : { choices: [{ message: { content: '{"b":2}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 }); }));
    process.env.CLAUDE_API_KEY = 'ck'; process.env.OPENAI_API_KEY = 'ok'; process.env.OPENAI_BASE_URL = 'https://gen.example.com/v1'; process.env.OPENAI_MODEL = 'gpt-test';
    process.env.AI_PROVIDER = 'anthropic';
    expect(await transportFor()('SYS', 'USER', AbortSignal.timeout(1000))).toEqual({ text: '{"a":1}', inputTokens: 5, outputTokens: 7 });
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages'); expect(calls[0].init.headers['x-api-key']).toBe('ck'); expect(calls[0].body.system).toBe('SYS');
    process.env.AI_PROVIDER = 'openai-compatible';
    expect(await transportFor()('SYS', 'USER', AbortSignal.timeout(1000), 'claude-pinned')).toEqual({ text: '{"b":2}', inputTokens: 3, outputTokens: 4 });
    expect(calls[1].url).toBe('https://gen.example.com/v1/chat/completions'); expect(calls[1].init.headers.authorization).toBe('Bearer ok');
    expect(calls[1].body.model).toBe('gpt-test'); expect(calls[1].body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }]);
    expect(JSON.stringify(calls[1].init.headers)).not.toContain('ck'); // the other provider's key is never sent
  });
  it('a provider error surfaces without leaking the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    process.env.OPENAI_API_KEY = 'secret-key'; process.env.AI_PROVIDER = 'openai';
    await expect(transportFor()('s', 'u', AbortSignal.timeout(1000))).rejects.toThrow('Model service answered 401');
  });
});
