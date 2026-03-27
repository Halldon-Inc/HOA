"""
Merge all HOA data sources:
1. SoS keyword results (1120 geocoded) - main dataset
2. IRS enriched data (88 with exterior data) - supplement with exterior info
3. Stucco properties (322) - keep as separate layer
"""
import json
import os

DATA_DIR = '/Users/minime/Projects/nj-stucco-map/data'
PUBLIC_DIR = '/Users/minime/Projects/nj-stucco-map/public/data'

# Load all sources
with open(f'{DATA_DIR}/sos-hoas-geocoded.json') as f:
    sos_hoas = json.load(f)

with open(f'{DATA_DIR}/final-hoas-enriched.json') as f:
    irs_hoas = json.load(f)

with open(f'{DATA_DIR}/stucco-properties.json') as f:
    stucco = json.load(f)

print(f'SoS HOAs (geocoded): {len(sos_hoas)}')
print(f'IRS HOAs (enriched): {len(irs_hoas)}')
print(f'Stucco properties: {len(stucco)}')

# Build IRS lookup by name (normalized)
irs_lookup = {}
for h in irs_hoas:
    name = h.get('name', '').upper().strip()
    irs_lookup[name] = h

# Management company data
NJ_MGMT = {
    'Taylor Management': {'phone': '973-267-9000', 'website': 'taylormanagement.com', 'region': 'North NJ'},
    'Associa': {'phone': '800-808-4882', 'website': 'associa.com', 'region': 'Statewide'},
    'FirstService Residential': {'phone': '888-331-7417', 'website': 'fsresidential.com', 'region': 'Statewide'},
    'RCP Management': {'phone': '973-890-3507', 'website': 'rcpmanagement.com', 'region': 'North NJ'},
    'Prime Management': {'phone': '732-390-1100', 'website': 'primemanagement.com', 'region': 'Central NJ'},
    'Community Management Corporation': {'phone': '609-587-7272', 'website': 'cmcmgt.com', 'region': 'Central/South NJ'},
    'Access Property Management': {'phone': '732-446-0611', 'website': 'accesspm.com', 'region': 'Central NJ'},
    'Alliance Association Management': {'phone': '973-992-0100', 'website': 'allianceam.com', 'region': 'North NJ'},
    'Kipcon': {'phone': '201-262-6080', 'website': 'kipcon.com', 'region': 'North NJ'},
    'KEW Management': {'phone': '856-665-5500', 'website': 'kewmanagement.com', 'region': 'South NJ'},
}

# County assignment from city (best effort using NJ lat ranges)
def assign_county_from_coords(lat, lng):
    """Rough county estimation from coordinates."""
    if lat > 41.0: return 'Sussex'
    if lat > 40.9:
        if lng < -74.5: return 'Sussex'
        return 'Bergen'
    if lat > 40.8:
        if lng < -74.3: return 'Morris'
        if lng < -74.1: return 'Passaic'
        return 'Bergen'
    if lat > 40.7:
        if lng < -74.5: return 'Morris'
        if lng < -74.2: return 'Essex'
        return 'Hudson'
    if lat > 40.6:
        if lng < -74.5: return 'Morris'
        if lng < -74.3: return 'Union'
        return 'Hudson'
    if lat > 40.5:
        if lng < -74.7: return 'Somerset'
        if lng < -74.3: return 'Middlesex'
        return 'Monmouth'
    if lat > 40.3:
        if lng < -74.7: return 'Somerset'
        if lng < -74.3: return 'Middlesex'
        return 'Monmouth'
    if lat > 40.1:
        if lng < -74.8: return 'Mercer'
        if lng < -74.3: return 'Monmouth'
        return 'Monmouth'
    if lat > 39.9:
        if lng < -74.9: return 'Burlington'
        if lng < -74.2: return 'Ocean'
        return 'Ocean'
    if lat > 39.7:
        if lng < -75.0: return 'Burlington'
        if lng < -74.2: return 'Ocean'
        return 'Ocean'
    if lat > 39.5:
        if lng < -75.1: return 'Camden'
        if lng < -74.5: return 'Atlantic'
        return 'Atlantic'
    if lat > 39.3:
        if lng < -75.1: return 'Gloucester'
        if lng < -74.7: return 'Atlantic'
        return 'Cape May'
    if lat > 39.1:
        if lng < -75.2: return 'Salem'
        if lng < -75.0: return 'Cumberland'
        return 'Cape May'
    return 'Cape May'

COUNTY_MGMT = {
    'Bergen': 'Taylor Management',
    'Essex': 'Taylor Management',
    'Passaic': 'Taylor Management',
    'Morris': 'Taylor Management',
    'Sussex': 'Taylor Management',
    'Hudson': 'RCP Management',
    'Monmouth': 'Prime Management',
    'Ocean': 'Prime Management',
    'Middlesex': 'Prime Management',
    'Mercer': 'Community Management Corporation',
    'Burlington': 'Community Management Corporation',
    'Camden': 'KEW Management',
    'Atlantic': 'KEW Management',
    'Gloucester': 'KEW Management',
    'Salem': 'KEW Management',
    'Cumberland': 'KEW Management',
    'Cape May': 'KEW Management',
    'Warren': 'Taylor Management',
    'Somerset': 'Prime Management',
    'Union': 'Alliance Association Management',
    'Hunterdon': 'Taylor Management',
}

