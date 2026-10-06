'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Provider = {
  provider: { id: string; name: string };
  assignment: { id: string; providerRole: 'EXPERT' | 'COACH'; status: string };
  operational: {
    totalSessions: number;
    completedSessions: number;
    cancelledSessions: number;
    sessionCompletionRate: number | null;
    attendanceRate: number | null;
  };
  performanceReview: {
    id: string;
    humanPerformanceScore: number | null;
    serviceQualityScore: number | null;
    clientExperienceScore: number | null;
    businessOutcomeScore: number | null;
    compositeScore: number | null;
    status: string;
    evidence?: unknown;
    notes?: string | null;
  } | null;
};

type Summary = {
  participants: { total: number; active: number };
  delivery: { sessionCompletionRate: number | null; attendanceRate: number | null };
  coordination: { openTasks: number; openExceptions: number; criticalExceptions: number };
  providers: { activeAssignments: number };
};

const API = '/api/v1';

function pct(value: number | null | undefined) {
  return value == null ? '—' : `${Number(value).toFixed(0)}%`;
}

function score(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toFixed(0);
}

export default function ProviderPerformancePage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [period, setPeriod] = useState(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    return { start: start.toISOString(), end: end.toISOString() };
  });

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('workspaceId');
    if (id) setWorkspaceId(id);
  }, []);

  async function load(id = workspaceId) {
    if (!id) return;
    setLoading(true);
    setMessage('');
    try {
      const qs = new URLSearchParams({ periodStart: period.start, periodEnd: period.end });
      const [summaryRes, providerRes] = await Promise.all([
        fetch(`${API}/programme-workspaces/${id}/monitoring/summary?${qs}`, { credentials: 'include' }),
        fetch(`${API}/programme-workspaces/${id}/provider-performance?${qs}`, { credentials: 'include' }),
      ]);
      if (!summaryRes.ok || !providerRes.ok) throw new Error('Unable to load monitoring data. Check your programme access.');
      setSummary(await summaryRes.json());
      setProviders(await providerRes.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load monitoring data.');
      setSummary(null);
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (workspaceId) void load(); }, [workspaceId, period.start, period.end]);

  async function saveReview(event: FormEvent<HTMLFormElement>, provider: Provider) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      providerAssignmentId: provider.assignment.id,
      periodStart: period.start,
      periodEnd: period.end,
      humanPerformanceScore: form.get('humanPerformanceScore') === '' ? null : Number(form.get('humanPerformanceScore')),
      serviceQualityScore: form.get('serviceQualityScore') === '' ? null : Number(form.get('serviceQualityScore')),
      clientExperienceScore: form.get('clientExperienceScore') === '' ? null : Number(form.get('clientExperienceScore')),
      businessOutcomeScore: form.get('businessOutcomeScore') === '' ? null : Number(form.get('businessOutcomeScore')),
      evidence: { source: 'programme-performance-review', capturedAt: new Date().toISOString() },
      notes: String(form.get('notes') ?? '').trim() || null,
    };
    const res = await fetch(`${API}/programme-workspaces/${workspaceId}/provider-performance/reviews`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMessage('Review could not be saved. Scores must be between 0 and 100 and the provider must belong to this workspace.');
      return;
    }
    setMessage(`Saved review for ${provider.provider.name}.`);
    await load();
  }

  async function finalize(reviewId: string) {
    const res = await fetch(`${API}/provider-performance-reviews/${reviewId}/finalize`, {
      method: 'POST',
      credentials: 'include',
    });
    setMessage(res.ok ? 'Performance review finalized.' : 'Review could not be finalized. It requires at least one evidence-backed score.');
    await load();
  }

  const headline = useMemo(() => {
    const reviewed = providers.filter((p) => p.performanceReview?.status === 'FINAL').length;
    return { reviewed, total: providers.length };
  }, [providers]);

  return (
    <main className="content" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <div className="crumbs">Programme Workspace / Monitoring</div>
          <h1>Provider Performance & Service Quality</h1>
          <p className="muted">Evidence-backed operational performance for Experts and Coaches. Human Performance, Service Quality, Client Experience and Business Outcome remain separate.</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void load(); }} className="page-actions">
          <input aria-label="Programme workspace ID" placeholder="Workspace ID" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
          <button className="btn primary" type="submit" disabled={loading}>{loading ? 'Loading…' : 'Load workspace'}</button>
        </form>
      </div>

      {message && <div role="status" className="notice">{message}</div>}

      <section className="metrics" aria-label="Programme monitoring summary">
        {[
          ['Participants', summary ? String(summary.participants.total) : '—', summary ? `${summary.participants.active} active` : ''],
          ['Session completion', summary ? pct(summary.delivery.sessionCompletionRate) : '—', 'authoritative delivery data'],
          ['Attendance', summary ? pct(summary.delivery.attendanceRate) : '—', 'present + late'],
          ['Active providers', summary ? String(summary.providers.activeAssignments) : '—', `${headline.reviewed}/${headline.total} final reviews`],
          ['Open exceptions', summary ? String(summary.coordination.openExceptions) : '—', summary ? `${summary.coordination.criticalExceptions} critical` : ''],
          ['Open tasks', summary ? String(summary.coordination.openTasks) : '—', 'coordination layer'],
        ].map(([label, value, note]) => (
          <article className="metric" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Provider performance</h2><p className="muted small">Operational metrics are read from delivery and attendance records. Performance scores require human review.</p></div></div>
        {!providers.length && <div className="empty">{workspaceId ? (loading ? 'Loading providers…' : 'No provider assignments found for this workspace and period.') : 'Enter a Programme Workspace ID to begin.'}</div>}
        <div className="provider-list">
          {providers.map((provider) => {
            const review = provider.performanceReview;
            return <article className="provider" key={provider.assignment.id}>
              <div className="provider-head">
                <div><h3>{provider.provider.name}</h3><span className="badge">{provider.assignment.providerRole}</span> <span className="badge muted-badge">{provider.assignment.status}</span></div>
                <div className="operational">
                  <span>{provider.operational.totalSessions} sessions</span>
                  <span>{pct(provider.operational.sessionCompletionRate)} completion</span>
                  <span>{pct(provider.operational.attendanceRate)} attendance</span>
                </div>
              </div>
              <form className="review-grid" onSubmit={(e) => void saveReview(e, provider)}>
                {[
                  ['humanPerformanceScore', 'Human Performance', review?.humanPerformanceScore],
                  ['serviceQualityScore', 'Service Quality', review?.serviceQualityScore],
                  ['clientExperienceScore', 'Client Experience', review?.clientExperienceScore],
                  ['businessOutcomeScore', 'Business Outcome', review?.businessOutcomeScore],
                ].map(([name, label, value]) => <label key={String(name)}>{label}<input name={String(name)} type="number" min="0" max="100" step="1" defaultValue={value == null ? '' : Number(value)} placeholder="0–100" /></label>)}
                <label className="notes">Evidence / review note<textarea name="notes" defaultValue={review?.notes ?? ''} maxLength={5000} placeholder="Record the evidence or review context used for the score." /></label>
                <div className="review-actions">
                  <div className="composite">Composite <strong>{score(review?.compositeScore)}</strong><small>informational average only</small></div>
                  <button className="btn primary" type="submit">Save draft review</button>
                  {review?.id && review.status !== 'FINAL' && <button className="btn" type="button" onClick={() => void finalize(review.id)}>Finalize</button>}
                  {review?.status === 'FINAL' && <span className="final">FINAL</span>}
                </div>
              </form>
            </article>;
          })}
        </div>
      </section>
    </main>
  );
}
