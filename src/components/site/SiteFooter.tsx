import Link from 'next/link';
import { Logo } from './Logo';
import { Container } from './ui';
import { LOGIN_HREF, REGISTER_HREF } from './config';
import { contactOf, socialLinks, type SiteContent } from '@/lib/site-content';

export function SiteFooter({ site }: { site: SiteContent }) {
  const SITE = contactOf(site);
  const social = socialLinks(site);
  const lk = 'flex min-h-8 w-fit whitespace-nowrap items-center text-white/80 no-underline transition-colors hover:text-lime';
  return (
    <footer className="bg-ink pt-8 text-white">
      <Container>
        <div className="grid gap-6 pb-6 md:grid-cols-[1.1fr_1.5fr_1fr]">
          <div className="flex flex-col gap-3">
            <Logo onDark />
            <p className="max-w-xs text-xs leading-relaxed text-white/70">{site.brand.footerBlurb}</p>
            {social.length > 0 && <ul className="m-0 flex list-none flex-wrap gap-x-4 p-0 text-xs" aria-label="Social media">{social.map((l) => <li key={l.label}><a className={lk} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}<span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>}
          </div>
          <nav aria-label="Explore and account" className="text-sm">
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-lime">Explore</p>
            <ul style={{ rowGap: 0 }} className="m-0 grid list-none auto-rows-min grid-cols-2 content-start gap-x-6 p-0 sm:grid-cols-3">
              {site.nav.map((n) => <li key={n.href}><Link href={n.href} className={lk}>{n.label}</Link></li>)}
              <li><Link href="/#how-it-works" className={lk}>How it works</Link></li>
              <li><Link href={LOGIN_HREF} className={lk}>Sign in</Link></li>
              <li className="col-span-2 sm:col-span-1"><Link href={REGISTER_HREF} className={lk}>Start your health check</Link></li>
            </ul>
          </nav>
          <address className="flex flex-col text-sm not-italic">
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-lime">Contact</p>
            <span className="py-1 text-xs leading-relaxed text-white/80">{SITE.address.join(', ')}</span>
            <a className={lk} href={`mailto:${SITE.email}`}>{SITE.email}</a>
            <a className={lk} href={`tel:${SITE.phoneHref}`}>{SITE.phone}</a>
            {SITE.hours && <span className="text-xs text-white/70">{SITE.hours}</span>}
          </address>
        </div>
        <div className="flex flex-col gap-1 border-t border-white/15 py-2 text-xs text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Samakose. All rights reserved.</p>
          <p className="flex flex-wrap items-center gap-x-4"><Link href="/privacy" className="inline-flex min-h-8 items-center text-white/70 underline underline-offset-2">Privacy notice</Link><Link href="/terms" className="inline-flex min-h-8 items-center text-white/70 underline underline-offset-2">Terms of use</Link><span>Illustrations and sample figures are labelled as examples.</span></p>
        </div>
      </Container>
      <div className="h-1.5 w-full" style={{ background: 'repeating-linear-gradient(90deg,#c6f26b 0 24px,#e2a93b 24px 36px,#c4553a 36px 48px,#0f4a3f 48px 72px)' }} aria-hidden="true" />
    </footer>
  );
}
