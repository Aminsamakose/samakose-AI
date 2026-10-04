import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { libraryDimension, weakestForLibrary } from '@/domain/library-map';

const LIB = ['Strategy, Market and Customers', 'Operations and Value Delivery', 'Financial Management and Performance', 'Funding and Capital Readiness', 'People, Leadership and Governance', 'Records, Data and Systems', 'Legal, Regulatory and Risk', 'Resilience, Inclusion and Sustainability'];
const dimsOf = (f: string) => Array.from(new Set((JSON.parse(fs.readFileSync(path.resolve(process.cwd(), `docs/frameworks/drafts/${f}-bank-v1-loadable.json`), 'utf8')).questions as any[]).map((q) => q.dimension)));

describe('library dimension map', () => {
  for (const f of ['sme360', 'agrifood360', 'eso360']) it(`every ${f} dimension resolves to a library dimension, one to one`, () => {
    const d = dimsOf(f); expect(d).toHaveLength(8);
    const mapped = d.map(libraryDimension); for (const m of mapped) expect(LIB).toContain(m);
    expect(new Set(mapped).size).toBe(8);
  });
  it('translates and de-duplicates the weakest dimensions, and passes unknown names through', () => {
    expect(weakestForLibrary([{ dimension: 'Production, Inputs and Post-harvest', value: 10 }, { dimension: 'Delivery Operations and Service Quality', value: 20 }, { dimension: 'Records, Data and Systems', value: 30 }, { dimension: 'Finance', value: 40 }, { dimension: 'Zzz', value: 50 }]))
      .toEqual(['Operations and Value Delivery', 'Records, Data and Systems', 'Finance']);
    expect(libraryDimension('Zzz')).toBe('Zzz');
  });
});
