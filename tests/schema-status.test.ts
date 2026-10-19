import { describe, expect, it } from 'vitest';
import { pendingMigrations } from '@/db/schema-status';

const entries = [{ tag: '0001_a', when: 1 }, { tag: '0002_b', when: 2 }, { tag: '0003_c', when: 3 }];
const hash = (t: string) => `h:${t}`;

describe('pendingMigrations', () => {
  it('is empty when every journal migration is applied', () => {
    expect(pendingMigrations(entries, new Set(entries.map((e) => hash(e.tag))), hash)).toEqual([]);
  });
  it('lists migrations the database has not applied, in journal order', () => {
    expect(pendingMigrations(entries, new Set([hash('0001_a')]), hash)).toEqual(['0002_b', '0003_c']);
  });
  it('treats an edited, already-applied migration as pending so drift is visible', () => {
    expect(pendingMigrations(entries, new Set(['h:0001_a', 'other', 'h:0003_c']), hash)).toEqual(['0002_b']);
  });
});
