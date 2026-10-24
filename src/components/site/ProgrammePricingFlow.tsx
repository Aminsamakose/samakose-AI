'use client';
/**
 * The customer-facing One business / Individual (coming soon) / Programme cohort flow, reading
 * only from the published pricing configuration (/public/pricing) - never from a draft, never
 * from anything an admin is still editing. The price shown here is always labelled an estimate;
 * the authoritative amount for anything actually charged is computed server-side at checkout time
 * (see pricing.ts's quoteOneBusiness/quoteProgramme), never trusted from this client calculation.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from './ui';

const PLATFORM_LABEL: Record<string, string> = { SME: 'SME360', AGRIFOOD: 'AgriFood360', ESO: 'ESO360' };
const PLATFORM_DESC: Record<string, string> = { SME: 'General SME health and readiness', AGRIFOOD: 'Agri-food business readiness', ESO: 'Enterprise-support organisation capacity' };
const SETUP_LABEL: Record<string, string> = { samakose_only: 'Samakose tool', partner_only: 'Partner tools', both: 'Both' };

type Pkg = { key: string; name: string; durationLabel: string; pricesGhs: Partial<Record<string, number>> };
type Rule = { setup: string; discountPct: number; oneSamakosePlatformOnly: boolean; partnerToolsNameRequired: boolean; customerFacingNote: string | null };
type PricingData = { platforms: Record<string, { enabled: boolean }>; packages: Pkg[]; programmeRules: Rule[]; tax: { mode: string } } | null;

const money = (n: number) => 'GH₵' + n.toLocaleString('en-GH', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export function ProgrammePricingFlow() {
  const [data, setData] = useState<PricingData>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState<'one' | 'individual' | 'programme'>('programme');
  const [setup, setSetup] = useState('samakose_only');
  const [platform, setPlatform] = useState('SME');
  const [packageKey, setPackageKey] = useState('');
  const [participants, setParticipants] = useState(30);
  const [quote, setQuote] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetch('/api/v1/public/pricing').then((r) => r.ok ? r.json() : null).then((j) => { setData(j?.data ?? null); setLoading(false); }).catch(() => setLoading(false)); }, []);

  const platforms = useMemo(() => Object.entries(data?.platforms ?? {}).filter(([, v]) => v.enabled).map(([k]) => k), [data]);
  const packages = data?.packages ?? [];
  const rule = data?.programmeRules.find((r) => r.setup === setup);

  useEffect(() => { if (!packageKey && packages.length) setPackageKey(packages[0].key); }, [packages, packageKey]);
  useEffect(() => { if (!platforms.includes(platform) && platforms[0]) setPlatform(platforms[0]); }, [platforms, platform]);

  const review = async () => {
    setError(null); setQuote(null);
    try {
      const params = new URLSearchParams(
        path === 'programme'
          ? { toolSetup: setup, ...(rule?.oneSamakosePlatformOnly ? { platform } : {}), packageKey, participantCount: String(participants) }
          : { platform, packageKey }
      );
      const res = await fetch(`/api/v1/public/pricing/quote/${path === 'programme' ? 'programme' : 'one-business'}?${params}`);
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? 'Could not estimate this price. Please check your selections.'); return; }
      setQuote(json.data);
    } catch { setError('Could not reach the pricing service. Please try again.'); }
  };

  if (loading) return <Card className="animate-pulse"><div className="h-6 w-40 rounded bg-black/5" /></Card>;
  if (!data) return <Card><p className="text-sm text-muted">Pricing is being finalised. Please check back shortly, or send an enquiry.</p></Card>;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-card border p-4">
        <h1 className="font-display text-2xl font-bold">Business Doctor pricing</h1>
        <p className="mt-1 text-sm text-muted">Choose a business support plan or a programme cohort package. Individual entrepreneur assessments are coming soon.</p>
      </div>
      <div role="tablist" aria-label="Purchase path" className="flex flex-wrap gap-2">
        {([['one', 'One business'], ['individual', 'Individual · Coming soon'], ['programme', 'Programme cohort']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={path === id} onClick={() => setPath(id)} type="button"
            className={`rounded-full border px-4 py-2 text-sm font-medium ${path === id ? 'border-forest bg-forest/10 text-forest' : 'border-line text-muted'}`}>{label}</button>
        ))}
      </div>

      {path === 'individual' && <Card><p className="text-sm text-muted">Individual entrepreneur assessments (such as SWOT and Entrepreneurship/E-Readiness) are planned but not yet available for purchase. No price or date is set yet — check back soon.</p></Card>}

      {path === 'one' && (
        <Card>
          <h2 className="font-display text-lg font-bold">Buy for one business</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="one-platform">1. Choose a platform</label>
              <div className="mt-2 grid gap-2">
                {platforms.map((p) => (
                  <label key={p} className={`flex cursor-pointer flex-col rounded-card border p-3 ${platform === p ? 'border-forest bg-forest/5' : 'border-line'}`}>
                    <span className="flex items-center gap-2"><input type="radio" name="one-platform" checked={platform === p} onChange={() => setPlatform(p)} />{PLATFORM_LABEL[p]}</span>
                    <span className="ml-6 text-xs text-muted">{PLATFORM_DESC[p]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="one-package">2. Choose a package and duration</label>
              <select id="one-package" className="mt-2 w-full rounded-card border p-2" value={packageKey} onChange={(e) => setPackageKey(e.target.value)}>
                {packages.map((p) => <option key={p.key} value={p.key}>{p.name} · {money(p.pricesGhs[platform] ?? 0)} · {p.durationLabel}</option>)}
              </select>
            </div>
          </div>
          <button type="button" onClick={review} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-forest px-6 text-sm font-semibold text-white">Review payment estimate</button>
        </Card>
      )}

      {path === 'programme' && (
        <Card>
          <h2 className="font-display text-lg font-bold">Set up your programme</h2>
          <div className="mt-3">
            <label className="text-sm font-medium">1. Which tools will the programme use?</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(data.programmeRules ?? []).map((r) => (
                <label key={r.setup} className={`cursor-pointer rounded-card border p-3 ${setup === r.setup ? 'border-forest bg-forest/5' : 'border-line'}`}>
                  <span className="flex items-center gap-2"><input type="radio" name="setup" checked={setup === r.setup} onChange={() => setSetup(r.setup)} />{SETUP_LABEL[r.setup]}</span>
                  <span className="ml-6 block text-xs text-muted">{r.discountPct}% off the package rate</span>
                </label>
              ))}
            </div>
          </div>
          {rule?.oneSamakosePlatformOnly && (
            <div className="mt-4">
              <label className="text-sm font-medium">2. Select one Samakose platform</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {platforms.map((p) => (
                  <label key={p} className={`cursor-pointer rounded-card border p-3 ${platform === p ? 'border-forest bg-forest/5' : 'border-line'}`}>
                    <span className="flex items-center gap-2"><input type="radio" name="programme-platform" checked={platform === p} onChange={() => setPlatform(p)} />{PLATFORM_LABEL[p]}</span>
                    <span className="ml-6 block text-xs text-muted">{PLATFORM_DESC[p]}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">Only one Samakose platform may be selected per programme.</p>
            </div>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium" htmlFor="prog-package">3. Choose a package and duration</label>
              <select id="prog-package" className="mt-2 w-full rounded-card border p-2" value={packageKey} onChange={(e) => setPackageKey(e.target.value)}>
                {packages.map((p) => <option key={p.key} value={p.key}>{p.name} · {money(p.pricesGhs[platform] ?? Object.values(p.pricesGhs)[0] ?? 0)} · {p.durationLabel}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="prog-count">4. Number of participating businesses</label>
              <input id="prog-count" type="number" min={1} className="mt-2 w-full rounded-card border p-2" value={participants}
                onChange={(e) => setParticipants(Math.max(1, Number(e.target.value) || 1))} aria-describedby="prog-count-hint" />
            </div>
          </div>
          <p id="prog-count-hint" className="mt-2 text-xs text-muted">Package duration is included in the listed rate; no extra monthly multiplier is applied.</p>
          <button type="button" onClick={review} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-forest px-6 text-sm font-semibold text-white">Review payment estimate</button>
        </Card>
      )}

      {error && <div role="alert" className="rounded-card border border-dashed border-gold bg-[color:var(--warn-soft)] p-3 text-sm text-[color:var(--warn)]">{error}</div>}

      {quote && path !== 'individual' && (
        <Card className="bg-forest/5">
          <h2 className="font-display text-lg font-bold">{path === 'programme' ? 'Programme estimate' : 'Estimate'}</h2>
          <div className="mt-3 rounded-card bg-white p-4">
            <p className="text-xs text-muted">Estimated total including tax</p>
            <p className="font-display text-3xl font-extrabold text-forest">{money(quote.totalGhs)}</p>
            {path === 'programme' && <p className="text-xs text-muted">{money(Math.round((quote.totalGhs / quote.participantCount) * 100) / 100)} incl. estimated tax per participating business</p>}
          </div>
          <dl className="mt-3 grid gap-1 text-sm">
            <Row k="Package" v={`${quote.package} · ${quote.durationLabel}`} />
            {path === 'programme' && <Row k="Tool setup" v={`${SETUP_LABEL[setup]}${quote.platform ? ' · ' + PLATFORM_LABEL[quote.platform] : ''}`} />}
            {path === 'programme' && <Row k="Participants" v={String(quote.participantCount)} />}
            <Row k="Estimated subtotal before tax" v={money(path === 'programme' ? quote.listSubtotalGhs : quote.subtotalGhs)} />
            {path === 'programme' && <Row k={`Programme discount (${quote.discountPct}%)`} v={'-' + money(quote.discountAmountGhs)} />}
            {quote.taxLines?.map((l: any) => <Row key={l.name} k={`${l.name} (${l.pct}%)`} v={money(l.amountGhs)} />)}
            <Row k="Estimated total including tax" v={money(quote.totalGhs)} />
          </dl>
          <p className="mt-3 text-xs text-muted">This is an estimate, not a final payable amount. The final amount is confirmed before payment by the authoritative checkout.</p>
        </Card>
      )}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) { return <div className="flex justify-between border-t pt-1 first:border-0 first:pt-0"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>; }
