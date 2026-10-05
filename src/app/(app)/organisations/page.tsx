'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, DataTable, Modal, PageHead, Button, type Col } from '@/components/ui';
import { OrgForm, type OrgRow } from '@/components/portfolio/OrgForm';
import { REGIONS, ORG_TYPES, typeLabel, usePerms, useTitle } from '@/components/portfolio/shared';

type Row = OrgRow & { code: string; caseCount: number };

export default function OrganisationsPage() {
  useTitle('Organisations');
  const router = useRouter();
  const { can, ready } = usePerms();
  const [region, setRegion] = useState(''); const [type, setType] = useState(''); const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const cols: Col<Row>[] = [
    { key: 'name', label: 'Organisation', sort: 'name', render: (r) => <>{r.name}</> },
    { key: 'code', label: 'Code', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'type', label: 'Type', sort: 'type', render: (r) => typeLabel(r.type) },
    { key: 'sector', label: 'Sector' },
    { key: 'region', label: 'Region', sort: 'region', render: (r) => <>{r.region ?? '-'}{r.district ? `, ${r.district}` : ''}</> },
    { key: 'contactName', label: 'Contact', render: (r) => <>{(r as any).contactHidden ? <span className="muted">Restricted</span> : r.contactName ?? '-'}</> },
    { key: 'caseCount', label: 'Cases', align: 'r', render: (r) => <span className="num">{r.caseCount}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> }
  ];
  const toolbar = <>
    <div><label className="sr" htmlFor="f-region">Region</label><select id="f-region" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All regions</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
    <div><label className="sr" htmlFor="f-type">Type</label><select id="f-type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
    <div><label className="sr" htmlFor="f-status">Status</label><select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>Active</option><option>Inactive</option></select></div>
  </>;
  const canCreate = can('organisations', 'create');
  return <div className="stack">
    <PageHead title="Organisations" sub="Businesses and enterprise support organisations you can work with." actions={<>{can('organisations', 'delete') && <Link href="/organisations/registry" className="btn">Registry clean-up</Link>}{canCreate && <Button variant="primary" onClick={() => setOpen(true)}>New organisation</Button>}</>} />
    <DataTable<Row> endpoint="/organisations" columns={cols} rowHref={(r) => `/organisations/${r.id}`} params={{ region, type, status }} toolbar={toolbar} exportable={ready && can('organisations', 'export')}
      placeholder="Search name, code, contact or district" defaultSort={{ key: 'name', dir: 'asc' }}
      empty={{ title: 'No organisations yet', hint: canCreate ? 'Register the first organisation to begin.' : 'Organisations you work with will appear here.', action: canCreate ? <Button variant="primary" size="sm" onClick={() => setOpen(true)}>New organisation</Button> : undefined }} />
    <Modal open={open} onClose={() => setOpen(false)} title="New organisation">
      <OrgForm onCancel={() => setOpen(false)} onDone={(r) => { setOpen(false); router.push(`/organisations/${r.id}`); }} />
    </Modal>
  </div>;
}
