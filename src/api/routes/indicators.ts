import { z } from 'zod';
import { defineRoute, status } from '../framework';
import { INDICATOR_METRICS } from '@/db/schema';
import * as ind from '@/services/indicators';

const I = 'Programme indicators';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31');
const body = z.object({ name: z.string().trim().min(3).max(120), metric: z.enum(INDICATOR_METRICS), target: z.number().positive().max(100000), dueDate: isoDate.nullish(), note: z.string().trim().max(500).nullish() });
defineRoute({ method: 'GET', path: '/programmes/:id/indicators', tag: I, summary: 'Targets for a programme with live progress. Funders see values only where enough businesses stand behind them', permission: ['dashboard', 'read'], handler: ({ ctx, params }) => ind.listIndicators(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programmes/:id/indicators', tag: I, summary: 'Set a target for a programme', permission: ['programmes', 'edit'], body, handler: async ({ ctx, params, body }) => status(201, await ind.createIndicator(ctx, params.id, body as any)) });
defineRoute({ method: 'PATCH', path: '/indicators/:id', tag: I, summary: 'Change a target', permission: ['programmes', 'edit'], body: body.partial(), handler: ({ ctx, params, body }) => ind.updateIndicator(ctx, params.id, body as any) });
defineRoute({ method: 'DELETE', path: '/indicators/:id', tag: I, summary: 'Remove a target', permission: ['programmes', 'edit'], handler: ({ ctx, params }) => ind.deleteIndicator(ctx, params.id) });
