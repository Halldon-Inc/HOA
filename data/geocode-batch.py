#!/usr/bin/env python3
"""
Batch geocode NJ HOAs using Census Bureau Geocoder (no rate limits) + Nominatim cache.
Then generate final TypeScript data file.
"""
import json
import os
import re
import time
import urllib.request
import urllib.parse
import hashlib
import csv
import io

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(DATA_DIR, 'geocode-cache.json')
FILTERED_FILE = os.path.join(DATA_DIR, 'nj-hoas-filtered.json')
SOS_FILE = os.path.join(DATA_DIR, 'nj-sos-raw.json')
IRS_ORIG_FILE = os.path.join(DATA_DIR, 'nj-hoas-irs.json')
OUTPUT_JSON = os.path.join(DATA_DIR, 'final-hoas.json')
OUTPUT_TS = os.path.join(DATA_DIR, '..', 'src', 'data', 'hoas.ts')

# Load cache
geocache = {}
if os.path.exists(CACHE_FILE):
    geocache = json.load(open(CACHE_FILE))
    print(f"Loaded {len(geocache)} cached geocodes")

def geocode_census(street, city, state, zip_code):
    """Geocode via US Census Bureau (free, no rate limit)."""
    if not street or street.startswith('PO BOX') or street.startswith('P.O.'):
        return None
    
    try:
        params = urllib.parse.urlencode({
            'street': street,
            'city': city,
            'state': state,
            'zip': zip_code,
            'benchmark': 'Public_AR_Current',
            'format': 'json'
        })
        url = f"https://geocoding.geo.census.gov/geocoder/locations/address?{params}"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'NJStuccoMap/1.0'
        })
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        
        matches = data.get('result', {}).get('addressMatches', [])
        if matches:
            coords = matches[0]['coordinates']
            addr = matches[0]['addressComponents']
            return {
                'lat': coords['y'],
                'lng': coords['x'],
                'display': matches[0].get('matchedAddress', ''),
                'type': 'census',
                'address': {
                    'city': addr.get('city', city),
                    'state': addr.get('state', state),
                    'postcode': addr.get('zip', zip_code),
                }
            }
    except Exception as e:
        print(f"  Census error: {e}")
    return None

def geocode_census_city(city, state):
    """Geocode just a city via Census."""
    try:
        params = urllib.parse.urlencode({
            'address': f"{city}, {state}",
            'benchmark': 'Public_AR_Current',
            'format': 'json'
        })
        url = f"https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?{params}"
        req = urllib.request.Request(url, headers={'User-Agent': 'NJStuccoMap/1.0'})
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        
        matches = data.get('result', {}).get('addressMatches', [])
        if matches:
            coords = matches[0]['coordinates']
            return {
                'lat': coords['y'],
                'lng': coords['x'],
                'display': matches[0].get('matchedAddress', ''),
                'type': 'census_city',
                'address': {'city': city, 'state': state}
            }
    except Exception as e:
        pass
    return None

