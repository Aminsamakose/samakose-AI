'use client';
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import clsx from 'clsx';

const STEPS = [
  { k: 'Diagnose', t: 'Measure the health of the whole business', d: 'A guided assessment covers finance, market and sales, operations, people and governance, records and systems, and compliance and access to finance. Evidence you upload is graded alongside your answers.' },
  { k: 'Prioritise', t: 'Find the few conditions that matter most', d: 'The score places the business in a band, from Critical to Strong, and shows which dimensions pull it down, so you see where to start rather than a long list.' },
  { k: 'Prescribe', t: 'Match each condition to an intervention', d: 'Every priority gets a specific prescription: what to do, who owns it, what it needs and what it should achieve.' },
  { k: 'Execute', t: 'Turn the prescription into a dated plan', d: 'Prescriptions become an action plan with owners, deadlines and evidence of completion.' },
  { k: 'Coach', t: 'Get support while you act', d: 'Coaches and advisers work from the same record, so each session builds on the last one.' },
  { k: 'Measure', t: 'Re-check and track change', d: 'Scores and KPIs are re-measured so improvement, or the lack of it, is visible and can be reported to programme partners.' },
  { k: 'Scale', t: 'Build on a healthier base', d: 'When the basics are healthy, the same record supports conversations with lenders and partners and reporting to programmes.' }
];

export function HowItWorks() {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  const s = STEPS[i];
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-14">
      <div role="tablist" aria-label="How the platform works" className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {STEPS.map((st, n) => (
          <button key={st.k} role="tab" type="button" id={`hiw-tab-${n}`} aria-selected={n === i} aria-controls="hiw-panel" tabIndex={n === i ? 0 : -1}
            onClick={() => setI(n)}
            onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setI((n + 1) % STEPS.length); } if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setI((n + STEPS.length - 1) % STEPS.length); } }}
            className={clsx('flex min-h-11 flex-none items-center gap-3 rounded-full border px-4 py-2 text-left text-sm font-semibold transition-colors duration-200', n === i ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-fg hover:bg-surface-2')}>
            <span className={clsx('flex size-6 items-center justify-center rounded-full font-mono text-xs', n === i ? 'bg-lime text-ink' : 'bg-surface-2')}>{n + 1}</span>
            {st.k}
          </button>
        ))}
      </div>
      <div id="hiw-panel" role="tabpanel" aria-labelledby={`hiw-tab-${i}`} className="min-h-[200px] rounded-card border border-line bg-surface p-7">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-leaf-ink">Step {i + 1} of {STEPS.length}</p>
            <h3 className="mt-2 font-display text-2xl font-semibold">{s.t}</h3>
            <p className="mt-3 max-w-xl text-muted">{s.d}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
