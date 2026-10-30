import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => { delete process.env.PAYSTACK_SECRET_KEY; delete process.env.PAYSTACK_SECRET_KEY_1; });

describe('env.paystackSecret', () => {
  it('reads the canonical name when it is set', async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_live_canonical';
    process.env.PAYSTACK_SECRET_KEY_1 = 'sk_live_should_not_be_used';
    const { env } = await import('@/lib/env');
    expect(env.paystackSecret).toBe('sk_live_canonical');
  });
  it('falls back to PAYSTACK_SECRET_KEY_1 when the canonical name is unset -- this is the production fix: Vercel has the key under the _1 name and code read the other', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY_1 = 'sk_live_from_the_1_suffixed_var';
    const { env } = await import('@/lib/env');
    expect(env.paystackSecret).toBe('sk_live_from_the_1_suffixed_var');
  });
  it('is empty, not a crash, when neither is set -- mock mode stays the correct fallback behaviour', async () => {
    delete process.env.PAYSTACK_SECRET_KEY; delete process.env.PAYSTACK_SECRET_KEY_1;
    const { env } = await import('@/lib/env');
    expect(env.paystackSecret).toBe('');
  });
  it('still trims whitespace and stray quotes through the fallback path', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY_1 = '  "sk_live_padded"  ';
    const { env } = await import('@/lib/env');
    expect(env.paystackSecret).toBe('sk_live_padded');
  });
});
