/**
 * Real, live video-meeting creation: Zoom (Server-to-Server OAuth) and Google Meet (via a
 * Google Calendar event with conferenceData). This is the layer integrations.ts's zoom/google_meet
 * `test()` functions deliberately stop short of -- those only verify credentials. This module
 * makes the actual "create a meeting" API call and returns a real join link.
 *
 * Credentials are resolved by services/integration-credentials.ts, which checks the database
 * (an administrator's own Settings-screen entry) before falling back to the matching environment
 * variable. Which provider is used by default is a separate administrator choice, stored as a
 * non-secret value in the `rules` table via integrations.ts (RULE_KEY('video')), exposed through
 * the admin Settings screen -- never hardcoded here.
 */
import type { Ctx } from '@/lib/context';
import { ApiError } from '@/lib/errors';
import { resolveZoomCredentials, resolveGoogleCredentials } from './integration-credentials';

export type VideoProvider = 'zoom' | 'google_meet';

export type MeetingRequest = { title: string; startsAt: Date; endsAt: Date; timezone?: string; description?: string | null };
export type MeetingResult = { joinUrl: string; externalId: string; provider: VideoProvider; raw?: unknown };

class MeetingProviderError extends ApiError {
  constructor(message: string) { super(502, 'MEETING_PROVIDER_ERROR', message); }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 15_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, json, text };
}

/* ---------------------------------- Zoom ---------------------------------- */

/** Server-to-Server OAuth token fetch. Reused by integrations.ts's connectivity test and here, so the
 * credential-exchange logic has exactly one implementation. */
export async function getZoomAccessToken(ctx: Ctx): Promise<string> {
  const creds = await resolveZoomCredentials(ctx);
  if (!creds) {
    throw new MeetingProviderError('Zoom is not configured. Set the account ID, client ID and client secret in Settings -> Integrations, or ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET as environment variables.');
  }
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const tok = await fetchJson(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(creds.accountId)}`, { method: 'POST', headers: { authorization: `Basic ${basic}` } });
  const accessToken = (tok.json as { access_token?: string } | null)?.access_token;
  if (!tok.ok || !accessToken) throw new MeetingProviderError(`Zoom rejected the Server-to-Server OAuth credentials (HTTP ${tok.status}).`);
  return accessToken;
}

export async function createZoomMeeting(ctx: Ctx, req: MeetingRequest): Promise<MeetingResult> {
  const accessToken = await getZoomAccessToken(ctx);
  const durationMinutes = Math.max(1, Math.round((req.endsAt.getTime() - req.startsAt.getTime()) / 60_000));
  const body = {
    topic: req.title.slice(0, 200),
    type: 2, // scheduled meeting
    start_time: req.startsAt.toISOString(),
    duration: durationMinutes,
    timezone: 'UTC',
    agenda: req.description?.slice(0, 2000) ?? undefined,
    settings: { join_before_host: true, waiting_room: false, approval_type: 2 },
  };
  const r = await fetchJson('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new MeetingProviderError(`Zoom could not create the meeting (HTTP ${r.status}): ${String((r.json as { message?: string } | null)?.message ?? r.text).slice(0, 300)}`);
  const d = r.json as { id?: number; join_url?: string };
  if (!d.join_url || d.id == null) throw new MeetingProviderError('Zoom created the meeting but returned no join URL.');
  return { joinUrl: d.join_url, externalId: String(d.id), provider: 'zoom', raw: d };
}

/** Updates an existing Zoom meeting's time/duration in place, keeping the same join URL and meeting ID. */
export async function updateZoomMeeting(ctx: Ctx, externalId: string, req: MeetingRequest): Promise<void> {
  const accessToken = await getZoomAccessToken(ctx);
  const durationMinutes = Math.max(1, Math.round((req.endsAt.getTime() - req.startsAt.getTime()) / 60_000));
  const body = { topic: req.title.slice(0, 200), start_time: req.startsAt.toISOString(), duration: durationMinutes, timezone: 'UTC', agenda: req.description?.slice(0, 2000) ?? undefined };
  const r = await fetchJson(`https://api.zoom.us/v2/meetings/${encodeURIComponent(externalId)}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Zoom's PATCH returns 204 with no body on success. A 404 means the meeting is already gone on
  // Zoom's side (deleted manually, or expired) -- the caller treats that the same as "needs a fresh
  // meeting", never as a crash, mirroring the cancel path's best-effort handling.
  if (!r.ok && r.status !== 404) throw new MeetingProviderError(`Zoom could not reschedule the meeting (HTTP ${r.status}): ${String((r.json as { message?: string } | null)?.message ?? r.text).slice(0, 300)}`);
  if (r.status === 404) throw new MeetingProviderError('Zoom meeting no longer exists; a new meeting must be created.');
}

