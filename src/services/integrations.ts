/**
 * Third-party integration configuration: Zoom, Microsoft Teams, WhatsApp Business, SMS
 * (Twilio or Arkesel), e-signature (DocuSign) and accounting sync (QuickBooks Online or Xero).
 *
 * Security pattern, same as AI settings (see ./ai-settings.ts): credentials and secrets live
 * ONLY in environment variables, set on the hosting platform (Vercel project settings) and
 * never written to the database or returned to a client. What an administrator can see and
 * change here is: which environment variables are set (true/false, never the value), the
 * provider choice for SMS and accounting (stored in the `rules` table, the same mechanism the
 * AI settings screen uses), and a "test connection" action that makes one real, read-only
 * call to the provider's API using whatever credentials are currently set.
 *
 * None of the actual send/create actions (book a Zoom meeting, send a WhatsApp message, send
 * an SMS, send a document for signature, push an invoice to QuickBooks/Xero) are implemented
 * here -- this module is configuration and connectivity verification only. Building the real
 * send/sync flows is separate, substantial work per provider and needs an explicit decision on
 * scope before it's built against invented assumptions about how each will be used.
 */
import { eq, inArray } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError } from '@/lib/errors';
import { env } from '@/lib/env';
import { allow, need } from './common';
import { getZoomAccessToken, getGoogleCalendarAccessToken } from './meetings';

export type IntegrationId = 'zoom' | 'google_meet' | 'video' | 'teams' | 'whatsapp' | 'sms' | 'esignature' | 'accounting';

type EnvVarRef = { name: string; secret: boolean };
interface Descriptor {
  id: IntegrationId;
  label: string;
  category: string;
  docsHint: string;
  /** Env vars this integration reads. `secret: false` entries (ids, not keys) are safe to echo back. */
  envVars: EnvVarRef[];
  /** Provider sub-choice stored in the `rules` table (e.g. which SMS gateway), or null if there isn't one. */
  providerChoiceKey: string | null;
  providerOptions: readonly string[] | null;
  configured(choice: string | null): boolean;
  test(choice: string | null): Promise<{ ok: boolean; message: string }>;
}

const RULE_KEY = (id: IntegrationId) => `integrations.${id}.provider`;
export const INTEGRATION_RULE_KEYS = (['sms', 'accounting', 'video'] as IntegrationId[]).map(RULE_KEY);
/** The administrator's chosen default video provider for Calendar/provider-assignment/delivery-coordination
 * meeting creation. Read by programme-calendar.ts, provider-assignment.ts and delivery-operations.ts. */
export const VIDEO_PROVIDER_RULE_KEY = RULE_KEY('video');

async function fetchJson(url: string, init: RequestInit, timeoutMs = 15_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, json, text };
}

