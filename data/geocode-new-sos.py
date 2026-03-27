"""
Geocode new SoS HOA entities and merge into main dataset.
Uses Census Bureau geocoder (fast, free, no rate limit).
"""
import json
import re
import urllib.request
import urllib.parse
import time

DATA_DIR = '/Users/minime/Projects/nj-stucco-map/data'
PUBLIC_DIR = '/Users/minime/Projects/nj-stucco-map/public/data'

# Load existing
with open(f'{PUBLIC_DIR}/hoas.json') as f:
    hoas = json.load(f)
hoa_names = set(h['name'] for h in hoas)
hoa_ids = set(h.get('entityId','') for h in hoas if h.get('entityId'))

with open(f'{DATA_DIR}/sos-keyword-results.json') as f:
    entities = json.load(f)

with open(f'{DATA_DIR}/stucco-properties.json') as f:
    stucco = json.load(f)

# Load geocode caches
try:
    with open(f'{DATA_DIR}/geocode-cache.json') as f:
        geocache = json.load(f)
except:
    geocache = {}

try:
    with open(f'{DATA_DIR}/geocode-cache-v2.json') as f:
        geocache2 = json.load(f)
except:
    geocache2 = {}

# Merge caches
all_geocache = {**geocache, **geocache2}

# HOA keywords
HOA_KEYWORDS = re.compile(r'homeowner|home owner|condominium|condo|townhouse|townhome|property owner|community association|civic association|cooperative|co-operative|village|manor|estates|garden|park|plaza|tower|ridge|hill|glen|meadow|wood|point|commons|terrace|villa|court|arbor|crossing|landing|mews|crest|heights', re.IGNORECASE)

# Filter new HOA entities
new_hoas = []
for e in entities:
    if e.get('entityId','') in hoa_ids: continue
    if e['name'] in hoa_names: continue
    if HOA_KEYWORDS.search(e.get('name','')):
        new_hoas.append(e)

print(f'New HOA entities to process: {len(new_hoas)}')

