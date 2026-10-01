import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/dashboard', '/cases', '/organisations', '/programmes', '/finance', '/admin', '/my-case', '/reports', '/reviews', '/sessions', '/profile', '/notifications', '/search', '/pay', '/login', '/mfa', '/mfa-setup', '/accept-invite', '/reset-password', '/forgot-password', '/change-password'] }], sitemap: `${env.appUrl}/sitemap.xml` };
}
