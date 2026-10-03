import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/public-sans';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './globals.css';

import { getSite } from '@/lib/site-content';

export async function generateMetadata(): Promise<Metadata> {
  const { brand, seo } = await getSite();
  const image = /^https:\/\//.test(String(seo.shareImage ?? '')) ? [String(seo.shareImage)] : undefined;
  return {
    metadataBase: new URL(process.env.APP_URL || 'https://samakose-ai.vercel.app'),
    alternates: { canonical: './' },
    title: { default: String(brand.browserTitle), template: `%s | ${brand.siteName}` },
    description: String(seo.description),
    robots: seo.indexing === false ? { index: false, follow: false } : undefined,
    openGraph: { siteName: String(brand.siteName), description: String(seo.description), images: image },
    twitter: image ? { card: 'summary_large_image', images: image } : undefined
  };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' };

const NO_FLASH = "try{var t=localStorage.getItem('sk-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

/** An administrator's brand colour, applied to the light theme only. The dark theme keeps its own tuned colours. */
function brandCss(hex: unknown): string {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/.test(hex)) return '';
  const rule = `--brand:${hex};--forest:${hex};--brand-soft:color-mix(in srgb,${hex} 14%,#fff)`;
  return `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${rule}}}:root[data-theme="light"]{${rule}}`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const css = brandCss((await getSite()).brand.primaryColour);
  return <html lang="en-GH" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />{css && <style dangerouslySetInnerHTML={{ __html: css }} />}</head><body>{children}</body></html>;
}