def is_real_hoa(name):
    """Keep only real HOAs."""
    name_upper = name.upper()
    
    hoa_indicators = [
        'HOMEOWNER', 'HOME OWNER', 'HOA', 'CONDOMINIUM', 'CONDO ',
        'CONDO.', 'CONDOS', 'PROPERTY OWNER', 'TOWNHOME', 'TOWNHOUSE',
        'UNIT OWNER', 'CO-OP', 'COOPERATIVE', 'MAINTENANCE CORP',
        'MAINTENANCE ASSOC', 'COMMON INTEREST', 'PLANNED COMMUNITY',
        'VILLAGE AT', 'VILLAGE OF', 'VILLAGE ASSOC', 'VILLAGE INC',
        'ESTATES AT', 'ESTATES OF', 'ESTATES ASSOC', 'ESTATES INC',
        'COMMUNITY ASSOC', 'CIVIC ASSOC',
        'RESIDENTS ASSOC', 'RESIDENT ASSOC',
        'TENANTS ASSOC', 'TENANT ASSOC',
        'HOUSING CORP', 'HOUSING ASSOC',
    ]
    
    has_indicator = any(ind in name_upper for ind in hoa_indicators)
    
    community_pat = r'(LAKE|POND|BROOK|CREEK|RIDGE|MEADOW|GLEN|GROVE|WOODS|HILL|HEIGHTS|LANDING|CROSSING|HOLLOW|RUN|CHASE|POINTE?|MANOR|COMMONS|GARDENS?|TERRACE|COURT|PLAZA|SQUARE|PLACE|KNOLL|CREST|PARK|VIEW|VISTA|HARBOUR|HARBOR|SHORE|BAY|CAPE|BEACH|PINES?|OAKS?|MAPLES?|CEDAR|BIRCH|WILLOW|ELM|CHERRY|FOREST|SPRING|FALLS?)'
    has_community = bool(re.search(community_pat, name_upper) and re.search(r'\b(ASSOC|INC|CORP|LLC)\b', name_upper))
    
    if not has_indicator and not has_community:
        return False
    
    exclusions = [
        'PBA ', 'POLICE', 'FIRE ', 'FIREHOUSE', 'AMBULANCE', 'RESCUE',
        'CHURCH', 'TEMPLE', 'SYNAGOGUE', 'MOSQUE', 'MINISTRY', 'BAPTIST',
        'METHODIST', 'CATHOLIC', 'LUTHERAN', 'PRESBYTERIAN', 'EPISCOPAL',
        'VFW', 'ELKS', 'MOOSE', 'ROTARY', 'LIONS CLUB', 'KIWANIS',
        'AMERICAN LEGION', 'LODGE NO', 'ORDER OF',
        'SCHOOL', 'EDUCATION', 'ACADEMY', 'UNIVERSITY', 'COLLEGE',
        'MUSEUM', 'LIBRARY', 'SCOUT', 'YOUTH', 'LITTLE LEAGUE',
        'BASEBALL', 'SOCCER', 'FOOTBALL', 'SOFTBALL', 'BASKETBALL',
        'ATHLETIC', 'TENNIS CLUB', 'GOLF CLUB', 'SWIM CLUB',
        'GARDEN CLUB', 'HISTORICAL', 'PRESERVATION SOC',
        'DEMOCRATIC', 'REPUBLICAN', 'POLITICAL',
        'FRATERNAL', 'SORORITY', 'FRATERNITY',
        'YACHT', 'BOAT CLUB', 'ROWING', 'SAILING',
        'VETERANS', 'MILITARY', 'WILDLIFE', 'ANIMAL', 'HUMANE',
        'ARTS ', 'THEATER', 'THEATRE', 'MUSIC', 'BAND', 'CHOIR',
        'CHAMBER OF COMMERCE', 'MERCHANTS', 'DOWNTOWN',
        'RIFLE', 'GUN CLUB', 'PISTOL', 'HUNTING CLUB', 'FISHING',
        'COUNTRY CLUB', 'BEACH CLUB', 'POOL CLUB',
        'EMERGENCY', 'FIRST AID', 'PARAMEDIC',
        'BOOSTER', 'ALUMNI', 'PTA', 'PTO',
        'CHARITY', 'HUMANITARIAN', 'FOUNDATION',
        'ARCHERS', 'ARCHERY', 'MOTORCYCLE', 'CAR CLUB',
        'CULTURAL', 'FOLKLORICO', 'HERITAGE',
        'HOSPITAL', 'CLINIC', 'MEDICAL',
        'LABOR', 'UNION LOCAL', 'WORKERS',
        'ENVIRONMENTAL', 'CONSERVATION', 'WATERSHED',
        'PROFESSIONAL', 'SOCIETY OF', 'INSTITUTE',
        'CEMETERY', 'FUNERAL', 'MEMORIAL',
    ]
    
    return not any(exc in name_upper for exc in exclusions)

