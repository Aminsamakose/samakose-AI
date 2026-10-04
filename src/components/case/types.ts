/** Contract between the case workspace page and its tab components. */
export type CaseData = {
  id: string; code: string; status: string; orgId: string; orgName: string; orgCode: string; region: string | null;
  programmeId: string | null; programmeName: string | null; cohortId: string | null;
  platform?: string; consultantId: string | null; consultantName: string | null; coachId: string | null; reviewerId: string | null;
  people: { id: string; name: string; role: string }[];
  score: { overall: number; maturity: string; confidenceClass: string; dimensions: any; at: string } | null;
  facts?: Record<string, boolean>;
  nextManualSteps: { to: string; trigger: string }[];
  automaticNext: { to: string; trigger: string; needs: string[]; missing: string[] }[];
  createdAt: string; updatedAt: string;
};
export type TabProps = { caseId: string; caseData: CaseData; role: string; reload: () => void };
export const CASE_TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'diagnostic', label: 'Diagnostic' }, { id: 'evidence', label: 'Evidence' },
  { id: 'score', label: 'Score' }, { id: 'diagnosis', label: 'Diagnosis' }, { id: 'prescription', label: 'Prescription' },
  { id: 'actions', label: 'Actions' }, { id: 'kpis', label: 'KPIs' }, { id: 'risks', label: 'Risks' },
  { id: 'coaching', label: 'Coaching' }, { id: 'messages', label: 'Messages' }, { id: 'reports', label: 'Reports' }, { id: 'activity', label: 'Activity' }
] as const;
