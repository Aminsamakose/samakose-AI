import { z } from 'zod';
import { asc, desc, ilike, or, sql, type SQL, type AnyColumn } from 'drizzle-orm';

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['json', 'csv']).default('json')
});
export type ListQuery = z.infer<typeof listQuery>;

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/** ilike across the given columns. */
export function search(q: string | undefined, cols: AnyColumn[]): SQL | undefined {
  if (!q) return undefined;
  const pat = `%${escapeLike(q)}%`;
  return or(...cols.map((c) => ilike(c, pat)));
}
/** Only whitelisted sort keys are accepted. */
export function orderBy(q: ListQuery, allowed: Record<string, AnyColumn>, fallback: AnyColumn) {
  const col = (q.sort && allowed[q.sort]) || fallback;
  return q.dir === 'asc' ? asc(col) : desc(col);
}
export const offset = (q: ListQuery) => (q.page - 1) * q.pageSize;
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; pages: number };
export const page = <T>(items: T[], total: number, q: ListQuery): Page<T> => ({ items, total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) });
export const countOf = sql<number>`count(*)::int`;
