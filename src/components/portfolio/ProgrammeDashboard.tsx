'use client';
import { Async, BarList, Card, Empty, Tile, useApi } from '@/components/ui';
import { titleCase } from '@/lib/client/api';

type Group = { key: string; n: number | null };
type Dash = {
  programme: { id: string; code: string; name: string; status: string };
  minGroupSize: number; total: number | null; byState: Group[]; maturity: Group[];
  scoreChange: { n: number | null; average: number | null };
  dimensions: { dimension: string; avgValue?: number | null; avg_value?: number | null; n?: number }[];
  cohorts: { id: string; name: string; capacity: number; enrolled: number | null }[];
  suppressed: boolean;
};

function Groups({ data, min, label }: { data: Group[]; min: number; label: string }) {
  const shown = data.filter((g) => g.n !== null).map((g) => ({ label: g.key, value: g.n as number }));
  const hidden = data.filter((g) => g.n === null);
  if (!data.length) return <Empty title="Nothing to show" hint={`Groups with fewer than ${min} businesses are hidden to protect privacy.`} />;
  return <div className="stack">
    {shown.length ? <BarList data={shown} /> : <p className="muted">All groups are hidden.</p>}
    {hidden.length > 0 && <p className="small muted">{label} hidden because fewer than {min} businesses are in the group: {hidden.map((g) => titleCase(g.key)).join(', ')}.</p>}
  </div>;
}

export function ProgrammeDashboard({ id, canExport }: { id: string; canExport: boolean }) {
  const st = useApi<Dash>(`/programmes/${id}/dashboard`);
  return <Async state={st}>{(d) => {
    const min = d.minGroupSize;
    const dims = d.dimensions.map((x) => ({ label: x.dimension, value: x.avgValue !== undefined ? x.avgValue : x.avg_value ?? null }));
    const hiddenDims = dims.filter((x) => x.value === null);
    const anyHidden = d.suppressed && (d.total === null || d.byState.some((g) => g.n === null) || d.maturity.some((g) => g.n === null) || hiddenDims.length > 0 || d.scoreChange.n === null || d.cohorts.some((c) => c.enrolled === null));
    return <div className="stack">
      {d.suppressed && <div className="alert info" role="note">Results for funders are aggregates only. Any group with fewer than {min} businesses is hidden so that no individual business can be identified.{anyHidden ? ' Some values below are hidden for this reason.' : ''}</div>}
      <div className="grid">
        <Tile label="Businesses enrolled" value={d.total === null ? 'Hidden' : d.total} hint={d.total === null ? `Fewer than ${min} businesses` : undefined} />
        <Tile label="Businesses re-scored" value={d.scoreChange.n === null ? 'Hidden' : d.scoreChange.n} hint={d.scoreChange.n === null ? `Fewer than ${min} businesses` : 'Scored at least twice'} />
        <Tile label="Average score change" value={d.scoreChange.average === null ? (d.scoreChange.n === null ? 'Hidden' : 'None yet') : `${d.scoreChange.average > 0 ? '+' : ''}${d.scoreChange.average}`} hint="Points between first and latest score" />
        <Tile label="Cohorts" value={d.cohorts.length} />
      </div>
      <div className="grid two">
        <Card title="Cases by state"><Groups data={d.byState} min={min} label="States" /></Card>
        <Card title="Maturity"><Groups data={d.maturity} min={min} label="Levels" /></Card>
      </div>
      <div className="grid two">
        <Card title="Average score by dimension">
          {dims.length === 0 ? <Empty title="No scores to show" hint={d.suppressed ? `Dimension averages need at least ${min} businesses.` : 'Scores appear once businesses are diagnosed.'} /> :
            <div className="stack">
              <BarList data={dims.filter((x) => x.value !== null).map((x) => ({ label: x.label, value: x.value as number }))} max={100} />
              {hiddenDims.length > 0 && <p className="small muted">Dimensions hidden because fewer than {min} businesses are scored: {hiddenDims.map((x) => x.label).join(', ')}.</p>}
            </div>}
        </Card>
        <Card title="Cohort comparison">
          {d.cohorts.length === 0 ? <Empty title="No cohorts yet" /> : <div className="table-wrap"><table><thead><tr><th>Cohort</th><th className="r">Capacity</th><th className="r">Enrolled</th><th className="r">Filled</th></tr></thead>
            <tbody>{d.cohorts.map((c) => <tr key={c.id}><td>{c.name}</td><td className="r num">{c.capacity}</td><td className="r num">{c.enrolled === null ? `Fewer than ${min}` : c.enrolled}</td><td className="r num">{c.enrolled === null ? '-' : `${Math.round((c.enrolled / Math.max(1, c.capacity)) * 100)}%`}</td></tr>)}</tbody></table></div>}
        </Card>
      </div>
      {canExport && <p><a className="btn" href={`/api/v1/programmes/${id}/export`} download>Export CSV</a></p>}
    </div>;
  }}</Async>;
}