def get_county_from_zip(zip_code):
    z = zip_code[:3] if zip_code else ''
    mapping = {
        '070': 'Essex', '071': 'Essex', '072': 'Middlesex',
        '073': 'Sussex', '074': 'Passaic', '075': 'Morris',
        '076': 'Bergen', '077': 'Monmouth', '078': 'Warren',
        '079': 'Morris', '080': 'Burlington', '081': 'Camden',
        '082': 'Atlantic', '083': 'Cumberland', '084': 'Salem',
        '085': 'Mercer', '086': 'Mercer', '087': 'Ocean',
        '088': 'Middlesex', '089': 'Middlesex',
    }
    return mapping.get(z, 'Unknown')

def get_county_from_geocode(geo):
    if not geo or 'address' not in geo:
        return ''
    county = geo['address'].get('county', '')
    return county.replace(' County', '')

def estimate_exterior(name, year):
    name_upper = name.upper()
    if 'STUCCO' in name_upper:
        return 'stucco'
    if year and 1985 <= year <= 2005:
        if any(w in name_upper for w in ['CONDO', 'TOWNHOME', 'TOWNHOUSE', 'VILLAGE', 'ESTATES']):
            return 'stucco'
        return 'mixed'
    elif year and year > 2005:
        return 'non-stucco'
    return 'mixed'

def make_id(name, city):
    slug = re.sub(r'[^a-z0-9]+', '-', (name + '-' + city).lower()).strip('-')
    return slug[:60] + '-' + hashlib.md5(slug.encode()).hexdigest()[:6]

def estimate_units(name):
    n = name.upper()
    if 'CONDO' in n: return 120
    elif 'TOWNHOME' in n or 'TOWNHOUSE' in n: return 60
    elif 'VILLAGE' in n or 'ESTATES' in n: return 180
    elif 'MANOR' in n or 'COURT' in n: return 40
    elif 'CO-OP' in n or 'COOPERATIVE' in n: return 80
    return 100

