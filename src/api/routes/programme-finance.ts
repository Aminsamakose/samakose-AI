import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as pf from '@/services/programme-finance';

const B = 'Programme budget';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31');
const money = z.number().positive('Enter an amount above zero').max(1_000_000_000);
const line = z.object({ category: z.string().trim().min(2).max(80), description: z.string().trim().max(300).nullish(), amountGhs: money });
const tranche = z.object({ label: z.string().trim().min(2).max(80), amountGhs: money, dueDate: isoDate.nullish(), note: z.string().trim().max(300).nullish() });
defineRoute({ method: 'GET', path: '/programmes/:id/budget', tag: B, summary: 'Budget lines, funder payment tranches and the position against the programme budget', permission: ['dashboard', 'read'], handler: ({ ctx, params }) => pf.overview(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programmes/:id/budget-lines', tag: B, summary: 'Add a budget line. Lines cannot exceed the programme budget', permission: ['programmes', 'edit'], body: line, handler: async ({ ctx, params, body }) => status(201, await pf.addLine(ctx, params.id, body as any)) });
defineRoute({ method: 'PATCH', path: '/budget-lines/:id', tag: B, summary: 'Change a budget line', permission: ['programmes', 'edit'], body: line.partial(), handler: ({ ctx, params, body }) => pf.updateLine(ctx, params.id, body as any) });
defineRoute({ method: 'DELETE', path: '/budget-lines/:id', tag: B, summary: 'Remove a budget line', permission: ['programmes', 'edit'], handler: ({ ctx, params }) => pf.removeLine(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programmes/:id/tranches', tag: B, summary: 'Plan a funder payment tranche. The schedule cannot exceed the programme budget', permission: ['programmes', 'edit'], body: tranche, handler: async ({ ctx, params, body }) => status(201, await pf.addTranche(ctx, params.id, body as any)) });
defineRoute({ method: 'PATCH', path: '/tranches/:id', tag: B, summary: 'Change a planned tranche', permission: ['programmes', 'edit'], body: tranche.partial(), handler: ({ ctx, params, body }) => pf.updateTranche(ctx, params.id, body as any) });
defineRoute({ method: 'POST', path: '/tranches/:id/receive', tag: B, summary: 'Record that a tranche was received', permission: ['programmes', 'edit'], body: z.object({ receivedOn: isoDate, receivedGhs: z.number().min(0).max(1_000_000_000) }), handler: ({ ctx, params, body }) => pf.receiveTranche(ctx, params.id, body) });
defineRoute({ method: 'DELETE', path: '/tranches/:id', tag: B, summary: 'Remove a planned tranche', permission: ['programmes', 'edit'], handler: ({ ctx, params }) => pf.removeTranche(ctx, params.id) });