const DESCRIPTORS: Descriptor[] = [
  {
    id: 'zoom', label: 'Zoom', category: 'Virtual delivery', providerChoiceKey: null, providerOptions: null,
    docsHint: 'Zoom Marketplace -> Build App -> Server-to-Server OAuth. Grant the meeting:write:admin scope.',
    envVars: [{ name: 'ZOOM_ACCOUNT_ID', secret: false }, { name: 'ZOOM_CLIENT_ID', secret: false }, { name: 'ZOOM_CLIENT_SECRET', secret: true }],
    configured: () => !!(env.zoomAccountId && env.zoomClientId && env.zoomClientSecret),
    async test() {
      if (!(env.zoomAccountId && env.zoomClientId && env.zoomClientSecret)) return { ok: false, message: 'Zoom is not configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET.' };
      let accessToken: string;
      try { accessToken = await getZoomAccessToken(); } catch (e) { return { ok: false, message: String((e as Error).message ?? e) }; }
      const me = await fetchJson('https://api.zoom.us/v2/users/me', { headers: { authorization: `Bearer ${accessToken}` } });
      if (!me.ok) return { ok: false, message: `Connected to Zoom but could not read the account (HTTP ${me.status}).` };
      const email = (me.json as { email?: string })?.email;
      return { ok: true, message: `Connected to Zoom${email ? ` as ${email}` : ''}. Live meeting creation is available for Calendar, provider assignment and delivery coordination.` };
    },
  },
  {
    id: 'google_meet', label: 'Google Meet', category: 'Virtual delivery', providerChoiceKey: null, providerOptions: null,
    docsHint: 'Google Cloud Console -> APIs & Services -> OAuth consent + Calendar API enabled, then complete the authorization-code flow once (access_type=offline, scope https://www.googleapis.com/auth/calendar) to obtain a refresh token. Reuses GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET already used for sign-in.',
    envVars: [{ name: 'GOOGLE_CLIENT_ID', secret: false }, { name: 'GOOGLE_CLIENT_SECRET', secret: true }, { name: 'GOOGLE_CALENDAR_REFRESH_TOKEN', secret: true }, { name: 'GOOGLE_CALENDAR_ID', secret: false }],
    configured: () => !!(env.googleClientId && env.googleClientSecret && env.googleCalendarRefreshToken),
    async test() {
      if (!(env.googleClientId && env.googleClientSecret && env.googleCalendarRefreshToken)) return { ok: false, message: 'Google Meet is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALENDAR_REFRESH_TOKEN.' };
      let accessToken: string;
      try { accessToken = await getGoogleCalendarAccessToken(); } catch (e) { return { ok: false, message: String((e as Error).message ?? e) }; }
      const cal = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.googleCalendarId)}`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!cal.ok) return { ok: false, message: `Connected to Google but could not read GOOGLE_CALENDAR_ID (HTTP ${cal.status}). Check the calendar id and that the consented account has access to it.` };
      const summary = (cal.json as { summary?: string })?.summary;
      return { ok: true, message: `Connected to Google Calendar${summary ? ` ("${summary}")` : ''}. Live Meet-link creation is available for Calendar, provider assignment and delivery coordination.` };
    },
  },
  {
    id: 'video', label: 'Default video provider', category: 'Virtual delivery', providerChoiceKey: RULE_KEY('video'), providerOptions: ['zoom', 'google_meet'],
    docsHint: 'Choose which configured provider Calendar, provider assignment and delivery coordination use to create real meeting links. Configure Zoom and/or Google Meet above first.',
    envVars: [],
    configured: (choice) => choice === 'zoom' ? !!(env.zoomAccountId && env.zoomClientId && env.zoomClientSecret)
      : choice === 'google_meet' ? !!(env.googleClientId && env.googleClientSecret && env.googleCalendarRefreshToken) : false,
    async test(choice) {
      if (!choice) return { ok: false, message: 'Choose a default video provider (Zoom or Google Meet) first.' };
      const d = choice === 'zoom' ? byId.get('zoom') : choice === 'google_meet' ? byId.get('google_meet') : null;
      if (!d) return { ok: false, message: 'Unknown video provider.' };
      const r = await d.test(null);
      return { ok: r.ok, message: r.ok ? `Default video provider is ${choice === 'zoom' ? 'Zoom' : 'Google Meet'}. ${r.message}` : r.message };
    },
  },
  {
    id: 'teams', label: 'Microsoft Teams', category: 'Virtual delivery', providerChoiceKey: null, providerOptions: null,
    docsHint: 'Azure AD -> App registrations -> New registration. Grant the OnlineMeetings.ReadWrite.All application permission with admin consent.',
    envVars: [{ name: 'MS_TEAMS_TENANT_ID', secret: false }, { name: 'MS_TEAMS_CLIENT_ID', secret: false }, { name: 'MS_TEAMS_CLIENT_SECRET', secret: true }, { name: 'MS_TEAMS_ORGANIZER_USER_ID', secret: false }],
    configured: () => !!(env.teamsTenantId && env.teamsClientId && env.teamsClientSecret),
    async test() {
      if (!(env.teamsTenantId && env.teamsClientId && env.teamsClientSecret)) return { ok: false, message: 'Microsoft Teams is not configured. Set MS_TEAMS_TENANT_ID, MS_TEAMS_CLIENT_ID and MS_TEAMS_CLIENT_SECRET.' };
      const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.teamsClientId, client_secret: env.teamsClientSecret, scope: 'https://graph.microsoft.com/.default' });
      const tok = await fetchJson(`https://login.microsoftonline.com/${encodeURIComponent(env.teamsTenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      if (!tok.ok) return { ok: false, message: `Microsoft Entra ID rejected the app credentials (HTTP ${tok.status}). Check the tenant, client ID and secret.` };
      const accessToken = (tok.json as { access_token?: string })?.access_token;
      if (!accessToken) return { ok: false, message: 'Microsoft Entra ID returned no access token.' };
      if (!env.teamsOrganizerUserId) return { ok: true, message: 'Connected to Microsoft Graph. Set MS_TEAMS_ORGANIZER_USER_ID (the user Teams meetings are created under) to verify meeting-creation access.' };
      const who = await fetchJson(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.teamsOrganizerUserId)}`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!who.ok) return { ok: false, message: `Connected to Microsoft Graph but could not read MS_TEAMS_ORGANIZER_USER_ID (HTTP ${who.status}). Check the value and the admin-consented permission.` };
      const name = (who.json as { displayName?: string })?.displayName;
      return { ok: true, message: `Connected to Microsoft Graph${name ? `; meetings would be organized by ${name}` : ''}.` };
    },
  },
  {
    id: 'whatsapp', label: 'WhatsApp Business', category: 'Messaging', providerChoiceKey: null, providerOptions: null,
    docsHint: 'Meta for Developers -> WhatsApp -> API Setup. Use a permanent system-user access token, not the 24-hour temporary one.',
    envVars: [{ name: 'WHATSAPP_PHONE_NUMBER_ID', secret: false }, { name: 'WHATSAPP_BUSINESS_ACCOUNT_ID', secret: false }, { name: 'WHATSAPP_ACCESS_TOKEN', secret: true }],
    configured: () => !!(env.whatsappPhoneNumberId && env.whatsappAccessToken),
    async test() {
      if (!(env.whatsappPhoneNumberId && env.whatsappAccessToken)) return { ok: false, message: 'WhatsApp Business is not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.' };
      const r = await fetchJson(`https://graph.facebook.com/v19.0/${encodeURIComponent(env.whatsappPhoneNumberId)}?fields=verified_name,display_phone_number,quality_rating`, { headers: { authorization: `Bearer ${env.whatsappAccessToken}` } });
      if (!r.ok) return { ok: false, message: `Meta rejected the request (HTTP ${r.status}). Check the phone number ID and access token, and that the token has not expired.` };
      const d = r.json as { verified_name?: string; display_phone_number?: string };
      return { ok: true, message: `Connected to WhatsApp Business as ${d.verified_name ?? 'this number'} (${d.display_phone_number ?? env.whatsappPhoneNumberId}).` };
    },
  },
  {
    id: 'sms', label: 'SMS', category: 'Messaging', providerChoiceKey: RULE_KEY('sms'), providerOptions: ['twilio', 'arkesel'],
    docsHint: 'Twilio: console.twilio.com -> Account SID and Auth Token. Arkesel (Ghana): sms.arkesel.com -> SMS API -> API key.',
    envVars: [{ name: 'TWILIO_ACCOUNT_SID', secret: false }, { name: 'TWILIO_AUTH_TOKEN', secret: true }, { name: 'TWILIO_FROM_NUMBER', secret: false }, { name: 'ARKESEL_API_KEY', secret: true }, { name: 'ARKESEL_SENDER_ID', secret: false }],
    configured: (choice) => choice === 'twilio' ? !!(env.twilioAccountSid && env.twilioAuthToken && env.twilioFromNumber)
      : choice === 'arkesel' ? !!env.arkeselApiKey : false,
    async test(choice) {
      if (choice === 'twilio') {
        if (!(env.twilioAccountSid && env.twilioAuthToken)) return { ok: false, message: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.' };
        const basic = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString('base64');
        const r = await fetchJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.twilioAccountSid)}.json`, { headers: { authorization: `Basic ${basic}` } });
        if (!r.ok) return { ok: false, message: `Twilio rejected the credentials (HTTP ${r.status}).` };
        const d = r.json as { friendly_name?: string; status?: string };
        if (!env.twilioFromNumber) return { ok: true, message: `Connected to Twilio account "${d.friendly_name ?? env.twilioAccountSid}" (${d.status}). Set TWILIO_FROM_NUMBER before sending.` };
        return { ok: true, message: `Connected to Twilio account "${d.friendly_name ?? env.twilioAccountSid}" (${d.status}).` };
      }
      if (choice === 'arkesel') {
        if (!env.arkeselApiKey) return { ok: false, message: 'Arkesel is not configured. Set ARKESEL_API_KEY.' };
        // Arkesel's balance/account-check endpoint is not verified against their current API
        // version here, so this reports only that the key is present rather than claiming a
        // live call succeeded against an unverified path. Confirm the endpoint in Arkesel's
        // current docs before relying on a live check, or send one real test SMS manually.
        return { ok: true, message: 'An Arkesel API key is set. This has not made a live call -- Arkesel\'s current balance-check endpoint was not verified here. Send one manual test SMS to confirm the key works before going live.' };
      }
      return { ok: false, message: 'Choose an SMS provider (Twilio or Arkesel) and set its credentials first.' };
    },
  },
  {
    id: 'esignature', label: 'E-signature (DocuSign)', category: 'Documents', providerChoiceKey: null, providerOptions: null,
    docsHint: 'DocuSign Developer Center -> create an Integration Key. Production server integrations normally use a JWT grant with a consented user; DOCUSIGN_ACCESS_TOKEN here is for connectivity testing with a short-lived token obtained via DocuSign\'s own OAuth flow.',
    envVars: [{ name: 'DOCUSIGN_INTEGRATION_KEY', secret: false }, { name: 'DOCUSIGN_CLIENT_SECRET', secret: true }, { name: 'DOCUSIGN_ACCOUNT_ID', secret: false }, { name: 'DOCUSIGN_BASE_URL', secret: false }, { name: 'DOCUSIGN_ACCESS_TOKEN', secret: true }],
    configured: () => !!(env.docusignIntegrationKey && env.docusignClientSecret && env.docusignAccountId),
    async test() {
      if (!(env.docusignIntegrationKey && env.docusignClientSecret && env.docusignAccountId)) return { ok: false, message: 'DocuSign is not configured. Set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_CLIENT_SECRET and DOCUSIGN_ACCOUNT_ID.' };
      if (!env.docusignAccessToken) return { ok: false, message: 'App credentials are set, but no DOCUSIGN_ACCESS_TOKEN is present to verify connectivity. Full server-to-server access needs a JWT consent grant, which is separate setup work.' };
      const host = env.docusignBaseUrl.includes('demo') ? 'https://account-d.docusign.com' : 'https://account.docusign.com';
      const r = await fetchJson(`${host}/oauth/userinfo`, { headers: { authorization: `Bearer ${env.docusignAccessToken}` } });
      if (!r.ok) return { ok: false, message: `DocuSign rejected the access token (HTTP ${r.status}). It may have expired -- these tokens are short-lived.` };
      const d = r.json as { name?: string; accounts?: { account_id: string; is_default: boolean }[] };
      const matches = d.accounts?.some((a) => a.account_id === env.docusignAccountId);
      return { ok: true, message: `Connected to DocuSign as ${d.name ?? 'this user'}.${matches ? '' : ' Note: DOCUSIGN_ACCOUNT_ID does not match any account on this token.'}` };
    },
  },
  {
    id: 'accounting', label: 'Accounting sync', category: 'Finance', providerChoiceKey: RULE_KEY('accounting'), providerOptions: ['quickbooks', 'xero'],
    docsHint: 'QuickBooks Online: developer.intuit.com -> create an app, complete the OAuth2 authorization-code flow once to get a refresh token. Xero: developer.xero.com -> create an app, same one-time refresh-token setup.',
    envVars: [{ name: 'QUICKBOOKS_CLIENT_ID', secret: false }, { name: 'QUICKBOOKS_CLIENT_SECRET', secret: true }, { name: 'QUICKBOOKS_REALM_ID', secret: false }, { name: 'QUICKBOOKS_REFRESH_TOKEN', secret: true }, { name: 'XERO_CLIENT_ID', secret: false }, { name: 'XERO_CLIENT_SECRET', secret: true }, { name: 'XERO_TENANT_ID', secret: false }, { name: 'XERO_REFRESH_TOKEN', secret: true }],
    configured: (choice) => choice === 'quickbooks' ? !!(env.quickbooksClientId && env.quickbooksClientSecret && env.quickbooksRealmId && env.quickbooksRefreshToken)
      : choice === 'xero' ? !!(env.xeroClientId && env.xeroClientSecret && env.xeroTenantId && env.xeroRefreshToken) : false,
    async test(choice) {
      if (choice === 'quickbooks') {
        if (!(env.quickbooksClientId && env.quickbooksClientSecret && env.quickbooksRealmId && env.quickbooksRefreshToken)) return { ok: false, message: 'QuickBooks Online is not configured. Set QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_REALM_ID and QUICKBOOKS_REFRESH_TOKEN.' };
        const basic = Buffer.from(`${env.quickbooksClientId}:${env.quickbooksClientSecret}`).toString('base64');
        const tok = await fetchJson('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.quickbooksRefreshToken }) });
        if (!tok.ok) return { ok: false, message: `Intuit rejected the refresh token (HTTP ${tok.status}). A QuickBooks refresh token expires after 100 days of inactivity and needs re-authorizing.` };
        const accessToken = (tok.json as { access_token?: string })?.access_token;
        if (!accessToken) return { ok: false, message: 'Intuit returned no access token.' };
        const info = await fetchJson(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(env.quickbooksRealmId)}/companyinfo/${encodeURIComponent(env.quickbooksRealmId)}`, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
        if (!info.ok) return { ok: false, message: `Connected to Intuit but could not read company info (HTTP ${info.status}). Check QUICKBOOKS_REALM_ID.` };
        const name = (info.json as { CompanyInfo?: { CompanyName?: string } })?.CompanyInfo?.CompanyName;
        return { ok: true, message: `Connected to QuickBooks Online${name ? ` for ${name}` : ''}.` };
      }
      if (choice === 'xero') {
        if (!(env.xeroClientId && env.xeroClientSecret && env.xeroTenantId && env.xeroRefreshToken)) return { ok: false, message: 'Xero is not configured. Set XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_TENANT_ID and XERO_REFRESH_TOKEN.' };
        const basic = Buffer.from(`${env.xeroClientId}:${env.xeroClientSecret}`).toString('base64');
        const tok = await fetchJson('https://identity.xero.com/connect/token', { method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.xeroRefreshToken }) });
        if (!tok.ok) return { ok: false, message: `Xero rejected the refresh token (HTTP ${tok.status}). Xero refresh tokens expire after 60 days and need re-authorizing.` };
        const accessToken = (tok.json as { access_token?: string })?.access_token;
        if (!accessToken) return { ok: false, message: 'Xero returned no access token.' };
        const conn = await fetchJson('https://api.xero.com/connections', { headers: { authorization: `Bearer ${accessToken}` } });
        if (!conn.ok) return { ok: false, message: `Connected to Xero but could not list organisations (HTTP ${conn.status}).` };
        const orgs = conn.json as { tenantId: string; tenantName?: string }[] | null;
        const match = orgs?.find((o) => o.tenantId === env.xeroTenantId);
        return { ok: true, message: match ? `Connected to Xero organisation "${match.tenantName ?? match.tenantId}".` : 'Connected to Xero, but XERO_TENANT_ID does not match any connected organisation.' };
      }
      return { ok: false, message: 'Choose an accounting system (QuickBooks Online or Xero) and set its credentials first.' };
    },
  },
];

