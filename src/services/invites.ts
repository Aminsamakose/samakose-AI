import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { sha256 } from '@/lib/crypto';

/** A withdrawn invitation keeps its row, with a different kind, so the link can say "withdrawn" instead of a vague "invalid". An email already delivered cannot be recalled; the link inside it can be made dead. */
export const WITHDRAWN = 'invite_withdrawn';
export const WITHDRAWN_MESSAGE = 'This invitation was withdrawn. Please contact the person who invited you.';

export async function withdrawInviteLinks(db: Ctx['db'], userId: string) {
  await db.update(schema.userTokens).set({ kind: WITHDRAWN })
    .where(and(eq(schema.userTokens.userId, userId), eq(schema.userTokens.kind, 'invite'), isNull(schema.userTokens.usedAt)));
}

export async function wasWithdrawn(db: Ctx['db'], token: string) {
  const [t] = await db.select({ id: schema.userTokens.id }).from(schema.userTokens)
    .where(and(eq(schema.userTokens.tokenHash, sha256(token)), eq(schema.userTokens.kind, WITHDRAWN))).limit(1);
  return !!t;
}

/** Someone who was invited, never set a password, and whose invitation was withdrawn. Their record is kept (history stays whole) and can be reused if they are invited again. */
export const isWithdrawnInvitee = (u: { active: boolean; passwordHash: string | null }) => !u.active && !u.passwordHash;
