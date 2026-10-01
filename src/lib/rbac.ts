/**
 * Permission matrix: role x resource x action. Anything not listed is denied.
 * Row-level scoping (which records a role can reach) lives in domain/scope.ts.
 * Seven actions: read, create, edit, approve, delete, export, override.
 */
import type { Role } from '@/db/schema';

export type Action = 'read' | 'create' | 'edit' | 'approve' | 'delete' | 'export' | 'override';
export const RESOURCES = [
  'users', 'organisations', 'programmes', 'cohorts', 'cases', 'diagnostics', 'evidence', 'documents', 'scores', 'diagnoses',
  'prescriptions', 'actions', 'kpis', 'sessions', 'risks', 'reports', 'plans', 'contracts', 'invoices', 'payments',
  'audit', 'settings', 'dashboard', 'integrations', 'inquiries'
] as const;
export type Resource = (typeof RESOURCES)[number];

const R = 'read' as const, C = 'create' as const, E = 'edit' as const, A = 'approve' as const, D = 'delete' as const, X = 'export' as const, O = 'override' as const;
type Grants = Partial<Record<Resource, Action[]>>;

const ADMIN: Grants = {
  users: [R, C, E, D, X], organisations: [R, C, E, D, X], programmes: [R, C, E, D, X], cohorts: [R, C, E, D, X],
  cases: [R, C, E, X], diagnostics: [R, C], evidence: [R, C, E], documents: [R, C], scores: [R], diagnoses: [R, C],
  prescriptions: [R, C], actions: [R, C, E, X], kpis: [R, C, E], sessions: [R, C, E], risks: [R, E], reports: [R, C, X],
  plans: [R, C, E, D], contracts: [R, C, E, X], invoices: [R, C, E, D, X], payments: [R, C, X],
  audit: [R, X], settings: [R, C, E, D], dashboard: [R, X], integrations: [R, C, E], inquiries: [R, E, X]
};
export const PERMISSIONS: Record<Role, Grants> = {
  ADMIN,
  EXECUTIVE: {
    organisations: [R, X], programmes: [R, X], cohorts: [R], cases: [R, X], scores: [R], diagnoses: [R], prescriptions: [R], actions: [R],
    kpis: [R], reports: [R, X], contracts: [R], invoices: [R, X], payments: [R], dashboard: [R, X]
  },
  PROGRAMME_MANAGER: {
    users: [R], organisations: [R, C, E, X], programmes: [R, E, X], cohorts: [R, C, E, X], cases: [R, C, E, X], diagnostics: [R], scores: [R],
    diagnoses: [R], prescriptions: [R], actions: [R, X], kpis: [R], sessions: [R], reports: [R, X], contracts: [R], dashboard: [R, X]
  },
  CONSULTANT: {
    users: [R], organisations: [R, C, E], cases: [R, C, E], diagnostics: [R, C], evidence: [R, C, E], documents: [R, C], scores: [R],
    diagnoses: [R, C, E, O], prescriptions: [R, C, E, O], actions: [R, C, E, X], kpis: [R, C, E], sessions: [R, C, E], risks: [R, E],
    reports: [R, C], dashboard: [R]
  },
  REVIEWER: {
    cases: [R], evidence: [R], documents: [R], scores: [R], diagnoses: [R], prescriptions: [R, A], actions: [R], kpis: [R], risks: [R],
    reports: [R, A], dashboard: [R]
  },
  COACH: {
    cases: [R], evidence: [R], scores: [R], diagnoses: [R], prescriptions: [R], actions: [R, E], kpis: [R, C], sessions: [R, C, E],
    risks: [R], reports: [R], dashboard: [R]
  },
  FINANCE: {
    organisations: [R], plans: [R, C, E], contracts: [R, C, E, X], invoices: [R, C, E, X], payments: [R, C, X], dashboard: [R]
  },
  OWNER: {
    organisations: [R, E], cases: [R], diagnostics: [R, C], evidence: [R, C], documents: [R, C], scores: [R], prescriptions: [R],
    actions: [R, E], kpis: [R, C], sessions: [R], reports: [R], invoices: [R], payments: [C], dashboard: [R]
  },
  FUNDER: { programmes: [R], cohorts: [R], reports: [R], dashboard: [R, X] }
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  return !!PERMISSIONS[role]?.[resource]?.includes(action);
}

/** Roles that work inside the organisation, as opposed to clients and funders. */
export const STAFF_ROLES: Role[] = ['ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER', 'CONSULTANT', 'REVIEWER', 'COACH', 'FINANCE'];
export const isStaff = (r: Role) => STAFF_ROLES.includes(r);
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrator', EXECUTIVE: 'Executive', PROGRAMME_MANAGER: 'Programme manager', CONSULTANT: 'Consultant',
  REVIEWER: 'Reviewer', COACH: 'Coach', FINANCE: 'Finance', OWNER: 'Business owner', FUNDER: 'Funder'
};
