#!/usr/bin/env python3
"""
Expand HOA-parcel matching by improving municipality name normalization.
Matches 3,666 currently-unmatched HOAs against MOD-IV data using fuzzy municipality matching.
"""

import json
import re
from collections import defaultdict, Counter
from difflib import SequenceMatcher

# Load data
with open('public/data/hoas.json') as f:
    hoas = json.load(f)

with open('data/modiv-condos.json') as f:
    condos = json.load(f)

with open('data/modiv-stucco-confirmed.json') as f:
    stucco_parcels = json.load(f)

print(f"Loaded {len(hoas)} HOAs, {len(condos)} condos, {len(stucco_parcels)} stucco parcels")

# Better municipality normalization
def normalize_muni(name):
    """Aggressively normalize municipality names."""
    if not name:
        return ''
    name = name.upper().strip()
    # Remove common suffixes
    for suffix in [' CITY', ' TWP', ' TWNSHP', ' TOWNSHIP', ' BORO', ' BOROUGH', 
                   ' VILLAGE', ' TOWN', ' COUNTY']:
        if name.endswith(suffix):
            name = name[:-len(suffix)].strip()
    # Handle special cases
    name = name.replace('MOUNT ', 'MT ')
    name = name.replace('SAINT ', 'ST ')
    name = name.replace('NORTH ', 'N ')
    name = name.replace('SOUTH ', 'S ')
    name = name.replace('EAST ', 'E ')
    name = name.replace('WEST ', 'W ')
    return name.strip()

def extract_street(addr):
    """Extract street name from address."""
    if not addr:
        return ''
    addr = addr.upper().strip()
    # Remove unit/apt numbers
    addr = re.sub(r'\s*(APT|UNIT|#|STE|SUITE)\s*\S*$', '', addr)
    # Remove leading house number
    addr = re.sub(r'^\d+[\-\d]*\s+', '', addr)
    # Normalize street suffixes
    for old, new in [('STREET', 'ST'), ('AVENUE', 'AVE'), ('BOULEVARD', 'BLVD'), 
                      ('DRIVE', 'DR'), ('ROAD', 'RD'), ('LANE', 'LN'), ('COURT', 'CT'),
                      ('PLACE', 'PL'), ('TERRACE', 'TER'), ('CIRCLE', 'CIR')]:
        addr = re.sub(rf'\b{old}\b', new, addr)
    return addr.strip()

# Build index: normalized municipality -> condos
muni_condos = defaultdict(list)
for c in condos:
    mun = normalize_muni(c.get('MUN_NAME', ''))
    if mun:
        muni_condos[mun].append(c)

# Build index: normalized municipality -> stucco parcels
muni_stucco = defaultdict(list)
for s in stucco_parcels:
    mun = normalize_muni(s.get('MUN_NAME', ''))
    if mun:
        muni_stucco[mun].append(s)

print(f"Indexed {len(muni_condos)} municipality groups (condos)")
print(f"Indexed {len(muni_stucco)} municipality groups (stucco)")

# Get unmatched HOAs
unmatched = [h for h in hoas if h.get('matchMethod') == 'zip_density']
print(f"\nProcessing {len(unmatched)} unmatched HOAs...")

# Build HOA municipality -> normalized
hoa_index = {}
for h in unmatched:
    muni = h.get('municipality', '') or ''
    norm = normalize_muni(muni)
    if norm:
        hoa_index.setdefault(norm, []).append(h)

# Try fuzzy matching municipalities
muni_map = {}
for hoa_muni in set(normalize_muni(h.get('municipality','')) for h in unmatched):
    if not hoa_muni:
        continue
    if hoa_muni in muni_condos or hoa_muni in muni_stucco:
        muni_map[hoa_muni] = hoa_muni
        continue
    # Fuzzy match
    best_score = 0
    best_match = None
    all_munis = set(muni_condos.keys()) | set(muni_stucco.keys())
    for mod_muni in all_munis:
        # Try substring matching first
        if hoa_muni in mod_muni or mod_muni in hoa_muni:
            score = 0.9
        else:
            score = SequenceMatcher(None, hoa_muni, mod_muni).ratio()
        if score > best_score:
            best_score = score
            best_match = mod_muni
    if best_score >= 0.75:
        muni_map[hoa_muni] = best_match

print(f"Municipality map: {len(muni_map)} of {len(set(normalize_muni(h.get('municipality','')) for h in unmatched if h.get('municipality')))} matched")

# Now match unmatched HOAs to parcels
new_links = []
matched_count = 0
stucco_matched = 0

