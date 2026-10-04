'use client';
import { type ReactNode } from 'react';
import Link from 'next/link';
import { dateFmt, dateTime, ghs, titleCase } from '@/lib/client/api';
import { Badge, Card, Empty, LineChart, LinkButton, PageHead } from '@/components/ui';
import { BarsWithTable, LinkTile, canDo, type Me } from './common';
import { EscalationsCard } from './EscalationsCard';

type Col<R> = { label: string; render: (r: R) => ReactNode; align?: 'r' };
function MiniTable<R extends { id?: string }>({ rows, cols, empty, caption }: { rows: R[]; cols: Col<R>[]; empty: string; caption: string }) {
  if (!rows.length) return <Empty title={empty} />;
  return <div className="table-wrap"><table><caption className="sr">{caption}</caption>
    <thead><tr>{cols.map((c) => <th key={c.label} className={c.align}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={r.id ?? i}>{cols.map((c) => <td key={c.label} className={c.align}>{c.render(r)}</td>)}</tr>)}</tbody></table></div>;
}
const num = (n: unknown) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-GB'));
const score = (n: unknown) => (n === null || n === undefined ? '-' : Number(n).toFixed(1));

/* ------------------------------ management ------------------------------ */
export function Management({ d }: { d: any }) {
  const t = d.totals ?? {};
  return <div className="stack">
    <EscalationsCard />
    <div className="grid">
      <LinkTile label="Organisations" value={num(t.organisations)} hint="Businesses you can see" href="/organisations" />
      <LinkTile label="Cases" value={num(t.cases)} hint="All cases, any state" href="/cases" />
      <LinkTile label="Active cases" value={num(t.active_cases)} hint="Cases not yet graduated" href="/cases" />
      <LinkTile label="Average score" value={score(t.avg_score)} hint="Mean of each case's latest health score, out of 100" href="/cases" />
      <LinkTile label="Overdue actions" value={num(t.overdue_actions)} hint="Not done and past the due date" href="/actions?overdue=true" tone={Number(t.overdue_actions) > 0 ? 'warn' : undefined} />
      <LinkTile label="Awaiting review" value={num(t.pending_reviews)} hint="Prescriptions in review" href="/reviews" />
    </div>
    {d.finance && <div className="grid">
      <LinkTile label="Outstanding invoices" value={ghs(d.finance.outstanding)} hint="Sent or overdue, not yet paid" href="/finance/invoices" />
      <LinkTile label="Overdue invoices" value={ghs(d.finance.overdue)} hint="Past the due date" href="/finance/invoices" />
      <LinkTile label="Paid, last 30 days" value={ghs(d.finance.paid_30d)} hint="Invoices settled in the last 30 days" href="/finance/payments" />
    </div>}
    <div className="grid two">
      <Card title="Cases by state"><BarsWithTable label="cases by state" data={(d.byState ?? []).map((x: any) => ({ label: x.status, value: x.n }))} hrefFor={(l) => `/cases?status=${encodeURIComponent(l)}`} /></Card>
      <Card title="Maturity of latest scores"><BarsWithTable label="maturity" data={(d.maturity ?? []).map((x: any) => ({ label: x.maturity, value: x.n }))} /></Card>
    </div>
    <Card title="Average score by month" actions={<span className="small muted">Last 12 months</span>}>
      {(d.trend ?? []).length ? <LineChart label="Average health score by month" points={d.trend.map((x: any) => ({ x: x.month, y: x.avg_score }))} /> : <Empty title="No scores yet" hint="Scores appear once diagnostics are completed." />}
    </Card>
    <Card title="Programmes">
      <MiniTable caption="Programmes by number of cases" rows={d.byProgramme ?? []} empty="No programmes with cases yet" cols={[
        { label: 'Programme', render: (r: any) => <Link href={`/programmes/${r.id}`}>{r.name}</Link> },
        { label: 'Cases', align: 'r', render: (r: any) => <span className="num">{r.cases}</span> },
        { label: 'Average score', align: 'r', render: (r: any) => <span className="num">{score(r.avg_score)}</span> }]} />
    </Card>
    <Card title="Recent activity">
      <MiniTable caption="Recent events" rows={d.recent ?? []} empty="No activity yet" cols={[
        { label: 'When', render: (r: any) => dateTime(r.created_at) }, { label: 'Event', render: (r: any) => titleCase(String(r.type).replace(/([a-z])([A-Z])/g, '$1 $2')) }, { label: 'Case', render: (r: any) => r.case_code ?? '-' }]} />
    </Card>
  </div>;
}

