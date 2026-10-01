import { unstable_cache } from 'next/cache';
import type { SiteContent } from '@/lib/site-content';
/** The cached loader needs a Next.js runtime; tests call the same code path uncached. */
export async function loadForTest(): Promise<SiteContent> {
  const mod = await import('@/lib/site-content');
  void unstable_cache;
  return (mod as any).__load();
}
