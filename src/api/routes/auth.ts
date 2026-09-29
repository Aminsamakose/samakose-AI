import { z } from 'zod';
import { defineRoute, parseCookies, status } from '../framework';
import { COOKIE } from '@/lib/session';
import * as auth from '@/services/auth';
import * as users from '@/services/users';
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
const userList = listQuery.extend({ role: z.string().optional(), active: z.enum(['true', 'false']).optional() });
defineRoute({ method: 'GET', path: '/users', tag: U, summary: 'List users', permission: ['users', 'read'], query: userList, handler: ({ ctx, query }) => users.listUsers(ctx, query) });
defineRoute({ method: 'GET', path: '/users/assignable', tag: U, summary: 'Consultants, coaches and reviewers who can be assigned to cases', permission: ['users', 'read'], handler: ({ ctx }) => users.assignable(ctx) });
defineRoute({ method: 'GET', path: '/users/:id', tag: U, summary: 'One user', permission: ['users', 'read'], handler: ({ ctx, params }) => users.getUser(ctx, params.id) });
defineRoute({ method: 'POST', path: '/users', tag: U, summary: 'Invite a user by email', permission: ['users', 'create'], body: z.object({ email, name, role, orgId: uuid.nullish(), programmeIds: z.array(uuid).max(50).optional() }), handler: async ({ ctx, body }) => status(201, await users.inviteUser(ctx, body)) });
defineRoute({ method: 'PATCH', path: '/users/:id', tag: U, summary: 'Change name, role, organisation or active state', permission: ['users', 'edit'], body: z.object({ name: name.optional(), role: role.optional(), active: z.boolean().optional(), orgId: uuid.nullish() }), handler: ({ ctx, params, body }) => users.updateUser(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/users/:id/unlock', tag: U, summary: 'Clear a sign-in lockout', permission: ['users', 'edit'], body: empty, handler: ({ ctx, params }) => users.unlockUser(ctx, params.id) });
defineRoute({ method: 'POST', path: '/users/:id/reset-mfa', tag: U, summary: 'Remove two-step verification so the user can set it up again', permission: ['users', 'edit'], body: empty, handler: ({ ctx, params }) => users.resetUserMfa(ctx, params.id) });
defineRoute({ method: 'POST', path: '/users/:id/resend-invite', tag: U, summary: 'Send the invitation again', permission: ['users', 'edit'], body: empty, handler: ({ ctx, params }) => users.resendInvite(ctx, params.id) });
defineRoute({ method: 'PUT', path: '/users/:id/programmes', tag: U, summary: 'Set the programmes a manager or funder can see', permission: ['users', 'edit'], body: z.object({ programmeIds: z.array(uuid).max(100) }), handler: ({ ctx, params, body }) => users.setUserProgrammes(ctx, params.id, body.programmeIds) });
