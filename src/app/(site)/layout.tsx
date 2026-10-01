import { SiteHeader } from '@/components/site/SiteHeader';
import { ScrollProgress } from '@/components/site/ScrollProgress';
import { SiteFooter } from '@/components/site/SiteFooter';
import { AnnouncementBar } from '@/components/site/AnnouncementBar';
import { getSite } from '@/lib/site-content';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const site = await getSite();
  return (
    <div className="site flex min-h-screen flex-col">
      <a href="#main" className="skip">Skip to content</a>
      <ScrollProgress />
      <AnnouncementBar a={site.announcement} />
      <SiteHeader nav={site.nav} />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter site={site} />
    </div>
  );
}
