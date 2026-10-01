/**
 * Workflow and registration switches an administrator can change without a developer. Stored in the rules table
 * as 1 (on) or 0 (off). Protected switches guard a safety rule: turning one off needs a written reason, which is audited.
 */
export type Switch = { key: string; label: string; help: string; group: 'workflow' | 'registration'; default: 0 | 1; protected?: boolean };

export const SWITCHES: Switch[] = [
  { key: 'switch.report_requires_verified_org', group: 'workflow', default: 1, protected: true, label: 'Block report release for unverified organisations',
    help: 'When on, a report cannot be released while its organisation is still pending verification, whatever the reviewer decides. Turn off only in exceptional cases.' },
  { key: 'switch.self_registration', group: 'registration', default: 1, label: 'Allow self-registration', help: 'When off, only people you invite can create an account. The register page shows a closed notice.' },
  { key: 'switch.google_signin', group: 'registration', default: 1, label: 'Allow Google sign-in for new business owners', help: 'Existing owners who linked Google can still sign in. Needs Google keys to be set up as well.' },
  { key: 'switch.owner_needs_approval', group: 'registration', default: 0, label: 'Require administrator approval for new business owners', help: 'When on, owners wait for approval after confirming their email, like other roles.' },
  { key: 'switch.role.CONSULTANT', group: 'registration', default: 1, label: 'Consultants may self-register', help: 'They still wait for administrator approval.' },
  { key: 'switch.role.COACH', group: 'registration', default: 1, label: 'Coaches and mentors may self-register', help: 'They still wait for administrator approval.' },
  { key: 'switch.role.PROGRAMME_MANAGER', group: 'registration', default: 1, label: 'Programme managers may self-register', help: 'They still wait for administrator approval.' },
  { key: 'switch.role.FUNDER', group: 'registration', default: 1, label: 'Partners and funders may self-register', help: 'They still wait for administrator approval.' }
];
export const SWITCH_BY_KEY = Object.fromEntries(SWITCHES.map((s) => [s.key, s]));
