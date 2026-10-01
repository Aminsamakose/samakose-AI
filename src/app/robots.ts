import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { getSite } from '@/lib/site-content';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { seo } = await getSite();
  if (seo.indexing === false) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/dashboard', '/cases', '/organisations', '/programmes', '/finance', '/admin', '/my-case', '/reports', '/reviews', '/sessions', '/profile', '/notifications', '/search', '/pay', '/login', '/mfa', '/mfa-setup', '/accept-invite', '/reset-password', '/forgot-password', '/change-password'] }], sitemap: `${env.appUrl}/sitemap.xml` };
}
