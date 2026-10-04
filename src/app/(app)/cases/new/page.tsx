'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiFail } from '@/lib/client/api';
import { Button, Card, Empty, ErrorState, Field, FormError, Loading, Modal, PageHead, useApi, useForm } from '@/components/ui';
import { NewOrgForm } from '@/components/case/core/NewOrgForm';
import { useMe } from '@/components/case/core/shared';

type Org = { id: string; code: string; name: string; region?: string | null; consentAt?: string | null };
const STARTS = [
  { v: 'PROFILED', l: 'Profiled (business profile is complete, ready for the diagnostic)' },
  { v: 'ONBOARDING', l: 'Onboarding (profile still being collected)' },
  { v: 'PROSPECT', l: 'Prospect (first contact only)' }
];

export default function NewCasePage() {
  useEffect(() => { document.title = 'New case | Business Doctor by Samakose'; }, []);
  const router = useRouter();
  const { can, ready, me, error: meError, loading: meLoading } = useMe();
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [added, setAdded] = useState<Org[]>([]);
  const [modal, setModal] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const orgs = useApi<{ items: Org[] }>(ready && can('organisations', 'read') ? `/organisations?pageSize=50&sort=name&dir=asc${dq ? `&q=${encodeURIComponent(dq)}` : ''}` : null);
  const progs = useApi<{ items: { id: string; name: string; status: string }[] }>(ready && can('programmes', 'read') ? '/programmes?pageSize=100&sort=name&dir=asc' : null);

  const f = useForm({ orgId: '', programmeId: '', cohortId: '', startState: 'PROFILED' }, async (v) => {
    if (!v.orgId) throw new ApiFail(422, 'validation', 'Choose the organisation for this case', { orgId: 'Choose an organisation' });
    if (me?.role === 'PROGRAMME_MANAGER' && !v.programmeId) throw new ApiFail(422, 'validation', 'Choose one of your programmes', { programmeId: 'Choose a programme' });
    if (v.cohortId && !v.programmeId) throw new ApiFail(422, 'validation', 'Choose the programme first', { cohortId: 'Choose the programme for this cohort first' });
    return api.post<{ id: string }>('/cases', { orgId: v.orgId, programmeId: v.programmeId || null, cohortId: v.cohortId || null, startState: v.startState });
  }, { onDone: (r) => router.push(`/cases/${r.id}`), success: 'Case opened' });

  const prog = useApi<{ cohorts: { id: string; name: string; status: string; capacity: number; enrolled: number }[] }>(f.values.programmeId ? `/programmes/${f.values.programmeId}` : null);
  const list = [...added, ...(orgs.data?.items ?? []).filter((o) => !added.some((a) => a.id === o.id))];
  const selected = list.find((o) => o.id === f.values.orgId);
  const activeProgs = (progs.data?.items ?? []).filter((p) => !['Completed', 'Cancelled'].includes(p.status));
  const openCohorts = (prog.data?.cohorts ?? []).filter((c) => c.status !== 'Closed');

  if (meLoading && !ready) return <Loading />;
  if (meError && !ready) return <ErrorState message={meError} />;
  if (!can('cases', 'create')) return <div className="stack"><PageHead title="New case" /><Empty title="You cannot open cases" hint="Your role does not include opening cases. Ask a consultant or administrator." /></div>;

  return <div className="stack">
    <PageHead title="New case" crumbs={<Link href="/cases">Cases</Link>} sub="Open a case for an organisation. The organisation must have recorded consent." />
    <Card>
      <form onSubmit={f.onSubmit} className="stack" noValidate>
        <FormError message={f.formError} />
        {can('organisations', 'read') && <div className="stack">
          <Field label="Find an organisation" name="orgSearch" hint="Type part of a name or code to narrow the list">{(p) => <input {...p} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          <Field label="Organisation" name="orgId" required error={f.errors.orgId}>{(p) => (
            <select {...p} {...f.input('orgId')}>
              <option value="">{orgs.loading && !orgs.data ? 'Loading organisations' : list.length ? 'Choose an organisation' : 'No organisations found'}</option>
              {list.map((o) => <option key={o.id} value={o.id}>{o.name}{o.region ? ` (${o.region})` : ''} - {o.code}</option>)}
            </select>)}</Field>
          <div aria-live="polite">{orgs.error && <div className="alert bad" role="alert">{orgs.error}</div>}
            {selected && selected.consentAt === null && <div className="alert warn">This organisation has no recorded consent, so a case cannot be opened for it yet.</div>}</div>
          {can('organisations', 'create') && <div><Button type="button" onClick={() => setModal(true)}>Register a new organisation</Button></div>}
        </div>}
        <div className="form-grid">
          {can('programmes', 'read') && <Field label={me?.role === 'PROGRAMME_MANAGER' ? 'Programme' : 'Programme (optional)'} name="programmeId" required={me?.role === 'PROGRAMME_MANAGER'} error={f.errors.programmeId}>{(p) => (
            <select {...p} value={f.values.programmeId} onChange={(e) => { f.set('programmeId', e.target.value); f.set('cohortId', ''); }}>
              <option value="">{me?.role === 'PROGRAMME_MANAGER' ? 'Choose a programme' : 'No programme'}</option>{activeProgs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>)}</Field>}
          {f.values.programmeId && <Field label="Cohort (optional)" name="cohortId" error={f.errors.cohortId} hint={prog.loading ? 'Loading cohorts' : openCohorts.length ? undefined : 'This programme has no open cohorts'}>{(p) => (
            <select {...p} {...f.input('cohortId')}><option value="">No cohort</option>{openCohorts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.enrolled} of {c.capacity} places used)</option>)}</select>)}</Field>}
          <Field label="Start state" name="startState" error={f.errors.startState} hint="Most cases start as Profiled. Earlier states move forward with a confirm step.">{(p) => (
            <select {...p} {...f.input('startState')}>{STARTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>)}</Field>
        </div>
        <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy} disabled={selected?.consentAt === null}>Open case</Button><Button type="button" onClick={() => router.push('/cases')}>Cancel</Button></div>
      </form>
    </Card>
    <Modal open={modal} onClose={() => setModal(false)} title="Register a new organisation">
      <NewOrgForm onCancel={() => setModal(false)} onCreated={(o) => { setAdded((a) => [{ id: o.id, code: o.code, name: o.name, consentAt: new Date().toISOString() }, ...a]); f.set('orgId', o.id); setModal(false); }} />
    </Modal>
  </div>;
}
