import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { eq, inArray } from 'drizzle-orm';

let admin: Session;
const ENV_KEYS = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALENDAR_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });

afterEach(async () => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  await db().delete(schema.rules).where(inArray(schema.rules.key, ['integrations.video.provider']));
});

/** A fetch stub that answers Zoom's OAuth-token and meeting-create endpoints, and nothing else. */
function stubZoomFetch(opts: { joinUrl?: string; meetingId?: number; tokenFails?: boolean; createFails?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes('zoom.us/oauth/token')) {
      if (opts.tokenFails) return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
      return new Response(JSON.stringify({ access_token: 'zoom-access-token' }), { status: 200 });
    }
    if (url.includes('api.zoom.us/v2/users/me/meetings')) {
      if (opts.createFails) return new Response(JSON.stringify({ message: 'Invalid request' }), { status: 400 });
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ id: opts.meetingId ?? 987654321, join_url: opts.joinUrl ?? 'https://zoom.us/j/987654321', topic: body.topic }), { status: 201 });
    }
    if (url.includes('api.zoom.us/v2/meetings/')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch in Zoom stub: ${url}`);
  }));
  return calls;
}

function stubGoogleFetch(opts: { joinUrl?: string; eventId?: string; tokenFails?: boolean; createFails?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes('oauth2.googleapis.com/token')) {
      if (opts.tokenFails) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: 'google-access-token' }), { status: 200 });
    }
    if (url.includes('googleapis.com/calendar/v3/calendars') && !url.includes('/events')) {
      return new Response(JSON.stringify({ id: 'primary', summary: 'Test calendar' }), { status: 200 });
    }
    if (url.includes('/events') && !url.includes('/events/')) {
      if (opts.createFails) return new Response(JSON.stringify({ error: { message: 'Bad conference request' } }), { status: 400 });
      void init;
      return new Response(JSON.stringify({ id: opts.eventId ?? 'evt_abc123', hangoutLink: opts.joinUrl ?? 'https://meet.google.com/abc-defg-hij' }), { status: 200 });
    }
    if (url.includes('/events/')) return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch in Google stub: ${url}`);
  }));
  return calls;
}

async function setZoomEnv() { process.env.ZOOM_ACCOUNT_ID = 'acc'; process.env.ZOOM_CLIENT_ID = 'cid'; process.env.ZOOM_CLIENT_SECRET = 'secret'; }
async function setGoogleEnv() { process.env.GOOGLE_CLIENT_ID = 'gcid'; process.env.GOOGLE_CLIENT_SECRET = 'gsecret'; process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = 'refresh-token'; }
async function chooseVideoProvider(provider: 'zoom' | 'google_meet') {
  const r = await api(admin).put('/settings/integrations/video', { provider });
  expect(r.status, JSON.stringify(r.error)).toBe(200);
}

describe('meetings.ts: live Zoom/Google Meet creation (mocked transport)', () => {
  it('createZoomMeeting returns the real join_url and surfaces a clean error when Zoom rejects the credentials', async () => {
    const { createZoomMeeting } = await import('@/services/meetings');
    await setZoomEnv();
    stubZoomFetch({ joinUrl: 'https://zoom.us/j/1112223333' });
    const start = new Date(); const end = new Date(start.getTime() + 45 * 60_000);
    const m = await createZoomMeeting({ title: 'Kickoff', startsAt: start, endsAt: end });
    expect(m.joinUrl).toBe('https://zoom.us/j/1112223333');
    expect(m.provider).toBe('zoom');

    stubZoomFetch({ tokenFails: true });
    await expect(createZoomMeeting({ title: 'Kickoff', startsAt: start, endsAt: end })).rejects.toThrow(/rejected the Server-to-Server OAuth/);
  });

  it('createZoomMeeting refuses to fabricate a join link when Zoom accepts the token but the create call fails', async () => {
    const { createZoomMeeting } = await import('@/services/meetings');
    await setZoomEnv();
    stubZoomFetch({ createFails: true });
    await expect(createZoomMeeting({ title: 'Kickoff', startsAt: new Date(), endsAt: new Date(Date.now() + 1800_000) })).rejects.toThrow(/could not create the meeting/);
  });

  it('createGoogleMeetEvent returns a real Meet hangoutLink and surfaces a clean error on a bad refresh token', async () => {
    const { createGoogleMeetEvent } = await import('@/services/meetings');
    await setGoogleEnv();
    stubGoogleFetch({ joinUrl: 'https://meet.google.com/xyz-abcd-efg' });
    const m = await createGoogleMeetEvent({ title: 'Delivery session', startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000) });
    expect(m.joinUrl).toBe('https://meet.google.com/xyz-abcd-efg');
    expect(m.provider).toBe('google_meet');

    stubGoogleFetch({ tokenFails: true });
    await expect(createGoogleMeetEvent({ title: 'Delivery session', startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000) })).rejects.toThrow(/rejected the Calendar refresh token/);
  });

  it('neither provider is configured until every required credential is present', async () => {
    const { isVideoProviderConfigured } = await import('@/services/meetings');
    expect(isVideoProviderConfigured('zoom')).toBe(false);
    expect(isVideoProviderConfigured('google_meet')).toBe(false);
    await setZoomEnv();
    expect(isVideoProviderConfigured('zoom')).toBe(true);
  });
});

