import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, need } from './common';

const events = schema.notificationEvents;
const notifications = schema.notifications;
const deliveries = schema.notificationDeliveries;
const preferences = schema.notificationPreferences;
const templates = schema.notificationTemplates;
const programmes = schema.programmes;
const cohorts = schema.cohorts;

async function programmeFor(ctx: Ctx, programmeId: string) {
  const [row] = await ctx.db.select().from(programmes).where(eq(programmes.id, programmeId)).limit(1);
  if (!row) throw notFound('Programme not found');
  await assertProgramme(ctx, programmeId);
  return row;
}

async function scope(ctx: Ctx, programmeId?: string | null, cohortId?: string | null) {
  if (programmeId) await programmeFor(ctx, programmeId);
  if (cohortId) {
    const [cohort] = await ctx.db.select().from(cohorts).where(eq(cohorts.id, cohortId)).limit(1);
    if (!cohort) throw notFound('Cohort not found');
    await assertProgramme(ctx, cohort.programmeId);
    if (programmeId && cohort.programmeId !== programmeId) throw unprocessable('Cohort does not belong to this programme');
  }
}

export async function listNotifications(ctx: Ctx, status?: string) {
  const userId = need(ctx).user.id;
  allow(ctx, 'programme_workspaces', 'read');
  const where = status ? and(eq(notifications.recipientUserId, userId), eq(notifications.status, status)) : eq(notifications.recipientUserId, userId);
  return ctx.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt));
}

export async function markNotificationRead(ctx: Ctx, id: string) {
  const userId = need(ctx).user.id;
  allow(ctx, 'programme_workspaces', 'read');
  const [row] = await ctx.db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.recipientUserId, userId))).limit(1);
  if (!row) throw notFound('Notification not found');
  await ctx.db.update(notifications).set({ status: 'READ', readAt: new Date(), updatedAt: new Date() }).where(eq(notifications.id, id));
  await audit(ctx, 'notification.read', 'notification', id, { status: row.status }, { status: 'READ' });
  return { ok: true };
}

export async function createEvent(ctx: Ctx, input: { programmeId?: string | null; cohortId?: string | null; eventType: string; entityType: string; entityId?: string | null; payload?: unknown }) {
  allow(ctx, 'programme_workspaces', 'edit');
  await scope(ctx, input.programmeId, input.cohortId);
  const [row] = await ctx.db.insert(events).values({
    programmeId: input.programmeId ?? null, cohortId: input.cohortId ?? null, eventType: input.eventType,
    entityType: input.entityType, entityId: input.entityId ?? null, payload: input.payload ?? {}, createdBy: need(ctx).user.id,
  }).returning();
  await audit(ctx, 'notification.event.created', 'notification_event', row.id, undefined, { eventType: row.eventType, programmeId: row.programmeId, cohortId: row.cohortId });
  return row;
}

export async function sendNotification(ctx: Ctx, input: { recipientUserId: string; programmeId?: string | null; cohortId?: string | null; channel?: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP'; eventId?: string | null; templateKey?: string | null; subject?: string | null; body: string; metadata?: unknown }) {
  allow(ctx, 'programme_workspaces', 'edit');
  await scope(ctx, input.programmeId, input.cohortId);
  if (!input.body.trim()) throw unprocessable('Notification body is required');
  const channel = input.channel ?? 'IN_APP';
  const [pref] = await ctx.db.select().from(preferences).where(and(eq(preferences.userId, input.recipientUserId), input.programmeId ? eq(preferences.programmeId, input.programmeId) : isNull(preferences.programmeId), eq(preferences.channel, channel))).limit(1);
  if (pref?.enabled === 'false') return { skipped: true, reason: 'recipient_preference_disabled' };
  const [notification] = await ctx.db.insert(notifications).values({
    recipientUserId: input.recipientUserId, programmeId: input.programmeId ?? null, cohortId: input.cohortId ?? null,
    channel, eventId: input.eventId ?? null, templateKey: input.templateKey ?? null, subject: input.subject ?? null,
    body: input.body.trim(), status: 'PENDING', metadata: input.metadata ?? {},
  }).returning();
  const [delivery] = await ctx.db.insert(deliveries).values({ notificationId: notification.id, channel, status: channel === 'IN_APP' ? 'DELIVERED' : 'QUEUED', deliveredAt: channel === 'IN_APP' ? new Date() : null }).returning();
  if (channel === 'IN_APP') await ctx.db.update(notifications).set({ status: 'DELIVERED', sentAt: new Date(), updatedAt: new Date() }).where(eq(notifications.id, notification.id));
  await audit(ctx, 'notification.created', 'notification', notification.id, undefined, { recipientUserId: input.recipientUserId, channel, deliveryId: delivery.id });
  return { notification, delivery };
}

export async function listProgrammeNotifications(ctx: Ctx, programmeId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await programmeFor(ctx, programmeId);
  return ctx.db.select().from(notifications).where(eq(notifications.programmeId, programmeId)).orderBy(desc(notifications.createdAt));
}

export async function upsertPreference(ctx: Ctx, input: { userId: string; programmeId?: string | null; channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP'; enabled: boolean }) {
  allow(ctx, 'programme_workspaces', 'edit');
  await scope(ctx, input.programmeId, null);
  const existing = await ctx.db.select().from(preferences).where(and(eq(preferences.userId, input.userId), input.programmeId ? eq(preferences.programmeId, input.programmeId) : isNull(preferences.programmeId), eq(preferences.channel, input.channel))).limit(1);
  if (existing[0]) {
    const [row] = await ctx.db.update(preferences).set({ enabled: input.enabled ? 'true' : 'false', updatedAt: new Date() }).where(eq(preferences.id, existing[0].id)).returning();
    return row;
  }
  const [row] = await ctx.db.insert(preferences).values({ userId: input.userId, programmeId: input.programmeId ?? null, channel: input.channel, enabled: input.enabled ? 'true' : 'false' }).returning();
  return row;
}

export async function listTemplates(ctx: Ctx, programmeId?: string | null) {
  allow(ctx, 'programme_workspaces', 'read');
  if (programmeId) await programmeFor(ctx, programmeId);
  return ctx.db.select().from(templates).where(programmeId ? eq(templates.programmeId, programmeId) : isNull(templates.programmeId)).orderBy(asc(templates.key));
}
