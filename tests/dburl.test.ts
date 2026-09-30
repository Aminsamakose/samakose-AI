import { describe, it, expect } from 'vitest';
import { parse } from 'pg-connection-string';
import { cleanDatabaseUrl } from '@/db/client';

const good = 'postgresql://postgres.abc:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

describe('database url clean-up', () => {
  it.each([
    ['plain', good],
    ['leading space', ` ${good}`],
    ['trailing newline', `${good}\n`],
    ['double quotes', `"${good}"`],
    ['single quotes', `'${good}'`],
    ['pasted with the variable name', `DATABASE_URL=${good}`],
    ['name, quotes and spaces', `  DATABASE_URL = "${good}" `]
  ])('accepts %s', (_l, raw) => {
    const c = cleanDatabaseUrl(raw);
    expect(c).toBe(good);
    expect(parse(c).host).toBe('aws-1-eu-central-1.pooler.supabase.com');
  });
});
