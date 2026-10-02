'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, dateFmt } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, KV, Modal, PageHead, useApi, useForm, useToast } from '@/components/ui';
import { OrgForm, type OrgRow } from '@/components/portfolio/OrgForm';
import { typeLabel, usePerms, useTitle } from '@/components/portfolio/shared';

type Org = OrgRow & { code: string; consentAt: string | null; createdAt: string; caseCount: number; cases: { id: string; code: string; status: string; programmeId: string | null }[]; users: { id: string; name: string; email: string; active: boolean }[] };
type Prog = { id: string; name: string; status: string };
type ProgDetail = { cohorts: { id: string; name: string; status: string; capacity: number; enrolled: number }[] };
const STARTS = [['PROSPECT', 'Prospect'], ['ONBOARDING', 'Onboarding'], ['PROFILED', 'Profiled']];

function NewCase({ org, onClose }: { org: Org; onClose: () => void }) {
  const router = useRouter();
  const { can } = usePerms();
  const progs = useApi<{ items: Prog[] }>(can('programmes', 'read') ? '/programmes?pageSize=100' : null);
  const form = useForm({ programmeId: '', cohortId: '', startState: 'PROSPECT' }, (v) => api.post('/cases', { orgId: org.id, programmeId: v.programmeId || null, cohortId: v.cohortId || null, startState: v.startState }), { onDone: (r) => router.push(`/cases/${r.id}`), success: 'Case opened' });
  const detail = useApi<ProgDetail>(form.values.programmeId ? `/programmes/${form.values.programmeId}` : null);
  const e = form.errors;
  return <form onSubmit={form.onSubmit} className="stack" noValidate>
    <FormError message={form.formError} />
    <p className="muted small">A case is the diagnostic record for {org.name}. The organisation must have recorded consent.</p>
    <Field label="Programme (optional)" name="programmeId" error={e.programmeId}>{(p) => <select {...p} value={form.values.programmeId} onChange={(ev) => { form.set('programmeId', ev.target.value); form.set('cohortId', ''); }}><option value="">No programme</option>{(progs.data?.items ?? []).filter((x) => ['Draft', 'Active'].includes(x.status)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</Field>
    {form.values.programmeId && <Field label="Cohort (optional)" name="cohortId" error={e.cohortId}>{(p) => <select {...p} {...form.input('cohortId')}><option value="">No cohort</option>{(detail.data?.cohorts ?? []).filter((c) => c.status !== 'Closed').map((c) => <option key={c.id} value={c.id}>{c.name} ({c.enrolled} of {c.capacity})</option>)}</select>}</Field>}
    <Field label="Start state" name="startState" error={e.startState}>{(p) => <select {...p} {...form.input('startState')}>{STARTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={form.busy}>Open case</Button><Button type="button" onClick={onClose}>Cancel</Button></div>
  </form>;
}

export default function OrganisationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter(); const toast = useToast();
  const { can, role } = usePerms();
  const st = useApi<Org>(`/organisations/${id}`);
  const [editing, setEditing] = useState(false); const [newCase, setNewCase] = useState(false);
  useTitle(st.data?.name ?? 'Organisation');
  return <Async state={st}>{(o) => {
    const ownerOnly = role === 'OWNER';
    const archived = o.status === 'Archived';
    return <div className="stack">
      <PageHead crumbs={<Link href="/organisations">Organisations</Link>} title={o.name} sub={<><span className="mono">{o.code}</span> · {typeLabel(o.type)} · <Badge>{o.status}</Badge></>}
        actions={<>
          {can('scores', 'read') && role !== 'FUNDER' && <Link href={`/organisations/${o.id}/record`} className="btn">Health record</Link>}
          {can('cases', 'create') && !archived && <Button variant="primary" onClick={() => setNewCase(true)}>Open a new case</Button>}
          {can('organisations', 'edit') && !editing && !archived && <Button onClick={() => setEditing(true)}>Edit</Button>}
          {can('organisations', 'delete') && !archived && <ConfirmButton variant="danger" label="Archive organisation" message="This removes the organisation from lists. Its records stay in the audit trail. Organisations with cases that are not graduated cannot be archived." onConfirm={async () => { await api.del(`/organisations/${o.id}`); toast('Organisation archived'); router.push('/organisations'); }} />}
        </>} />
      {editing ? <Card title="Edit organisation"><OrgForm org={o} ownerOnly={ownerOnly} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); st.reload(); }} /></Card> :
        <Card title="Profile"><KV items={[['Sector', o.sector], ['Region', o.region], ['District', o.district], ['Size', o.size], ['Contact person', o.contactName], ['Contact email', o.contactEmail ? <a href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a> : null], ['Contact phone', o.contactPhone], ['Consent recorded', o.consentAt ? dateFmt(o.consentAt) : 'Not recorded'], ['Registered', dateFmt(o.createdAt)]]} /></Card>}
      <Card title={`Cases (${o.cases.length})`}>
        {o.cases.length === 0 ? <Empty title="No cases yet" hint={can('cases', 'create') ? 'Open a case to start the diagnostic for this organisation.' : undefined} /> :
          <div className="table-wrap"><table><thead><tr><th>Case</th><th>State</th></tr></thead><tbody>{o.cases.map((c) => <tr key={c.id}><td>{can('cases', 'read') ? <Link href={`/cases/${c.id}`} className="mono">{c.code}</Link> : <span className="mono">{c.code}</span>}</td><td><Badge>{c.status}</Badge></td></tr>)}</tbody></table></div>}
      </Card>
      {role === 'ADMIN' && <Card title={`Users (${o.users.length})`}>
        {o.users.length === 0 ? <Empty title="No user accounts" hint="Business owner accounts linked to this organisation appear here." /> :
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead><tbody>{o.users.map((u) => <tr key={u.id}><td>{u.name}</td><td><a href={`mailto:${u.email}`}>{u.email}</a></td><td><Badge tone={u.active ? 'ok' : 'bad'}>{u.active ? 'Active' : 'Inactive'}</Badge></td></tr>)}</tbody></table></div>}
      </Card>}
      <Modal open={newCase} onClose={() => setNewCase(false)} title="Open a new case"><NewCase org={o} onClose={() => setNewCase(false)} /></Modal>
    </div>;
  }}</Async>;
}
