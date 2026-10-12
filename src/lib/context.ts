import type { DbOrTx } from '@/db/client';
import type { Role } from '@/db/schema';

export type AuthUser = {
  // `role` is what every permission check reads: the role this session is currently acting as.
  // `primaryRole` is the person's own users.role, unaffected by switching -- used only by the
  // role-switch UI/endpoints to know what "switch back" means. Everything else should keep
  // reading `role`, exactly as before this field existed.
  id: string; email: string; name: string; role: Role; primaryRole: Role; orgId: string | null;
  programmeIds: string[]; mfaEnabled: boolean; mfaVerified: boolean; sessionId: string; mustChangePassword: boolean; approvalStatus: string; profileRequired: boolean;
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
