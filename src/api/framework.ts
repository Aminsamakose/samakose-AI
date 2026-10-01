/**
 * A small route framework: every endpoint is declared once with its method, path, permission,
 * input schemas and handler. The same declarations produce the OpenAPI document.
 * The dispatcher handles auth, MFA gate, CSRF, rate limits, validation, transactions and errors.
 */
import { ZodError, type ZodType } from 'zod';
import { db, tx } from '@/db/client';
import type { Ctx, AuthUser } from '@/lib/context';
import { can, type Action, type Resource } from '@/lib/rbac';
import { ApiError, forbidden, tooMany, unauthorized } from '@/lib/errors';
import { COOKIE, loadSession, rateLimit } from '@/lib/session';
import { env } from '@/lib/env';
import { randomToken } from '@/lib/crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type HandlerArgs = { ctx: Ctx; params: Record<string, string>; query: any; body: any; req: Request; rawBody: string };
export type RouteDef = {
  method: Method; path: string; summary: string; tag: string;
  auth?: 'session' | 'public' | 'webhook';
  permission?: [Resource, Action];
  /** Allowed while MFA setup or password change is still pending. */
  gateExempt?: boolean;
  body?: ZodType; query?: ZodType;
  rateLimit?: { key: string; limit: number; windowSec: number };
  multipart?: boolean;
  transactional?: boolean;
  handler: (a: HandlerArgs) => Promise<unknown>;
};
export type Csv = { __csv: true; filename: string; content: string };
export const csvResponse = (filename: string, content: string): Csv => ({ __csv: true, filename, content });

export const routes: RouteDef[] = [];
export const defineRoute = (r: RouteDef) => { routes.push(r); return r; };

