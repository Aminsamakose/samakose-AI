import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { listArticles } from '@/lib/content';

const PAGES = ['', '/platform', '/solutions', '/impact', '/resources', '/pricing', '/about', '/contact', '/privacy', '/terms'];
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.appUrl;
  return [...PAGES.map((p) => ({ url: base + p })), ...listArticles().map((a) => ({ url: `${base}/resources/${a.slug}`, lastModified: a.date }))];
}
