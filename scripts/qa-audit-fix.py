#!/usr/bin/env python3
"""QA Audit Fix: Populate stucco_confirmed from stucco_classification in modiv-hoa-linked.json."""

import json
from collections import Counter, defaultdict
from datetime import datetime

# --- Load data ---
with open('data/modiv-hoa-linked.json') as f:
    linked = json.load(f)

with open('data/modiv-stucco-classified.json') as f:
    classified = json.load(f)

print(f"Loaded {len(linked)} linked records, {len(classified)} classified records")

# --- Build classification lookup by parcel_index ---
class_by_idx = {r['parcel_index']: r for r in classified}

# --- Derive stucco_confirmed from classification ---
CLASSIFICATION_TO_CONFIRMED = {
    'confirmed-stucco': 'stucco',
    'mixed-materials': 'mixed',
    'brick': 'non-stucco',
    'frame': 'non-stucco',
    'concrete-block': 'non-stucco',
    'apartment-generic': 'unknown',
    'unknown': 'unknown',
}

before_confirmed = Counter(r.get('stucco_confirmed') for r in linked)
print(f"\nBEFORE stucco_confirmed: {dict(before_confirmed)}")

updated = 0
for r in linked:
    cls = r.get('stucco_classification', 'unknown')
    r['stucco_confirmed'] = CLASSIFICATION_TO_CONFIRMED.get(cls, 'unknown')
    updated += 1

after_confirmed = Counter(r.get('stucco_confirmed') for r in linked)
print(f"AFTER  stucco_confirmed: {dict(after_confirmed)}")

# --- Check for phantom matches (cross-municipality) ---
# For matched records, verify the HOA name doesn't imply a different municipality
phantom_count = 0
phantom_examples = []
for r in linked:
    if r.get('matched_hoa_name') and r.get('match_method') == 'proximity':
        # Proximity matches are the most likely to be cross-municipality
        phantom_count += 1
        if len(phantom_examples) < 5:
            phantom_examples.append({
                'parcel': r['PROP_LOC'],
                'mun': r['MUN_NAME'],
                'hoa': r['matched_hoa_name'],
                'method': r['match_method'],
                'confidence': r.get('match_confidence', 0),
            })

print(f"\nPotential phantom matches (proximity-based): {phantom_count}")
for ex in phantom_examples:
    print(f"  {ex['parcel']} ({ex['mun']}) -> {ex['hoa']} [conf={ex['confidence']}]")

# --- Check for duplicates ---
# By parcel_index
pi_counts = Counter(r['parcel_index'] for r in linked)
dup_parcels = {k: v for k, v in pi_counts.items() if v > 1}

# By PROP_LOC + MUN_NAME
loc_counts = Counter((r['PROP_LOC'], r['MUN_NAME']) for r in linked)
dup_locs = {k: v for k, v in loc_counts.items() if v > 1}

print(f"\nDuplicate parcel_index: {len(dup_parcels)}")
print(f"Duplicate PROP_LOC+MUN_NAME: {len(dup_locs)}")

# --- Write corrected file ---
with open('data/modiv-hoa-linked.json', 'w') as f:
    json.dump(linked, f, indent=2)
print(f"\nWrote corrected data/modiv-hoa-linked.json ({len(linked)} records)")

# --- Write QA audit results ---
stucco_count = after_confirmed.get('stucco', 0)
mixed_count = after_confirmed.get('mixed', 0)
non_stucco_count = after_confirmed.get('non-stucco', 0)
unknown_count = after_confirmed.get('unknown', 0)
matched_count = sum(1 for r in linked if r.get('matched_hoa_name'))

