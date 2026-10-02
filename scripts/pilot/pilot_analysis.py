#!/usr/bin/env python3
"""Pilot analysis for the Business Health banks (needs numpy, scipy, pandas).

  analyse  <bank.json> <responses.csv> <out_dir> [--outcomes outcomes.csv] [--draws 500]
  selftest

responses.csv columns: case, org_type, diagnostic, version, rater, submitted_at, question_code, value, not_applicable, evidence_class
(from scripts/pilot/export-responses.ts). outcomes.csv: case plus one column per outcome (0/1 or numeric).
Targets come from docs/frameworks/banks/SPEC.md section 7. Nothing here is a claim of validity until the sample is large enough.
"""
import json, os, sys, tempfile
import numpy as np, pandas as pd
from scipy.stats import rankdata, spearmanr

MIN_CASES = 100
OMEGA_MIN, FLOOR_CEIL_MAX, KAPPA_MIN, ITEM_REST_MIN = 0.70, 0.15, 0.60, 0.20
SENS_SPEARMAN_MIN, SENS_BAND_MAX = 0.95, 0.10      # proposed by this tool, to be agreed
MULT = {'Verified': 1.0, 'Document-supported': 0.95, 'Self-reported': 0.8, 'Unverified': 0.6, 'Missing': 0.5}   # DEFAULT_RULES
BANDS = [(40, 'Critical'), (60, 'Fragile'), (75, 'Developing')]
RD = dict(not_ready=45, emerging=60, conditional=75, gate_block=2, gate_ready=3)
PAIR_DAYS = 14

# ------------------------------------------------------------------ data
def load(bank_path, csv_path):
    bank = json.load(open(bank_path, encoding='utf-8'))
    codes = [q['code'] for q in bank['questions']]
    df = pd.read_csv(csv_path, dtype={'case': str, 'rater': str})
    df = df[df['question_code'].isin(codes)].copy()
    df['submitted_at'] = pd.to_datetime(df['submitted_at'], utc=True, errors='coerce')
    df['not_applicable'] = df['not_applicable'].fillna(0).astype(int)
    return bank, codes, df

def matrices(df, codes):
    """One row per diagnostic. V values (NaN when unanswered or not applicable), NA flag, M evidence multiplier."""
    idx = {c: i for i, c in enumerate(codes)}
    diags = df.drop_duplicates('diagnostic').set_index('diagnostic')[['case', 'rater', 'submitted_at', 'version']]
    pos = {d: i for i, d in enumerate(diags.index)}
    V = np.full((len(diags), len(codes)), np.nan); NA = np.zeros_like(V, dtype=bool); M = np.full_like(V, np.nan)
    for r in df.itertuples(index=False):
        i, j = pos[r.diagnostic], idx[r.question_code]
        if r.not_applicable: NA[i, j] = True
        else: V[i, j] = r.value; M[i, j] = MULT.get(r.evidence_class, 0.8)
    return diags, V, NA, M

def first_per_case(diags):
    d = diags.reset_index().sort_values(['case', 'submitted_at', 'version'])
    first = d.drop_duplicates('case')
    return [int(diags.index.get_loc(x)) for x in first['diagnostic']]

# ------------------------------------------------------------------ scoring (mirrors src/domain)
def score(V, M, w, cols):
    v, m = V[:, cols], M[:, cols]; ww = w[cols][None, :]
    ok = ~np.isnan(v)
    num = np.where(ok, ww * (np.nan_to_num(v) / 4) * np.nan_to_num(m), 0).sum(1); den = np.where(ok, ww, 0).sum(1)
    return np.where(den > 0, 100 * num / np.where(den > 0, den, 1), np.nan)

def band(x):
    out = np.empty(len(x), dtype=object)
    for i, s in enumerate(x): out[i] = 'n/a' if np.isnan(s) else next((n for t, n in BANDS if s < t), 'Strong')
    return out

