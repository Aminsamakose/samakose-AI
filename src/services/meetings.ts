/**
 * Real, live video-meeting creation: Zoom (Server-to-Server OAuth) and Google Meet (via a
 * Google Calendar event with conferenceData). This is the layer integrations.ts's zoom/google_meet
 * `test()` functions deliberately stop short of -- those only verify credentials. This module
 * makes the actual "create a meeting" API call and returns a real join link.
 *
 * Same security pattern as everywhere else in this codebase: all credentials come from
 * environment variables (src/lib/env.ts) only. Nothing here writes a secret to the database.
 * Which provider is used by default is an administrator choice, stored as a non-secret value in
 * the `rules` table via integrations.ts (RULE_KEY('video')), exposed through the admin Settings
 * screen -- never hardcoded here.
 */
import { env } from '@/lib/env';
import { ApiError } from '@/lib/errors';

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
export async function getZoomAccessToken(): Promise<string> {
  if (!(env.zoomAccountId && env.zoomClientId && env.zoomClientSecret)) {
    throw new MeetingProviderError('Zoom is not configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET in Settings.');
  }
  const basic = Buffer.from(`${env.zoomClientId}:${env.zoomClientSecret}`).toString('base64');
  const tok = await fetchJson(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(env.zoomAccountId)}`, { method: 'POST', headers: { authorization: `Basic ${basic}` } });
  const accessToken = (tok.json as { access_token?: string } | null)?.access_token;
  if (!tok.ok || !accessToken) throw new MeetingProviderError(`Zoom rejected the Server-to-Server OAuth credentials (HTTP ${tok.status}).`);
  return accessToken;
}

export async function createZoomMeeting(req: MeetingRequest): Promise<MeetingResult> {
  const accessToken = await getZoomAccessToken();
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

export async function cancelZoomMeeting(externalId: string): Promise<void> {
  const accessToken = await getZoomAccessToken();
  await fetchJson(`https://api.zoom.us/v2/meetings/${encodeURIComponent(externalId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
  // Zoom returns 204/404 either way for an already-gone meeting; cancellation here is best-effort
  // and must never block the calendar-side cancellation that triggered it.
}

/* ------------------------------- Google Meet ------------------------------- */

/** Exchanges the administrator's one-time-consent refresh token for a short-lived access token. */
export async function getGoogleCalendarAccessToken(): Promise<string> {
  if (!(env.googleClientId && env.googleClientSecret && env.googleCalendarRefreshToken)) {
    throw new MeetingProviderError('Google Meet is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALENDAR_REFRESH_TOKEN in Settings.');
  }
  const r = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.googleCalendarRefreshToken,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
    }),
  });
  const accessToken = (r.json as { access_token?: string } | null)?.access_token;
  if (!r.ok || !accessToken) throw new MeetingProviderError(`Google rejected the Calendar refresh token (HTTP ${r.status}). It may have been revoked and need re-authorizing.`);
  return accessToken;
}

export async function createGoogleMeetEvent(req: MeetingRequest): Promise<MeetingResult> {
  const accessToken = await getGoogleCalendarAccessToken();
  const requestId = `samakose-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const body = {
    summary: req.title.slice(0, 200),
    description: req.description ?? undefined,
    start: { dateTime: req.startsAt.toISOString(), timeZone: req.timezone ?? 'UTC' },
    end: { dateTime: req.endsAt.toISOString(), timeZone: req.timezone ?? 'UTC' },
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
  };
  const calendarId = encodeURIComponent(env.googleCalendarId);
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

export async function cancelGoogleMeetEvent(externalId: string): Promise<void> {
  const accessToken = await getGoogleCalendarAccessToken();
  const calendarId = encodeURIComponent(env.googleCalendarId);
  await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(externalId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } });
}

/* --------------------------------- Dispatch --------------------------------- */

export async function createVideoMeeting(provider: VideoProvider, req: MeetingRequest): Promise<MeetingResult> {
  if (provider === 'zoom') return createZoomMeeting(req);
  if (provider === 'google_meet') return createGoogleMeetEvent(req);
  throw new MeetingProviderError(`Unknown video provider: ${String(provider)}`);
}

export async function cancelVideoMeeting(provider: VideoProvider, externalId: string): Promise<void> {
  if (provider === 'zoom') return cancelZoomMeeting(externalId);
  if (provider === 'google_meet') return cancelGoogleMeetEvent(externalId);
}

export function isVideoProviderConfigured(provider: VideoProvider): boolean {
  if (provider === 'zoom') return !!(env.zoomAccountId && env.zoomClientId && env.zoomClientSecret);
  if (provider === 'google_meet') return !!(env.googleClientId && env.googleClientSecret && env.googleCalendarRefreshToken);
  return false;
}
