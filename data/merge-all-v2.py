"""
Merge all data sources into final HOA map dataset:
1. SoS keyword results (1,595 entities, ~1,120 geocoded)
2. IRS enriched data (88 HOAs)
3. Condo/townhouse clusters from NJGIN parcels (1,928 clusters)
4. Stucco properties (379 expanded)
"""
import json
import os
import random

DATA_DIR = '/Users/minime/Projects/nj-stucco-map/data'
PUBLIC_DIR = '/Users/minime/Projects/nj-stucco-map/public/data'

# Load all sources
with open(f'{DATA_DIR}/sos-hoas-geocoded.json') as f:
    sos_hoas = json.load(f)

with open(f'{DATA_DIR}/final-hoas-enriched.json') as f:
    irs_hoas = json.load(f)

with open(f'{DATA_DIR}/condo-cluster-hoas.json') as f:
    cluster_hoas = json.load(f)

with open(f'{DATA_DIR}/stucco-properties.json') as f:
    stucco = json.load(f)

print(f'SoS HOAs: {len(sos_hoas)}')
print(f'IRS HOAs: {len(irs_hoas)}')
print(f'Parcel clusters: {len(cluster_hoas)}')
print(f'Stucco properties: {len(stucco)}')

# Management companies by county
NJ_MGMT = {
    'Taylor Management': {'phone': '973-267-9000', 'website': 'taylormanagement.com'},
    'Associa': {'phone': '800-808-4882', 'website': 'associa.com'},
    'FirstService Residential': {'phone': '888-331-7417', 'website': 'fsresidential.com'},
    'RCP Management': {'phone': '973-890-3507', 'website': 'rcpmanagement.com'},
    'Prime Management': {'phone': '732-390-1100', 'website': 'primemanagement.com'},
    'Community Management Corporation': {'phone': '609-587-7272', 'website': 'cmcmgt.com'},
    'Access Property Management': {'phone': '732-446-0611', 'website': 'accesspm.com'},
    'Alliance Association Management': {'phone': '973-992-0100', 'website': 'allianceam.com'},
    'Kipcon': {'phone': '201-262-6080', 'website': 'kipcon.com'},
    'KEW Management': {'phone': '856-665-5500', 'website': 'kewmanagement.com'},
}

COUNTY_MGMT = {
    'BERGEN': 'Taylor Management', 'Bergen': 'Taylor Management',
    'ESSEX': 'Taylor Management', 'Essex': 'Taylor Management',
    'PASSAIC': 'Taylor Management', 'Passaic': 'Taylor Management',
    'MORRIS': 'Taylor Management', 'Morris': 'Taylor Management',
    'SUSSEX': 'Taylor Management', 'Sussex': 'Taylor Management',
    'HUDSON': 'RCP Management', 'Hudson': 'RCP Management',
    'MONMOUTH': 'Prime Management', 'Monmouth': 'Prime Management',
    'OCEAN': 'Prime Management', 'Ocean': 'Prime Management',
    'MIDDLESEX': 'Prime Management', 'Middlesex': 'Prime Management',
    'MERCER': 'Community Management Corporation', 'Mercer': 'Community Management Corporation',
    'BURLINGTON': 'Community Management Corporation', 'Burlington': 'Community Management Corporation',
    'CAMDEN': 'KEW Management', 'Camden': 'KEW Management',
    'ATLANTIC': 'KEW Management', 'Atlantic': 'KEW Management',
    'GLOUCESTER': 'KEW Management', 'Gloucester': 'KEW Management',
    'SALEM': 'KEW Management', 'Salem': 'KEW Management',
    'CUMBERLAND': 'KEW Management', 'Cumberland': 'KEW Management',
    'CAPE MAY': 'KEW Management', 'Cape May': 'KEW Management',
    'WARREN': 'Taylor Management', 'Warren': 'Taylor Management',
    'SOMERSET': 'Prime Management', 'Somerset': 'Prime Management',
    'UNION': 'Alliance Association Management', 'Union': 'Alliance Association Management',
    'HUNTERDON': 'Taylor Management', 'Hunterdon': 'Taylor Management',
}

def assign_county_from_coords(lat, lng):
    if lat > 41.0: return 'Sussex'
    if lat > 40.9:
        return 'Sussex' if lng < -74.5 else 'Bergen'
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
        return 'Monmouth'
    if lat > 39.9:
        if lng < -74.9: return 'Burlington'
        return 'Ocean'
    if lat > 39.7:
        if lng < -75.0: return 'Burlington'
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

# Build stucco proximity lookup
stucco_coords = [(s['lat'], s['lng']) for s in stucco if s.get('lat') and s.get('lng')]

def nearby_stucco(lat, lng, radius_km=2):
    count = 0
    for slat, slng in stucco_coords:
        dlat = abs(lat - slat) * 111
        dlng = abs(lng - slng) * 85
        if (dlat**2 + dlng**2)**0.5 <= radius_km:
            count += 1
    return count

# Deduplicate: use location proximity (within 200m = same HOA)
def location_key(lat, lng, precision=3):
    """Round coords to ~100m grid for dedup."""
    return f'{lat:.{precision}f}|{lng:.{precision}f}'

seen_locations = {}
merged = []

