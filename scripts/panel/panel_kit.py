#!/usr/bin/env python3
"""Expert panel kit for the Business Health banks.

  make     <bank.json> <out.xlsx>                 build the rating workbook sent to each expert
  analyse  <bank.json> <returned_dir> <out_dir>   content validity results from the returned workbooks
  selftest                                        check the maths and the round trip

Content validity method: item-level content validity index (I-CVI) on a 4 point relevance scale, the proportion of experts
rating 3 or 4, with the modified kappa that adjusts for chance agreement (Lynn 1986; Polit, Beck and Owen 2007).
Thresholds come from the bank specification (docs/frameworks/banks/SPEC.md section 7): I-CVI of 0.78 or more with 6 to 10 experts.
"""
import csv, json, math, os, random, statistics, sys, tempfile
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

CVI_MIN = 0.78          # item level threshold from SPEC section 7
FIT_MIN = 0.67          # share of experts who must say anchors fit or evidence is realistic
PANEL_MIN, PANEL_MAX = 6, 10
SCALE = {1: 'Not relevant', 2: 'Somewhat relevant', 3: 'Quite relevant', 4: 'Highly relevant'}
CLARITY = {1: 'Not clear', 2: 'Needs major rewording', 3: 'Clear, minor rewording', 4: 'Very clear'}
YNU = ['Yes', 'No', 'Unsure']
COLS = ['Code', 'Domain', 'Sub-dimension', 'Statement being rated', 'What each rating means (0 to 4)', 'Evidence the assessor looks for',
        'Relevance (1-4)', 'Clarity (1-4)', 'Anchors fit? (Yes/No/Unsure)', 'Evidence realistic in Ghana? (Yes/No/Unsure)',
        'Should block readiness if low? (Yes/No/Unsure)', 'Suggested weight 1-5 (optional)', 'Comment', 'Suggested wording']
IN0 = 6  # index of first input column (0 based)

def load_bank(path):
    b = json.load(open(path, encoding='utf-8'))
    doms = {d['code']: d['name'] for d in b['domains']}
    subs = {s['code']: s['name'] for s in b['subDimensions']}
    return b, doms, subs

def anchors_text(q):
    return '\n'.join(f'{i}: {a}' for i, a in enumerate(q['anchors']) if a)

# ----------------------------------------------------------------- maths
def i_cvi(ratings, ok=(3, 4)):
    r = [x for x in ratings if x is not None]
    if not r: return None, 0, 0
    a = sum(1 for x in r if x in ok)
    return a / len(r), len(r), a

def modified_kappa(n, a, cvi):
    """Kappa adjusted for chance: pc = C(N,A) * 0.5^N."""
    if n == 0: return None
    pc = math.comb(n, a) * 0.5 ** n
    return 1.0 if pc >= 1 else (cvi - pc) / (1 - pc)

def kappa_band(k):
    if k is None: return ''
    return 'Excellent' if k > 0.74 else 'Good' if k >= 0.60 else 'Fair' if k >= 0.40 else 'Poor'

def share(vals, yes='Yes'):
    v = [x for x in vals if x in YNU]
    return (sum(1 for x in v if x == yes) / len(v)) if v else None

def decide(rel, clar, fit, evi):
    """Plain decision rule. The panel informs the decision, Amin signs it off."""
    if rel is None: return 'No ratings'
    if rel < 0.5: return 'Candidate to remove'
    if rel < CVI_MIN: return 'Revise or merge'
    notes = []
    if clar is not None and clar < CVI_MIN: notes.append('wording')
    if fit is not None and fit < FIT_MIN: notes.append('anchors')
    if evi is not None and evi < FIT_MIN: notes.append('evidence')
    return 'Keep, revise ' + ' and '.join(notes) if notes else 'Keep'

