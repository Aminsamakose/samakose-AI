import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeUser, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { requiredApproverRole } from '@/services/approvals';
import { need } from '@/services/common';
import type { Ctx } from '@/lib/context';

let admin: Session, finance: Session, executive: Session, requester: Session;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE'); requester = await makeUser('FINANCE');
});

const fakeCtx = { db: db(), user: null, ip: '127.0.0.1', requestId: 'test', after: () => {} } as unknown as Ctx;

describe('Approval Matrix thresholds', () => {
  it('routes below the senior band to Standard', async () => {
    expect(await requiredApproverRole(fakeCtx, 'DISCOUNT_EXCEPTION', 5)).toBe('Standard');
  });
  it('routes at/above the senior band to FINANCE, below executive', async () => {
    expect(await requiredApproverRole(fakeCtx, 'DISCOUNT_EXCEPTION', 10)).toBe('FINANCE');
    expect(await requiredApproverRole(fakeCtx, 'REVENUE_SHARE_OVERRIDE', 24)).toBe('FINANCE');
  });
  it('routes at/above the executive band to EXECUTIVE', async () => {
    expect(await requiredApproverRole(fakeCtx, 'DISCOUNT_EXCEPTION', 25)).toBe('EXECUTIVE');
    expect(await requiredApproverRole(fakeCtx, 'PAYOUT', 15000)).toBe('EXECUTIVE');
  });
  it('an action type with no configured threshold always routes to Standard', async () => {
    expect(await requiredApproverRole(fakeCtx, 'LEDGER_ADJUSTMENT', 999999)).toBe('Standard');
    expect(await requiredApproverRole(fakeCtx, 'CONTRACT', undefined)).toBe('Standard');
  });
  it('a refund is routed by its percentage of invoice, like a discount', async () => {
    expect(await requiredApproverRole(fakeCtx, 'REFUND', 5)).toBe('Standard');
    expect(await requiredApproverRole(fakeCtx, 'REFUND', 10)).toBe('FINANCE');
    expect(await requiredApproverRole(fakeCtx, 'REFUND', 25)).toBe('EXECUTIVE');
  });
  it('a missing metric routes to Standard even for a thresholded action type', async () => {
    expect(await requiredApproverRole(fakeCtx, 'PAYOUT', undefined)).toBe('Standard');
  });
});

describe('approval requests: routing and lifecycle', () => {
  it('opens a request and routes it per the matrix', async () => {
    const r = await api(requester).post('/approvals', { actionType: 'DISCOUNT_EXCEPTION', referenceId: crypto.randomUUID(), metric: 30 });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.status).toBe('Pending');
    expect(r.data.requiredApproverRole).toBe('EXECUTIVE');
  });
  it('a request below any band has no required role recorded (Standard)', async () => {
    const r = await api(requester).post('/approvals', { actionType: 'REVENUE_SHARE_OVERRIDE', referenceId: crypto.randomUUID(), metric: 2 });
    expect(r.status).toBe(201);
    expect(r.data.requiredApproverRole).toBeNull();
  });
  it('lists requests, optionally filtered by status/action type', async () => {
    const id = (await api(requester).post('/approvals', { actionType: 'PAYOUT', referenceId: crypto.randomUUID(), amountGhs: 500 })).data.id as string;
    const list = (await api(admin).get('/approvals?actionType=PAYOUT')).data as any[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((row) => row.id === id)).toBe(true);
    expect(list.every((row) => row.actionType === 'PAYOUT')).toBe(true);
  });
});

describe('four-eyes: app-level and database-level', () => {
  it('the requester cannot decide their own request (app-level 403)', async () => {
    const id = (await api(requester).post('/approvals', { actionType: 'DISCOUNT_EXCEPTION', referenceId: crypto.randomUUID(), metric: 50 })).data.id as string;
    expect((await api(requester).post(`/approvals/${id}/decide`, { decision: 'Approved' })).status).toBe(403);
  });
  it('a required-tier request can only be decided by that tier (or an admin)', async () => {
    const id = (await api(requester).post('/approvals', { actionType: 'DISCOUNT_EXCEPTION', referenceId: crypto.randomUUID(), metric: 50 })).data.id as string;
    // finance.id and requester.id may collide in role but requester was built as its own FINANCE session;
    // the required tier here is EXECUTIVE, so a plain finance user (not executive, not admin) is refused.
    expect((await api(finance).post(`/approvals/${id}/decide`, { decision: 'Approved' })).status).toBe(403);
    const ok = await api(executive).post(`/approvals/${id}/decide`, { decision: 'Approved', reason: 'Within policy' });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(ok.data.request.status).toBe('Approved');
  });
  it('a decided request cannot be decided again (409)', async () => {
    const id = (await api(requester).post('/approvals', { actionType: 'PAYOUT', referenceId: crypto.randomUUID(), amountGhs: 200 })).data.id as string;
    expect((await api(admin).post(`/approvals/${id}/decide`, { decision: 'Approved' })).status).toBe(200);
    expect((await api(admin).post(`/approvals/${id}/decide`, { decision: 'Rejected' })).status).toBe(409);
  });
  it('the database trigger rejects a self-approval even when written directly, bypassing the service', async () => {
    const [req] = await db().insert(schema.approvalRequests).values({ actionType: 'CONTRACT', referenceId: crypto.randomUUID(), requestedBy: admin.userId, status: 'Pending' }).returning();
    await expect(
      db().insert(schema.approvalDecisions).values({ requestId: req.id, decision: 'Approved', decidedBy: admin.userId })
    ).rejects.toThrow();
  });
});

describe('conflict-of-interest checks', () => {
  it('records a CLEAR or BLOCKED check, auditable independent of enforcement', async () => {
    const r = await api(admin).post('/conflict-checks', { userId: requester.userId, contextType: 'REVENUE_SHARE_APPROVAL', referenceId: crypto.randomUUID(), result: 'BLOCKED', reason: 'Approver is also the proposed professional' });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.result).toBe('BLOCKED');
    const [row] = await db().select().from(schema.conflictChecks).where(eq(schema.conflictChecks.id, r.data.id)).limit(1);
    expect(row?.reason).toContain('also the proposed professional');
  });
});