export async function cancelZoomMeeting(ctx: Ctx, externalId: string): Promise<void> {
  const accessToken = await getZoomAccessToken(ctx);
  await fetchJson(`https://api.zoom.us/v2/meetings/${encodeURIComponent(externalId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  // Zoom returns 204/404 either way for an already-gone meeting; cancellation here is best-effort
  // and must never block the calendar-side cancellation that triggered it.
}

/* ------------------------------- Google Meet ------------------------------- */

/** Exchanges the administrator's one-time-consent refresh token for a short-lived access token.
 * Returns the calendar ID alongside it, resolved from the same credential source, so callers never
 * resolve credentials twice (and never risk acting on a stale calendar ID if the configured value
 * changes between two separate resolutions). */
async function getGoogleCalendarAuth(ctx: Ctx): Promise<{ accessToken: string; calendarId: string }> {
  const creds = await resolveGoogleCredentials(ctx);
  if (!creds) {
    throw new MeetingProviderError('Google Meet is not configured. Set the OAuth client ID/secret and calendar refresh token in Settings -> Integrations, or GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALENDAR_REFRESH_TOKEN as environment variables.');
  }
  const r = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  const accessToken = (r.json as { access_token?: string } | null)?.access_token;
  if (!r.ok || !accessToken) throw new MeetingProviderError(`Google rejected the Calendar refresh token (HTTP ${r.status}). It may have been revoked and need re-authorizing.`);
  return { accessToken, calendarId: creds.calendarId };
}

/** Exposed for integrations.ts's connectivity test, which only needs the token. */
export async function getGoogleCalendarAccessToken(ctx: Ctx): Promise<string> {
  return (await getGoogleCalendarAuth(ctx)).accessToken;
}

export async function createGoogleMeetEvent(ctx: Ctx, req: MeetingRequest): Promise<MeetingResult> {
  const { accessToken, calendarId: rawCalendarId } = await getGoogleCalendarAuth(ctx);
  const requestId = `samakose-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const body = {
    summary: req.title.slice(0, 200),
    description: req.description ?? undefined,
    start: { dateTime: req.startsAt.toISOString(), timeZone: req.timezone ?? 'UTC' },
    end: { dateTime: req.endsAt.toISOString(), timeZone: req.timezone ?? 'UTC' },
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
  };
  const calendarId = encodeURIComponent(rawCalendarId);
  const r = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?conferenceDataVersion=1`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new MeetingProviderError(`Google Calendar could not create the event (HTTP ${r.status}): ${String((r.json as { error?: { message?: string } } | null)?.error?.message ?? r.text).slice(0, 300)}`);
  const d = r.json as { id?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] } };
  const joinUrl = d.hangoutLink ?? d.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  if (!joinUrl || !d.id) throw new MeetingProviderError('Google Calendar created the event but returned no Meet join link.');
  return { joinUrl, externalId: d.id, provider: 'google_meet', raw: d };
}

/** Updates an existing Google Calendar event's time in place, preserving its conferenceData/Meet link. */
export async function updateGoogleMeetEvent(ctx: Ctx, externalId: string, req: MeetingRequest): Promise<void> {
  const { accessToken, calendarId: rawCalendarId } = await getGoogleCalendarAuth(ctx);
  const calendarId = encodeURIComponent(rawCalendarId);
  const body = {
    summary: req.title.slice(0, 200),
    description: req.description ?? undefined,
    start: { dateTime: req.startsAt.toISOString(), timeZone: req.timezone ?? 'UTC' },
    end: { dateTime: req.endsAt.toISOString(), timeZone: req.timezone ?? 'UTC' },
  };
  const r = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(externalId)}?conferenceDataVersion=1`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 404 || r.status === 410) throw new MeetingProviderError('Google Calendar event no longer exists; a new meeting must be created.');
  if (!r.ok) throw new MeetingProviderError(`Google Calendar could not reschedule the event (HTTP ${r.status}): ${String((r.json as { error?: { message?: string } } | null)?.error?.message ?? r.text).slice(0, 300)}`);
}

export async function cancelGoogleMeetEvent(ctx: Ctx, externalId: string): Promise<void> {
  const { accessToken, calendarId: rawCalendarId } = await getGoogleCalendarAuth(ctx);
  const calendarId = encodeURIComponent(rawCalendarId);
  await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(externalId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
}

/* --------------------------------- Dispatch --------------------------------- */

export async function createVideoMeeting(ctx: Ctx, provider: VideoProvider, req: MeetingRequest): Promise<MeetingResult> {
  if (provider === 'zoom') return createZoomMeeting(ctx, req);
  if (provider === 'google_meet') return createGoogleMeetEvent(ctx, req);
  throw new MeetingProviderError(`Unknown video provider: ${String(provider)}`);
}

export async function cancelVideoMeeting(ctx: Ctx, provider: VideoProvider, externalId: string): Promise<void> {
  if (provider === 'zoom') return cancelZoomMeeting(ctx, externalId);
  if (provider === 'google_meet') return cancelGoogleMeetEvent(ctx, externalId);
}

/** Reschedules an existing meeting in place (same join URL, same external ID). Throws MeetingProviderError
 * if the provider rejects it or the meeting no longer exists on the provider's side -- the caller is
 * expected to fall back to creating a fresh meeting in that case, not to leave the session unscheduled. */
export async function updateVideoMeeting(ctx: Ctx, provider: VideoProvider, externalId: string, req: MeetingRequest): Promise<void> {
  if (provider === 'zoom') return updateZoomMeeting(ctx, externalId, req);
  if (provider === 'google_meet') return updateGoogleMeetEvent(ctx, externalId, req);
  throw new MeetingProviderError(`Unknown video provider: ${String(provider)}`);
}

export async function isVideoProviderConfigured(ctx: Ctx, provider: VideoProvider): Promise<boolean> {
  if (provider === 'zoom') return !!(await resolveZoomCredentials(ctx));
  if (provider === 'google_meet') return !!(await resolveGoogleCredentials(ctx));
  return false;
}
