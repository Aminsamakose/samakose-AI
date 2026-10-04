'use client';
import { dateFmt } from '@/lib/client/api';
import { dimensionMoves, trendPoints, trendSummary, type TrendCase } from '@/lib/client/trend';

const W = 640, H = 240, L = 40, R = 16, T = 16, B = 40;
const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Overall health score over time. Points are spaced evenly by check, labelled with dates. Hollow diamonds mark a framework version change. */
export function TrendChart({ cases }: { cases: TrendCase[] }) {
  const pts = trendPoints(cases);
  const moves = dimensionMoves(cases);
  const n = pts.length;
  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.overall).toFixed(1)}`).join(' ');
  const summary = trendSummary(pts);
  // Date labels are about 80 units wide. Label every few points and always the last, dropping an earlier label that would touch it.
  const step = n > 1 ? (W - L - R) / (n - 1) : W;
  const gap = Math.max(1, Math.ceil(80 / step));
  const showDate = (i: number) => i === n - 1 || (i % gap === 0 && n - 1 - i >= gap);
  const showValue = (i: number) => n <= 10 || i === 0 || i === n - 1 || (i > 0 && pts[i].overall !== pts[i - 1].overall);

  if (!n) return <p className="muted small">No scores yet. The trend appears after the first health check.</p>;
  return <div className="stack">
    <p className="small" role="status">{summary}</p>
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} style={{ width: '100%', minWidth: 420, height: 'auto', display: 'block' }}>
        {[0, 25, 50, 75, 100].map((t) => <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{t}</text>
        </g>)}
        {n > 1 && <path d={path} fill="none" stroke="var(--brand)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((p, i) => {
          const cx = x(i), cy = y(p.overall);
          return <g key={p.id}>
            <title>{`${dateFmt(p.at)}: ${p.overall} (${p.maturity}, ${p.confidence} confidence, ${p.framework})${p.delta === null ? '' : `, ${sign(p.delta)} since the previous check`}${p.frameworkChanged ? '. Framework version changed.' : ''}`}</title>
            {p.frameworkChanged
              ? <rect x={cx - 6} y={cy - 6} width={12} height={12} transform={`rotate(45 ${cx} ${cy})`} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2.5} />
              : <circle cx={cx} cy={cy} r={5.5} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />}
            {showValue(i) && <text x={cx} y={cy - 12} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--fg)">{p.overall}</text>}
            {showDate(i) && <text x={i === n - 1 && n > 1 ? cx + 8 : i === 0 && n > 1 ? cx - 8 : cx} y={H - B + 18} textAnchor={i === n - 1 && n > 1 ? 'end' : i === 0 && n > 1 ? 'start' : 'middle'} fontSize={11} fill="var(--muted)">{dateFmt(p.at)}</text>}
          </g>;
        })}
      </svg>
    </div>
    <p className="small muted"><span aria-hidden="true">●</span> Same framework version as the check before. <span aria-hidden="true">◇</span> Framework version changed, so part of the movement may come from the framework and not the business.</p>
    {moves.length > 0 && <section aria-labelledby="dm-h">
      <h3 id="dm-h" className="small">Dimensions, first check to latest</h3>
      <div className="table-wrap"><table><thead><tr><th>Dimension</th><th>First</th><th>Latest</th><th>Change</th></tr></thead>
        <tbody>{moves.map((m) => <tr key={m.dimension}><td>{m.dimension}</td><td>{m.first}</td><td>{m.latest}</td><td>{m.delta === 0 ? 'no change' : sign(m.delta)}</td></tr>)}</tbody></table></div>
    </section>}
  </div>;
}
