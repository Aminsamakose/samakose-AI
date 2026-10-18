/**
 * Admin-settable Zoom/Google Meet credentials, stored encrypted at rest in the database.
 *
 * integrations.ts's own doc comment (and GAP-012's note in the functional gap register) describe
 * the deliberate original pattern: credentials live only in environment variables, set on the
 * hosting platform. That stays true for every OTHER integration in this file's sibling module
 * (Teams, WhatsApp, SMS, e-signature, accounting) -- but for Zoom and Google Meet specifically, an
 * administrator asked to be able to set these up from the Settings screen itself, without needing
 * Vercel project access. This module adds that path for those two integrations only.
 *
 * A database-stored value always takes precedence over the matching environment variable for the
 * same field. Clearing a stored field (saving an empty string for it) deletes the row and reverts
 * to whatever the environment variable provides, if anything -- so an administrator can always
 * fall back to the original platform-level configuration. Secrets are encrypted with the same
 * AES-256-GCM helper already used for MFA seeds (src/lib/crypto.ts); every field is encrypted,
 * including non-secret ones like an account ID, so this table never has to track which columns
 * are sensitive. Read endpoints report only whether a field is set and where from -- never the
 * value itself.
 */
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import { env } from '@/lib/env';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need } from './common';
import { encrypt, decrypt } from '@/lib/crypto';

export type CredentialIntegration = 'zoom' | 'google_meet';

const t = schema.integrationCredentials;

async function getCredentials(ctx: Ctx, integration: CredentialIntegration): Promise<Map<string, string>> {
  const rows = await ctx.db.select({ field: t.field, value: t.value }).from(t).where(eq(t.integration, integration));
  const out = new Map<string, string>();
  for (const r of rows) {
    try { out.set(r.field, decrypt(r.value)); } catch { /* corrupted row or rotated session secret -- treat as unset rather than throw */ }
  }
  return out;
}

/** Admin-only: which fields currently have a database-stored value (never the value itself). */
export async function listSetFields(ctx: Ctx, integration: CredentialIntegration): Promise<Set<string>> {
  const rows = await ctx.db.select({ field: t.field }).from(t).where(eq(t.integration, integration));
  return new Set(rows.map((r) => r.field));
}

export async function saveCredentials(ctx: Ctx, integration: CredentialIntegration, fields: Record<string, string>): Promise<void> {
  allow(ctx, 'integrations', 'edit');
  const uid = need(ctx).user.id;
  for (const [field, raw] of Object.entries(fields)) {
    const value = raw.trim();
    if (!value) {
      await ctx.db.delete(t).where(and(eq(t.integration, integration), eq(t.field, field)));
      continue;
    }
    const enc = encrypt(value);
    await ctx.db.insert(t).values({ integration, field, value: enc, updatedBy: uid })
      .onConflictDoUpdate({ target: [t.integration, t.field], set: { value: enc, updatedBy: uid, updatedAt: new Date() } });
  }
  await audit(ctx, 'settings.integration_credentials_changed', 'settings', null, undefined, { integration, fields: Object.keys(fields) });
}

/** Database value (if set) wins over the matching env var; returns null only when neither has it. */
export async function resolveZoomCredentials(ctx: Ctx): Promise<{ accountId: string; clientId: string; clientSecret: string } | null> {
  const db = await getCredentials(ctx, 'zoom');
  const accountId = db.get('accountId') || env.zoomAccountId;
  const clientId = db.get('clientId') || env.zoomClientId;
  const clientSecret = db.get('clientSecret') || env.zoomClientSecret;
  if (!(accountId && clientId && clientSecret)) return null;
  return { accountId, clientId, clientSecret };
}

export async function resolveGoogleCredentials(ctx: Ctx): Promise<{ clientId: string; clientSecret: string; refreshToken: string; calendarId: string } | null> {
  const db = await getCredentials(ctx, 'google_meet');
  const clientId = db.get('clientId') || env.googleClientId;
  const clientSecret = db.get('clientSecret') || env.googleClientSecret;
  const refreshToken = db.get('refreshToken') || env.googleCalendarRefreshToken;
  const calendarId = db.get('calendarId') || env.googleCalendarId;
  if (!(clientId && clientSecret && refreshToken)) return null;
  return { clientId, clientSecret, refreshToken, calendarId: calendarId || 'primary' };
}