# ----------------------------------------------------------------- make
def make(bank_path, out):
    b, doms, subs = load_bank(bank_path)
    wb = Workbook()
    ins = wb.active; ins.title = 'Instructions'
    lines = [
        (f"Expert review: {b['framework']} Business Health question bank", True),
        ('Draft for review. Nothing here is final. Your ratings decide which questions are kept, reworded or removed.', False),
        ('', False),
        ('What to do', True),
        ('1. Fill in the Expert sheet (name and declaration). Your name is used only to record the panel. Results are reported by expert number.', False),
        ('2. On the Ratings sheet, rate every question. Use the dropdown in the yellow columns. Leave a cell blank only if you cannot judge it, and say why in Comment.', False),
        ('3. Relevance (1 to 4): how important is this question for judging the health of this kind of enterprise in Ghana? 1 Not relevant, 2 Somewhat relevant, 3 Quite relevant, 4 Highly relevant.', False),
        ('4. Clarity (1 to 4): could an enterprise owner or an assessor understand it without help? 1 Not clear, 2 Needs major rewording, 3 Clear with minor rewording, 4 Very clear.', False),
        ('5. Anchors fit: do the five descriptions (0 to 4) match real practice, and are they distinct from each other?', False),
        ('6. Evidence realistic: could an assessor in Northern Ghana actually see this evidence at a typical enterprise?', False),
        ('7. Block readiness: if an enterprise scores 0 or 1 here, should it be called not ready for finance or the linked opportunity, whatever its other scores?', False),
        ('8. Suggested weight (optional): 1 minor to 5 critical. Only fill this where you disagree with common sense, not for every row.', False),
        ('9. Use Comment and Suggested wording freely. Missing topics can go on the last rows of the Ratings sheet or in the Expert sheet notes.', False),
        ('', False),
        ('Time needed: about 2 to 3 hours for 100 questions. Please return the workbook by the date agreed with Samakose.', False),
        ('', False),
        ('Confidentiality: the bank is a Samakose working draft. Please do not share it outside the panel.', False),
    ]
    for i, (t, bold) in enumerate(lines, 1):
        c = ins.cell(row=i, column=1, value=t); c.alignment = Alignment(wrap_text=True, vertical='top')
        if bold: c.font = Font(bold=True, size=12 if i > 1 else 14)
    ins.column_dimensions['A'].width = 120

    ex = wb.create_sheet('Expert')
    for r, (k, v) in enumerate([
        ('Full name', ''), ('Organisation', ''), ('Role', ''), ('Years of relevant experience', ''),
        ('Main area of expertise (for example agribusiness finance, SME coaching, cooperatives, ESO management)', ''),
        ('Any conflict of interest with Samakose? (Yes/No, and describe)', ''),
        ('I agree to take part and to keep the draft confidential (type Yes)', ''),
        ('Other notes, including topics you think are missing', '')], 1):
        ex.cell(row=r, column=1, value=k).alignment = Alignment(wrap_text=True, vertical='top')
        c = ex.cell(row=r, column=2); c.fill = PatternFill('solid', fgColor='FFF2CC'); c.alignment = Alignment(wrap_text=True, vertical='top')
    ex.column_dimensions['A'].width = 70; ex.column_dimensions['B'].width = 70

    ws = wb.create_sheet('Ratings')
    ws.append(COLS)
    thin = Side(style='thin', color='BBBBBB')
    for c in ws[1]:
        c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='1F4E3D')
        c.alignment = Alignment(wrap_text=True, vertical='center')
    for q in b['questions']:
        ws.append([q['code'], f"{q['domain']} {doms[q['domain']]}", f"{q['subDimension']} {subs[q['subDimension']]}", q['text'],
                   anchors_text(q), q['evidence']['requirement'] + (f" ({q['evidence']['method']})" if q['evidence'].get('method') else ''),
                   None, None, None, None, None, None, None, None])
    n = len(b['questions']) + 1
    for row in ws.iter_rows(min_row=2, max_row=n):
        for j, c in enumerate(row):
            c.alignment = Alignment(wrap_text=True, vertical='top'); c.border = Border(top=thin, bottom=thin, left=thin, right=thin)
            if j >= IN0: c.fill = PatternFill('solid', fgColor='FFF2CC')
    for col, w in zip('ABCDEFGHIJKLMN', [9, 22, 26, 48, 60, 40, 11, 11, 14, 16, 16, 14, 40, 40]): ws.column_dimensions[col].width = w
    ws.freeze_panes = 'E2'; ws.row_dimensions[1].height = 48
    def dv(formula, col, msg):
        v = DataValidation(type='list', formula1=formula, allow_blank=True, showErrorMessage=True, errorTitle='Not allowed', error=msg)
        ws.add_data_validation(v); v.add(f'{col}2:{col}{n + 10}')
    dv('"1,2,3,4"', 'G', 'Choose 1, 2, 3 or 4'); dv('"1,2,3,4"', 'H', 'Choose 1, 2, 3 or 4')
    dv('"Yes,No,Unsure"', 'I', 'Choose Yes, No or Unsure'); dv('"Yes,No,Unsure"', 'J', 'Choose Yes, No or Unsure'); dv('"Yes,No,Unsure"', 'K', 'Choose Yes, No or Unsure')
    dv('"1,2,3,4,5"', 'L', 'Choose 1 to 5')
    # a few empty rows for missing topics
    for i in range(1, 6):
        ws.cell(row=n + i, column=1, value=f'NEW-{i}')
        ws.cell(row=n + i, column=4, value='(Describe a missing topic or question here)').font = Font(italic=True, color='777777')
    wb.save(out)
    print(f"{b['framework']}: rating workbook for {len(b['questions'])} questions -> {out}")