for h in unmatched:
    hoa_muni = normalize_muni(h.get('municipality', '') or '')
    hoa_zip = h.get('address', '').split()[-1] if h.get('address') else ''
    hoa_addr = h.get('address', '') or ''
    hoa_street = extract_street(hoa_addr)
    
    mod_muni = muni_map.get(hoa_muni)
    if not mod_muni:
        continue
    
    # Get stucco parcels in this municipality
    local_stucco = muni_stucco.get(mod_muni, [])
    local_condos = muni_condos.get(mod_muni, [])
    
    if not local_stucco and not local_condos:
        continue
    
    # Count stucco in municipality by ZIP
    hoa_zip5 = ''
    # Try to extract ZIP from various fields
    addr = h.get('address', '') or ''
    zip_match = re.search(r'\b(\d{5})\b', addr)
    if zip_match:
        hoa_zip5 = zip_match.group(1)
    
    # Match stucco parcels by street if HOA has address
    stucco_count = 0
    total_count = 0
    linked_parcels = []
    
    if hoa_street:
        # Direct street matching
        for s in local_stucco:
            parcel_street = extract_street(s.get('PROP_LOC', ''))
            if parcel_street and hoa_street and (
                hoa_street in parcel_street or parcel_street in hoa_street or
                SequenceMatcher(None, hoa_street, parcel_street).ratio() > 0.7
            ):
                stucco_count += 1
                linked_parcels.append({
                    'parcel_address': s.get('PROP_LOC',''),
                    'parcel_muni': s.get('MUN_NAME',''),
                    'parcel_zip': s.get('ZIP5',''),
                    'hoa_id': h.get('entityId',''),
                    'hoa_name': h['name'],
                    'match_method': 'expanded_street',
                    'is_stucco': True
                })
        
        for c in local_condos:
            parcel_street = extract_street(c.get('PROP_LOC', ''))
            if parcel_street and hoa_street and (
                hoa_street in parcel_street or parcel_street in hoa_street or
                SequenceMatcher(None, hoa_street, parcel_street).ratio() > 0.7
            ):
                total_count += 1
                is_stucco_condo = any(x in (c.get('BLDG_DESC','') or '').upper() for x in ['STCO', 'STUC'])
                if is_stucco_condo:
                    stucco_count += 1
    
    # Also count by ZIP proximity for this municipality
    if hoa_zip5:
        zip_stucco = sum(1 for s in local_stucco if s.get('ZIP5') == hoa_zip5)
        zip_total = sum(1 for c in local_condos if c.get('ZIP5') == hoa_zip5)
        
        # If no street matches, use ZIP-level data (lower confidence)
        if stucco_count == 0 and total_count == 0 and zip_stucco > 0:
            stucco_count = zip_stucco
            total_count = zip_total + zip_stucco
            for s in local_stucco:
                if s.get('ZIP5') == hoa_zip5:
                    linked_parcels.append({
                        'parcel_address': s.get('PROP_LOC',''),
                        'parcel_muni': s.get('MUN_NAME',''),
                        'parcel_zip': s.get('ZIP5',''),
                        'hoa_id': h.get('entityId',''),
                        'hoa_name': h['name'],
                        'match_method': 'expanded_zip',
                        'is_stucco': True
                    })
    
    if stucco_count > 0 or total_count > 0:
        total = max(total_count, stucco_count)
        pct = (stucco_count / total * 100) if total > 0 else 0
        
        h['stuccoConfirmed'] = stucco_count
        h['totalParcels'] = total
        h['stuccoPercentage'] = round(pct, 1)
        h['matchMethod'] = 'parcel_expanded'
        
        # Reclassify
        if pct > 50:
            h['exteriorType'] = 'stucco'
        elif pct > 10:
            h['exteriorType'] = 'mixed'
        else:
            h['exteriorType'] = 'non-stucco'
        
        matched_count += 1
        if stucco_count > 0:
            stucco_matched += 1
        new_links.extend(linked_parcels)

print(f"\nExpanded matching results:")
print(f"  Newly matched HOAs: {matched_count}")
print(f"  HOAs with stucco data: {stucco_matched}")
print(f"  New parcel links: {len(new_links)}")

# Final stats
from collections import Counter
types = Counter(h.get('exteriorType','?') for h in hoas)
methods = Counter(h.get('matchMethod','none') for h in hoas)
print(f"\nFinal distribution: {dict(types)}")
print(f"Match methods: {dict(methods)}")

# Save updated data
with open('public/data/hoas.json', 'w') as f:
    json.dump(hoas, f)

# Append new links to existing
try:
    with open('data/parcel-hoa-links.json') as f:
        existing_links = json.load(f)
except:
    existing_links = []

existing_links.extend(new_links)
with open('data/parcel-hoa-links.json', 'w') as f:
    json.dump(existing_links, f)

print(f"\nTotal parcel links: {len(existing_links)}")
print("Files saved successfully.")