def readiness_levels(V, NA, M, w, bank, codes):
    qs = bank['questions']; res = {}
    for r in bank['readiness']:
        cols = [i for i, q in enumerate(qs) if r['code'] in q.get('readiness', [])]
        gate = [i for i in cols if qs[i]['criticality'] == 'Gate']
        idx = score(V, M, w, cols)
        lv = []
        for k in range(V.shape[0]):
            gv = [(0 if np.isnan(V[k, g]) and not NA[k, g] else (None if NA[k, g] else V[k, g])) for g in gate]   # unanswered gate blocks, N/A passes
            gv = [x for x in gv if x is not None]
            s = idx[k]
            if np.isnan(s) or s < RD['not_ready'] or any(x < RD['gate_block'] for x in gv): lv.append('Not ready')
            elif s < RD['emerging']: lv.append('Emerging')
            elif s < RD['conditional']: lv.append('Conditionally ready')
            else: lv.append('Ready' if all(x >= RD['gate_ready'] for x in gv) else 'Conditionally ready')
        res[r['code']] = (idx, np.array(lv, dtype=object))
    return res

# ------------------------------------------------------------------ reliability
def corr_pairwise(X, min_n=20):
    return pd.DataFrame(X).corr(min_periods=min_n).values

def std_alpha(R):
    k = R.shape[0]
    if k < 2: return np.nan
    rbar = (R.sum() - k) / (k * (k - 1))
    return k * rbar / (1 + (k - 1) * rbar)

def omega_1f(R, iters=200):
    """McDonald's omega from a one factor solution (iterated principal axis on the correlation matrix)."""
    R = np.nan_to_num(R.copy(), nan=0.0); k = R.shape[0]
    if k < 3: return np.nan
    h = np.clip(np.max(np.abs(R - np.eye(k)), axis=1), 0.05, 0.95)
    lam = np.sqrt(h)
    for _ in range(iters):
        Rr = R.copy(); np.fill_diagonal(Rr, h)
        vals, vecs = np.linalg.eigh(Rr)
        l = vecs[:, -1] * np.sqrt(max(vals[-1], 0)); l = l if l.sum() >= 0 else -l
        hn = np.clip(l ** 2, 0.005, 0.995)
        if np.max(np.abs(hn - h)) < 1e-6: lam = np.sqrt(hn); break
        h = hn; lam = np.sqrt(h)
    lam = np.minimum(np.abs(lam), 0.995); s = lam.sum() ** 2
    return s / (s + (1 - lam ** 2).sum())

def item_rest(V, cols):
    out = {}
    for j in cols:
        rest = np.nanmean(V[:, [c for c in cols if c != j]], axis=1)
        ok = ~np.isnan(V[:, j]) & ~np.isnan(rest)
        out[j] = np.corrcoef(V[ok, j], rest[ok])[0, 1] if ok.sum() >= 20 and np.nanstd(V[ok, j]) > 0 and np.nanstd(rest[ok]) > 0 else np.nan
    return out

# ------------------------------------------------------------------ agreement
def qwk(a, b, k=5):
    a, b = np.asarray(a, int), np.asarray(b, int)
    if len(a) < 2: return np.nan
    O = np.zeros((k, k)); [O.__setitem__((x, y), O[x, y] + 1) for x, y in zip(a, b)]
    W = np.array([[(i - j) ** 2 for j in range(k)] for i in range(k)]) / (k - 1) ** 2
    E = np.outer(O.sum(1), O.sum(0)) / O.sum()
    den = (W * E).sum()
    return 1 - (W * O).sum() / den if den > 0 else np.nan

