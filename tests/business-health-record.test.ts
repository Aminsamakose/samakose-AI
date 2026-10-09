import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { answerSheet, api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let admin: Session;
let recordId: string;
let orgId: string;

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
});

describe('Business Health Record migration', () => {
  it('backfills source references and captures future changes without copying source facts', async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile('migrations/0049_business_health_record.sql', 'utf8');

    expect(sql).toContain('create table if not exists public.business_health_records');
    expect(sql).toContain('create table if not exists public.business_health_record_events');
    expect(sql).toContain('on conflict (record_id, source_type, source_id, event_type, occurred_at) do nothing');
    expect(sql).toContain('business_health_record_events_append_only');
    for (const trigger of [
      'bhr_org_source_event', 'bhr_case_source_event', 'bhr_diagnostic_source_event',
      'bhr_score_source_event', 'bhr_prescription_source_event', 'bhr_intervention_source_event',
      'bhr_evidence_source_event', 'bhr_document_source_event', 'bhr_kpi_reading_source_event',
      'bhr_certificate_source_event', 'bhr_opportunity_referral_event_source_event'
    ]) expect(sql).toContain(`create trigger ${trigger}`);
    expect(sql).toContain('source facts remain authoritative in their existing tables');
  });
});

describe('first-class Business Health Record', () => {
  it('creates a stable organisation anchor and appends linked source events through a diagnostic and score', async () => {
    const org = await makeOrg(admin);
    orgId = org.id;

    const [before] = await db().select().from(schema.businessHealthRecords)
      .where(eq(schema.businessHealthRecords.orgId, org.id)).limit(1);
    expect(before).toBeTruthy();
    recordId = before.id;

    const [created] = await db().select().from(schema.businessHealthRecordEvents)
      .where(eq(schema.businessHealthRecordEvents.recordId, recordId));
    expect(created.eventType).toBe('ORGANISATION_CREATED');
    expect(created.sourceType).toBe('organisations');
    expect(created.sourceId).toBe(org.id);

    const c = await api(admin).post('/cases', { orgId: org.id });
    expect(c.status).toBe(201);
    const owner = await makeUser('OWNER', { orgId: org.id });
    const result = await api(owner).post(`/cases/${c.data.id}/diagnostics`, {
      answers: await answerSheet(2, 'Self-reported'),
      uuid: `bhr-${uniq()}`
    });
    expect(result.status).toBe(201);

    const [after] = await db().select().from(schema.businessHealthRecords)
      .where(eq(schema.businessHealthRecords.orgId, org.id)).limit(1);
    expect(after.id).toBe(recordId);
    expect(after.recordVersion).toBeGreaterThan(before.recordVersion);
    expect(after.firstAssessedAt).toBeTruthy();

    const record = await api(admin).get(`/organisations/${org.id}/record`);
    expect(record.status).toBe(200);
    expect(record.data.record.id).toBe(recordId);
    expect(record.data.timeline.some((e: any) => e.eventType === 'CASE_OPENED')).toBe(true);
    expect(record.data.timeline.some((e: any) => e.eventType === 'DIAGNOSTIC_SUBMITTED')).toBe(true);
    expect(record.data.timeline.some((e: any) => e.eventType === 'SCORE_COMPUTED')).toBe(true);
  });

  it('keeps the event ledger append-only', async () => {
    const [event] = await db().select().from(schema.businessHealthRecordEvents)
      .where(eq(schema.businessHealthRecordEvents.recordId, recordId)).limit(1);
    expect(event).toBeTruthy();
    await expect(db().update(schema.businessHealthRecordEvents).set({ summary: 'tampered' })
      .where(eq(schema.businessHealthRecordEvents.id, event.id))).rejects.toThrow();
    await expect(db().delete(schema.businessHealthRecordEvents)
      .where(eq(schema.businessHealthRecordEvents.id, event.id))).rejects.toThrow();

    const record = await api(admin).get(`/organisations/${orgId}/record`);
    expect(record.data.timeline.some((e: any) => e.id === event.id && e.summary !== 'tampered')).toBe(true);
  });
});
