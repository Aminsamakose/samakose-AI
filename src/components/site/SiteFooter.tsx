import Link from 'next/link';
import { Logo } from './Logo';
import { Container } from './ui';
import { NAV, SITE, LOGIN_HREF, REGISTER_HREF } from './config';

export function SiteFooter() {
  const a = 'text-white/80 no-underline transition-colors hover:text-lime';
  return (
    <footer className="bg-ink pt-16 text-white">
      <Container>
        <div className="grid gap-10 pb-12 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div className="flex flex-col gap-4">
            <Logo onDark />
            <p className="max-w-xs text-sm text-white/70">Diagnose, prescribe and track the health of enterprises across Africa. Built in Tamale, Northern Ghana.</p>
          </div>
          <nav aria-label="Explore" className="flex flex-col gap-2 text-sm">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-lime">Explore</p>
            {NAV.map((n) => <Link key={n.href} href={n.href} className={a}>{n.label}</Link>)}
            <Link href="/#resources" className={a}>Resources</Link>
          </nav>
          <nav aria-label="Account" className="flex flex-col gap-2 text-sm">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-lime">Account</p>
            <Link href={LOGIN_HREF} className={a}>Sign in</Link>
            <Link href={REGISTER_HREF} className={a}>Start your health check</Link>
          </nav>
          <address className="flex flex-col gap-2 text-sm not-italic">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-lime">Contact</p>
            <span className="text-white/80">{SITE.address.map((l) => <span key={l} className="block">{l}</span>)}</span>
            <a className={a} href={`mailto:${SITE.email}`}>{SITE.email}</a>
            <a className={a} href={`tel:${SITE.phoneHref}`}>{SITE.phone}</a>
          </address>
        </div>
        <div className="flex flex-col gap-2 border-t border-white/15 py-6 text-xs text-white/60 sm:flex-row sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Samakose. All rights reserved.</p>
          <p>Illustrations and sample figures on this site are labelled as examples.</p>
        </div>
      </Container>
      <div className="h-2 w-full" style={{ background: 'repeating-linear-gradient(90deg,#c6f26b 0 24px,#e2a93b 24px 36px,#c4553a 36px 48px,#0f4a3f 48px 72px)' }} aria-hidden="true" />
    </footer>
  );
}
