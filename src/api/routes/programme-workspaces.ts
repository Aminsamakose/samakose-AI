import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as ws from '@/services/programme-workspaces';
import * as configService from '@/services/programme-workspace-configuration';
import * as participants from '@/services/programme-participant-lifecycle';
import * as people from '@/services/participant-people';
import { WORKSPACE_ROLES } from '@/domain/programme-workspace';

const W = 'Programme workspace';
const provider = z.enum(['SAMAKOSE_NETWORK', 'BRING_YOUR_OWN', 'HYBRID']);
const lifecycle = z.enum(['DRAFT','COMMERCIAL_REVIEW','INVOICED','PAYMENT_PENDING','APPROVED','CONFIGURING','READY','ACTIVE','PAUSED','COMPLETING','COMPLETED','CLOSED','ARCHIVED']);
const participantStatus = z.enum(['APPLICATION','ELIGIBILITY','SELECTED','INVITED','CONSENTED','ONBOARDED','COHORT_ASSIGNED','ACTIVE','COMPLETING','COMPLETED','WITHDRAWN','REJECTED']);
const workspaceRole = z.enum(WORKSPACE_ROLES);
const config = z.record(z.string(), z.unknown());
const configurationInput = z.object({
  configuration: config.optional(),
  objectives: z.array(z.unknown()).optional(),
  eligibilityRules: config.optional(),
  deliveryModel: config.optional(),
  reporting: config.optional(),
  entitlements: z.array(z.unknown()).optional(),
  frameworkVersionId: z.string().uuid().nullish(),
  participantConsentRequired: z.boolean().optional(),
  funderReportingEnabled: z.boolean().optional(),
  changeReason: z.string().trim().max(1000).nullish(),
});

