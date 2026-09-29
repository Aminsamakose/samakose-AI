import { z } from 'zod';
import { CASE_STATES, EVIDENCE_CLASSES, ORG_TYPES, ROLES } from '@/db/schema';

export const uuid = z.string().uuid();
export const email = z.string().trim().toLowerCase().email().max(200);
export const name = z.string().trim().min(2, 'Enter at least 2 characters').max(160);
export const text = (min = 1, max = 2000) => z.string().trim().min(min, min > 1 ? `Enter at least ${min} characters` : 'This field is required').max(max);
export const optText = (max = 200) => z.string().trim().max(max).nullish().transform((v) => (v === undefined ? undefined : v ? v : null));
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
export const money = z.number().positive('Enter an amount above zero').max(100_000_000);
export const role = z.enum(ROLES);
export const caseState = z.enum(CASE_STATES);
export const evidenceClass = z.enum(EVIDENCE_CLASSES);
export const orgType = z.enum(ORG_TYPES);
export const password = z.string().min(1, 'Enter a password').max(200);
export const empty = z.object({}).passthrough();