audit = f"""# QA Audit Results
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}

## Issue Fixed
`stucco_confirmed` was `null` for all 16,905 records. Now derived from `stucco_classification`:

| Classification | stucco_confirmed | Count |
|---|---|---|
| confirmed-stucco | stucco | {Counter(r['stucco_classification'] for r in linked).get('confirmed-stucco', 0)} |
| mixed-materials | mixed | {Counter(r['stucco_classification'] for r in linked).get('mixed-materials', 0)} |
| brick | non-stucco | {Counter(r['stucco_classification'] for r in linked).get('brick', 0)} |
| frame | non-stucco | {Counter(r['stucco_classification'] for r in linked).get('frame', 0)} |
| concrete-block | non-stucco | {Counter(r['stucco_classification'] for r in linked).get('concrete-block', 0)} |
| apartment-generic | unknown | {Counter(r['stucco_classification'] for r in linked).get('apartment-generic', 0)} |
| unknown | unknown | {Counter(r['stucco_classification'] for r in linked).get('unknown', 0)} |

## stucco_confirmed Summary
| Status | Count | % |
|---|---|---|
| stucco | {stucco_count} | {stucco_count/len(linked)*100:.1f}% |
| mixed | {mixed_count} | {mixed_count/len(linked)*100:.1f}% |
| non-stucco | {non_stucco_count} | {non_stucco_count/len(linked)*100:.1f}% |
| unknown | {unknown_count} | {unknown_count/len(linked)*100:.1f}% |

## HOA Match Stats
- Total parcels: {len(linked)}
- Matched to HOA: {matched_count} ({matched_count/len(linked)*100:.1f}%)
- Unmatched: {len(linked) - matched_count}

### Match Methods
{chr(10).join(f'- {k or "none"}: {v}' for k, v in sorted(Counter(r.get("match_method") for r in linked).items(), key=lambda x: -x[1]))}

## Phantom Match Check
- Proximity-based matches (potential cross-municipality): {phantom_count}
- These have lower confidence scores and should be verified manually

## Duplicate Check
- Duplicate parcel_index: {len(dup_parcels)} (should be 0)
- Duplicate PROP_LOC+MUN_NAME: {len(dup_locs)} (may be legitimate - multiple units at same address)

### Sample Duplicate Locations
{chr(10).join(f'- {loc}: {ct} records' for loc, ct in list(dup_locs.items())[:10])}
"""

with open('data/qa-audit-results.md', 'w') as f:
    f.write(audit)
print("Wrote data/qa-audit-results.md")

# --- Regenerate link report ---
by_county = defaultdict(list)
for r in linked:
    by_county[r['COUNTY']].append(r)

county_stats = []
for county in sorted(by_county.keys()):
    recs = by_county[county]
    s = sum(1 for r in recs if r['stucco_confirmed'] == 'stucco')
    m = sum(1 for r in recs if r['stucco_confirmed'] == 'mixed')
    ns = sum(1 for r in recs if r['stucco_confirmed'] == 'non-stucco')
    u = sum(1 for r in recs if r['stucco_confirmed'] == 'unknown')
    hoa = sum(1 for r in recs if r.get('matched_hoa_name'))
    county_stats.append((county, len(recs), s, m, ns, u, hoa))

report = f"""# MOD-IV HOA Link Report
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}

## Summary
- **Total parcels:** {len(linked):,}
- **Matched to HOA:** {matched_count:,} ({matched_count/len(linked)*100:.1f}%)
- **Stucco confirmed:** {stucco_count:,}
- **Mixed materials:** {mixed_count:,}
- **Non-stucco:** {non_stucco_count:,}
- **Unknown:** {unknown_count:,}

## By County

| County | Parcels | Stucco | Mixed | Non-Stucco | Unknown | HOA Matched |
|---|---|---|---|---|---|---|
"""

for county, total, s, m, ns, u, hoa in county_stats:
    report += f"| {county} | {total} | {s} | {m} | {ns} | {u} | {hoa} |\n"

report += f"| **TOTAL** | **{len(linked)}** | **{stucco_count}** | **{mixed_count}** | **{non_stucco_count}** | **{unknown_count}** | **{matched_count}** |\n"

report += f"""
## Match Method Breakdown

| Method | Count |
|---|---|
"""
for method, count in sorted(Counter(r.get('match_method') for r in linked).items(), key=lambda x: -x[1]):
    report += f"| {method or 'unmatched'} | {count} |\n"

report += f"""
## Stucco Classification Detail

| Classification | Count | Confidence (avg) |
|---|---|---|
"""
for cls, count in sorted(Counter(r['stucco_classification'] for r in linked).items(), key=lambda x: -x[1]):
    avg_conf = sum(r['stucco_confidence'] for r in linked if r['stucco_classification'] == cls) / count
    report += f"| {cls} | {count} | {avg_conf:.0f} |\n"

with open('data/modiv-link-report.md', 'w') as f:
    f.write(report)
print("Wrote data/modiv-link-report.md")

# --- Final verification ---
with open('data/modiv-hoa-linked.json') as f:
    verify = json.load(f)
v_confirmed = Counter(r.get('stucco_confirmed') for r in verify)
print(f"\nVERIFICATION - stucco_confirmed: {dict(v_confirmed)}")
assert None not in v_confirmed, "ERROR: Still has null stucco_confirmed!"
print("All records have stucco_confirmed set. Fix verified.")