const byId = new Map(DESCRIPTORS.map((d) => [d.id, d]));

export async function readIntegrationSettings(ctx: Ctx) {
  allow(ctx, 'integrations', 'read');
  const rows = await ctx.db.select().from(schema.rules).where(inArray(schema.rules.key, INTEGRATION_RULE_KEYS));
  const choices = new Map(rows.map((r) => [r.key, r.value]));
  return DESCRIPTORS.map((d) => {
    const choice = d.providerChoiceKey ? choices.get(d.providerChoiceKey) ?? null : null;
    return {
      id: d.id, label: d.label, category: d.category, docsHint: d.docsHint,
      providerOptions: d.providerOptions, providerChoice: choice,
      envVars: d.envVars.map((v) => ({ name: v.name, set: !!process.env[v.name]?.trim(), secret: v.secret })),
      configured: d.configured(choice),
    };
  });
}

export async function saveIntegrationChoice(ctx: Ctx, id: IntegrationId, body: { provider: string }) {
  allow(ctx, 'integrations', 'edit');
  const d = byId.get(id);
  if (!d || !d.providerChoiceKey || !d.providerOptions) throw fieldError({ id: 'This integration has no provider choice to save' });
  if (!d.providerOptions.includes(body.provider)) throw fieldError({ provider: `Choose one of: ${d.providerOptions.join(', ')}` });
  const uid = need(ctx).user.id;
  await ctx.db.insert(schema.rules).values({ key: d.providerChoiceKey, value: body.provider, updatedBy: uid })
    .onConflictDoUpdate({ target: schema.rules.key, set: { value: body.provider, updatedBy: uid, updatedAt: new Date() } });
  await audit(ctx, 'settings.integration_provider_changed', 'settings', null, undefined, { integration: id, provider: body.provider });
  return readIntegrationSettings(ctx);
}

