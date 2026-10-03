import { allSwitches } from '@/services/switches';
import { z } from 'zod';
import { defineRoute, parseCookies, status } from '../framework';
import { COOKIE } from '@/lib/session';
import * as auth from '@/services/auth';
import * as demo from '@/services/demographics';
import * as users from '@/services/users';
import { googleCallback, googleEnabled, startGoogle } from '@/services/google';
import { env } from '@/lib/env';
import { listQuery } from '../list';
import { email, name, password, role, uuid, empty } from '../schemas';

const T = 'Authentication';
defineRoute({ method: 'POST', path: '/auth/login', tag: T, summary: 'Sign in with email and password', auth: 'public', transactional: false,
  rateLimit: { key: 'login:ip:{ip}', limit: 30, windowSec: 900 }, body: z.object({ email, password }),
  handler: ({ ctx, body, req }) => auth.login(ctx, body.email, body.password, req.headers.get('user-agent')) });
defineRoute({ method: 'POST', path: '/auth/logout', tag: T, summary: 'Sign out', gateExempt: true, body: empty,
  handler: ({ ctx, req }) => auth.logout(ctx, parseCookies(req.headers.get('cookie'))[COOKIE()]) });
defineRoute({ method: 'GET', path: '/auth/me', tag: T, summary: 'Current user, permissions and next required step', gateExempt: true, handler: ({ ctx }) => auth.me(ctx) });
defineRoute({ method: 'PATCH', path: '/auth/me', tag: T, summary: 'Update own profile', gateExempt: true, body: z.object({ name }), handler: ({ ctx, body }) => auth.updateMe(ctx, body.name) });
defineRoute({ method: 'POST', path: '/auth/mfa/verify', tag: T, summary: 'Verify a two-step code for this session', gateExempt: true, transactional: false, body: z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), handler: ({ ctx, body }) => auth.verifyMfa(ctx, body.code) });
defineRoute({ method: 'POST', path: '/auth/mfa/setup', tag: T, summary: 'Start two-step setup and get the QR code', gateExempt: true, body: empty, handler: ({ ctx }) => auth.mfaSetup(ctx) });
defineRoute({ method: 'POST', path: '/auth/mfa/enable', tag: T, summary: 'Confirm the first code and turn two-step on', gateExempt: true, body: z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), handler: ({ ctx, body }) => auth.mfaEnable(ctx, body.code) });
defineRoute({ method: 'POST', path: '/auth/mfa/disable', tag: T, summary: 'Turn two-step off (not allowed for roles that require it)', body: z.object({ password, code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }), handler: ({ ctx, body }) => auth.mfaDisable(ctx, body.password, body.code) });
defineRoute({ method: 'POST', path: '/auth/change-password', tag: T, summary: 'Change own password', gateExempt: true, body: z.object({ current: password, next: password }), handler: ({ ctx, body }) => auth.changePassword(ctx, body.current, body.next) });
defineRoute({ method: 'POST', path: '/auth/logout-others', tag: T, summary: 'Sign out every other session', body: empty, handler: ({ ctx }) => auth.logoutOthers(ctx) });
defineRoute({ method: 'POST', path: '/auth/forgot', tag: T, summary: 'Ask for a password reset link', auth: 'public', rateLimit: { key: 'forgot:ip:{ip}', limit: 10, windowSec: 3600 }, body: z.object({ email }), handler: async ({ ctx, body }) => status(202, await auth.forgotPassword(ctx, body.email)) });
defineRoute({ method: 'POST', path: '/auth/reset', tag: T, summary: 'Set a new password with a reset link token', auth: 'public', rateLimit: { key: 'reset:ip:{ip}', limit: 20, windowSec: 3600 }, body: z.object({ token: z.string().min(10).max(200), password }), handler: ({ ctx, body }) => auth.resetPassword(ctx, body.token, body.password) });
defineRoute({ method: 'POST', path: '/auth/accept-invite', tag: T, summary: 'Accept an invitation and set a password', auth: 'public', rateLimit: { key: 'invite:ip:{ip}', limit: 20, windowSec: 3600 }, body: z.object({ token: z.string().min(10).max(200), password, name: name.optional() }), handler: ({ ctx, body }) => auth.acceptInvite(ctx, body.token, body.password, body.name) });

