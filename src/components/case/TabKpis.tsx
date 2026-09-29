'use client';
import { useState } from 'react';
import { dateFmt } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, LineChart, Modal, Tile, useApi } from '@/components/ui';
import type { TabProps } from './types';
import { useMe } from './clinical/common';
import { KpiForm, ReadingForm, type Kpi } from './clinical/KpiForms';

const fmt = (n: number | null | undefined, unit: string | null) => (n === null || n === undefined ? '-' : `${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`);

export default function TabKpis({ caseId, role, reload }: TabProps) {
  const list = useApi<Kpi[]>(`/cases/${caseId}/kpis`);
  const { can } = useMe();
  const [modal, setModal] = useState<{ kind: 'kpi'; kpi?: Kpi } | { kind: 'reading'; kpi: Kpi } | null>(null);
  const done = () => { setModal(null); list.reload(); reload(); };
  const staff = role !== 'OWNER';
  return <div className="stack">
    <Card title="Indicators" actions={can('kpis', 'create') && staff && <Button variant="primary" size="sm" onClick={() => setModal({ kind: 'kpi' })}>Add indicator</Button>}>
      <p className="muted">Each indicator has a baseline, a target and dated readings. Readings are never edited, so the history stays honest.</p>
    </Card>
    <Async state={list}>{(rows) => rows.length === 0 ? <Empty title="No indicators yet" hint={staff ? 'Indicators are added when a prescription is approved, or add one now.' : 'Your adviser will set the indicators to watch.'} /> :
      <div className="grid two">{rows.map((k) => {
        const vals = [...k.readings.map((r) => r.value), ...(k.baseline !== null ? [k.baseline] : []), ...(k.target !== null ? [k.target] : [])];
        const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
        const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
        return <Card key={k.id} title={<>{k.name} <span className="small muted mono">{k.code}</span></>} actions={<>
          {can('kpis', 'create') && <Button size="sm" onClick={() => setModal({ kind: 'reading', kpi: k })}>Add reading</Button>}
          {can('kpis', 'edit') && <Button size="sm" onClick={() => setModal({ kind: 'kpi', kpi: k })} aria-label={`Edit ${k.name}`}>Edit</Button>}</>}>
          <div className="grid">
            <Tile label="Baseline" value={fmt(k.baseline, k.unit)} />
            <Tile label="Latest" value={fmt(k.latest?.value, k.unit)} hint={k.latest ? `${dateFmt(k.latest.date)}, ${k.latest.sourceClass}` : 'No readings yet'} />
            <Tile label="Target" value={fmt(k.target, k.unit)} hint={k.progress !== null ? `${Math.round(k.progress * 100)}% of the way` : undefined} />
          </div>
          {k.progress !== null && <div style={{ margin: '10px 0' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(k.progress * 100)} aria-label={`Progress toward target for ${k.name}`}>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${k.progress * 100}%` }} /></div></div>}
          {k.progress === null && (k.baseline === null || k.target === null) && <p className="small muted" style={{ marginTop: 8 }}>Set a baseline and a target to see progress.</p>}
          {k.readings.length === 0 ? <Empty title="No readings yet" hint="Add the first reading to start the trend line." /> :
            <LineChart label={`${k.name} readings`} points={k.readings.map((r) => ({ x: dateFmt(r.date), y: r.value }))} min={Math.floor(lo - pad)} max={Math.ceil(hi + pad)} />}
          {k.readings.length > 0 && <details className="small muted"><summary>Readings with source</summary>
            <div className="table-wrap"><table><thead><tr><th>Date</th><th className="r">Value</th><th>Source</th></tr></thead><tbody>{[...k.readings].reverse().map((r) => <tr key={r.id}><td>{dateFmt(r.date)}</td><td className="r num">{fmt(r.value, k.unit)}</td><td><Badge tone={r.sourceClass === 'Verified' ? 'ok' : ''}>{r.sourceClass}</Badge></td></tr>)}</tbody></table></div></details>}
        </Card>;
      })}</div>}</Async>
    <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.kind === 'reading' ? `Add a reading for ${modal.kpi.name}` : modal?.kpi ? `Edit ${modal.kpi.name}` : 'Add an indicator'}>
      {modal?.kind === 'kpi' && <KpiForm caseId={caseId} kpi={modal.kpi} onDone={done} onCancel={() => setModal(null)} />}
      {modal?.kind === 'reading' && <ReadingForm kpi={modal.kpi} staff={staff} onDone={done} onCancel={() => setModal(null)} />}
    </Modal>
  </div>;
}