export async function testIntegration(ctx: Ctx, id: IntegrationId) {
  allow(ctx, 'integrations', 'edit');
  const d = byId.get(id);
  if (!d) throw fieldError({ id: 'Unknown integration' });
  let choice: string | null = null;
  if (d.providerChoiceKey) {
    const [row] = await ctx.db.select().from(schema.rules).where(eq(schema.rules.key, d.providerChoiceKey)).limit(1);
    choice = row?.value ?? null;
  }
  const started = Date.now();
  try {
    const result = await d.test(choice);
    await audit(ctx, 'settings.integration_tested', 'settings', null, undefined, { integration: id, ok: result.ok });
    return { ...result, tookMs: Date.now() - started };
  } catch (e) {
    await audit(ctx, 'settings.integration_tested', 'settings', null, undefined, { integration: id, ok: false });
    return { ok: false, message: `Could not reach ${d.label}: ${String((e as Error).message ?? e).slice(0, 200)}`, tookMs: Date.now() - started };
  }
}

/**
 * The administrator's configured default video provider, for internal use by Calendar,
 * provider-assignment and delivery-coordination when they need to create a real meeting link.
 * Not an admin-settings read (no `integrations:read` gate) -- any caller already authorized for
 * the calendar/delivery action it supports is entitled to know which provider is in effect.
 * Returns null when no provider is chosen, or the chosen one isn't actually configured.
 */
export async function resolveVideoProvider(ctx: Ctx): Promise<'zoom' | 'google_meet' | null> {
  const [row] = await ctx.db.select().from(schema.rules).where(eq(schema.rules.key, VIDEO_PROVIDER_RULE_KEY)).limit(1);
  const choice = row?.value;
  if (choice !== 'zoom' && choice !== 'google_meet') return null;
  const d = byId.get(choice);
  if (!d || !d.configured(null)) return null;
  return choice;
}
