/** Logframe levels, top to bottom. A parent is always exactly one level above its child. */
export const LEVELS = ['impact', 'outcome', 'output'] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABEL: Record<Level, string> = { impact: 'Impact', outcome: 'Outcome', output: 'Output' };
export const parentLevel = (l: Level): Level | null => (l === 'impact' ? null : l === 'outcome' ? 'impact' : 'outcome');
/** Returns an error message, or null when the pairing is fine. */
export function checkParent(level: Level, parent: { level: string; programmeId: string } | null, programmeId: string): string | null {
  const need = parentLevel(level);
  if (!need) return parent ? 'An impact is the top of the framework and has no parent' : null;
  if (!parent) return null; // a parent is optional so work can be entered in any order
  if (parent.programmeId !== programmeId) return 'The parent belongs to a different programme';
  if (parent.level !== need) return level === 'outcome' ? 'An outcome sits under an impact' : 'An output sits under an outcome';
  return null;
}

type Money = number;
export const round2 = (n: number): Money => Math.round(n * 100) / 100;
/** Budget position. Allocation is the sum of lines; the tranche plan is checked against the same ceiling. */
export function budgetPosition(budget: number | null, lines: number[], tranches: { amount: number; status: string; received: number | null; due: string | null }[], today: string) {
  const allocated = round2(lines.reduce((a, b) => a + b, 0));
  const planned = round2(tranches.reduce((a, t) => a + t.amount, 0));
  const received = round2(tranches.filter((t) => t.status === 'Received').reduce((a, t) => a + (t.received ?? 0), 0));
  const overdue = tranches.filter((t) => t.status === 'Planned' && t.due && t.due < today).length;
  return { budget, allocated, unallocated: budget === null ? null : round2(budget - allocated), plannedTranches: planned, unscheduled: budget === null ? null : round2(budget - planned), received, outstanding: round2(planned - received), overdueTranches: overdue };
}