# Check proximity to stucco properties for each HOA
stucco_coords = [(s['lat'], s['lng']) for s in stucco if s.get('lat') and s.get('lng')]

def count_nearby_stucco(lat, lng, radius_km=2):
    count = 0
    for slat, slng in stucco_coords:
        dlat = abs(lat - slat) * 111
        dlng = abs(lng - slng) * 85  # rough for NJ latitude
        dist = (dlat**2 + dlng**2)**0.5
        if dist <= radius_km:
            count += 1
    return count

# Merge and enrich
merged = []
seen_ids = set()

for h in sos_hoas:
    eid = h.get('entityId', '')
    if eid in seen_ids:
        continue
    seen_ids.add(eid)
    
    lat = h.get('lat')
    lng = h.get('lng')
    if not lat or not lng:
        continue
    
    # Check IRS data for exterior info
    name_upper = h.get('name', '').upper().strip()
    irs_match = irs_lookup.get(name_upper)
    
    # Assign county
    county = h.get('county', '') or (irs_match.get('county', '') if irs_match else '')
    if not county:
        county = assign_county_from_coords(lat, lng)
    
    # Assign management company
    mgmt = COUNTY_MGMT.get(county, 'Associa')
    mgmt_info = NJ_MGMT.get(mgmt, {})
    
    # Check stucco proximity
    nearby_stucco = count_nearby_stucco(lat, lng)
    
    if irs_match and irs_match.get('exteriorType', 'unknown') != 'unknown':
        exterior = irs_match['exteriorType']
    elif nearby_stucco >= 5:
        exterior = 'stucco'
    elif nearby_stucco >= 1:
        exterior = 'mixed'
    else:
        exterior = 'non-stucco'
    
    merged.append({
        'name': h.get('name', ''),
        'municipality': h.get('municipality', ''),
        'county': county,
        'entityId': eid,
        'entityType': h.get('entityType', ''),
        'dateFormed': h.get('dateFormed', ''),
        'lat': lat,
        'lng': lng,
        'exteriorType': exterior,
        'nearbyStuccoCount': nearby_stucco,
        'managementCompany': mgmt,
        'managementPhone': mgmt_info.get('phone', ''),
        'managementWebsite': mgmt_info.get('website', ''),
        'parcelCount': irs_match.get('parcelCount', 0) if irs_match else 0,
        'yearBuilt': irs_match.get('yearBuilt') if irs_match else None,
        'geoSource': h.get('geoSource', 'unknown'),
    })

# Add IRS HOAs not already in SoS results
for h in irs_hoas:
    name_upper = h.get('name', '').upper().strip()
    if any(m['name'].upper().strip() == name_upper for m in merged):
        continue
    lat = h.get('lat')
    lng = h.get('lng')
    if not lat or not lng:
        continue
    
    county = h.get('county', '') or assign_county_from_coords(lat, lng)
    mgmt = COUNTY_MGMT.get(county, 'Associa')
    mgmt_info = NJ_MGMT.get(mgmt, {})
    nearby_stucco = count_nearby_stucco(lat, lng)
    
    merged.append({
        'name': h.get('name', ''),
        'municipality': h.get('municipality', ''),
        'county': county,
        'entityId': h.get('entityId', ''),
        'entityType': h.get('hoaType', ''),
        'dateFormed': '',
        'lat': lat,
        'lng': lng,
        'exteriorType': h.get('exteriorType', 'non-stucco'),
        'nearbyStuccoCount': nearby_stucco,
        'managementCompany': mgmt,
        'managementPhone': mgmt_info.get('phone', ''),
        'managementWebsite': mgmt_info.get('website', ''),
        'parcelCount': h.get('parcelCount', 0),
        'yearBuilt': h.get('yearBuilt'),
        'geoSource': 'irs',
    })

print(f'\nMerged total: {len(merged)}')

# Stats
exterior_counts = {}
county_counts = {}
for h in merged:
    ext = h['exteriorType']
    exterior_counts[ext] = exterior_counts.get(ext, 0) + 1
    county_counts[h['county']] = county_counts.get(h['county'], 0) + 1

print(f'\nExterior types:')
for k, v in sorted(exterior_counts.items(), key=lambda x: x[1], reverse=True):
    print(f'  {k}: {v}')

print(f'\nTop counties:')
for k, v in sorted(county_counts.items(), key=lambda x: x[1], reverse=True)[:25]:
    print(f'  {k}: {v}')

# Compute allCounties for the app
all_counties = sorted(set(h['county'] for h in merged if h['county']))

# Save to public/data for the app
os.makedirs(PUBLIC_DIR, exist_ok=True)
with open(f'{PUBLIC_DIR}/hoas.json', 'w') as f:
    json.dump(merged, f, indent=2)

# Also save the county list
with open(f'{PUBLIC_DIR}/counties.json', 'w') as f:
    json.dump(all_counties, f, indent=2)

print(f'\nSaved {len(merged)} HOAs to public/data/hoas.json')
print(f'Counties: {len(all_counties)}')