/* ------------------------------ consultant ------------------------------ */
export function Consultant({ d }: { d: any }) {
  const c = d.counts ?? {};
  return <div className="stack">
    <div className="grid">
      <LinkTile label="Open cases" value={num(c.open)} hint="Your cases that have not graduated" href="/cases" />
      <LinkTile label="Overdue actions" value={num(c.overdue)} hint="Across your cases, not done and past due" href="/actions?overdue=true" tone={Number(c.overdue) > 0 ? 'warn' : undefined} />
      <LinkTile label="Returned prescriptions" value={num(c.returned)} hint="Sent back by the reviewer for rework" href="/reviews" tone={Number(c.returned) > 0 ? 'warn' : undefined} />
    </div>
    {(d.returned ?? []).length > 0 && <Card title="Needs rework">
      <MiniTable caption="Returned prescriptions" rows={d.returned} empty="" cols={[
        { label: 'Prescription', render: (r: any) => <Link href={`/cases/${r.case_id}?tab=prescription`}>{r.code}</Link> }, { label: 'Case', render: (r: any) => r.case_code }, { label: 'Reviewer note', render: (r: any) => r.reason ?? '-' }]} />
    </Card>}
    <Card title="Your cases" actions={<LinkButton href="/cases" size="sm">All cases</LinkButton>}>
      <MiniTable caption="Your cases" rows={d.cases ?? []} empty="You have no cases yet" cols={[
        { label: 'Case', render: (r: any) => <Link href={`/cases/${r.id}`}>{r.code}</Link> }, { label: 'Organisation', render: (r: any) => r.org },
        { label: 'State', render: (r: any) => <Badge>{r.status}</Badge> }, { label: 'Score', align: 'r', render: (r: any) => <span className="num">{score(r.overall)}</span> },
        { label: 'Overdue', align: 'r', render: (r: any) => Number(r.overdue) > 0 ? <Link href={`/cases/${r.id}?tab=actions`}>{r.overdue} overdue</Link> : <span className="num">0</span> },
        { label: 'Next step', render: (r: any) => r.nextStep ?? '-' }]} />
    </Card>
    <Card title="Upcoming coaching sessions" actions={<LinkButton href="/sessions" size="sm">All sessions</LinkButton>}>
      <MiniTable caption="Upcoming sessions" rows={d.sessions ?? []} empty="No sessions scheduled" cols={[
        { label: 'When', render: (r: any) => <Link href="/sessions?upcoming=true">{dateTime(r.scheduled_at)}</Link> }, { label: 'Case', render: (r: any) => r.case_code }, { label: 'Organisation', render: (r: any) => r.org }]} />
    </Card>
  </div>;
}

/* ------------------------------- reviewer ------------------------------- */
export function Reviewer({ d }: { d: any }) {
  return <div className="stack">
    <div className="grid">
      <LinkTile label="Prescriptions waiting" value={num((d.queue ?? []).length)} hint="In review, oldest first" href="/reviews" />
      <LinkTile label="Reports waiting" value={num((d.reports ?? []).length)} hint="Draft reports to release or return" href="/reviews" />
      <LinkTile label="Approved, 30 days" value={num(d.decided?.approved)} hint="Prescriptions you approved" />
      <LinkTile label="Returned, 30 days" value={num(d.decided?.returned)} hint="Prescriptions you sent back" />
    </div>
    <Card title="Prescriptions to review" actions={<LinkButton href="/reviews" size="sm">Open review queue</LinkButton>}>
      <MiniTable caption="Prescriptions in review" rows={d.queue ?? []} empty="Nothing waiting for you" cols={[
        { label: 'Prescription', render: (r: any) => <Link href={`/cases/${r.case_id}?tab=prescription`}>{r.code}</Link> }, { label: 'Case', render: (r: any) => r.case_code },
        { label: 'Organisation', render: (r: any) => r.org }, { label: 'Submitted', render: (r: any) => dateFmt(r.created_at) }]} />
    </Card>
    <Card title="Reports to review">
      <MiniTable caption="Draft reports" rows={d.reports ?? []} empty="No draft reports" cols={[
        { label: 'Report', render: (r: any) => <Link href={`/reports/${r.id}`}>{r.title || r.code}</Link> }, { label: 'Case', render: (r: any) => r.case_code }, { label: 'Organisation', render: (r: any) => r.org }]} />
    </Card>
  </div>;
}