describe('delivery-operations: REMOTE/HYBRID sessions get a real meeting link', () => {
  it('creates a live Zoom meeting for a REMOTE session when no meetingUrl is given and Zoom is the chosen default', async () => {
    await setZoomEnv();
    await chooseVideoProvider('zoom');
    stubZoomFetch({ joinUrl: 'https://zoom.us/j/555000111' });

    const prog = (await api(admin).post('/programmes', { name: `Meetings ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 20 })).data;
    const activity = (await api(admin).post(`/cohorts/${cohort.id}/activities`, { name: 'Orientation workshop' })).data;

    const session = await api(admin).post(`/delivery-activities/${activity.id}/sessions`, {
      mode: 'REMOTE', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
    expect(session.status, JSON.stringify(session.error)).toBe(201);
    expect(session.data.meetingUrl).toBe('https://zoom.us/j/555000111');
    expect(session.data.metadata.videoProvider).toBe('zoom');
  });

  it('leaves meetingUrl null, with the failure recorded, when the provider rejects the request -- never fabricating a link', async () => {
    await setZoomEnv();
    await chooseVideoProvider('zoom');
    stubZoomFetch({ createFails: true });

    const prog = (await api(admin).post('/programmes', { name: `Meetings ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 20 })).data;
    const activity = (await api(admin).post(`/cohorts/${cohort.id}/activities`, { name: 'Orientation workshop' })).data;

    const session = await api(admin).post(`/delivery-activities/${activity.id}/sessions`, {
      mode: 'HYBRID', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
    expect(session.status).toBe(201);
    expect(session.data.meetingUrl).toBeNull();
    expect(session.data.metadata.videoMeetingError).toContain('could not create the meeting');
  });

  it('does not attempt a live meeting for an IN_PERSON session, or when the caller supplies a meetingUrl by hand', async () => {
    await setZoomEnv();
    await chooseVideoProvider('zoom');
    const calls = stubZoomFetch();

    const prog = (await api(admin).post('/programmes', { name: `Meetings ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 20 })).data;
    const activity = (await api(admin).post(`/cohorts/${cohort.id}/activities`, { name: 'Field visit' })).data;

    const inPerson = await api(admin).post(`/delivery-activities/${activity.id}/sessions`, {
      mode: 'IN_PERSON', location: 'Tamale office', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
    expect(inPerson.status).toBe(201);
    expect(inPerson.data.meetingUrl).toBeNull();

    const manual = await api(admin).post(`/delivery-activities/${activity.id}/sessions`, {
      mode: 'REMOTE', meetingUrl: 'https://custom.example.com/room/1', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
    expect(manual.status).toBe(201);
    expect(manual.data.meetingUrl).toBe('https://custom.example.com/room/1');
    expect(calls.length).toBe(0);
  });
});

describe('programme-calendar: scheduling a delivery session creates a real meeting and keeps the session in sync', () => {
  it('scheduleSession creates a live Google Meet event when no meetingUrl exists yet, and copies the link back onto the session', async () => {
    await setGoogleEnv();
    await chooseVideoProvider('google_meet');
    stubGoogleFetch({ joinUrl: 'https://meet.google.com/kkk-llll-mmm' });

    const prog = (await api(admin).post('/programmes', { name: `Calendar ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 20 })).data;
    const activity = (await api(admin).post(`/cohorts/${cohort.id}/activities`, { name: 'Diagnostic clinic' })).data;
    const session = (await api(admin).post(`/delivery-activities/${activity.id}/sessions`, {
      mode: 'IN_PERSON', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    })).data;
    expect(session.meetingUrl).toBeNull();

    const event = await api(admin).post(`/delivery-sessions/${session.id}/calendar`, {});
    expect(event.status, JSON.stringify(event.error)).toBe(201);
    expect(event.data.meetingUrl).toBe('https://meet.google.com/kkk-llll-mmm');
    expect(event.data.provider).toBe('GOOGLE');
    expect(event.data.metadata.videoProvider).toBe('google_meet');

    const [refreshed] = await db().select().from(schema.deliverySessions).where(eq(schema.deliverySessions.id, session.id));
    expect(refreshed.meetingUrl).toBe('https://meet.google.com/kkk-llll-mmm');
  });

  it('cancelling the calendar event best-effort cancels the live meeting without failing the cancellation', async () => {
    await setZoomEnv();
    await chooseVideoProvider('zoom');
    stubZoomFetch({ joinUrl: 'https://zoom.us/j/222333444' });

    const prog = (await api(admin).post('/programmes', { name: `Calendar ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 20 })).data;
    const event = await api(admin).post(`/cohorts/${cohort.id}/calendar-events`, {
      title: 'Zoom session', startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
    expect(event.status).toBe(201);
    expect(event.data.provider).toBe('ZOOM');

    const cancel = await api(admin).post(`/calendar-events/${event.data.id}/cancel`, {});
    expect(cancel.status).toBe(200);
    expect(cancel.data.ok).toBe(true);
  });

  it('skipLiveMeeting opts out of creating a real meeting even with a provider configured', async () => {
    await setGoogleEnv();
    await chooseVideoProvider('google_meet');
    const calls = stubGoogleFetch();

    const prog = (await api(admin).post('/programmes', { name: `Calendar ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 20 })).data;
    const event = await api(admin).post(`/cohorts/${cohort.id}/calendar-events`, {
      title: 'In-person only', skipLiveMeeting: true, startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    });
    expect(event.status).toBe(201);
    expect(event.data.provider).toBe('INTERNAL');
    expect(event.data.meetingUrl).toBeNull();
    expect(calls.length).toBe(0);
  });
});

describe('provider assignment: a real kickoff meeting can be created on activation', () => {
  /** Walk a fresh workspace through the full governed lifecycle up to CONFIGURING. */
  async function activateWorkspace(id: string) {
    for (const s of ['COMMERCIAL_REVIEW', 'INVOICED', 'PAYMENT_PENDING', 'APPROVED', 'CONFIGURING']) {
      const patched = await api(admin).patch(`/programme-workspaces/${id}`, { status: s });
      if (patched.status !== 200) throw new Error(`patch to ${s} failed: ${patched.status} ${patched.text}`);
    }
  }

  it('creates a real Zoom kickoff meeting when asked to, and records it on the assignment', async () => {
    await setZoomEnv();
    await chooseVideoProvider('zoom');
    stubZoomFetch({ joinUrl: 'https://zoom.us/j/777888999' });

    const prog = (await api(admin).post('/programmes', { name: `Kickoff ${uniq()}` })).data;
    const ws = (await api(admin).post(`/programmes/${prog.id}/workspace`, {})).data;
    await activateWorkspace(ws.id);
    const expert = await makeUser('EXPERT');
    await api(admin).post(`/programme-workspaces/${ws.id}/members`, { userId: expert.userId, role: 'EXPERT' });
    const assignment = (await api(admin).post(`/programme-workspaces/${ws.id}/provider-assignments`, { providerUserId: expert.userId, providerRole: 'EXPERT' })).data;

    const activated = await api(admin).post(`/provider-assignments/${assignment.id}/status`, { status: 'ACTIVE', scheduleKickoffMeeting: true });
    expect(activated.status, JSON.stringify(activated.error)).toBe(200);
    expect(activated.data.metadata.kickoffMeetingUrl).toBe('https://zoom.us/j/777888999');
    expect(activated.data.metadata.videoProvider).toBe('zoom');
  });

  it('does not attempt a kickoff meeting unless explicitly asked, and never fabricates one without a configured provider', async () => {
    const calls = stubZoomFetch();
    const prog = (await api(admin).post('/programmes', { name: `Kickoff ${uniq()}` })).data;
    const ws = (await api(admin).post(`/programmes/${prog.id}/workspace`, {})).data;
    await activateWorkspace(ws.id);
    const expert = await makeUser('EXPERT');
    await api(admin).post(`/programme-workspaces/${ws.id}/members`, { userId: expert.userId, role: 'EXPERT' });
    const assignment = (await api(admin).post(`/programme-workspaces/${ws.id}/provider-assignments`, { providerUserId: expert.userId, providerRole: 'EXPERT' })).data;

    const activated = await api(admin).post(`/provider-assignments/${assignment.id}/status`, { status: 'ACTIVE' });
    expect(activated.status).toBe(200);
    expect(activated.data.metadata.kickoffMeetingUrl).toBeUndefined();
    expect(calls.length).toBe(0);
  });
});