# ----------------------------------------------------------------- read
def read_returned(path, codes):
    wb = load_workbook(path, data_only=True)
    problems, rows = [], {}
    ws = wb['Ratings']
    head = [str(c.value or '').strip() for c in ws[1]]
    if head[:len(COLS)] != COLS: problems.append('Ratings sheet headings were changed')
    for r in ws.iter_rows(min_row=2, values_only=True):
        code = str(r[0] or '').strip()
        if not code: continue
        if code.startswith('NEW-'):
            if r[3] and not str(r[3]).startswith('(Describe'): rows[code] = {'new': str(r[3]), 'comment': r[12]}
            continue
        if code not in codes: problems.append(f'Unknown code {code}'); continue
        def num(v, lo, hi, what):
            if v is None or v == '': return None
            try: x = int(v)
            except Exception: problems.append(f'{code}: {what} "{v}" is not a number'); return None
            if x < lo or x > hi: problems.append(f'{code}: {what} {x} is outside {lo} to {hi}'); return None
            return x
        def ynu(v, what):
            if v is None or v == '': return None
            s = str(v).strip().capitalize()
            if s not in YNU: problems.append(f'{code}: {what} "{v}" is not Yes, No or Unsure'); return None
            return s
        rows[code] = {'rel': num(r[6], 1, 4, 'relevance'), 'clar': num(r[7], 1, 4, 'clarity'), 'fit': ynu(r[8], 'anchors fit'), 'evi': ynu(r[9], 'evidence'),
                      'gate': ynu(r[10], 'block readiness'), 'w': num(r[11], 1, 5, 'weight'), 'comment': (str(r[12]).strip() if r[12] else ''), 'wording': (str(r[13]).strip() if r[13] else '')}
    meta = {}
    if 'Expert' in wb.sheetnames:
        e = wb['Expert']
        meta = {str(e.cell(row=i, column=1).value or '')[:40]: (e.cell(row=i, column=2).value or '') for i in range(1, 9)}
    return rows, meta, problems