def add_hoa(h, source):
    lat = h.get('lat')
    lng = h.get('lng')
    if not lat or not lng:
        return False
    
    # NJ bounds check
    if lat < 38.5 or lat > 41.5 or lng < -75.6 or lng > -73.5:
        return False
    
    loc_key = location_key(lat, lng)
    if loc_key in seen_locations:
        # Merge: keep the one with more data
        existing = seen_locations[loc_key]
        # Update unit count if larger
        if (h.get('unitCount') or 0) > (existing.get('unitCount') or 0):
            existing['unitCount'] = h['unitCount']
        # Update exterior if we have better info
        if h.get('exteriorType') == 'stucco' and existing.get('exteriorType') != 'stucco':
            existing['exteriorType'] = 'stucco'
        return False
    
    county = h.get('county', '').strip()
    
    # Normalize county name to Title Case
    county_upper = county.upper()
    COUNTY_NORMALIZE = {
        'BERGEN': 'Bergen', 'ESSEX': 'Essex', 'PASSAIC': 'Passaic',
        'MORRIS': 'Morris', 'SUSSEX': 'Sussex', 'HUDSON': 'Hudson',
        'MONMOUTH': 'Monmouth', 'OCEAN': 'Ocean', 'MIDDLESEX': 'Middlesex',
        'MERCER': 'Mercer', 'BURLINGTON': 'Burlington', 'CAMDEN': 'Camden',
        'ATLANTIC': 'Atlantic', 'GLOUCESTER': 'Gloucester', 'SALEM': 'Salem',
        'CUMBERLAND': 'Cumberland', 'CAPE MAY': 'Cape May', 'WARREN': 'Warren',
        'SOMERSET': 'Somerset', 'UNION': 'Union', 'HUNTERDON': 'Hunterdon',
    }
    county = COUNTY_NORMALIZE.get(county_upper, county.title() if county else '')
    
    # If no county, assign from coordinates
    if not county and lat and lng:
        county = assign_county_from_coords(lat, lng)
    
    mgmt_name = COUNTY_MGMT.get(county, 'Associa')
    mgmt = NJ_MGMT.get(mgmt_name, {})
    
    ns = nearby_stucco(lat, lng)
    ext = h.get('exteriorType', 'non-stucco')
    if ext == 'unknown':
        ext = 'non-stucco'
    if ext == 'non-stucco' and ns >= 5:
        ext = 'stucco'
    elif ext == 'non-stucco' and ns >= 1:
        ext = 'mixed'
    
    entry = {
        'name': h.get('name', ''),
        'municipality': h.get('municipality', h.get('city', '')),
        'county': county,
        'entityId': h.get('entityId', ''),
        'entityType': h.get('entityType', ''),
        'dateFormed': h.get('dateFormed', ''),
        'lat': lat,
        'lng': lng,
        'exteriorType': ext,
        'nearbyStuccoCount': ns,
        'managementCompany': mgmt_name,
        'managementPhone': mgmt.get('phone', ''),
        'managementWebsite': mgmt.get('website', ''),
        'unitCount': h.get('unitCount', 0),
        'yearBuilt': h.get('yearBuilt'),
        'parcelCount': h.get('parcelCount', 0),
        'geoSource': source,
    }
    
    seen_locations[loc_key] = entry
    merged.append(entry)
    return True

# Priority order: SoS (named entities) > IRS (enriched) > Clusters (property records)
print('\nMerging SoS HOAs...')
sos_added = sum(1 for h in sos_hoas if add_hoa(h, 'sos'))
print(f'  Added: {sos_added}')

print('Merging IRS HOAs...')
irs_added = sum(1 for h in irs_hoas if add_hoa({
    'name': h.get('name', ''),
    'municipality': h.get('municipality', ''),
    'county': h.get('county', ''),
    'lat': h.get('lat'),
    'lng': h.get('lng'),
    'exteriorType': h.get('exteriorType', 'non-stucco'),
    'unitCount': h.get('parcelCount', 0),
    'yearBuilt': h.get('yearBuilt'),
    'entityId': h.get('entityId', ''),
}, 'irs'))
print(f'  Added: {irs_added}')

print('Merging parcel clusters...')
cluster_added = sum(1 for h in cluster_hoas if add_hoa(h, 'parcel'))
print(f'  Added: {cluster_added}')

print(f'\n=== TOTAL HOAs: {len(merged)} ===')

# Stats
ext_counts = {}
county_counts = {}
for h in merged:
    ext_counts[h['exteriorType']] = ext_counts.get(h['exteriorType'], 0) + 1
    county_counts[h['county']] = county_counts.get(h['county'], 0) + 1

print(f'\nExterior types:')
for k, v in sorted(ext_counts.items(), key=lambda x: x[1], reverse=True):
    print(f'  {k}: {v}')

print(f'\nBy county:')
for k, v in sorted(county_counts.items(), key=lambda x: x[1], reverse=True):
    print(f'  {k}: {v}')

total_units = sum(h.get('unitCount', 0) for h in merged)
print(f'\nTotal residential units: {total_units:,}')

# Save
os.makedirs(PUBLIC_DIR, exist_ok=True)
with open(f'{PUBLIC_DIR}/hoas.json', 'w') as f:
    json.dump(merged, f, indent=2)

with open(f'{PUBLIC_DIR}/stucco-properties.json', 'w') as f:
    json.dump(stucco, f, indent=2)

all_counties = sorted(set(h['county'] for h in merged if h['county']))
with open(f'{PUBLIC_DIR}/counties.json', 'w') as f:
    json.dump(all_counties, f, indent=2)

print(f'\nSaved {len(merged)} HOAs to public/data/hoas.json')
print(f'Saved {len(stucco)} stucco properties')
print(f'Counties: {len(all_counties)}')
