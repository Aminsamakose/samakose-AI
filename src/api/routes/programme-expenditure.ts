import { z } from 'zod';
import { defineRoute, status } from '../framework';
import { EVIDENCE_CLASSES } from '@/db/schema';
import * as exp from '@/services/programme-expenditure';

const E = 'Programme expenditure';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31');
const evidenceClass = z.enum(EVIDENCE_CLASSES);

const txBody = z.object({
  budgetLineId: z.string().uuid().nullish(),
  cohortId: z.string().uuid().nullish(),
  payee: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(120),
  purpose: z.string().trim().max(500).nullish(),
  amountGhs: z.number().positive().max(10_000_000),
  date: isoDate,
  reference: z.string().trim().max(120).nullish(),
  evidenceClass: evidenceClass.optional(),
  evidenceRef: z.string().trim().max(500).nullish(),
});
const paymentBody = txBody.extend({ settlesCommitmentId: z.string().uuid().nullish() });

defineRoute({ method: 'GET', path: '/programmes/:id/expenditure', tag: E, summary: 'Approved budget, committed, actual expenditure and what remains', permission: ['dashboard', 'read'], handler: ({ ctx, params }) => exp.overview(ctx, params.id) });
defineRoute({ method: 'GET', path: '/programmes/:id/expenditure/transactions', tag: E, summary: 'List commitments, payments and reversals for a programme', permission: ['dashboard', 'read'], handler: ({ ctx, params }) => exp.listTransactions(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programmes/:id/expenditure/commitments', tag: E, summary: 'Record an approved spend not yet paid', permission: ['programmes', 'edit'], body: txBody, handler: async ({ ctx, params, body }) => status(201, await exp.recordCommitment(ctx, params.id, body as any)) });
defineRoute({ method: 'POST', path: '/programmes/:id/expenditure/payments', tag: E, summary: 'Record money actually paid out, optionally settling a commitment', permission: ['programmes', 'edit'], body: paymentBody, handler: async ({ ctx, params, body }) => status(201, await exp.recordPayment(ctx, params.id, body as any)) });
defineRoute({ method: 'POST', path: '/expenditure-transactions/:id/reverse', tag: E, summary: 'Reverse a commitment or payment, preserving the original', permission: ['programmes', 'edit'], body: z.object({ reason: z.string().trim().min(3).max(1000) }), handler: async ({ ctx, params, body }) => status(201, await exp.reverseTransaction(ctx, params.id, body as any)) });