type Compiled = { def: RouteDef; re: RegExp; keys: string[] };
let compiled: Compiled[] | null = null;
function compile(): Compiled[] {
  if (compiled && compiled.length === routes.length) return compiled;
  compiled = routes.map((def) => {
    const keys: string[] = [];
    const re = new RegExp('^' + def.path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    return { def, re, keys };
  });
  return compiled;
}

export function clientIp(req: Request): string {
  if (env.trustProxy) return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  return 'direct';
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

function errorResponse(e: unknown, requestId: string): Response {
  const h = { 'x-request-id': requestId };
  if (e instanceof ApiError) return json(e.status, { error: { code: e.code, message: e.message, details: e.details, requestId } }, h);
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join('.') || '_'] ??= i.message;
    return json(400, { error: { code: 'validation_failed', message: 'Some fields need attention', details: fields, requestId } }, h);
  }
  const pg = (e as any)?.cause ?? e;
  const code = (pg as any)?.code as string | undefined;
  if (code === '23505') return json(409, { error: { code: 'duplicate', message: 'That record already exists', requestId } }, h);
  if (code === '22P02') return json(400, { error: { code: 'bad_request', message: 'A value has the wrong format', requestId } }, h);
  if (code === '23503') return json(409, { error: { code: 'in_use', message: 'A related record blocks this change', requestId } }, h);
  if (code === '23514' || code === '23000') return json(422, { error: { code: 'rule_violation', message: 'The change breaks a data rule', requestId } }, h);
  console.error(`[${requestId}]`, e);
  return json(500, { error: { code: 'server_error', message: 'Something went wrong on our side', requestId } }, h);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

export async function dispatch(req: Request, basePath = '/api/v1'): Promise<Response> {
  const requestId = req.headers.get('x-request-id') ?? randomToken(8);
  const url = new URL(req.url);
  const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) || '/' : url.pathname;
  const method = req.method.toUpperCase() as Method;
  let match: { def: RouteDef; params: Record<string, string> } | null = null;
  let pathKnown = false;
  for (const c of compile()) {
    const m = c.re.exec(path);
    if (!m) continue;
    pathKnown = true;
    if (c.def.method !== method) continue;
    match = { def: c.def, params: Object.fromEntries(c.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    break;
  }
  if (!match) return json(pathKnown ? 405 : 404, { error: { code: pathKnown ? 'method_not_allowed' : 'not_found', message: pathKnown ? 'Method not allowed' : 'No such endpoint', requestId } }, { 'x-request-id': requestId });
  const { def, params } = match;
  const ip = clientIp(req);
  for (const [k, v] of Object.entries(params)) {
    if ((k === 'id' || k.endsWith('Id')) && !UUID_RE.test(v)) return json(404, { error: { code: 'not_found', message: 'Not found', requestId } }, { 'x-request-id': requestId });
  }

  try {
    // CSRF: browsers always send Origin on cross-site writes. Webhooks are authenticated by signature instead.
    if (method !== 'GET' && def.auth !== 'webhook') {
      const origin = req.headers.get('origin');
      if (origin) {
        const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
        if (new URL(origin).host !== host) throw forbidden('Cross-site request blocked');
      }
    }
    // Authentication
    let user: AuthUser | null = null;
    if (def.auth !== 'public' && def.auth !== 'webhook') {
      const token = parseCookies(req.headers.get('cookie'))[COOKIE()];
      user = await loadSession(token);
      if (!user) throw unauthorized();
      if (!def.gateExempt) {
        if (env.mfaRequiredRoles.includes(user.role) && !user.mfaEnabled) throw new ApiError(403, 'mfa_setup_required', 'Set up two-step verification to continue');
        if (user.mfaEnabled && !user.mfaVerified) throw new ApiError(403, 'mfa_required', 'Enter your two-step verification code');
        if (user.approvalStatus !== 'approved') throw new ApiError(403, 'approval_pending', 'Your registration is waiting for approval');
        if (user.profileRequired) throw new ApiError(403, 'profile_incomplete', 'Complete your business profile to continue');
        if (user.mustChangePassword) throw new ApiError(403, 'password_change_required', 'Change your password to continue');
      }
      if (def.permission && !can(user.role, def.permission[0], def.permission[1])) throw forbidden();
      if (method !== 'GET' && (await rateLimit(`w:${user.id}`, 60)) > 240) throw tooMany();
    }
    if (def.rateLimit) {
      const key = def.rateLimit.key.replace('{ip}', ip);
      if ((await rateLimit(key, def.rateLimit.windowSec)) > def.rateLimit.limit) throw tooMany();
    }

    // Input
    const rawBody = def.multipart || method === 'GET' ? '' : await req.text();
    let body: unknown = undefined;
    if (def.body) {
      let parsed: unknown = {};
      if (rawBody) { try { parsed = JSON.parse(rawBody); } catch { throw new ApiError(400, 'bad_json', 'The request body is not valid JSON'); } }
      body = def.body.parse(parsed);
    }
    const query = def.query ? def.query.parse(Object.fromEntries(url.searchParams)) : Object.fromEntries(url.searchParams);

    // Run. Writes run in one transaction so data, audit and events commit together.
    const afters: (() => void | Promise<void>)[] = [];
    const mk = (d: Ctx['db']): Ctx => ({ user, ip, requestId, db: d, after: (fn) => { afters.push(fn); } });
    const args = (c: Ctx): HandlerArgs => ({ ctx: c, params, query, body, req, rawBody });
    const useTx = def.transactional ?? method !== 'GET';
    const result = useTx ? await tx((t) => def.handler(args(mk(t)))) : await def.handler(args(mk(db())));
    for (const fn of afters) { try { await fn(); } catch (e) { console.error('after-commit', e); } }

    if (result instanceof Response) return result;
    if ((result as Csv)?.__csv) {
      const c = result as Csv;
      return new Response(c.content, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${c.filename}"`, 'cache-control': 'no-store', 'x-request-id': requestId } });
    }
    return json(method === 'POST' && (result as any)?.__status ? (result as any).__status : 200, { data: (result as any)?.__status ? (result as any).data : result }, { 'x-request-id': requestId });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
/** Wrap a result so the endpoint answers with a specific status (201 created, 202 accepted). */
export const status = (code: number, data: unknown) => ({ __status: code, data });