# ----------------------------------------------------------------- analyse
def analyse(bank_path, folder, out_dir):
    b, doms, subs = load_bank(bank_path)
    qs = {q['code']: q for q in b['questions']}
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith('.xlsx') and not f.startswith('~$'))
    if not files: sys.exit('No returned workbooks found')
    os.makedirs(out_dir, exist_ok=True)
    experts = []
    for i, f in enumerate(files, 1):
        rows, meta, probs = read_returned(os.path.join(folder, f), set(qs))
        experts.append({'id': f'E{i}', 'file': f, 'rows': rows, 'meta': meta, 'problems': probs})
    N = len(experts)
    warn = []
    if N < PANEL_MIN: warn.append(f'Only {N} experts returned ratings. The bank specification asks for {PANEL_MIN} to {PANEL_MAX}. Treat the results as indicative.')
    if N > PANEL_MAX: warn.append(f'{N} experts returned ratings. More than {PANEL_MAX} is fine statistically but check the synthesis time.')
    results = []
    for code, q in qs.items():
        g = lambda k: [e['rows'].get(code, {}).get(k) for e in experts]
        rel, n, a = i_cvi(g('rel')); cl, _, _ = i_cvi(g('clar')); fit, evi = share(g('fit')), share(g('evi')); gate = share(g('gate'))
        ws_ = [x for x in g('w') if x]
        k = modified_kappa(n, a, rel) if rel is not None else None
        med = statistics.median(ws_) if ws_ else None
        results.append({'code': code, 'domain': q['domain'], 'subDimension': q['subDimension'], 'text': q['text'], 'weight': q['weight'], 'criticality': q['criticality'],
                        'raters': n, 'icvi': rel, 'kappa': k, 'kappaBand': kappa_band(k), 'clarityCvi': cl, 'anchorsFit': fit, 'evidenceRealistic': evi,
                        'blockYes': gate, 'suggestedWeightMedian': med,
                        'decision': decide(rel, cl, fit, evi)})
    def f(x, d=3): return '' if x is None else round(x, d)
    with open(os.path.join(out_dir, 'item_results.csv'), 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh)
        w.writerow(['Code', 'Domain', 'Sub-dimension', 'Statement', 'Current weight', 'Current criticality', 'Raters', 'I-CVI relevance', 'Modified kappa', 'Kappa band', 'Clarity CVI',
                    'Anchors fit share', 'Evidence realistic share', 'Block readiness Yes share', 'Suggested weight (median)', 'Decision'])
        for r in results:
            w.writerow([r['code'], r['domain'], r['subDimension'], r['text'], r['weight'], r['criticality'], r['raters'], f(r['icvi']), f(r['kappa']), r['kappaBand'], f(r['clarityCvi']),
                        f(r['anchorsFit']), f(r['evidenceRealistic']), f(r['blockYes']), r['suggestedWeightMedian'] if r['suggestedWeightMedian'] is not None else '', r['decision']])
    with open(os.path.join(out_dir, 'comments.csv'), 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh); w.writerow(['Code', 'Expert', 'Relevance', 'Clarity', 'Comment', 'Suggested wording'])
        for code in qs:
            for e in experts:
                r = e['rows'].get(code, {})
                if r.get('comment') or r.get('wording'): w.writerow([code, e['id'], r.get('rel') or '', r.get('clar') or '', r.get('comment', ''), r.get('wording', '')])
        for e in experts:
            for code, r in e['rows'].items():
                if code.startswith('NEW-'): w.writerow([code, e['id'], '', '', r.get('comment') or '', r['new']])
    with open(os.path.join(out_dir, 'expert_register_CONFIDENTIAL.csv'), 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh); w.writerow(['Expert', 'File', 'Declaration and details', 'Data problems'])
        for e in experts: w.writerow([e['id'], e['file'], json.dumps(e['meta'], ensure_ascii=False), '; '.join(e['problems'])])
    # domain level
    dom_rows = []
    for d, name in doms.items():
        rs = [r for r in results if r['domain'] == d and r['icvi'] is not None]
        if rs: dom_rows.append((d, name, sum(r['icvi'] for r in rs) / len(rs), sum(1 for r in rs if r['icvi'] >= CVI_MIN), len(rs)))
    allr = [r for r in results if r['icvi'] is not None]
    s_ave = sum(r['icvi'] for r in allr) / len(allr) if allr else None
    s_ua = sum(1 for r in allr if r['icvi'] >= CVI_MIN) / len(allr) if allr else None
    # leniency check
    lenient = []
    for e in experts:
        rel = [r['rel'] for r in e['rows'].values() if isinstance(r, dict) and r.get('rel')]
        if len(rel) >= 20 and len(set(rel)) == 1: lenient.append(e['id'])
    missing = {e['id']: sum(1 for c in qs if not e['rows'].get(c, {}).get('rel')) for e in experts}
    count = lambda lab: sum(1 for r in results if r['decision'].startswith(lab))
    gate_up = [r for r in results if r['blockYes'] is not None and r['criticality'] != 'Gate' and r['blockYes'] >= 0.67]
    gate_down = [r for r in results if r['blockYes'] is not None and r['criticality'] == 'Gate' and r['blockYes'] < 0.5]
    wdiff = [r for r in results if r['suggestedWeightMedian'] is not None and abs(r['suggestedWeightMedian'] - r['weight']) >= 2]
    L = [f"# {b['framework']} expert panel results", '', f'Bank version {b["version"]}. Experts returning ratings: {N}. Reported by expert number; names are in the confidential register only.', '']
    for w_ in warn: L.append(f'- WARNING: {w_}')
    for e in experts:
        if e['problems']: L.append(f'- Data problems in {e["id"]}: {len(e["problems"])} (see the confidential register)')
    for e in lenient: L.append(f'- {e} gave the same relevance rating to every question. Check whether the ratings are usable.')
    if missing and max(missing.values()) > 0: L.append('- Unrated questions per expert: ' + ', '.join(f'{k} {v}' for k, v in missing.items() if v))
    L += ['', '## Overall', '', f'- Average item content validity index (S-CVI/Ave): {f(s_ave, 2)}', f'- Share of questions at or above {CVI_MIN} (S-CVI/UA): {f(s_ua, 2)}',
          f'- Keep as written: {sum(1 for r in results if r["decision"] == "Keep")}', f'- Keep but revise wording, anchors or evidence: {count("Keep, revise")}',
          f'- Revise or merge: {count("Revise or merge")}', f'- Candidate to remove: {count("Candidate")}', '',
          '## By domain', '', '| Domain | Average I-CVI | Questions at or above threshold |', '|---|---|---|']
    for d, name, a_, ok, tot in dom_rows: L.append(f'| {d} {name} | {a_:.2f} | {ok} of {tot} |')
    def block(title, rs, extra=lambda r: ''):
        L.extend(['', f'## {title}', ''])
        if not rs: L.append('None.'); return
        L.extend(['| Code | Statement | I-CVI | Detail |', '|---|---|---|---|'])
        for r in rs: L.append(f'| {r["code"]} | {r["text"]} | {f(r["icvi"], 2)} | {extra(r)} |')
    block('Candidates to remove (relevance below 0.50)', [r for r in results if r['decision'].startswith('Candidate')])
    block('Revise or merge (relevance 0.50 to 0.77)', [r for r in results if r['decision'] == 'Revise or merge'], lambda r: f'kappa {f(r["kappa"], 2)} ({r["kappaBand"]})')
    block('Keep, with a fix needed', [r for r in results if r['decision'].startswith('Keep, revise')], lambda r: r['decision'][5:] + f'; clarity {f(r["clarityCvi"], 2)}, anchors {f(r["anchorsFit"], 2)}, evidence {f(r["evidenceRealistic"], 2)}')
    block('Panel would make these gates (two thirds or more say block readiness)', gate_up, lambda r: f'now {r["criticality"]}, weight {r["weight"]}; Yes share {f(r["blockYes"], 2)}')
    block('Current gates the panel doubts (under half say block readiness)', gate_down, lambda r: f'weight {r["weight"]}; Yes share {f(r["blockYes"], 2)}')
    block('Weight differs by 2 or more from the panel median', wdiff, lambda r: f'now {r["weight"]}, panel median {r["suggestedWeightMedian"]}')
    L += ['', '## How to use this', '',
          '- I-CVI is the share of experts rating relevance 3 or 4. The modified kappa corrects for chance agreement. Both describe agreement on relevance, not truth.',
          '- Wording, anchor and evidence changes are minor version changes. Changing a weight, a gate or removing a question is a major change and needs Amin\'s approval (SPEC section 7 and version control).',
          '- Panel weights and gate votes are advice. With 6 to 10 experts they are a sanity check, not a measurement. Calibrate weights again after pilot data.',
          '- This is evidence for content validity. It does not show reliability or criterion validity, which need pilot data.']
    open(os.path.join(out_dir, 'summary.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print(f'{b["framework"]}: {N} experts, S-CVI/Ave {f(s_ave, 2)}, S-CVI/UA {f(s_ua, 2)} -> {out_dir}')
    return results

# ----------------------------------------------------------------- selftest
def selftest():
    cvi, n, a = i_cvi([4, 4, 3, 4, 3, 4]); assert (cvi, n, a) == (1.0, 6, 6) and abs(modified_kappa(6, 6, cvi) - 1) < 1e-9
    cvi, n, a = i_cvi([4, 4, 3, 4, 3, 2]); assert abs(cvi - 5 / 6) < 1e-9
    assert abs(modified_kappa(6, 5, cvi) - 0.8161) < 1e-3, modified_kappa(6, 5, cvi)
    cvi, n, a = i_cvi([4, 3, 3, 4, 2, 1]); assert abs(modified_kappa(6, 4, cvi) - 0.5649) < 1e-3
    assert kappa_band(0.8) == 'Excellent' and kappa_band(0.65) == 'Good' and kappa_band(0.5) == 'Fair' and kappa_band(0.2) == 'Poor'
    assert decide(1.0, 1.0, 1.0, 1.0) == 'Keep' and decide(0.5, 1, 1, 1) == 'Revise or merge' and decide(0.33, 1, 1, 1) == 'Candidate to remove'
    assert decide(0.83, 0.5, 1.0, 0.5) == 'Keep, revise wording and evidence'
    here = os.path.dirname(os.path.abspath(__file__)); bank = os.path.join(here, '..', '..', 'docs', 'frameworks', 'banks', 'sme360-bank-v1.json')
    with tempfile.TemporaryDirectory() as t:
        tpl = os.path.join(t, 'tpl.xlsx'); make(bank, tpl)
        ret = os.path.join(t, 'returned'); os.makedirs(ret)
        rnd = random.Random(7); b, _, _ = load_bank(bank)
        for e in range(6):
            wb = load_workbook(tpl); ws = wb['Ratings']; wb['Expert']['B1'] = f'Expert {e}'
            for r in range(2, 2 + len(b['questions'])):
                code = ws.cell(row=r, column=1).value
                if code == 'SM-001': rel = 4                                  # unanimous
                elif code == 'SM-002': rel = [4, 4, 4, 3, 3, 1][e]           # 5 of 6
                elif code == 'SM-003': rel = [4, 1, 1, 2, 1, 3][e]           # 2 of 6
                else: rel = rnd.choice([3, 4, 4])
                ws.cell(row=r, column=7, value=rel); ws.cell(row=r, column=8, value=rnd.choice([3, 4]))
                ws.cell(row=r, column=9, value='Yes'); ws.cell(row=r, column=10, value='Yes'); ws.cell(row=r, column=11, value='Unsure')
            ws.cell(row=2, column=13, value='Test comment')
            ws.cell(row=2 + 3, column=12, value=5)
            wb.save(os.path.join(ret, f'e{e}.xlsx'))
        res = {r['code']: r for r in analyse(bank, ret, os.path.join(t, 'out'))}
        assert res['SM-001']['icvi'] == 1.0 and res['SM-001']['decision'] == 'Keep'
        assert abs(res['SM-002']['icvi'] - 5 / 6) < 1e-9 and res['SM-002']['decision'] == 'Keep'
        assert abs(res['SM-003']['icvi'] - 2 / 6) < 1e-9 and res['SM-003']['decision'] == 'Candidate to remove'
        assert res['SM-004']['suggestedWeightMedian'] == 5
        for f_ in ['item_results.csv', 'summary.md', 'comments.csv', 'expert_register_CONFIDENTIAL.csv']: assert os.path.exists(os.path.join(t, 'out', f_)), f_
        txt = open(os.path.join(t, 'out', 'summary.md'), encoding='utf-8').read()
        assert 'SM-003' in txt and '—' not in txt
    print('selftest passed')

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['make'] and len(a) == 3: make(a[1], a[2])
    elif a[:1] == ['analyse'] and len(a) == 4: analyse(a[1], a[2], a[3])
    elif a[:1] == ['selftest']: selftest()
    else: print(__doc__); sys.exit(1)
