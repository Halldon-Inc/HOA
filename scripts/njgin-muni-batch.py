#!/usr/bin/env python3
"""Query NJGIN for stucco counts per municipality and update HOA data."""
import json, urllib.request, urllib.parse, time, sys
from collections import Counter

with open('public/data/hoas.json') as f:
    hoas = json.load(f)

unmatched = {i: h for i, h in enumerate(hoas) if h.get('matchMethod') == 'zip_density'}
print(f'Unmatched: {len(unmatched)}', flush=True)

# Group by municipality
muni_indices = {}
for i, h in unmatched.items():
    muni = (h.get('municipality', '') or '').strip().upper()
    if muni and muni != 'UNKNOWN':
        muni_indices.setdefault(muni, []).append(i)

sorted_munis = sorted(muni_indices.items(), key=lambda x: -len(x[1]))
print(f'Municipalities to query: {len(sorted_munis)}', flush=True)

BASE = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query'

def qcount(where):
    params = {'where': where, 'returnGeometry': 'false', 'returnCountOnly': 'true', 'f': 'json'}
    url = f'{BASE}?{urllib.parse.urlencode(params)}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read()).get('count', -1)
    except:
        return -1

matched = 0
errors = 0
for idx, (muni, indices) in enumerate(sorted_munis):
    # Escape single quotes in muni name
    safe_muni = muni.replace("'", "''")
    
    stucco = qcount(f"UPPER(MUN_NAME) LIKE '%{safe_muni}%' AND (UPPER(BLDG_DESC) LIKE '%STCO%' OR UPPER(BLDG_DESC) LIKE '%STUC%')")
    if stucco < 0:
        errors += 1
        time.sleep(1)
        continue
    
    total = qcount(f"UPPER(MUN_NAME) LIKE '%{safe_muni}%'")
    if total <= 0:
        errors += 1
        time.sleep(0.5)
        continue
    
    pct = (stucco / total * 100) if total > 0 else 0
    
    for i in indices:
        hoas[i]['stuccoConfirmed'] = stucco
        hoas[i]['totalParcels'] = total
        hoas[i]['stuccoPercentage'] = round(pct, 1)
        hoas[i]['matchMethod'] = 'njgin_muni_query'
        if pct > 50:
            hoas[i]['exteriorType'] = 'stucco'
        elif pct > 10:
            hoas[i]['exteriorType'] = 'mixed'
        else:
            hoas[i]['exteriorType'] = 'non-stucco'
        matched += 1
    
    if (idx + 1) % 25 == 0:
        # Save checkpoint
        with open('public/data/hoas.json', 'w') as f:
            json.dump(hoas, f)
        print(f'[{idx+1}/{len(sorted_munis)}] {matched} HOAs, {errors} errors, last: {muni} ({stucco}/{total}={pct:.1f}%)', flush=True)
    
    time.sleep(0.15)

# Final save
with open('public/data/hoas.json', 'w') as f:
    json.dump(hoas, f)

types = Counter(h.get('exteriorType','?') for h in hoas)
methods = Counter(h.get('matchMethod','none') for h in hoas)
print(f'\nDone. Matched: {matched}, Errors: {errors}', flush=True)
print(f'Types: {dict(types)}', flush=True)
print(f'Methods: {dict(methods)}', flush=True)