/* --------------------------------- coach -------------------------------- */
export function Coach({ d }: { d: any }) {
  const overdue = (d.actions ?? []).filter((a: any) => a.overdue).length;
  return <div className="stack">
    <div className="grid">
      <LinkTile label="Scheduled sessions" value={num((d.sessions ?? []).length)} hint="Coaching sessions still to hold" href="/sessions?upcoming=true" />
      <LinkTile label="Your open actions" value={num((d.actions ?? []).length)} hint="Assigned to you and not done" href="/actions?mine=true" />
      <LinkTile label="Overdue" value={num(overdue)} hint="Your open actions past their due date" href="/actions?mine=true&overdue=true" tone={overdue > 0 ? 'warn' : undefined} />
      <LinkTile label="Cases" value={num((d.cases ?? []).length)} hint="Cases you coach" href="/cases" />
    </div>
    <Card title="Upcoming sessions" actions={<LinkButton href="/sessions" size="sm">All sessions</LinkButton>}>
      <MiniTable caption="Scheduled coaching sessions" rows={d.sessions ?? []} empty="No sessions scheduled" cols={[
        { label: 'When', render: (r: any) => <Link href={`/cases/${r.case_id}?tab=coaching`}>{dateTime(r.scheduled_at)}</Link> }, { label: 'Case', render: (r: any) => r.case_code },
        { label: 'Organisation', render: (r: any) => r.org }, { label: 'Brief', render: (r: any) => r.has_brief ? 'Ready' : 'Not prepared' }]} />
    </Card>
    <Card title="Your actions" actions={<LinkButton href="/actions?mine=true" size="sm">Manage actions</LinkButton>}>
      <MiniTable caption="Actions assigned to you" rows={d.actions ?? []} empty="No open actions" cols={[
        { label: 'Action', render: (r: any) => r.text }, { label: 'Case', render: (r: any) => r.case_code }, { label: 'Due', render: (r: any) => <>{dateFmt(r.due_date)}{r.overdue && <> <Badge tone="warn">Overdue</Badge></>}</> }, { label: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }]} />
    </Card>
    <Card title="Your cases">
      <MiniTable caption="Cases you coach" rows={d.cases ?? []} empty="No cases yet" cols={[
        { label: 'Case', render: (r: any) => <Link href={`/cases/${r.id}`}>{r.code}</Link> }, { label: 'Organisation', render: (r: any) => r.org }, { label: 'State', render: (r: any) => <Badge>{r.status}</Badge> }, { label: 'Score', align: 'r', render: (r: any) => <span className="num">{score(r.overall)}</span> }]} />
    </Card>
  </div>;
}

