'use client';
import { useId, useState } from 'react';
import Link from 'next/link';
import { dateTime } from '@/lib/client/api';
import { Button } from '@/components/ui';
import { DiffView, LogTable } from './common';

export type AuditRow = { id: number; at: string; actorId: string | null; actorEmail: string | null; ip: string | null; requestId: string | null; action: string; entity: string | null; entityId: string | null; caseId: string | null; before: unknown; after: unknown };
export type EventRow = { id: number; type: string; caseId: string | null; orgId: string | null; actorId: string | null; payload: unknown; createdAt: string };

const ENTITIES = ['user', 'case', 'organisation', 'programme', 'diagnostic', 'diagnosis', 'prescription', 'action', 'kpi', 'session', 'risk', 'report', 'plan', 'contract', 'invoice', 'payment', 'rules', 'question', 'library_item', 'job'];
const short = (s: string | null) => (s ? (s.length > 13 ? s.slice(0, 8) + '…' : s) : '-');

function AuditDetail({ r }: { r: AuditRow }) {
  return <div className="stack" style={{ padding: '6px 0' }}>
    <dl className="kv">
      <div style={{ display: 'contents' }}><dt>Entity</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{r.entity ?? '-'}{r.entityId ? ` / ${r.entityId}` : ''}</dd></div>
      {r.caseId && <div style={{ display: 'contents' }}><dt>Case</dt><dd><Link href={`/cases/${r.caseId}`}>Open case</Link></dd></div>}
      <div style={{ display: 'contents' }}><dt>IP address</dt><dd className="mono">{r.ip ?? '-'}</dd></div>
      <div style={{ display: 'contents' }}><dt>Request id</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{r.requestId ?? '-'}</dd></div>
    </dl>
    {r.before === null && r.after === null ? <p className="muted small">No before or after values were recorded for this action.</p>
      : r.before === null || r.before === undefined ? <><h3 className="small">Recorded values</h3><DiffView single after={r.after} /></>
      : r.after === null || r.after === undefined ? <><h3 className="small">Values before the action</h3><DiffView single before={r.before} /></>
      : <><h3 className="small">What changed</h3><DiffView before={r.before} after={r.after} /></>}
  </div>;
}

const auditCols = [
  { key: 'at', label: 'When', sort: 'at', render: (r: AuditRow) => <span className="num">{dateTime(r.at)}</span> },
  { key: 'who', label: 'Who', sort: 'actor', render: (r: AuditRow) => r.actorEmail ?? <span className="muted">System</span> },
  { key: 'action', label: 'Action', sort: 'action', render: (r: AuditRow) => <span className="mono">{r.action}</span> },
  { key: 'entity', label: 'Entity', render: (r: AuditRow) => <span>{r.entity ?? '-'} <span className="muted mono small">{short(r.entityId)}</span></span> }
];

/** Audit log with optional filter bar. `fixed` filters are applied silently (for example one user). */
export function AuditTable({ fixed, filters = true, pageSize = 20, exportable, searchable = true }: { fixed?: Record<string, unknown>; filters?: boolean; pageSize?: number; exportable?: boolean; searchable?: boolean }) {
  const [entity, setEntity] = useState(''); const [action, setAction] = useState(''); const [actor, setActor] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const id = useId(); const dl = `${id}-entities`;
  const badRange = !!from && !!to && from > to;
  const params = { ...(fixed ?? {}), entity, action, actor, from: badRange ? '' : from, to: badRange ? '' : to };
  const clear = () => { setEntity(''); setAction(''); setActor(''); setFrom(''); setTo(''); };
  const any = entity || action || actor || from || to;
  return <div className="stack">
    {filters && <div className="form-grid" role="group" aria-label="Audit filters">
      <div className="field"><label htmlFor={`${id}-e`}>Entity</label><input id={`${id}-e`} list={dl} value={entity} onChange={(e) => setEntity(e.target.value.trim())} placeholder="For example user" /><datalist id={dl}>{ENTITIES.map((x) => <option key={x} value={x} />)}</datalist></div>
      <div className="field"><label htmlFor={`${id}-a`}>Action starts with</label><input id={`${id}-a`} value={action} onChange={(e) => setAction(e.target.value.trim())} placeholder="For example user." /></div>
      <div className="field"><label htmlFor={`${id}-u`}>User email contains</label><input id={`${id}-u`} value={actor} onChange={(e) => setActor(e.target.value.trim())} placeholder="name@example.com" /></div>
      <div className="field"><label htmlFor={`${id}-f`}>From date</label><input id={`${id}-f`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div className="field"><label htmlFor={`${id}-t`}>To date</label><input id={`${id}-t`} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={badRange || undefined} />{badRange && <span className="err" role="alert">The end date must not be before the start date.</span>}</div>
      {any && <div className="field" style={{ justifyContent: 'flex-end' }}><Button onClick={clear}>Clear filters</Button></div>}
    </div>}
    <LogTable<AuditRow> endpoint="/audit" columns={auditCols} params={params} detail={(r) => <AuditDetail r={r} />} exportable={exportable} pageSize={pageSize} searchable={searchable} placeholder="Search action, user or entity" emptyTitle="No audit entries yet" />
  </div>;
}

const eventCols = [
  { key: 'when', label: 'When', render: (r: EventRow) => <span className="num">{dateTime(r.createdAt)}</span> },
  { key: 'type', label: 'Event', render: (r: EventRow) => <span className="mono">{r.type}</span> },
  { key: 'case', label: 'Case', render: (r: EventRow) => r.caseId ? <Link href={`/cases/${r.caseId}`}>Open case</Link> : <span className="muted">-</span> },
  { key: 'actor', label: 'Actor', render: (r: EventRow) => r.actorId ? <Link href={`/admin/users/${r.actorId}`}>{short(r.actorId)}</Link> : <span className="muted">System</span> }
];

export function EventsTable({ exportable }: { exportable?: boolean }) {
  const [type, setType] = useState(''); const id = useId();
  return <LogTable<EventRow> endpoint="/events" columns={eventCols} params={{ type }} searchable={false} exportable={exportable} emptyTitle="No events recorded yet"
    toolbar={<div className="field"><label htmlFor={id}>Event type (exact)</label><input id={id} value={type} onChange={(e) => setType(e.target.value.trim())} placeholder="For example PaymentReceived" /></div>}
    detail={(r) => <div className="stack" style={{ padding: '6px 0' }}>
      <dl className="kv"><div style={{ display: 'contents' }}><dt>Event id</dt><dd className="mono">{r.id}</dd></div>{r.orgId && <div style={{ display: 'contents' }}><dt>Organisation</dt><dd><Link href={`/organisations/${r.orgId}`}>Open organisation</Link></dd></div>}</dl>
      <h3 className="small">Payload</h3><DiffView single after={r.payload} />
    </div>} />;
}
