'use client';
import { useState } from 'react';
import { Async, Badge, Button, Card, Empty, useApi } from '@/components/ui';
import { dateTime, titleCase } from '@/lib/client/api';
import type { TabProps } from './types';

type Item = { at: string; actor: string | null; action: string; entity: string; entityId: string | null; detail: Record<string, unknown> | null };
const PAGE = 15;

const ACTION_TEXT: Record<string, string> = {
  'case.created': 'Case opened', 'case.state': 'Case state changed', 'case.assigned': 'People assigned to the case',
  'diagnostic.submitted': 'Diagnostic submitted', 'diagnostic.rejected': 'Diagnostic rejected by the data quality gate',
  'score.computed': 'Health score calculated', 'evidence.added': 'Evidence added', 'evidence.updated': 'Evidence updated',
  'document.uploaded': 'Document uploaded', 'document.downloaded': 'Document downloaded',
  'prescription.approved': 'Prescription approved', 'report.released': 'Report released', 'action.updated': 'Action updated'
};
const label = (a: string) => ACTION_TEXT[a] ?? titleCase(a.replace(/\./g, ' '));
const keyLabel = (k: string) => titleCase(k.replace(/([A-Z])/g, ' $1').toLowerCase()).replace(/^\w/, (m) => m.toUpperCase());
const isId = (k: string) => /(^|_)id$|Id$/.test(k) && k !== 'orgId';
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T/.test(v) ? dateTime(v) : v;
  if (Array.isArray(v)) return v.map(show).join('; ');
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${keyLabel(k)} ${show(x)}`).join(', ');
}
/** Turn the recorded payload into short readable lines. */
function summary(i: Item): string[] {
  const d = i.detail; if (!d || typeof d !== 'object') return [];
  if (i.action === 'case.state') {
    const to = String(d.status ?? ''); const how = d.automatic ? 'automatically' : 'manually';
    return [`Moved to ${to} ${how}${d.trigger ? ` (${String(d.trigger).toLowerCase()})` : ''}${d.reason ? `. Reason: ${d.reason}` : ''}`];
  }
  return Object.entries(d).filter(([k]) => !isId(k)).map(([k, v]) => `${keyLabel(k)}: ${show(v)}`);
}

export default function TabActivity({ caseId, role }: TabProps) {
  const st = useApi<Item[]>(`/cases/${caseId}/activity`);
  const [page, setPage] = useState(1);
  const internal = role !== 'OWNER';
  return <Card title="Activity" actions={<Button size="sm" onClick={st.reload}>Refresh</Button>}>
    <p className="muted small">The most recent 100 events on this case, newest first.{role === 'OWNER' ? ' You see the main milestones only.' : ''}</p>
    <Async state={st}>{(items) => {
      if (items.length === 0) return <Empty title="No activity yet" hint="Events appear here as the case moves forward." />;
      const pages = Math.max(1, Math.ceil(items.length / PAGE)); const p = Math.min(page, pages);
      const slice = items.slice((p - 1) * PAGE, p * PAGE);
      return <div className="stack">
        <ol className="timeline" aria-label="Case activity">{slice.map((i, n) => {
          const lines = summary(i);
          return <li key={`${i.at}-${n}`}><div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <div className="row"><strong>{label(i.action)}</strong><Badge tone="">{titleCase(i.entity)}</Badge></div>
            <div className="small muted"><time dateTime={i.at}>{dateTime(i.at)}</time>{internal && <> by {i.actor ?? 'the system'}</>}</div>
            {lines.length > 0 && <ul className="small" style={{ margin: '2px 0 0', paddingLeft: 18, overflowWrap: 'anywhere' }}>{lines.map((l, k) => <li key={k}>{l}</li>)}</ul>}
          </div></li>;
        })}</ol>
        <div className="pager"><span className="muted">{items.length} event{items.length === 1 ? '' : 's'}</span>
          <span className="row"><button className="btn sm" disabled={p <= 1} onClick={() => setPage(p - 1)}>Previous</button><span className="num">Page {p} of {pages}</span><button className="btn sm" disabled={p >= pages} onClick={() => setPage(p + 1)}>Next</button></span></div>
      </div>;
    }}</Async>
  </Card>;
}
