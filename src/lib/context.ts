import type { DbOrTx } from '@/db/client';
import type { Role } from '@/db/schema';

export type AuthUser = {
  id: string; email: string; name: string; role: Role; orgId: string | null;
  programmeIds: string[]; mfaEnabled: boolean; mfaVerified: boolean; sessionId: string; mustChangePassword: boolean; approvalStatus: string;
};
export type Ctx = {
  user: AuthUser | null;
  ip: string;
  requestId: string;
  db: DbOrTx;
  /** Work to run after the transaction commits (enqueue-kick, emails). */
  after: (fn: () => void | Promise<void>) => void;
};
export type AuthedCtx = Ctx & { user: AuthUser };
