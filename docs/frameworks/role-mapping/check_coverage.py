"""Checks the role mapping against the three banks.
Rules: every sub-dimension has at least one primary role; every role named exists for that platform;
every Gate question has a default respondent; reports each role's load when all roles are present, and when only one
role is present (the fallback takes everything else). Run: python3 check_coverage.py"""
import json, sys, collections, pathlib
here = pathlib.Path(__file__).parent
banks = here.parent / 'banks'
m = json.load(open(here / 'role-mapping-v1.json'))
files = {'SME360': 'sme360-bank-v1.json', 'AGRIFOOD360': 'agrifood360-bank-v1.json', 'ESO360': 'eso360-bank-v1.json'}
bad = 0
for plat, f in files.items():
    qs = json.load(open(banks / f))['questions']
    mp, roles, fb = m['map'][plat], m['roles'][plat], m['fallback'][plat]
    subs = collections.OrderedDict()
    for q in qs: subs.setdefault(q['subDimension'], []).append(q)
    for s in subs:
        if s not in mp or not mp[s]['primary']: print(f'FAIL {plat} {s}: no primary role'); bad += 1
    for s in mp:
        if s not in subs: print(f'FAIL {plat} {s}: mapped but not in the bank'); bad += 1
        for r in mp[s]['primary'] + mp[s]['contributor']:
            if r not in roles: print(f'FAIL {plat} {s}: unknown role {r}'); bad += 1
    load = collections.Counter(); gates = collections.Counter(); wt = collections.Counter()
    tot_w = sum(q['weight'] for q in qs)
    for s, items in subs.items():
        r = mp[s]['primary'][0]
        for q in items:
            load[r] += 1; wt[r] += q['weight']
            if q.get('criticality') == 'Gate': gates[r] += 1
    print(f"\n{plat}: {len(qs)} questions, {len(subs)} sub-dimensions, {sum(1 for q in qs if q.get('criticality')=='Gate')} gates. Default load if every role is present:")
    for r in roles: print(f"  {r:16} {load[r]:3} questions {100*wt[r]/tot_w:5.1f}% of weight {gates[r]:2} gates   {roles[r]}")
    for r in roles:
        if load[r]==0: print(f'  WARN {plat}: {r} is never a default respondent (contributor only)')
    print(f"  fallback role: {fb}")
print('\nRESULT:', 'OK' if not bad else f'{bad} problem(s)')
sys.exit(1 if bad else 0)