/* -------------------------------- finance ------------------------------- */
export function Finance({ d }: { d: any }) {
  const t = d.totals ?? {};
  return <div className="stack">
    <div className="grid">
      <LinkTile label="Receivable" value={ghs(t.receivable)} hint="Sent or overdue invoices not yet paid" href="/finance/invoices" />
      <LinkTile label="Overdue" value={ghs(t.overdue)} hint="Invoices past their due date" href="/finance/invoices?status=Overdue" tone={Number(t.overdue) > 0 ? 'warn' : undefined} />
      <LinkTile label="Paid, last 30 days" value={ghs(t.paid_30d)} hint="Invoices settled in the last 30 days" href="/finance/payments" />
    </div>
    <Card title="Invoices by status"><BarsWithTable label="invoice totals by status" format={ghs} data={(d.byStatus ?? []).map((x: any) => ({ label: x.status, value: Number(x.total) }))} hrefFor={(l) => `/finance/invoices?status=${encodeURIComponent(l)}`} />
      <MiniTable caption="Invoice counts by status" rows={(d.byStatus ?? []).map((x: any) => ({ id: x.status, ...x }))} empty="No invoices yet" cols={[{ label: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { label: 'Invoices', align: 'r', render: (r: any) => <span className="num">{r.n}</span> }, { label: 'Total', align: 'r', render: (r: any) => <span className="num">{ghs(r.total)}</span> }]} />
    </Card>
    <Card title="Overdue invoices" actions={<LinkButton href="/finance/invoices?status=Overdue" size="sm">View all</LinkButton>}>
      <MiniTable caption="Overdue invoices" rows={d.overdue ?? []} empty="No overdue invoices" cols={[
        { label: 'Invoice', render: (r: any) => <Link href={`/finance/invoices/${r.id}`}>{r.code}</Link> }, { label: 'Organisation', render: (r: any) => r.org }, { label: 'Amount', align: 'r', render: (r: any) => <span className="num">{ghs(r.amount)}</span> }, { label: 'Days overdue', align: 'r', render: (r: any) => <span className="num">{r.days}</span> }]} />
    </Card>
    <div className="grid two">
      <Card title="Recent payments" actions={<LinkButton href="/finance/payments" size="sm">All payments</LinkButton>}>
        <MiniTable caption="Recent payments" rows={d.recent ?? []} empty="No payments yet" cols={[
          { label: 'Payment', render: (r: any) => <Link href="/finance/payments">{r.code}</Link> }, { label: 'Invoice', render: (r: any) => r.invoice }, { label: 'Amount', align: 'r', render: (r: any) => <span className="num">{ghs(r.amount)}</span> }, { label: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }]} />
      </Card>
      <Card title="Contracts ending within 30 days" actions={<LinkButton href="/finance/contracts" size="sm">All contracts</LinkButton>}>
        <MiniTable caption="Expiring contracts" rows={d.expiring ?? []} empty="No contracts ending soon" cols={[
          { label: 'Contract', render: (r: any) => <Link href={`/finance/contracts/${r.id}`}>{r.code}</Link> }, { label: 'Organisation', render: (r: any) => r.org }, { label: 'Ends', render: (r: any) => dateFmt(r.end_date) }]} />
      </Card>
    </div>
  </div>;
}

/* --------------------------------- owner -------------------------------- */
export function Owner({ d }: { d: any }) {
  if (!d.case) return <Card><Empty title="Your business has no case yet" hint="Your adviser will open one for you. Nothing is needed from you until then." /></Card>;
  const overdue = (d.actions ?? []).filter((a: any) => a.overdue).length;
  const open = (d.actions ?? []).filter((a: any) => a.status !== 'Done').length;
  const latest = (d.history ?? []).at(-1);
  return <div className="stack">
    <div className="grid">
      <LinkTile label="Where you are" value={<Badge>{d.case.status}</Badge>} hint={d.case.nextStep ?? 'Your case is in progress'} href="/my-case" />
      <LinkTile label="Health score" value={score(latest?.overall)} hint={latest ? `Maturity: ${latest.maturity}. Out of 100` : 'Available after your diagnostic is scored'} href="/my-case" />
      <LinkTile label="Open actions" value={num(open)} hint="Steps still to do" href="/my-case" />
      <LinkTile label="Overdue" value={num(overdue)} hint="Actions past their due date" href="/my-case" tone={overdue > 0 ? 'warn' : undefined} />
      <LinkTile label="Invoices to pay" value={num((d.invoices ?? []).length)} hint="Sent or overdue" href="/my-case" />
    </div>
    <Card title="Score over time">{(d.history ?? []).length ? <LineChart label="Health score over time" points={d.history.map((h: any) => ({ x: dateFmt(h.created_at), y: h.overall }))} /> : <Empty title="No score yet" />}</Card>
    <div className="grid two">
      <Card title="Next coaching sessions"><MiniTable caption="Upcoming sessions" rows={d.sessions ?? []} empty="No sessions scheduled" cols={[{ label: 'When', render: (r: any) => dateTime(r.scheduled_at) }]} /></Card>
      <Card title="Released reports"><MiniTable caption="Released reports" rows={d.reports ?? []} empty="No reports released yet" cols={[{ label: 'Report', render: (r: any) => <Link href={`/reports/${r.id}`}>{r.title}</Link> }, { label: 'Released', render: (r: any) => dateFmt(r.released_at) }]} /></Card>
    </div>
    <p><LinkButton href="/my-case" variant="primary">Open my business</LinkButton></p>
  </div>;
}

/* --------------------------------- funder ------------------------------- */
export function Funder({ d, me }: { d: any; me: Me | null }) {
  const progs: any[] = d.programmes ?? [];
  if (!progs.length) return <Card><Empty title="No programmes to show" hint="Programmes you fund appear here once they are shared with you." /></Card>;
  const canExport = canDo(me, 'dashboard', 'export');
  return <div className="stack">
    {progs.map((p) => {
      const cell = (n: number | null) => n === null || n === undefined ? `Fewer than ${p.minGroupSize}` : num(n);
      return <Card key={p.programme.id} title={<Link href={`/programmes/${p.programme.id}`}>{p.programme.name}</Link>} actions={canExport ? <a className="btn sm" href={`/api/v1/programmes/${p.programme.id}/export`} download>Export CSV</a> : undefined}>
        <div className="stack">
          <div className="grid">
            <LinkTile label="Businesses" value={cell(p.total)} hint="Cases in this programme" href={`/programmes/${p.programme.id}`} />
            <LinkTile label="Average score change" value={p.scoreChange?.average === null || p.scoreChange?.average === undefined ? 'Not shown' : `${p.scoreChange.average > 0 ? '+' : ''}${p.scoreChange.average}`} hint={p.scoreChange?.n === null ? `Fewer than ${p.minGroupSize} businesses have two scores` : `Between first and latest score, ${p.scoreChange?.n ?? 0} businesses`} />
            <LinkTile label="Status" value={p.programme.status} hint={`${dateFmt(p.programme.startDate)} to ${dateFmt(p.programme.endDate)}`} />
          </div>
          {p.suppressed && <p className="small muted">Groups smaller than {p.minGroupSize} are hidden to protect privacy.</p>}
          <div className="grid two">
            <div><h3>Cases by state</h3><BarsWithTable label="cases by state" data={(p.byState ?? []).filter((g: any) => g.n !== null).map((g: any) => ({ label: g.key, value: g.n }))} />
              {(p.byState ?? []).some((g: any) => g.n === null) && <p className="small muted">Some states are hidden because they have fewer than {p.minGroupSize} businesses.</p>}</div>
            <div><h3>Average score by dimension</h3><BarsWithTable label="dimension scores" data={(p.dimensions ?? []).filter((x: any) => x.avgValue !== null).map((x: any) => ({ label: x.dimension, value: x.avgValue }))} format={(n) => n.toFixed(1)} /></div>
          </div>
        </div>
      </Card>;
    })}
  </div>;
}
export { PageHead };

/* ------------------------------- website roles ------------------------------- */
export function Website({ d }: { d: any }) {
  const c = d.content ?? {};
  return <div className="stack">
    <div className="grid">
      <LinkTile label="Waiting for review" value={num(c.in_review)} hint="Drafts sent for a decision" href="/admin/website" tone={Number(c.in_review) > 0 ? 'warn' : undefined} />
      <LinkTile label="Drafts" value={num(c.drafts)} hint="Items not yet published" href="/admin/website" />
      <LinkTile label="Scheduled" value={num(c.scheduled)} hint="Set to go live later" href="/admin/website" />
      <LinkTile label="Published" value={num(c.published)} hint="Items visitors can see" href="/admin/website" />
      {d.new_enquiries !== undefined && <LinkTile label="New enquiries" value={num(d.new_enquiries)} hint="Website messages not yet handled" href="/admin/website?tab=enquiries" />}
    </div>
    <Card title="Recently changed" actions={<LinkButton href="/admin/website" variant="primary" size="sm">Open website and content</LinkButton>}>
      <MiniTable caption="Recently changed website content" rows={d.recent ?? []} empty="Nothing has been edited yet" cols={[
        { label: 'Item', render: (r: any) => <Link href={`/admin/website/${r.kind}`}>{r.title || titleCase(r.kind)}</Link> },
        { label: 'Type', render: (r: any) => titleCase(r.kind) }, { label: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { label: 'Updated', render: (r: any) => dateTime(r.updated_at) }]} />
    </Card>
  </div>;
}

/** A team respondent sees only the areas assigned to them. */
export function Respondent({ d }: { d: any }) {
  if (!d.business || d.areas.length === 0) return <Card><Empty title="Nothing assigned to you yet" hint="The business owner will assign you the areas that fit your role. You will see them here." /></Card>;
  return <Card title={`Your areas for ${d.business}`}>
    <p className="muted small">These are the parts of the assessment you have been asked to answer. You see only these. </p>
    <div><LinkButton href="/answer" variant="primary">Answer my questions</LinkButton></div>
    <ul className="stack" style={{ margin: 0, paddingLeft: 20 }}>{d.areas.map((a: any) => <li key={a.code}>{a.name}</li>)}</ul>
  </Card>;
}
