import type { Metadata } from 'next';
import { publicVerification } from '@/services/certificates';

export const metadata: Metadata = { title: 'Confirm a certificate', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
const fmt = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await publicVerification(id).catch(() => null);
  return <div className="mx-auto w-full max-w-xl px-4 py-16" style={{ display: 'grid', gap: 16 }}>
    <h1>Confirm a business health certificate</h1>
    {!v ? <div className="alert warn"><b>No shared certificate found.</b> The reference may be wrong, or the business has not agreed to share it. Ask the business to send you a fresh link.</div> : <>
      <div className={`alert ${v.status === 'Valid' ? 'ok' : 'warn'}`}><b>{v.status === 'Valid' ? 'This certificate is valid.' : v.status === 'Expired' ? 'This certificate has expired.' : 'This certificate has been revoked.'}</b></div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 16px', margin: 0 }}>
        <dt>Business</dt><dd>{v.organisation}</dd><dt>Level</dt><dd>{v.level}</dd>
        <dt>Issued</dt><dd>{fmt(v.issuedAt)}</dd><dt>{v.status === 'Revoked' ? 'Revoked' : 'Valid until'}</dt><dd>{fmt(v.status === 'Revoked' ? v.revokedAt : v.expiresAt)}</dd>
        <dt>Issued by</dt><dd>Samakose Accelerator Lab, Business Doctor</dd>
      </dl>
      <p className="small" style={{ opacity: 0.8 }}>This page confirms the level and dates only. It is not a credit decision or a guarantee, and it shows no scores or private records. The business decides whether to share it.</p>
    </>}
  </div>;
}
