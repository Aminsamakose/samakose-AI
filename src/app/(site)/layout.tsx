import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site flex min-h-screen flex-col">
      <a href="#main" className="skip">Skip to content</a>
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
