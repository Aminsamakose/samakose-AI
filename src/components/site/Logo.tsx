import Link from 'next/link';
import clsx from 'clsx';

export function LogoMark({ className, onDark }: { className?: string; onDark?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx('size-9 flex-none', className)} aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill={onDark ? '#C6F26B' : 'var(--brand, #0F4A3F)'} />
      <path d="M6 21h7l3-8 5 16 4-11 2 3h7" fill="none" stroke={onDark ? '#0C2622' : 'var(--logo-line, #C6F26B)'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ onDark }: { onDark?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-3 no-underline" aria-label="Samakose, The Business Doctor, home">
      <LogoMark onDark={onDark} />
      <span className="flex flex-col whitespace-nowrap leading-tight">
        <span className={clsx('font-display text-lg font-bold tracking-tight', onDark ? 'text-white' : 'text-fg')}>Samakose</span>
        <span className={clsx('text-xs', onDark ? 'text-white/70' : 'text-muted')}>The Business Doctor</span>
      </span>
    </Link>
  );
}