defineRoute({ method: 'GET', path: '/programme-workspaces', tag: W, summary: 'List programme workspaces available to the signed-in user', permission: ['programme_workspaces', 'read'], handler: ({ ctx }) => ws.listWorkspaces(ctx) });
defineRoute({ method: 'GET', path: '/programmes/:id/workspace', tag: W, summary: 'Get the programme workspace', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => ws.getWorkspaceByProgramme(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programmes/:id/workspace', tag: W, summary: 'Create the single workspace for a programme', permission: ['programme_workspaces', 'create'], body: z.object({ name: z.string().trim().min(2).max(160).optional(), providerSource: provider.optional(), frameworkVersionId: z.string().uuid().nullish(), participantConsentRequired: z.boolean().optional(), funderReportingEnabled: z.boolean().optional(), configuration: config.optional() }), handler: async ({ ctx, params, body }) => status(201, await ws.createWorkspace(ctx, params.id, body)) });
defineRoute({ method: 'PATCH', path: '/programme-workspaces/:id', tag: W, summary: 'Update workspace lifecycle and non-versioned settings', permission: ['programme_workspaces', 'edit'], body: z.object({ name: z.string().trim().min(2).max(160).optional(), status: lifecycle.optional(), providerSource: provider.optional(), frameworkVersionId: z.string().uuid().nullish(), participantConsentRequired: z.boolean().optional(), funderReportingEnabled: z.boolean().optional() }), handler: ({ ctx, params, body }) => ws.updateWorkspace(ctx, params.id, body) });

defineRoute({ method: 'GET', path: '/programme-workspaces/:id/configurations', tag: W, summary: 'List versioned workspace configurations', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => configService.listConfigurations(ctx, params.id) });
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/configuration', tag: W, summary: 'Get the current approved workspace configuration', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => configService.getCurrentConfiguration(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/configurations', tag: W, summary: 'Create a new workspace configuration draft', permission: ['programme_workspaces', 'edit'], body: configurationInput, handler: async ({ ctx, params, body }) => status(201, await configService.createConfigurationDraft(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/configurations/:version/submit', tag: W, summary: 'Submit a workspace configuration for approval', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => configService.submitConfiguration(ctx, params.id, Number(params.version)) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/configurations/:version/approve', tag: W, summary: 'Approve a submitted workspace configuration', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => configService.approveConfiguration(ctx, params.id, Number(params.version)) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/configurations/:version/reject', tag: W, summary: 'Reject a submitted workspace configuration', permission: ['programme_workspaces', 'edit'], body: z.object({ reason: z.string().trim().min(3).max(1000) }), handler: ({ ctx, params, body }) => configService.rejectConfiguration(ctx, params.id, Number(params.version), body.reason) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/configurations/:version/revise', tag: W, summary: 'Create a new draft from a rejected configuration', permission: ['programme_workspaces', 'edit'], body: z.object({ changeReason: z.string().trim().max(1000).optional() }), handler: ({ ctx, params, body }) => configService.reviseRejectedConfiguration(ctx, params.id, Number(params.version), body.changeReason) });

defineRoute({ method: 'GET', path: '/programme-workspaces/:id/members', tag: W, summary: 'List workspace team members', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => ws.listMembers(ctx, params.id) });
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/team-entitlements', tag: W, summary: 'Show workspace team entitlement limits and current usage', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => ws.getTeamEntitlementUsage(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/members', tag: W, summary: 'Add a programme-scoped team member', permission: ['programme_workspaces', 'edit'], body: z.object({ userId: z.string().uuid(), role: workspaceRole }), handler: async ({ ctx, params, body }) => status(201, await ws.addMember(ctx, params.id, body)) });
defineRoute({ method: 'PATCH', path: '/programme-workspaces/:id/members/:userId/:role', tag: W, summary: 'Activate or deactivate a workspace membership', permission: ['programme_workspaces', 'edit'], body: z.object({ active: z.boolean() }), handler: ({ ctx, params, body }) => ws.setMemberActive(ctx, params.id, params.userId, params.role as any, body.active) });
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/participants', tag: W, summary: 'List programme participants', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => ws.listParticipants(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/participants', tag: W, summary: 'Add an organisation to the programme participant lifecycle', permission: ['programme_workspaces', 'edit'], body: z.object({ organisationId: z.string().uuid(), cohortId: z.string().uuid().nullish(), status: participantStatus.optional(), metadata: config.optional() }), handler: async ({ ctx, params, body }) => status(201, await ws.addParticipant(ctx, params.id, body)) });
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/participants/:participantId', tag: W, summary: 'Get one programme participant', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => participants.getParticipant(ctx, params.id, params.participantId) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/participants/:participantId/transition', tag: W, summary: 'Move a participant through the governed programme lifecycle', permission: ['programme_workspaces', 'edit'], body: z.object({ status: participantStatus }), handler: ({ ctx, params, body }) => ws.transitionParticipant(ctx, params.id, params.participantId, body.status) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/participants/:participantId/consent', tag: W, summary: 'Record participant consent', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => participants.recordConsent(ctx, params.id, params.participantId) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/participants/:participantId/onboard', tag: W, summary: 'Complete participant onboarding', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => participants.onboard(ctx, params.id, params.participantId) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/participants/:participantId/cohort', tag: W, summary: 'Assign an onboarded participant to a programme cohort', permission: ['programme_workspaces', 'edit'], body: z.object({ cohortId: z.string().uuid() }), handler: ({ ctx, params, body }) => participants.assignCohort(ctx, params.id, params.participantId, body.cohortId) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/participants/:participantId/activate', tag: W, summary: 'Activate a cohort-assigned participant', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => participants.activate(ctx, params.id, params.participantId) });

// The individual people behind one enrolment -- GAP 02 (participant/enterprise linkage). :participantId
// here is the enrolment id (programme_participants.id), same as every route above; "people" is this
// enrolment's actual human beings, since an enterprise can put forward more than one and the same
// person may appear on more than one enterprise's enrolment.
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/participants/:participantId/people', tag: W, summary: 'List the people behind one enrolment', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => people.listPeople(ctx, params.participantId) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/participants/:participantId/people', tag: W, summary: 'Add a person to one enrolment, new or already on another enterprise', permission: ['programme_workspaces', 'edit'], body: z.object({ participantId: z.string().uuid().optional(), fullName: z.string().trim().min(2).max(160).optional(), phone: z.string().trim().max(40).nullish(), email: z.string().trim().email().max(200).nullish(), role: z.enum(['OWNER', 'MANAGER', 'DELEGATE', 'OTHER']).optional(), isPrimary: z.boolean().optional() }), handler: async ({ ctx, params, body }) => status(201, await people.addPerson(ctx, params.participantId, body)) });
defineRoute({ method: 'DELETE', path: '/programme-workspaces/:id/participants/:participantId/people/:linkId', tag: W, summary: 'Remove a person from one enrolment', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => people.removePerson(ctx, params.participantId, params.linkId) });
