'use client';
import { motion, useReducedMotion } from 'motion/react';
import { CountUp } from './motion';

const R = 54;
const C = 2 * Math.PI * R;
const ROWS = [
  { k: 'SME360', v: 59 },
  { k: 'AgriFood360', v: 53 },
  { k: 'ESO360', v: 57 }
];

/** Illustrative health card. Figures are an example, not real client data, and the card says so. */
export function HeroVitals() {
  const reduce = useReducedMotion();
  return (
    <figure className="rounded-[24px] border border-lime/25 bg-ink/60 p-6 text-white backdrop-blur" aria-label="Illustrative business health score">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-lime">Vital signs, example only</span>
        <span className="rounded-full bg-lime px-3 py-1 text-xs font-bold text-ink">Fragile</span>
      </figcaption>
      <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row">
        <div className="relative size-36 flex-none">
          <svg viewBox="0 0 140 140" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="12" />
            <motion.circle cx="70" cy="70" r={R} fill="none" stroke="#C6F26B" strokeWidth="12" strokeLinecap="round" strokeDasharray={C}
              initial={{ strokeDashoffset: reduce ? C * 0.47 : C }} animate={{ strokeDashoffset: C * 0.47 }} transition={{ duration: 1.2, ease: [0.2, 0.7, 0.3, 1], delay: 0.3 }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <CountUp to={53} className="font-display text-4xl font-bold leading-none" />
            <span className="font-mono text-[11px] text-white/60">of 100</span>
          </div>
        </div>
        <ul className="flex w-full min-w-0 flex-1 flex-col gap-3">
          {ROWS.map((r, i) => (
            <li key={r.k} className="flex items-center gap-3 text-sm">
              <span className="w-[5.5rem] flex-none font-semibold">{r.k}</span>
              <span className="h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-white/15">
                <motion.span className="block h-full rounded-full bg-lime" initial={{ width: reduce ? `${r.v}%` : 0 }} animate={{ width: `${r.v}%` }} transition={{ duration: 0.9, delay: 0.5 + i * 0.12, ease: [0.2, 0.7, 0.3, 1] }} />
              </span>
              <span className="w-7 text-right font-semibold tabular-nums">{r.v}</span>
            </li>
          ))}
        </ul>
      </div>
      <svg viewBox="0 0 640 44" preserveAspectRatio="none" className="mt-5 h-8 w-full" aria-hidden="true">
        <motion.path d="M0 24h150l14-16 18 34 16-30 12 12h430" fill="none" stroke="#C6F26B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, delay: 0.4, ease: 'easeInOut' }} />
      </svg>
      <p className="mt-3 text-xs text-white/60">Sample organisation. Not real client data.</p>
    </figure>
  );
}
