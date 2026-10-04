'use client';
import Link from 'next/link';
import { Badge, Card, KV, Tile } from '@/components/ui';
import { dateTime } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/rbac';
import type { TabProps } from './types';
import { CASE_TABS } from './types';
import { FACT_LABEL, MaturityBadge, StateBadge, TAB_PERMISSION, one, useMe } from './core/shared';

export default function TabOverview({ caseId, caseData: c, role }: TabProps) {
  const { can } = useMe();
  const internal = role !== 'OWNER' && role !== 'FUNDER';
  const links = CASE_TABS.filter((t) => t.id !== 'overview' && (!TAB_PERMISSION[t.id] || can(TAB_PERMISSION[t.id][0], TAB_PERMISSION[t.id][1])));
  const dims: { dimension: string; value: number }[] = Array.isArray(c.score?.dimensions) ? c.score!.dimensions : [];
  const weakest = [...dims].sort((a, b) => a.value - b.value)[0];
  const facts = c.facts ? Object.entries(c.facts) : [];
  return <div className="stack">
    <div className="grid two">
      <Card title="State">
        <KV items={[
          ['Current state', <StateBadge key="s" state={c.status} />],
          ['Organisation', c.orgName], ['Region', c.region], ['Programme', c.programmeName],
          ['Opened', dateTime(c.createdAt)], ['Last updated', dateTime(c.updatedAt)]
        ]} />
      </Card>
    </div>
    <div className="grid two">
      <Card title="Latest score" actions={can('scores', 'read') ? <Link className="btn sm" href={`/cases/${caseId}?tab=score`}>Open score tab</Link> : undefined}>
        {!c.score ? <p className="muted">This case has not been scored yet. A score is produced when a diagnostic passes the data quality gate.</p> : <div className="stack">
          <div className="grid">
            <Tile label="Overall" value={one(c.score.overall)} hint="Out of 100" />
            <Tile label="Maturity" value={<MaturityBadge value={c.score.maturity} />} />
            <Tile label="Confidence" value={c.score.confidenceClass} />
          </div>
          {weakest && <p className="small">Weakest dimension: <strong>{weakest.dimension}</strong> at {one(weakest.value)}.</p>}
          <p className="small muted">Scored {dateTime(c.score.at)}</p>
        </div>}
      </Card>
      <Card title="Next steps">
        {!internal ? <p>Your consultant will guide the next step. Use the tabs below to see your diagnostic, score and plan as they become available.</p> : <div className="stack">
          {c.automaticNext.length === 0 && c.nextManualSteps.length === 0 && <p className="muted">There are no further steps from this state.</p>}
          {c.automaticNext.map((a) => <div key={a.to}>
            <p><strong>Automatic:</strong> moves to {a.to} ({a.trigger.toLowerCase()}).</p>
            {a.missing.length > 0 ? <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{a.missing.map((m) => <li key={m}>Still needed: {FACT_LABEL[m] ?? m}</li>)}</ul> : <p className="small muted">All conditions are met.</p>}
          </div>)}
          {c.nextManualSteps.map((m) => <p key={m.to}><strong>Manual:</strong> {m.trigger} moves the case to {m.to}. Use the lifecycle panel above.</p>)}
        </div>}
      </Card>
    </div>
    {internal && <Card title="Facts checklist">
      {facts.length === 0 ? <p className="muted">No facts are available for this case.</p> : <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
        {facts.filter(([k]) => k !== 'confirmed').map(([k, v]) => <li key={k} className="row"><Badge tone={v ? 'ok' : 'warn'}>{v ? 'Done' : 'Not yet'}</Badge><span>{FACT_LABEL[k] ?? k}</span></li>)}
      </ul>}
    </Card>}
    <Card title="Quick links">
      <div className="row">{links.map((t) => <Link key={t.id} className="btn sm" href={`/cases/${caseId}?tab=${t.id}`}>{t.label}</Link>)}</div>
    </Card>
  </div>;
}
