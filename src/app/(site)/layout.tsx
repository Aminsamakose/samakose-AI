import Script from 'next/script';
import { SiteHeader } from '@/components/site/SiteHeader';
import { ScrollProgress } from '@/components/site/ScrollProgress';
import { SiteFooter } from '@/components/site/SiteFooter';
import { AnnouncementBar } from '@/components/site/AnnouncementBar';
import { getSite } from '@/lib/site-content';

const DNT = "if(navigator.doNotTrack==='1'||window.doNotTrack==='1')window.__noTrack=true;";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const site = await getSite();
  const ga = String(site.analytics.ga4Id ?? ''); const pl = String(site.analytics.plausibleDomain ?? '');
  if (site.maintenance.on) {
    return <div className="site flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <main id="main" className="max-w-xl" style={{ display: 'grid', gap: 16 }}>
        <h1>{String(site.brand.name || 'Samakose')} is being updated</h1>
        <p style={{ opacity: 0.85 }}>{site.maintenance.message || 'We are making improvements and will be back shortly. Thank you for your patience.'}</p>
        <p className="small" style={{ opacity: 0.7 }}>Team members can still <a href="/login">sign in</a>.</p>
      </main>
    </div>;
  }
  return (
    <div className="site flex min-h-screen flex-col">
      <a href="#main" className="skip">Skip to content</a>
      <ScrollProgress />
      <AnnouncementBar a={site.announcement} />
      <SiteHeader nav={site.nav} />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter site={site} />
      {(ga || pl) && <Script id="dnt" strategy="afterInteractive">{DNT}</Script>}
      {ga && <>
        <Script id="ga-src" src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />
        <Script id="ga-init" strategy="afterInteractive">{`if(!window.__noTrack){window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}',{anonymize_ip:true});}`}</Script>
      </>}
      {pl && <Script id="pl" strategy="afterInteractive">{`if(!window.__noTrack){var s=document.createElement('script');s.defer=true;s.src='https://plausible.io/js/script.js';s.setAttribute('data-domain','${pl}');document.head.appendChild(s);}`}</Script>}
    </div>
  );
}
