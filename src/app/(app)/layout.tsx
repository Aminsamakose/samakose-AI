import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, loadSession } from '@/lib/session';
import { env } from '@/lib/env';
import { Shell } from '@/components/Shell';
import { photoUrl } from '@/services/auth';

export const dynamic = 'force-dynamic';

/** Every signed-in page passes through here: session, MFA and password gates are enforced on the server. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(COOKIE())?.value;
  const u = await loadSession(token);
  if (!u) redirect('/login');
  if (u.mfaEnabled && !u.mfaVerified) redirect('/mfa');
  if (u.mustChangePassword) redirect('/change-password');
  if (env.mfaRequiredRoles.includes(u.role) && !u.mfaEnabled) redirect('/mfa-setup');
  return <Shell user={{ name: u.name, role: u.role, email: u.email, photoUrl: photoUrl(u) }}>{children}</Shell>;
}
