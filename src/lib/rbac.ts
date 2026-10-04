/**
 * Permission matrix: role x resource x action. Anything not listed is denied.
 * Row-level scoping (which records a role can reach) lives in domain/scope.ts.
 * Ten actions: read, create, edit, approve, delete, export, override, assign, verify, certify.
 * EXPERT is one role. What an expert may do on a case depends on the assignment (lead or coach), enforced in domain/scope.ts.
 */
import type { Role } from '@/db/schema';

export type Action = 'read' | 'create' | 'edit' | 'approve' | 'delete' | 'export' | 'override' | 'assign' | 'verify' | 'certify';
export const RESOURCES = [
  'users', 'organisations', 'programmes', 'cohorts', 'cases', 'diagnostics', 'evidence', 'documents', 'scores', 'diagnoses',
  'prescriptions', 'actions', 'kpis', 'sessions', 'risks', 'reports', 'plans', 'contracts', 'invoices', 'payments',
  'audit', 'settings', 'dashboard', 'integrations', 'inquiries', 'content', 'site_settings', 'media', 'frameworks', 'agents', 'consent', 'role_mapping', 'team', 'feedback', 'practitioners', 'ratings', 'opportunities', 'referrals'
] as const;
export type Resource = (typeof RESOURCES)[number];

const R = 'read' as const, C = 'create' as const, E = 'edit' as const, A = 'approve' as const, D = 'delete' as const, X = 'export' as const, O = 'override' as const, S = 'assign' as const, V = 'verify' as const, T = 'certify' as const;
type Grants = Partial<Record<Resource, Action[]>>;

const ADMIN: Grants = {
  users: [R, C, E, D, X], organisations: [R, C, E, D, X], programmes: [R, C, E, D, X], cohorts: [R, C, E, D, X],
  cases: [R, C, E, X, S, T], diagnostics: [R, C], evidence: [R, C, E], documents: [R, C], scores: [R], diagnoses: [R, C],
  prescriptions: [R, C], actions: [R, C, E, X], kpis: [R, C, E], sessions: [R, C, E], risks: [R, E], reports: [R, C, X],
  plans: [R, C, E, D], contracts: [R, C, E, X], invoices: [R, C, E, D, X], payments: [R, C, X],
  audit: [R, X], settings: [R, C, E, D], dashboard: [R, X], integrations: [R, C, E], inquiries: [R, E, X],
  content: [R, C, E, A, D], site_settings: [R, E, A], media: [R, C, E, D],
  // Only the administrator can approve a framework version, which is the product sign-off.
  frameworks: [R, C, E, A],
  // AI agents are managed by the administrator only. Executives can see the workforce.
  agents: [R, C, E, A],
  // Consent wording and the role mapping decide what people are asked and who answers. Administrator only; executives can read.
  consent: [R, C, E, A], role_mapping: [R, C, E, A],
  // UAT and result feedback is read and triaged by the administrator; executives can read it.
  feedback: [R, E, X],
  // Vetting and conflicts are decided by the administrator. Ratings are read by the administrator; the people being rated see their own.
  practitioners: [R, E, A], ratings: [R],
  // UNLOCK. The catalogue is published by the administrator and programme manager. Referrals are decided by people, never by the matcher.
  opportunities: [R, C, E, A], referrals: [R, C, E, A, D]
};
export const PERMISSIONS: Record<Role, Grants> = {
  ADMIN,
  EXECUTIVE: {
    agents: [R], consent: [R], role_mapping: [R], feedback: [R], frameworks: [R], organisations: [R, X], programmes: [R, X], cohorts: [R], cases: [R, X], scores: [R], diagnoses: [R], prescriptions: [R], actions: [R],
    kpis: [R], reports: [R, X], contracts: [R], invoices: [R, X], payments: [R], dashboard: [R, X], practitioners: [R], ratings: [R], opportunities: [R], referrals: [R]
  },
  PROGRAMME_MANAGER: {
    frameworks: [R], users: [R], organisations: [R, C, E, X], programmes: [R, E, X], cohorts: [R, C, E, X], cases: [R, C, E, X, S], diagnostics: [R], scores: [R],
    diagnoses: [R], prescriptions: [R], actions: [R, X], kpis: [R], sessions: [R], reports: [R, X], contracts: [R], dashboard: [R, X], practitioners: [R], ratings: [R, C], opportunities: [R, C, E, A], referrals: [R, C, E, A, D]
  },
  // One role for people who advise and coach. Lead-only actions (diagnosis, prescription, evidence verification, diagnostics) are limited to cases where the expert is the lead.
  EXPERT: {
    frameworks: [R], users: [R], organisations: [R, C, E], cases: [R, C, E], diagnostics: [R, C], evidence: [R, C, E, V], documents: [R, C], scores: [R],
    diagnoses: [R, C, E, O], prescriptions: [R, C, E, O], actions: [R, C, E, X], kpis: [R, C, E], sessions: [R, C, E], risks: [R, E],
    reports: [R, C], dashboard: [R], practitioners: [R, E], opportunities: [R], referrals: [R, C]
  },
  REVIEWER: {
    frameworks: [R], cases: [R, T], evidence: [R], documents: [R], scores: [R], diagnoses: [R], prescriptions: [R, A], actions: [R], kpis: [R], risks: [R],
    reports: [R, A], dashboard: [R], ratings: [R, C]
  },
  FINANCE: {
    organisations: [R], plans: [R, C, E], contracts: [R, C, E, X], invoices: [R, C, E, X], payments: [R, C, X], dashboard: [R]
  },
  OWNER: {
    organisations: [R, E], cases: [R], diagnostics: [R, C], evidence: [R, C], documents: [R, C], scores: [R], prescriptions: [R],
    actions: [R, E], kpis: [R, C], sessions: [R], reports: [R], invoices: [R], payments: [C], dashboard: [R], ratings: [R, C], opportunities: [R], referrals: [R, C, D],
    // The owner invites colleagues and decides who answers which area.
    team: [R, C, E, D]
  },
  // A colleague invited to answer part of an assessment. No default permissions: what they can see comes only from their assignments.
  RESPONDENT: { dashboard: [R] },
  FUNDER: { programmes: [R], cohorts: [R], reports: [R], dashboard: [R, X] },
  // Website roles never reach client, case or finance data. The editor drafts; only the site manager and administrator publish.
  CONTENT_EDITOR: { content: [R, C, E], site_settings: [R], media: [R, C], dashboard: [R] },
  SITE_MANAGER: { content: [R, C, E, A, D], site_settings: [R, E, A], media: [R, C, E, D], inquiries: [R, E], dashboard: [R] }
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  return !!PERMISSIONS[role]?.[resource]?.includes(action);
}

/** Roles that work inside the organisation, as opposed to clients and funders. */
export const STAFF_ROLES: Role[] = ['ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER', 'EXPERT', 'REVIEWER', 'FINANCE', 'CONTENT_EDITOR', 'SITE_MANAGER'];
export const isStaff = (r: Role) => STAFF_ROLES.includes(r);
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrator', EXECUTIVE: 'Executive', PROGRAMME_MANAGER: 'Programme manager', EXPERT: 'Expert',
  REVIEWER: 'Reviewer', FINANCE: 'Finance', OWNER: 'Business owner', FUNDER: 'Funder',
  CONTENT_EDITOR: 'Content editor', SITE_MANAGER: 'Site manager', RESPONDENT: 'Team respondent'
};
