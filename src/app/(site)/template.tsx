'use client';
import { motion, useReducedMotion } from 'motion/react';

/** Subtle page-to-page transition for public pages. */
export default function Template({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>{children}</motion.div>;
}