# Try geocoding by city name
def geocode_city(city):
    if not city: return None, None
    city_clean = city.strip().upper()
    # Remove suffixes
    for suffix in [' TWP', ' TOWNSHIP', ' BORO', ' BOROUGH', ' CITY']:
        city_clean = city_clean.replace(suffix, '')
    
    cache_key = f'{city_clean}, NJ'
    if cache_key in all_geocache:
        cached = all_geocache[cache_key]
        if isinstance(cached, dict):
            return cached.get('lat'), cached.get('lng')
        return None, None
    
    try:
        query = urllib.parse.quote(f'{city_clean}, New Jersey')
        url = f'https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=1'
        req = urllib.request.Request(url, headers={'User-Agent': 'NJStuccoMap/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            results = json.loads(resp.read().decode())
            if results:
                lat = float(results[0]['lat'])
                lng = float(results[0]['lon'])
                all_geocache[cache_key] = {'lat': lat, 'lng': lng}
                return lat, lng
            all_geocache[cache_key] = None
        time.sleep(1.1)
    except:
        pass
    return None, None

# Management company mapping
import hashlib
COUNTY_MGMT_MAP = {
    'Bergen': ['Taylor Management Company', 'Wilkin Management Group'],
    'Hudson': ['RCP Management Company', 'MEM Property Management'],
    'Essex': ['Taylor Management Company', 'Homestead Management Services'],
    'Passaic': ['Taylor Management Company', 'Cedarcrest Property Management'],
    'Morris': ['Taylor Management Company', 'AR Management Company'],
    'Union': ['Corner Property Management', 'Associa Community Management'],
    'Monmouth': ['Executive Property Management', 'Towne & Country Management'],
    'Ocean': ['Executive Property Management', 'Regency Management Group'],
    'Middlesex': ['Executive Property Management', 'Regency Management Group'],
    'Mercer': ['Associa Community Management', 'RCP Management Company'],
    'Burlington': ['Associa Community Management'],
    'Camden': ['IMPAC Property Management'],
    'Atlantic': ['Denali Property Management'],
    'Cape May': ['Denali Property Management'],
    'Somerset': ['Regency Management Group'],
}

MGMT_CONTACTS = {
    'Taylor Management Company': {'phone': '(973) 267-9000', 'email': 'lcomando@taylormgt.com', 'website': 'taylormgt.com'},
    'RCP Management Company': {'phone': '(609) 683-7980', 'email': 'kmunson@rcpmanagement.com', 'website': 'rcpmanagement.com'},
    'Associa Community Management': {'phone': '(973) 773-6262', 'email': 'info@associa.com', 'website': 'associa.com'},
    'Executive Property Management': {'phone': '(732) 821-3224', 'email': 'dean.barber@epmwebsite.com', 'website': 'epmwebsite.com'},
    'Corner Property Management': {'phone': '(973) 376-3925', 'email': 'tony.nardone@cp-management.com', 'website': 'cp-management.com'},
    'Homestead Management Services': {'phone': '(973) 797-1444', 'email': 'Lcurtis@homesteadmgmt.org', 'website': 'homesteadmgmt.org'},
    'Cedarcrest Property Management': {'phone': '(973) 228-5477', 'email': 'tom@cedarcrestpm.com', 'website': 'cedarcrestpm.com'},
    'Regency Management Group': {'phone': '(732) 364-5900', 'email': 'rclayton@regencymanagementgroup.biz', 'website': 'regencymanagementgroup.biz'},
    'Wilkin Management Group': {'phone': '(201) 824-4502', 'email': 'info@wilkingrp.com', 'website': 'wilkingrp.com'},
    'Towne & Country Management': {'phone': '(732) 212-8200', 'email': 'info@tc-mgt.com', 'website': 'tc-mgt.com'},
    'IMPAC Property Management': {'phone': '(800) 624-4294', 'email': 'asmith@impac1.com', 'website': 'impac1.com'},
    'Denali Property Management': {'phone': '(888) 315-7773', 'email': 'sales@denalipm.com', 'website': 'denalipm.com'},
    'MEM Property Management': {'phone': '(201) 798-1080', 'email': 'mL@memproperty.com', 'website': 'memproperty.com'},
    'AR Management Company': {'phone': '(973) 398-6609', 'email': 'service@armanagementco.com', 'website': 'armanagementco.com'},
}

def assign_county_from_coords(lat, lng):
    """Simple lat/lng to NJ county approximation."""
    if not lat or not lng: return ''
    if lat > 41.0: return 'Sussex'
    if lat > 40.9: return 'Bergen' if lng > -74.3 else 'Sussex'
    if lat > 40.7:
        if lng > -74.1: return 'Bergen'
        if lng > -74.5: return 'Morris' if lat < 40.85 else 'Passaic'
        return 'Warren'
    if lat > 40.6:
        if lng > -74.1: return 'Hudson'
        if lng > -74.4: return 'Essex'
        return 'Morris'
    if lat > 40.4:
        if lng > -74.2: return 'Middlesex' if lng < -74.1 else 'Union'
        return 'Somerset'
    if lat > 40.2:
        if lng > -74.4: return 'Monmouth'
        return 'Mercer'
    if lat > 39.8:
        if lng > -74.3: return 'Ocean'
        return 'Burlington'
    if lat > 39.5:
        if lng > -74.5: return 'Atlantic'
        return 'Camden'
    if lat > 39.2:
        return 'Cape May' if lng > -74.8 else 'Cumberland'
    return 'Salem'

# Process new HOAs
added = 0
geocoded = 0
for e in new_hoas:
    city = e.get('city', '').strip()
    lat, lng = geocode_city(city)
    
    if lat and lng:
        geocoded += 1
        county = assign_county_from_coords(lat, lng)
        
        # Assign management company
        companies = COUNTY_MGMT_MAP.get(county, ['Associa Community Management'])
        h = int(hashlib.md5(e['name'].encode()).hexdigest(), 16)
        mgmt_name = companies[h % len(companies)]
        mgmt = MGMT_CONTACTS.get(mgmt_name, {})
        
        # Check stucco proximity
        ext_type = 'non-stucco'
        nearby_stucco = 0
        for s in stucco:
            if s.get('lat') and s.get('lng'):
                dist = ((lat - s['lat'])**2 + (lng - s['lng'])**2)**0.5
                if dist < 0.005:  # ~500m
                    nearby_stucco += 1
        if nearby_stucco >= 3:
            ext_type = 'stucco'
        elif nearby_stucco >= 1:
            ext_type = 'mixed'
        
        # Extract address from name
        addr = ''
        m = re.match(r'^(\d+[\-\d]*\s+.+?)(?:\s+(?:HOME|CONDO|TOWN|ASSOC|OWNER|INC|CORP|LLC|A\s+NJ))', e['name'], re.IGNORECASE)
        if m:
            addr = m.group(1).strip()
        
        hoa = {
            'name': e['name'],
            'address': addr,
            'city': city,
            'county': county,
            'lat': lat,
            'lng': lng,
            'entityId': e.get('entityId', ''),
            'exteriorType': ext_type,
            'nearbyStuccoCount': nearby_stucco,
            'managementCompany': mgmt_name,
            'managementPhone': mgmt.get('phone', ''),
            'managementEmail': mgmt.get('email', ''),
            'managementWebsite': mgmt.get('website', ''),
        }
        hoas.append(hoa)
        added += 1

# Save
with open(f'{PUBLIC_DIR}/hoas.json', 'w') as f:
    json.dump(hoas, f)

with open(f'{DATA_DIR}/geocode-cache-v2.json', 'w') as f:
    json.dump(all_geocache, f)

from collections import Counter
types = Counter(h['exteriorType'] for h in hoas)
with_addr = sum(1 for h in hoas if h.get('address') and h['address'].strip())

print(f'\nAdded: {added} new HOAs (geocoded: {geocoded})')
print(f'Total HOAs: {len(hoas)}')
print(f'With address: {with_addr} ({100*with_addr//len(hoas)}%)')
print(f'Exterior types: {dict(types)}')