const U = 'Users';
const userList = listQuery.extend({ role: z.string().optional(), active: z.enum(['true', 'false']).optional(), approval: z.enum(['pending']).optional() });
defineRoute({ method: 'GET', path: '/users', tag: U, summary: 'List users', permission: ['users', 'read'], query: userList, handler: ({ ctx, query }) => users.listUsers(ctx, query) });
defineRoute({ method: 'GET', path: '/users/assignable', tag: U, summary: 'Consultants, coaches and reviewers who can be assigned to cases', permission: ['users', 'read'], handler: ({ ctx }) => users.assignable(ctx) });
defineRoute({ method: 'GET', path: '/users/:id', tag: U, summary: 'One user', permission: ['users', 'read'], handler: ({ ctx, params }) => users.getUser(ctx, params.id) });
defineRoute({ method: 'POST', path: '/users', tag: U, summary: 'Invite a user by email', permission: ['users', 'create'], body: z.object({ email, name, role, orgId: uuid.nullish(), programmeIds: z.array(uuid).max(50).optional() }), handler: async ({ ctx, body }) => status(201, await users.inviteUser(ctx, body)) });
defineRoute({ method: 'PATCH', path: '/users/:id', tag: U, summary: 'Change name, role, organisation or active state', permission: ['users', 'edit'], body: z.object({ name: name.optional(), role: role.optional(), active: z.boolean().optional(), orgId: uuid.nullish() }), handler: ({ ctx, params, body }) => users.updateUser(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/users/:id/unlock', tag: U, summary: 'Clear a sign-in lockout', permission: ['users', 'edit'], body: empty, handler: ({ ctx, params }) => users.unlockUser(ctx, params.id) });
defineRoute({ method: 'POST', path: '/users/:id/reset-mfa', tag: U, summary: 'Remove two-step verification so the user can set it up again', permission: ['users', 'edit'], body: empty, handler: ({ ctx, params }) => users.resetUserMfa(ctx, params.id) });
defineRoute({ method: 'POST', path: '/users/:id/resend-invite', tag: U, summary: 'Send the invitation again', permission: ['users', 'edit'], body: empty, handler: ({ ctx, params }) => users.resendInvite(ctx, params.id) });
defineRoute({ method: 'PUT', path: '/users/:id/programmes', tag: U, summary: 'Set the programmes a manager or funder can see', permission: ['users', 'edit'], body: z.object({ programmeIds: z.array(uuid).max(100) }), handler: ({ ctx, params, body }) => users.setUserProgrammes(ctx, params.id, body.programmeIds) });

defineRoute({ method: 'GET', path: '/auth/registration-options', tag: T, summary: 'Country, locations, published consent wording and role choices for the registration form', auth: 'public', rateLimit: { key: 'regopts:ip:{ip}', limit: 120, windowSec: 3600 }, query: z.object({ country: z.string().length(2).optional() }), handler: ({ ctx, query }) => auth.registrationOptions(ctx, query.country) });
defineRoute({ method: 'GET', path: '/auth/districts', tag: T, summary: 'Districts (Metropolitan, Municipal and District Assemblies) under a region', auth: 'public', rateLimit: { key: 'districts:ip:{ip}', limit: 300, windowSec: 3600 }, query: z.object({ region: z.string().min(2).max(80), country: z.string().length(2).default('GH') }), handler: ({ ctx, query }) => auth.districtsFor(ctx, query.country, query.region) });
defineRoute({ method: 'POST', path: '/auth/register', tag: T, summary: 'Self-register. Starts pending until the email is confirmed and, for non-owners, an administrator approves', auth: 'public', rateLimit: { key: 'register:ip:{ip}', limit: 8, windowSec: 3600 },
  body: z.object({ name, email, password, role: z.enum(auth.SELF_ROLES), orgName: z.string().trim().max(160).optional(), orgType: z.enum(['SME', 'AGRIFOOD', 'ESO']).optional(), note: z.string().max(1000).optional(), consent: z.boolean(), countryCode: z.string().length(2).optional(), geoUnitId: z.string().uuid().nullish(), consentPurposes: z.array(z.enum(['account', 'assessment'])).max(4).optional(), routing: z.object({ jobRole: z.string().trim().min(2).max(40), jobRoleOther: z.string().max(120).optional(), responsibility: z.string().max(300).optional(), assessmentMode: z.enum(['self', 'team', 'hybrid']) }).optional() }), handler: ({ ctx, body }) => auth.register(ctx, body) });
defineRoute({ method: 'POST', path: '/auth/verify-email', tag: T, summary: 'Confirm an email address from the link we sent', auth: 'public', rateLimit: { key: 'verify:ip:{ip}', limit: 30, windowSec: 3600 }, body: z.object({ token: z.string().min(10).max(200) }), handler: ({ ctx, body }) => auth.verifyEmail(ctx, body.token) });
defineRoute({ method: 'POST', path: '/auth/resend-verification', tag: T, summary: 'Send the confirmation email again', auth: 'public', rateLimit: { key: 'resendv:ip:{ip}', limit: 10, windowSec: 3600 }, body: z.object({ email }), handler: ({ ctx, body }) => auth.resendVerification(ctx, body.email) });
defineRoute({ method: 'POST', path: '/users/:id/approve', tag: U, summary: 'Approve a self-registered user', permission: ['users', 'edit'], body: z.object({ role: role.optional(), orgId: uuid.nullish() }), handler: ({ ctx, params, body }) => users.approveRegistration(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/users/:id/reject', tag: U, summary: 'Reject a self-registered user', permission: ['users', 'edit'], body: z.object({ reason: z.string().max(300).optional() }), handler: ({ ctx, params, body }) => users.rejectRegistration(ctx, params.id, body.reason) });
defineRoute({ method: 'GET', path: '/auth/profile', tag: T, summary: 'Own business profile (business owners)', gateExempt: true, handler: ({ ctx }) => auth.getProfile(ctx) });
defineRoute({ method: 'PUT', path: '/auth/profile', tag: T, summary: 'Complete or update the business profile. Required before a new owner can use the platform', gateExempt: true,
  body: z.object({ name: z.string().trim().max(160), type: z.enum(['SME', 'AGRIFOOD', 'ESO']), sector: z.string().trim().max(120), region: z.string().trim().max(80), district: z.string().trim().max(120), size: z.string().trim().max(40), contactPhone: z.string().trim().max(40), registrationNumber: z.string().trim().max(60).optional(), consent: z.boolean() }), handler: ({ ctx, body }) => auth.saveProfile(ctx, body) });
const CAT = z.enum(['demographics', 'disability']);
defineRoute({ method: 'GET', path: '/me/demographics', tag: T, summary: 'My optional demographic and disability answers, with the consent wording for each', handler: ({ ctx }) => demo.getMine(ctx) });
defineRoute({ method: 'PUT', path: '/me/demographics/:category', tag: T, summary: 'Save an optional answer. Agreeing is recorded against the wording shown', body: z.object({ gender: z.string().max(40).optional(), ageBand: z.string().max(40).optional(), status: z.string().max(40).optional() }), handler: ({ ctx, params, body }) => demo.save(ctx, CAT.parse(params.category), body) });
defineRoute({ method: 'DELETE', path: '/me/demographics/:category', tag: T, summary: 'Withdraw consent and remove my answers', handler: ({ ctx, params }) => demo.withdraw(ctx, CAT.parse(params.category)) });
defineRoute({ method: 'GET', path: '/me/next-step', tag: T, summary: 'The next best action after registration, from the routing answers', handler: ({ ctx }) => demo.nextBestAction(ctx) });
defineRoute({ method: 'GET', path: '/admin/demographics', tag: T, summary: 'Totals only. Groups below the privacy minimum are hidden', permission: ['consent', 'read'], handler: ({ ctx }) => demo.aggregate(ctx) });
defineRoute({ method: 'GET', path: '/auth/providers', tag: T, summary: 'Which sign-in options are switched on', auth: 'public', handler: async ({ ctx }) => {
  const s = await allSwitches(ctx.db);
  const open = s['switch.self_registration'];
  return { google: googleEnabled() && open && s['switch.google_signin'], selfRegistration: open,
    roles: ['OWNER', ...['EXPERT', 'PROGRAMME_MANAGER', 'FUNDER'].filter((r) => s[`switch.role.${r}`])] };
} });
defineRoute({ method: 'GET', path: '/auth/google/start', tag: T, summary: 'Begin Google sign-in (business owners)', auth: 'public', transactional: false, rateLimit: { key: 'gstart:ip:{ip}', limit: 30, windowSec: 600 }, handler: async () => startGoogle() });
defineRoute({ method: 'GET', path: '/auth/google/callback', tag: T, summary: 'Google returns here after sign-in', auth: 'public', transactional: false, query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).passthrough(),
  handler: ({ ctx, query, req }) => googleCallback(ctx, query, parseCookies(req.headers.get('cookie'))[env.isProd ? '__Host-sk-oauth' : 'sk_oauth'], req.headers.get('user-agent')) });
