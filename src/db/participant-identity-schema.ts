/**
 * The person-level participant record the funder-accountability gap register (GAP 02) found
 * missing. `programmeParticipants` (programme-workspace-schema.ts) is an enterprise's enrolment
 * in a programme -- one row per (programme, organisation), see its unique index. It has no room
 * for who the actual human beings behind that enterprise are: an owner, a manager, a delegate who
 * attends on the owner's behalf. Funders routinely need to count and report on individuals, not
 * just enrolled businesses, and the same person may represent more than one enterprise (a
 * cooperative officer across several member businesses) while one enterprise may put forward more
 * than one person (owner plus a co-manager).
 *
 * `participants` is the person identity, independent of any one enrolment. `programmeParticipantPeople`
 * is the many-to-many link to a specific enrolment, carrying the role that person plays for that
 * enrolment -- so a merge/duplicate workflow for people (if ever needed) touches one small table
 * and a join, not every service that currently reads `programmeParticipants`.
 */
import { boolean, text, timestamp, uuid, index, uniqueIndex, pgTable, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { programmeParticipants } from './programme-workspace-schema';
import { users } from './schema';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

export const participants = pgTable('participants', {
  id: id(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  email: text('email'),
  // "This looks like the same person as an existing record" -- set by an authorised merge, never
  // written to directly. Mirrors organisations.mergedInto (schema.ts) so the same review/merge
  // pattern applies to people as to enterprises: nothing is deleted, the record just points on.
  mergedInto: uuid('merged_into'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('participant_name_idx').on(t.fullName),
  index('participant_phone_idx').on(t.phone),
]);

export const PARTICIPANT_ROLES = ['OWNER', 'MANAGER', 'DELEGATE', 'OTHER'] as const;

export const programmeParticipantPeople = pgTable('programme_participant_people', {
  id: id(),
  programmeParticipantId: uuid('programme_participant_id').notNull().references(() => programmeParticipants.id, { onDelete: 'cascade' }),
  participantId: uuid('participant_id').notNull().references(() => participants.id),
  role: text('role').notNull().default('OWNER'),
  // Exactly one person per enrolment should read as "the" contact on a list view; enforced in the
  // service layer (set true on the first person added, otherwise explicit) rather than a DB
  // constraint, since "exactly one primary" needs a partial-unique-index-on-write that the ORM
  // here doesn't manage declaratively elsewhere either (see organisations' single contact fields).
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: created(),
}, (t) => [
  uniqueIndex('programme_participant_people_uq').on(t.programmeParticipantId, t.participantId),
  index('programme_participant_people_participant_idx').on(t.participantId),
  check('programme_participant_people_role_ck', sql`${t.role} in ('OWNER','MANAGER','DELEGATE','OTHER')`),
]);