def rater_pairs(diags):
    d = diags.reset_index().sort_values('submitted_at'); pairs = []
    for case, g in d.groupby('case'):
        g = g.reset_index(drop=True); t0 = g.loc[0, 'submitted_at']
        near = g[(g['submitted_at'] - t0) <= pd.Timedelta(days=PAIR_DAYS)]
        a = near.iloc[0]; other = near[near['rater'] != a['rater']]
        if len(other): pairs.append((int(diags.index.get_loc(a['diagnostic'])), int(diags.index.get_loc(other.iloc[0]['diagnostic']))))
    return pairs

# ------------------------------------------------------------------ AUC
def auc(score_, y):
    y = np.asarray(y); s = np.asarray(score_); ok = ~np.isnan(s) & ~np.isnan(y); s, y = s[ok], y[ok]
    n1, n0 = (y == 1).sum(), (y == 0).sum()
    if n1 < 5 or n0 < 5: return np.nan, int(ok.sum())
    r = rankdata(s); return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0), int(ok.sum())

# ------------------------------------------------------------------ main analysis
def analyse(bank_path, csv_path, out_dir, outcomes=None, draws=500, seed=11):
    bank, codes, df = load(bank_path, csv_path)
    qs = bank['questions']; w = np.array([q['weight'] for q in qs], float)
    doms = {d['code']: d['name'] for d in bank['domains']}
    dom_cols = {d: [i for i, q in enumerate(qs) if q['domain'] == d] for d in doms}
    diags, V, NA, M = matrices(df, codes)
    pick = first_per_case(diags); Vb, NAb, Mb = V[pick], NA[pick], M[pick]; cases = diags.iloc[pick]['case'].values
    n = len(pick); os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(seed)
    overall = score(Vb, Mb, w, list(range(len(codes)))); dom_scores = {d: score(Vb, Mb, w, c) for d, c in dom_cols.items()}

    # items
    irest = {d: item_rest(Vb, c) for d, c in dom_cols.items()}
    items = []
    for j, q in enumerate(qs):
        a = Vb[:, j]; ans = ~np.isnan(a)
        items.append({'code': q['code'], 'domain': q['domain'], 'subDimension': q['subDimension'], 'text': q['text'], 'weight': q['weight'], 'criticality': q['criticality'],
                      'answered': int(ans.sum()), 'notApplicableShare': round(NAb[:, j].mean(), 3), 'unansweredShare': round((~ans & ~NAb[:, j]).mean(), 3),
                      'mean': round(float(np.nanmean(a)), 2) if ans.any() else None, 'sd': round(float(np.nanstd(a)), 2) if ans.any() else None,
                      'floorShare': round(float((a[ans] == 0).mean()), 3) if ans.any() else None, 'ceilingShare': round(float((a[ans] == 4).mean()), 3) if ans.any() else None,
                      'itemRest': None if np.isnan(irest[q['domain']][j]) else round(float(irest[q['domain']][j]), 2)})
    idf = pd.DataFrame(items); idf.to_csv(os.path.join(out_dir, 'items.csv'), index=False, encoding='utf-8-sig')

    # domains
    drows = []
    for d, cols in dom_cols.items():
        R = corr_pairwise(Vb[:, cols]); s = dom_scores[d]; ok = ~np.isnan(s)
        drows.append({'domain': d, 'name': doms[d], 'items': len(cols), 'alphaStd': None if np.isnan(std_alpha(R)) else round(float(std_alpha(R)), 2),
                      'omega': None if np.isnan(omega_1f(R)) else round(float(omega_1f(R)), 2), 'meanScore': round(float(np.nanmean(s)), 1), 'sdScore': round(float(np.nanstd(s)), 1),
                      'floorShare': round(float((s[ok] <= 5).mean()), 3), 'ceilingShare': round(float((s[ok] >= 95).mean()), 3)})
    ddf = pd.DataFrame(drows); ddf.to_csv(os.path.join(out_dir, 'domains.csv'), index=False, encoding='utf-8-sig')
    ok = ~np.isnan(overall)

    # weight sensitivity
    base_band, base_rd = band(overall), readiness_levels(Vb, NAb, Mb, w, bank, codes)
    all_cols = list(range(len(codes)))
    def compare(w2, M2=Mb):
        o2 = score(Vb, M2, w2, all_cols); rho = spearmanr(overall[ok], o2[ok]).statistic
        chg = float((band(o2)[ok] != base_band[ok]).mean()); d_ = np.abs(o2[ok] - overall[ok])
        rd2 = readiness_levels(Vb, NAb, M2, w2, bank, codes)
        rchg = float(np.mean([(rd2[k][1] != base_rd[k][1]).mean() for k in base_rd]))
        return rho, chg, float(np.percentile(d_, 95)), rchg
    sens = []
    sens.append(('Equal weights', *compare(np.ones_like(w))))
    sens.append(('Evidence ignored (all multipliers 1)', *compare(w, np.where(np.isnan(Mb), np.nan, 1.0))))
    R_ = np.array([compare(np.clip(w + rng.integers(-1, 2, size=w.shape), 1, 5)) for _ in range(draws)])
    sens.append((f'Each weight moved by -1, 0 or +1 ({draws} draws), mean', *R_.mean(0)))
    sens.append((f'Same, worst draw', R_[:, 0].min(), R_[:, 1].max(), R_[:, 2].max(), R_[:, 3].max()))
    sdf = pd.DataFrame(sens, columns=['scenario', 'spearmanWithOfficial', 'shareChangingBand', 'p95AbsScoreChange', 'shareReadinessLevelChanging']).round(3)
    sdf.to_csv(os.path.join(out_dir, 'sensitivity.csv'), index=False, encoding='utf-8-sig')

    # inter-rater
    pairs = rater_pairs(diags); rrows = []
    if len(pairs) >= 5:
        for d, cols in list(dom_cols.items()) + [('ALL', all_cols)]:
            a, b = [], []
            for i, k in pairs:
                for j in cols:
                    if not np.isnan(V[i, j]) and not np.isnan(V[k, j]): a.append(V[i, j]); b.append(V[k, j])
            rrows.append({'scope': d, 'pairsOfCases': len(pairs), 'itemPairs': len(a), 'weightedKappa': None if not a else round(float(qwk(a, b)), 2),
                          'withinOnePoint': None if not a else round(float((np.abs(np.array(a) - np.array(b)) <= 1).mean()), 3)})
        pd.DataFrame(rrows).to_csv(os.path.join(out_dir, 'inter_rater.csv'), index=False, encoding='utf-8-sig')
        so = np.array([[score(V[[i]], M[[i]], w, all_cols)[0], score(V[[k]], M[[k]], w, all_cols)[0]] for i, k in pairs]); mad = float(np.nanmean(np.abs(so[:, 0] - so[:, 1])))
    else: mad = None

    # criterion validity
    crows = []
    if outcomes and os.path.exists(outcomes):
        o = pd.read_csv(outcomes, dtype={'case': str}).set_index('case'); o = o.reindex(cases)
        preds = {'Overall score': overall, **{f'{d} {doms[d]}': dom_scores[d] for d in doms}, **{f"{r['code']} index": base_rd[r['code']][0] for r in bank['readiness']}}
        for col in o.columns:
            y = pd.to_numeric(o[col], errors='coerce').values; binary = set(np.unique(y[~np.isnan(y)])) <= {0.0, 1.0}
            for name, s in preds.items():
                if binary: a_, m_ = auc(s, y); crows.append({'outcome': col, 'predictor': name, 'type': 'AUC', 'value': None if np.isnan(a_) else round(float(a_), 2), 'n': m_})
                else:
                    okk = ~np.isnan(s) & ~np.isnan(y)
                    if okk.sum() >= 20: crows.append({'outcome': col, 'predictor': name, 'type': 'Spearman', 'value': round(float(spearmanr(s[okk], y[okk]).statistic), 2), 'n': int(okk.sum())})
        pd.DataFrame(crows).to_csv(os.path.join(out_dir, 'criterion.csv'), index=False, encoding='utf-8-sig')

    # report
    f = lambda x: '' if x is None or (isinstance(x, float) and np.isnan(x)) else x
    L = [f"# {bank['framework']} pilot analysis", '', f"Bank {bank['version']}. Cases analysed (first diagnostic per case): {n}. Diagnostics in file: {len(diags)}.", '']
    if n < MIN_CASES: L += [f'**Sample too small.** The bank specification asks for at least {MIN_CASES} completed cases per platform before reliability is judged. With {n} cases the figures below are indicative only and must not be used to claim validity or to change weights.', '']
    L += ['## Targets (SPEC section 7)', '', '| Check | Target | Result | Status |', '|---|---|---|---|']
    def st(ok_): return 'Pass' if ok_ else 'Not met'
    L.append(f'| Completed cases | {MIN_CASES} or more | {n} | {st(n >= MIN_CASES)} |')
    for r in drows: L.append(f"| {r['domain']} reliability (omega) | {OMEGA_MIN} or more | {f(r['omega'])} (alpha {f(r['alphaStd'])}) | {st((r['omega'] or 0) >= OMEGA_MIN)} |")
    for r in drows: L.append(f"| {r['domain']} floor and ceiling | under {int(FLOOR_CEIL_MAX * 100)} percent each | {r['floorShare'] * 100:.0f} and {r['ceilingShare'] * 100:.0f} percent | {st(r['floorShare'] < FLOOR_CEIL_MAX and r['ceilingShare'] < FLOOR_CEIL_MAX)} |")
    ms = sdf.iloc[2]
    L.append(f"| Weight sensitivity (proposed target) | Spearman {SENS_SPEARMAN_MIN} or more, under {int(SENS_BAND_MAX * 100)} percent change band | {ms.spearmanWithOfficial:.2f}, {ms.shareChangingBand * 100:.0f} percent | {st(ms.spearmanWithOfficial >= SENS_SPEARMAN_MIN and ms.shareChangingBand < SENS_BAND_MAX)} |")
    if rrows:
        al = [r for r in rrows if r['scope'] == 'ALL'][0]; L.append(f"| Inter-rater agreement (weighted kappa) | {KAPPA_MIN} or more | {f(al['weightedKappa'])} on {al['pairsOfCases']} double-rated cases | {st((al['weightedKappa'] or 0) >= KAPPA_MIN)} |")
    else: L.append('| Inter-rater agreement (weighted kappa) | 0.60 or more | Fewer than 5 double-rated cases | Not tested |')
    L += ['', '## Domains', '', '| Domain | Items | Omega | Alpha | Mean | SD | Floor | Ceiling |', '|---|---|---|---|---|---|---|---|']
    for r in drows: L.append(f"| {r['domain']} {r['name']} | {r['items']} | {f(r['omega'])} | {f(r['alphaStd'])} | {r['meanScore']} | {r['sdScore']} | {r['floorShare'] * 100:.0f}% | {r['ceilingShare'] * 100:.0f}% |")
    L += ['', '## Weight sensitivity', '', '| Scenario | Rank correlation with official | Share changing maturity band | 95th percentile score change | Share of readiness levels changing |', '|---|---|---|---|---|']
    for r in sdf.itertuples(index=False): L.append(f'| {r.scenario} | {r.spearmanWithOfficial:.3f} | {r.shareChangingBand * 100:.0f}% | {r.p95AbsScoreChange:.1f} | {r.shareReadinessLevelChanging * 100:.0f}% |')
    L += ['', '## Questions to review', '']
    weak = idf[(idf['itemRest'].notna()) & (idf['itemRest'] < ITEM_REST_MIN)]; fc = idf[(idf['floorShare'] > FLOOR_CEIL_MAX) | (idf['ceilingShare'] > FLOOR_CEIL_MAX)]
    na = idf[(idf['notApplicableShare'] > 0.4) | (idf['unansweredShare'] > 0.10)]
    def tbl(title, d, cols):
        L.extend([f'### {title}', ''])
        if d.empty: L.extend(['None.', '']); return
        L.append('| Code | Statement | ' + ' | '.join(c[1] for c in cols) + ' |'); L.append('|---|---|' + '---|' * len(cols))
        for r in d.itertuples(index=False): L.append(f'| {r.code} | {r.text} | ' + ' | '.join(str(getattr(r, c[0])) for c in cols) + ' |')
        L.append('')
    tbl(f'Weak link to the rest of the domain (item-rest correlation under {ITEM_REST_MIN})', weak, [('itemRest', 'Item-rest r')])
    tbl(f'Most answers at one end (over {int(FLOOR_CEIL_MAX * 100)} percent at 0 or at 4)', fc, [('floorShare', 'At 0'), ('ceilingShare', 'At 4')])
    tbl('Often not applicable or unanswered', na, [('notApplicableShare', 'Not applicable'), ('unansweredShare', 'Unanswered')])
    if rrows:
        L += ['## Inter-rater agreement', '', f'Double-rated cases are cases with a second diagnostic by a different rater within {PAIR_DAYS} days of the first. Mean absolute difference in overall score between raters: {mad:.1f} points.', '', '| Scope | Item pairs | Weighted kappa | Within one point |', '|---|---|---|---|']
        for r in rrows: L.append(f"| {r['scope']} | {r['itemPairs']} | {f(r['weightedKappa'])} | {f(r['withinOnePoint'])} |")
        L.append('')
    if crows:
        L += ['## Criterion validity', '', 'AUC of 0.5 means no better than chance, 0.7 is acceptable, 0.8 is strong. Many comparisons are made, so treat single results with caution.', '', '| Outcome | Predictor | Measure | Value | Cases |', '|---|---|---|---|---|']
        for r in crows: L.append(f"| {r['outcome']} | {r['predictor']} | {r['type']} | {f(r['value'])} | {r['n']} |")
        L.append('')
    L += ['## Reading these results', '',
          '- Business health domains are partly formative: a business can be strong on some practices and weak on others, so items need not move together. A low omega is a prompt to review the domain, not proof that it is broken.',
          '- Floor and ceiling here are the share of cases in the bottom or top five points of a domain score. Item level floors and ceilings are listed for review only.',
          '- The weight sensitivity target is proposed by this tool and needs to be agreed. Changing weights, gates or removing a question is a major version change that needs Amin\'s approval.',
          '- Do not recalibrate on fewer than 100 cases, and keep the data that produced any recalibration with the new bank version.']
    open(os.path.join(out_dir, 'report.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print(f"{bank['framework']}: {n} cases, mean omega {np.nanmean([r['omega'] if r['omega'] is not None else np.nan for r in drows]):.2f}, report -> {out_dir}/report.md")
    return dict(n=n, domains=ddf, items=idf, sens=sdf, rater=pd.DataFrame(rrows), criterion=pd.DataFrame(crows))

# ------------------------------------------------------------------ selftest
def simulate(bank, path, n_cases=150, seed=3, outcomes_path=None, pair_share=0.3):
    rng = np.random.default_rng(seed); qs = bank['questions']; rows = []; out = []
    for c in range(n_cases):
        g = rng.normal(); dom = {d['code']: rng.normal(0, 0.6) for d in bank['domains']}
        t0 = pd.Timestamp('2026-11-01', tz='UTC') + pd.Timedelta(days=int(rng.integers(0, 40)))
        raters = [f'R{rng.integers(1, 4)}'] + ([f'R{rng.integers(4, 6)}'] if rng.random() < pair_share else [])
        latent = {q['code']: 1.6 + 1.1 * (0.7 * g + dom[q['domain']]) + rng.normal(0, 0.8) for q in qs}
        for ri, rater in enumerate(raters):
            did = f'D{c:03d}-{ri}'
            for q in qs:
                if q['applies'] != 'All' and (hash((c, q['code'])) % 10) < 3: rows.append([f'C{c:03d}', 'SME', did, 1, rater, t0 + pd.Timedelta(days=ri), q['code'], 0, 1, 'Self-reported']); continue
                v = int(np.clip(round(latent[q['code']] + (rng.normal(0, 0.35) if ri else 0)), 0, 4))
                rows.append([f'C{c:03d}', 'SME', did, 1, rater, t0 + pd.Timedelta(days=ri), q['code'], v, 0, rng.choice(list(MULT), p=[.1, .2, .5, .1, .1])])
        out.append([f'C{c:03d}', int(rng.random() < 1 / (1 + np.exp(-1.5 * g))), 'x'])
    pd.DataFrame(rows, columns=['case', 'org_type', 'diagnostic', 'version', 'rater', 'submitted_at', 'question_code', 'value', 'not_applicable', 'evidence_class']).to_csv(path, index=False)
    if outcomes_path: pd.DataFrame(out, columns=['case', 'loan_access', 'note']).drop(columns='note').assign(revenue_growth=lambda d: rng.normal(5, 10, len(d)) + 8 * d['loan_access']).to_csv(outcomes_path, index=False)

def selftest():
    # known values
    assert abs(qwk([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]) - 1) < 1e-9 and qwk([0, 4, 0, 4], [4, 0, 4, 0]) < 0
    assert abs(auc(np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10.]), np.array([0] * 5 + [1] * 5))[0] - 1) < 1e-9
    R = np.full((5, 5), 0.5); np.fill_diagonal(R, 1); assert abs(std_alpha(R) - 5 * .5 / (1 + 4 * .5)) < 1e-9 and 0.7 < omega_1f(R) < 0.85
    here = os.path.dirname(os.path.abspath(__file__)); bank_path = os.path.join(here, '..', '..', 'docs', 'frameworks', 'banks', 'sme360-bank-v1.json')
    bank = json.load(open(bank_path, encoding='utf-8'))
    with tempfile.TemporaryDirectory() as t:
        csv_, oc = os.path.join(t, 'r.csv'), os.path.join(t, 'o.csv'); simulate(bank, csv_, 150, outcomes_path=oc)
        r = analyse(bank_path, csv_, os.path.join(t, 'out'), outcomes=oc, draws=60)
        assert r['n'] == 150 and len(r['items']) == 100 and len(r['domains']) == 8
        assert r['domains']['omega'].mean() > 0.6, r['domains']['omega'].mean()
        assert r['sens'].iloc[0]['spearmanWithOfficial'] > 0.8
        assert not r['rater'].empty and r['rater'][r['rater'].scope == 'ALL'].weightedKappa.iloc[0] > 0.4
        assert r['criterion'][(r['criterion'].outcome == 'loan_access') & (r['criterion'].predictor == 'Overall score')].value.iloc[0] > 0.6
        txt = open(os.path.join(t, 'out', 'report.md'), encoding='utf-8').read()
        assert 'Sample too small' not in txt and '—' not in txt
        csv2 = os.path.join(t, 's.csv'); simulate(bank, csv2, 30, seed=5); analyse(bank_path, csv2, os.path.join(t, 'out2'), draws=20)
        assert 'Sample too small' in open(os.path.join(t, 'out2', 'report.md'), encoding='utf-8').read()
    print('selftest passed')

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['selftest']: selftest()
    elif a[:1] == ['analyse'] and len(a) >= 4:
        oc = a[a.index('--outcomes') + 1] if '--outcomes' in a else None; dr = int(a[a.index('--draws') + 1]) if '--draws' in a else 500
        analyse(a[1], a[2], a[3], oc, dr)
    else: print(__doc__); sys.exit(1)
