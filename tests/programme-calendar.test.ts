import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';

/**
 * scheduleSession's "no existing active event for this session" check has no database constraint
 * behind it (calendar_events carries no unique index on sessionId, because a session can
 * legitimately move to a fresh event after one is cancelled). Without the advisory lock in
 * programme-calendar.ts, two concurrent calls for the same session - a double-click on Schedule, or
 * a client retry after a slow video-provider response - could both pass the check and each create
 * their own calendar_events row, and (when a video provider is configured) each their own live
 * meeting, for one delivery session.
 */
let admin: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });

async function cohortWithSession() {
  const prog = (await api(admin).post('/programmes', { name: `Calendar ${uniq()}` })).data;
  const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `C-${uniq()}`, capacity: 20 })).data;
  const activity = (await api(admin).post(`/cohorts/${cohort.id}/activities`, { name: `Session ${uniq()}` })).data;
  const session = (await api(admin).post(`/delivery-activities/${activity.id}/sessions`, {
    mode: 'IN_PERSON', startsAt: '2027-02-01T09:00:00Z', endsAt: '2027-02-01T11:00:00Z', skipLiveMeeting: true
  })).data;
  return { cohort, session };
}

describe('programme calendar: scheduling a delivery session', () => {
  it('schedules once, and a second attempt is refused as a duplicate', async () => {
    const { session } = await cohortWithSession();
    const first = await api(admin).post(`/delivery-sessions/${session.id}/calendar`, { skipLiveMeeting: true });
    expect(first.status, JSON.stringify(first.error)).toBe(201);
    const second = await api(admin).post(`/delivery-sessions/${session.id}/calendar`, { skipLiveMeeting: true });
    expect(second.status).toBe(409);

    const events = await db().select().from(schema.calendarEvents).where(eq(schema.calendarEvents.sessionId, session.id));
    expect(events).toHaveLength(1);
  });

  it('two concurrent schedule attempts for the same session never create two calendar events', async () => {
    const { session } = await cohortWithSession();
    const [r1, r2] = await Promise.all([
      api(admin).post(`/delivery-sessions/${session.id}/calendar`, { skipLiveMeeting: true }),
      api(admin).post(`/delivery-sessions/${session.id}/calendar`, { skipLiveMeeting: true })
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const events = await db().select().from(schema.calendarEvents).where(eq(schema.calendarEvents.sessionId, session.id));
    expect(events).toHaveLength(1);
  });

  it('can be rescheduled after cancellation, since sessionId has no unique constraint by design', async () => {
    const { session } = await cohortWithSession();
    const first = await api(admin).post(`/delivery-sessions/${session.id}/calendar`, { skipLiveMeeting: true });
    expect(first.status).toBe(201);
    const cancel = await api(admin).post(`/calendar-events/${first.data.id}/cancel`, {});
    expect(cancel.status).toBe(200);

    const rescheduled = await api(admin).post(`/delivery-sessions/${session.id}/calendar`, { skipLiveMeeting: true });
    expect(rescheduled.status, JSON.stringify(rescheduled.error)).toBe(201);

    const events = await db().select().from(schema.calendarEvents).where(eq(schema.calendarEvents.sessionId, session.id));
    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.status !== 'CANCELLED')).toHaveLength(1);
  });

  it('two concurrent reschedules of the same event both apply cleanly, serialized rather than interleaved', async () => {
    const { session } = await cohortWithSession();
    const created = await api(admin).post(`/delivery-sessions/${session.id}/calendar`, { skipLiveMeeting: true });
    expect(created.status).toBe(201);

    const [r1, r2] = await Promise.all([
      api(admin).post(`/calendar-events/${created.data.id}/reschedule`, { startsAt: '2027-02-02T09:00:00Z', endsAt: '2027-02-02T11:00:00Z' }),
      api(admin).post(`/calendar-events/${created.data.id}/reschedule`, { startsAt: '2027-02-03T09:00:00Z', endsAt: '2027-02-03T11:00:00Z' })
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Whichever committed last, the event's stored time must match exactly one of the two requested
    // times, not some torn mix of the two (no video provider is configured here, so there is no
    // external meeting to drift out of sync, but the serialization itself is what this asserts).
    const [row] = await db().select().from(schema.calendarEvents).where(eq(schema.calendarEvents.id, created.data.id));
    const times = [row.startsAt.toISOString(), row.endsAt.toISOString()];
    const matchesFirst = times[0] === '2027-02-02T09:00:00.000Z' && times[1] === '2027-02-02T11:00:00.000Z';
    const matchesSecond = times[0] === '2027-02-03T09:00:00.000Z' && times[1] === '2027-02-03T11:00:00.000Z';
    expect(matchesFirst || matchesSecond).toBe(true);
  });
});
