/** Deterministic drafts used when AI_MODE=mock. They follow the same schemas the real model must follow. */
import type { PrescriptionItem } from '@/db/schema';

export type DiagnosisContext = {
  business: { type: string; sector: string | null; region: string | null; size: string | null };
  overall: number; maturity: string; confidence_class: string;
  dimensions: { dimension: string; value: number }[];
  weakest_answers: { question_code: string; question: string; dimension: string; value: number; evidence_class: string; evidence_id: string }[];
  allowed_evidence_ids: string[];
};
export function mockDiagnosis(c: DiagnosisContext) {
  const weakest = [...c.dimensions].sort((a, b) => a.value - b.value).slice(0, 2);
  const root_causes = weakest.map((d) => {
    const ans = c.weakest_answers.filter((a) => a.dimension === d.dimension).slice(0, 2);
    const ids = ans.length ? ans.map((a) => a.evidence_id) : c.allowed_evidence_ids.slice(0, 1);
    return { cause: `${d.dimension}: ${ans.length ? ans.map((a) => a.question.toLowerCase()).join('; ') + ' is not yet in place' : 'practices are weak'} (dimension score ${d.value})`, evidence_ids: ids };
  });
  const lowest = weakest[0]?.value ?? 100;
  const priority = c.overall < 40 || lowest < 30 ? 'High' : c.overall < 60 ? 'Medium' : 'Low';
  const risks = c.dimensions.filter((d) => d.value < 50).map((d) => ({ text: `${d.dimension} score of ${d.value} exposes the business to avoidable losses`, severity: d.value < 35 ? 'High' : 'Medium' }));
  return {
    summary: `The business scores ${c.overall} out of 100 (${c.maturity}) with ${c.confidence_class.toLowerCase()} confidence. The weakest areas are ${weakest.map((d) => d.dimension).join(' and ')}. Fixing these first will lift the overall score fastest.`,
    root_causes, priority, risks, model_confidence: 0.6
  };
}

export type LibraryLite = { id: string; title: string; dimension: string; description: string; typical_days: number };
export type PrescriptionContext = { weakest_dimensions: string[]; library: LibraryLite[]; limits: { min_days: number; max_days: number } };
export function mockPrescription(c: PrescriptionContext): { items: PrescriptionItem[] } {
  const clamp = (d: number) => Math.max(c.limits.min_days, Math.min(c.limits.max_days, Math.round(d)));
  const items: PrescriptionItem[] = [];
  for (const dim of c.weakest_dimensions.slice(0, 3)) {
    for (const lib of c.library.filter((l) => l.dimension === dim).slice(0, 2)) {
      items.push({ library_id: lib.id, actions: [
        { text: lib.description, owner_role: 'OWNER', deadline_days: clamp(lib.typical_days) },
        { text: `Review progress on "${lib.title}" at the next coaching session`, owner_role: 'COACH', deadline_days: clamp(lib.typical_days + 7) }
      ] });
    }
  }
  if (!items.length && c.library[0]) items.push({ library_id: c.library[0].id, actions: [{ text: c.library[0].description, owner_role: 'OWNER', deadline_days: clamp(c.library[0].typical_days) }] });
  return { items };
}

export type BriefContext = { org: string; status: string; overall: number | null; maturity: string | null; open_actions: string[]; overdue_actions: string[]; done_actions: number; last_session: string | null; kpis: { name: string; latest: number | null; target: number | null }[] };
export function mockBrief(c: BriefContext) {
  const lines = [
    `Where ${c.org} stands: case is ${c.status}${c.overall !== null ? `, health score ${c.overall} (${c.maturity})` : ''}.`,
    `Progress: ${c.done_actions} action(s) done, ${c.open_actions.length} open${c.overdue_actions.length ? `, ${c.overdue_actions.length} overdue` : ''}.`,
    c.overdue_actions.length ? `Overdue: ${c.overdue_actions.slice(0, 3).join('; ')}.` : 'Nothing is overdue.',
    c.last_session ? `Last session notes: ${c.last_session}` : 'This is the first session on record.',
    'Questions to ask: What has changed in the last two weeks? What is blocking the next action? What will you do before we meet again?',
    'Agree before closing: one owner and one date for each open action.'
  ];
  return { brief: lines.join('\n') };
}

export type ReportContext = {
  org: string; overall: number; maturity: string; confidence_class: string; dimensions: { dimension: string; value: number }[]; previous_overall: number | null;
  evidence_share: Record<string, number>; actions: { total: number; done: number; overdue: number };
  kpis: { name: string; unit: string | null; baseline: number | null; latest: number | null; target: number | null }[]; root_causes: string[];
};
export function mockReport(c: ReportContext) {
  const strong = [...c.dimensions].sort((a, b) => b.value - a.value)[0], weak = [...c.dimensions].sort((a, b) => a.value - b.value)[0];
  const backed = Math.round(((c.evidence_share['Verified'] ?? 0) + (c.evidence_share['Document-supported'] ?? 0)) * 100);
  const change = c.previous_overall === null ? 'This is the first measurement.' : `Compared with the previous measurement of ${c.previous_overall}, the score moved by ${(c.overall - c.previous_overall).toFixed(1)} points.`;
  return { sections: [
    { heading: 'Where the business stands', body: `${c.org} has a health score of ${c.overall} out of 100, which is ${c.maturity}. ${change}` },
    { heading: 'Strongest and weakest areas', body: `The strongest area is ${strong?.dimension} (${strong?.value}). The weakest is ${weak?.dimension} (${weak?.value}).${c.root_causes.length ? ' Main causes found: ' + c.root_causes.join('; ') + '.' : ''}` },
    { heading: 'Work agreed and done', body: `${c.actions.done} of ${c.actions.total} agreed actions are complete${c.actions.overdue ? `, and ${c.actions.overdue} are overdue` : ''}.` },
    { heading: 'Indicators', body: c.kpis.length ? c.kpis.map((k) => `${k.name}: ${k.latest ?? 'no reading yet'}${k.unit ? ' ' + k.unit : ''}${k.target !== null ? ` (target ${k.target})` : ''}`).join('. ') + '.' : 'No indicators have been set yet.' },
    { heading: 'How much of this is backed by evidence', body: `${backed} percent of the score rests on verified or document-supported answers. The rest is self-reported and may change when evidence is checked. Confidence in this result is ${c.confidence_class.toLowerCase()}.` }
  ] };
}
