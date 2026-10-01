'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import clsx from 'clsx';
import { Logo } from './Logo';
import { ButtonLink } from './ui';
import { NAV, LOGIN_HREF, PORTAL_HREF, REGISTER_HREF } from './config';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  // Seamless handoff: a visitor who already has a session sees "Open portal" instead of "Sign in".
  useEffect(() => {
    let live = true;
    fetch('/api/v1/auth/me', { credentials: 'same-origin' }).then((r) => { if (live && r.ok) setSignedIn(true); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open]);

  const link = 'rounded-full px-3 py-2 text-sm font-semibold text-fg no-underline transition-colors duration-200 hover:bg-surface-2';
  return (
    <header className={clsx('sticky top-0 z-40 border-b transition-all duration-300', scrolled ? 'border-line bg-bg/90 backdrop-blur' : 'border-transparent bg-bg')}>
      <div className="mx-auto flex h-[72px] w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => <Link key={n.href} href={n.href} className={link}>{n.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          {signedIn ? <ButtonLink href={PORTAL_HREF}>Open portal</ButtonLink> : (<>
            <ButtonLink href={LOGIN_HREF} variant="ghost">Sign in</ButtonLink>
            <ButtonLink href={REGISTER_HREF}>Start your health check</ButtonLink>
          </>)}
        </div>
        <button type="button" className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-fg lg:hidden" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((v) => !v)}>
          {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </div>
      <div id="mobile-menu" hidden={!open} className="border-t border-line bg-bg lg:hidden">
        <nav aria-label="Mobile" className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 sm:px-6">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="rounded-xl px-3 py-3 text-base font-semibold text-fg no-underline hover:bg-surface-2" onClick={() => setOpen(false)}>{n.label}</Link>)}
          <div className="mt-3 flex flex-col gap-2">
            {signedIn ? <ButtonLink href={PORTAL_HREF}>Open portal</ButtonLink> : (<>
              <ButtonLink href={REGISTER_HREF}>Start your health check</ButtonLink>
              <ButtonLink href={LOGIN_HREF} variant="ghost">Sign in</ButtonLink>
            </>)}
          </div>
        </nav>
      </div>
    </header>
  );
}
