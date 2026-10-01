'use client';
import { motion, useScroll, useSpring, useReducedMotion } from 'motion/react';

/** A thin lime line under the header that shows how far down the page you are. Hidden for reduced motion. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const x = useSpring(scrollYProgress, { stiffness: 180, damping: 28, mass: 0.3 });
  const reduce = useReducedMotion();
  if (reduce) return null;
  return <motion.div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-lime" style={{ scaleX: x }} />;
}
