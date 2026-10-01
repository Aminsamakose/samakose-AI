import Link from 'next/link';
import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>;
}

export function Section({ id, tone = 'light', children, className }: { id?: string; tone?: 'light' | 'soft' | 'dark'; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={clsx('py-16 sm:py-24', tone === 'dark' ? 'bg-ink text-white' : tone === 'soft' ? 'bg-surface-2 text-fg' : 'bg-bg text-fg', className)}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <p className={clsx('font-mono text-xs font-medium uppercase tracking-[0.14em]', dark ? 'text-lime' : 'text-leaf')}>{children}</p>;
}

type Variant = 'primary' | 'lime' | 'ghost' | 'ghost-dark';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-forest text-white hover:bg-leaf',
  lime: 'bg-lime text-ink hover:brightness-95',
  ghost: 'border border-line bg-surface text-fg hover:bg-surface-2',
  'ghost-dark': 'border border-white/25 text-white hover:bg-white/10'
};
export function ButtonLink({ href, variant = 'primary', children, className }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={clsx('inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[0.95rem] font-semibold no-underline transition duration-200 active:scale-[0.97] focus-visible:outline-2', VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rounded-card border border-line bg-surface p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg', className)}>{children}</div>;
}

/** Marks content that is not yet verified. Replace the contents when real data is supplied. */
export function Placeholder({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div role="note" className="rounded-card border border-dashed border-gold bg-[color:var(--warn-soft)] p-5 text-sm text-[color:var(--warn)]">
      <p className="font-mono text-xs font-medium uppercase tracking-[0.12em]">Placeholder, replace with verified data</p>
      <p className="mt-1 font-semibold">{label}</p>
      {children}
    </div>
  );
}
