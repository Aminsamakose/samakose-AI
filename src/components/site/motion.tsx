'use client';
import { motion, useInView, useReducedMotion, animate } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Fades and lifts content in once as it scrolls into view. Content stays visible without JS and with reduced motion. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }} transition={{ duration: 0.45, delay, ease: [0.2, 0.7, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}

/** Staggers its direct <Item> children in on scroll. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial="hide" whileInView="show" viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      variants={{ hide: {}, show: { transition: { staggerChildren: 0.08 } } }}>
      {children}
    </motion.div>
  );
}
export function Item({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return <motion.div className={className} variants={{ hide: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.2, 0.7, 0.3, 1] } } }}>{children}</motion.div>;
}

/** Counts up to a value when first seen. Shows the final value immediately for reduced motion. */
export function CountUp({ to, duration = 1.1, className }: { to: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setV(to); return; }
    const c = animate(0, to, { duration, ease: [0.2, 0.7, 0.3, 1], onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [inView, to, duration, reduce]);
  return <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>;
}
