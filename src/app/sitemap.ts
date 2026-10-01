import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { listAllArticles } from '@/lib/content';

const PAGES = ['', '/platform', '/solutions', '/impact', '/resources', '/pricing', '/about', '/contact', '/privacy', '/terms'];
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.appUrl;
  return [...PAGES.map((p) => ({ url: base + p })), ...(await listAllArticles()).map((a) => ({ url: `${base}/resources/${a.slug}`, lastModified: a.date }))];
}