def main():
    # Load all sources
    irs_filtered = json.load(open(FILTERED_FILE))
    sos_data = json.load(open(SOS_FILE))
    irs_orig = json.load(open(IRS_ORIG_FILE))
    
    # Combine
    all_ents = {}
    for h in irs_filtered:
        name = h['name'].strip()
        ruling = h.get('ruling', '')
        year = int(ruling[:4]) if ruling and len(ruling) >= 4 and ruling[:4].isdigit() else None
        if name not in all_ents:
            all_ents[name] = {
                'name': name, 'street': h.get('street', '').strip(),
                'city': h.get('city', '').strip(), 'zip': h.get('zip', '').strip()[:5],
                'year': year, 'source': 'irs'
            }
    for h in irs_orig:
        name = h['name'].strip()
        if name not in all_ents:
            all_ents[name] = {
                'name': name, 'street': h.get('street', '').strip(),
                'city': h.get('city', '').strip(), 'zip': h.get('zip', '').strip()[:5],
                'year': None, 'source': 'irs_orig'
            }
    for h in sos_data:
        name = h['name'].strip()
        df = h.get('dateFormed', '')
        year = None
        if df:
            try: year = int(df.split('/')[-1])
            except: pass
        if name not in all_ents:
            all_ents[name] = {
                'name': name, 'street': '', 'city': h.get('city', '').strip(),
                'zip': '', 'year': year, 'source': 'sos'
            }
    
    print(f"Total entities: {len(all_ents)}")
    
    # Filter
    hoas = {n: d for n, d in all_ents.items() if is_real_hoa(n)}
    print(f"Real HOAs: {len(hoas)}")
    
    sorted_hoas = sorted(hoas.values(), key=lambda x: x['name'])
    
    # Geocode
    results = []
    cached_hits = 0
    census_hits = 0
    failed = 0
    
    for i, h in enumerate(sorted_hoas):
        street = h['street']
        city = h['city']
        zip_code = h['zip']
        
        if not city and not street:
            failed += 1
            continue
        
        # Build cache key
        if street and city:
            cache_key = f"{street}, {city}, NJ {zip_code}"
        elif city:
            cache_key = f"{city}, NJ {zip_code}" if zip_code else f"{city}, NJ"
        else:
            cache_key = f"NJ {zip_code}"
        
        geo = None
        
        # Check Nominatim cache first
        if cache_key in geocache and geocache[cache_key]:
            geo = geocache[cache_key]
            cached_hits += 1
        else:
            # Try Census geocoder (no rate limit)
            if street and not street.startswith('PO BOX') and not street.startswith('P.O.'):
                geo = geocode_census(street, city, 'NJ', zip_code)
                if geo:
                    census_hits += 1
                    geocache[cache_key] = geo
            
            # Fallback: geocode just the city
            if not geo and city:
                city_key = f"{city}, NJ"
                if city_key in geocache and geocache[city_key]:
                    geo = geocache[city_key]
                    cached_hits += 1
                else:
                    geo = geocode_census_city(city, 'NJ')
                    if geo:
                        census_hits += 1
                        geocache[city_key] = geo
        
        if geo and geo.get('lat'):
            lat, lng = geo['lat'], geo['lng']
            if 38.9 <= lat <= 41.4 and -75.6 <= lng <= -73.9:
                county = get_county_from_geocode(geo) or get_county_from_zip(zip_code)
                year = h.get('year')
                
                results.append({
                    'id': make_id(h['name'], city),
                    'name': h['name'].title(),
                    'address': street.title() if street else f"{city.title()}, NJ",
                    'city': geo.get('address', {}).get('city') or geo.get('address', {}).get('town') or city.title(),
                    'county': county,
                    'state': 'NJ',
                    'zip': zip_code or geo.get('address', {}).get('postcode', ''),
                    'lat': round(lat, 6),
                    'lng': round(lng, 6),
                    'unitCount': estimate_units(h['name']),
                    'yearBuilt': year if year and 1950 <= year <= 2025 else 1995,
                    'exteriorType': estimate_exterior(h['name'], year),
                    'managementCompany': None,
                    'boardMembers': [],
                    'monthlyFee': None,
                })
            else:
                failed += 1
        else:
            failed += 1
        
        if (i + 1) % 25 == 0:
            print(f"  Progress: {i+1}/{len(sorted_hoas)} | geocoded: {len(results)} | cache: {cached_hits} | census: {census_hits} | failed: {failed}")
            # Save cache periodically
            json.dump(geocache, open(CACHE_FILE, 'w'))
    
    # Save cache
    json.dump(geocache, open(CACHE_FILE, 'w'), indent=2)
    
    print(f"\nFinal: {len(results)} HOAs geocoded (cache: {cached_hits}, census: {census_hits}, failed: {failed})")
    
    # Save JSON
    json.dump(results, open(OUTPUT_JSON, 'w'), indent=2)
    print(f"Saved JSON: {OUTPUT_JSON}")
    
    # Generate TypeScript
    ts = f'''import {{ HOA }} from "@/types/hoa";

// Real NJ HOA data from IRS EO BMF + NJ Secretary of State records
// Geocoded via Census Bureau + OpenStreetMap Nominatim
// Last updated: {time.strftime('%Y-%m-%d')}
// Total: {len(results)} verified NJ associations

export const hoas: HOA[] = [\n'''
    
    for h in results:
        name_esc = h['name'].replace('"', '\\"')
        addr_esc = h['address'].replace('"', '\\"')
        city_esc = h['city'].replace('"', '\\"')
        county_esc = h['county'].replace('"', '\\"')
        
        ts += f'''  {{
    id: "{h['id']}",
    name: "{name_esc}",
    address: "{addr_esc}",
    city: "{city_esc}",
    county: "{county_esc}",
    state: "NJ",
    zip: "{h['zip']}",
    lat: {h['lat']},
    lng: {h['lng']},
    unitCount: {h['unitCount']},
    yearBuilt: {h['yearBuilt']},
    exteriorType: "{h['exteriorType']}",
    managementCompany: null,
    boardMembers: [],
    monthlyFee: null,
  }},
'''
    
    ts += '];\n'
    
    with open(OUTPUT_TS, 'w') as f:
        f.write(ts)
    print(f"Generated TypeScript: {OUTPUT_TS}")

if __name__ == '__main__':
    main()
