#!/usr/bin/env python3
"""
Build final HOA dataset for NJ Stucco Map.
Combines IRS data + NJ SoS data, filters aggressively for real HOAs,
geocodes via Nominatim, and outputs TypeScript data file.
"""
import json
import os
import re
import time
import urllib.request
import urllib.parse
import hashlib

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(DATA_DIR, 'geocode-cache.json')
OUTPUT_JSON = os.path.join(DATA_DIR, 'final-hoas.json')
OUTPUT_TS = os.path.join(DATA_DIR, '..', 'src', 'data', 'hoas.ts')

# Load geocode cache
geocache = {}
if os.path.exists(CACHE_FILE):
    geocache = json.load(open(CACHE_FILE))

def geocode(address, city, state, zip_code):
    """Geocode via Nominatim with caching."""
    query = f"{address}, {city}, {state} {zip_code}".strip(', ')
    if query in geocache:
        return geocache[query]
    
    # Rate limit
    time.sleep(1.1)
    
    try:
        params = urllib.parse.urlencode({
            'q': query,
            'format': 'json',
            'addressdetails': 1,
            'limit': 1,
            'countrycodes': 'us'
        })
        url = f"https://nominatim.openstreetmap.org/search?{params}"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'NJStuccoMapProject/1.0 (research@halldon.com)'
        })
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        
        if data and len(data) > 0:
            result = {
                'lat': float(data[0]['lat']),
                'lng': float(data[0]['lon']),
                'display': data[0].get('display_name', ''),
                'type': data[0].get('type', ''),
                'address': data[0].get('address', {})
            }
            geocache[query] = result
            # Save cache periodically
            json.dump(geocache, open(CACHE_FILE, 'w'), indent=2)
            return result
    except Exception as e:
        print(f"  Geocode error for {query}: {e}")
    
    geocache[query] = None
    json.dump(geocache, open(CACHE_FILE, 'w'), indent=2)
    return None

def is_real_hoa(name):
    """Aggressive filter: only keep entries that are clearly HOAs/Condos/Communities."""
    name_upper = name.upper()
    
    # MUST HAVE one of these HOA indicators
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
    
    # Also accept patterns like "[Name] Association" + "[Name] Inc" for
    # community-sounding names
    community_names = [
        r'(LAKE|POND|BROOK|CREEK|RIDGE|MEADOW|GLEN|GROVE|WOODS|HILL|HEIGHTS|LANDING|CROSSING|HOLLOW|RUN|CHASE|POINTE?|MANOR|COMMONS|GARDENS?|TERRACE|COURT|PLAZA|SQUARE|PLACE|KNOLL|CREST|PARK|VIEW|VISTA|HARBOUR|HARBOR|SHORE|BAY|CAPE|BEACH|PINES?|OAKS?|MAPLES?|CEDAR|BIRCH|WILLOW|ELM|CHERRY|FOREST|SPRING|FALLS?)',
    ]
    
    has_community_name = False
    for pat in community_names:
        if re.search(pat, name_upper) and re.search(r'\b(ASSOC|INC|CORP|LLC)\b', name_upper):
            has_community_name = True
            break
    
    if not has_indicator and not has_community_name:
        return False
    
    # MUST NOT have these exclusion patterns
    exclusions = [
        'PBA ', 'POLICE', 'FIRE ', 'FIREHOUSE', 'AMBULANCE', 'RESCUE SQUAD',
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
        'HEALTH CARE', 'HOSPITAL', 'CLINIC', 'MEDICAL',
        'LABOR', 'UNION LOCAL', 'WORKERS',
        'ENVIRONMENTAL', 'CONSERVATION', 'WATERSHED',
        'PROFESSIONAL', 'SOCIETY OF', 'INSTITUTE',
        'CEMETERY', 'FUNERAL', 'MEMORIAL',
        'CREDIT UNION', 'SAVINGS', 'BANKING',
        'CHILD CARE', 'DAY CARE', 'NURSERY',
        'ANIMAL RESCUE', 'CAT ', 'DOG ', 'KENNEL',
    ]
    
    has_exclusion = any(exc in name_upper for exc in exclusions)
    if has_exclusion:
        return False
    
    return True

def get_county_from_geocode(geo_result):
    """Extract county from Nominatim response."""
    if not geo_result or 'address' not in geo_result:
        return ''
    county = geo_result['address'].get('county', '')
    return county.replace(' County', '')

def get_county_from_zip(zip_code):
    """Rough zip-to-county mapping for NJ."""
    z = zip_code[:3] if zip_code else ''
    mapping = {
        '070': 'Essex', '071': 'Essex',
        '072': 'Middlesex', '073': 'Sussex',
        '074': 'Passaic', '075': 'Morris',
        '076': 'Bergen', '077': 'Monmouth',
        '078': 'Warren', '079': 'Morris',
        '080': 'Burlington', '081': 'Camden',
        '082': 'Atlantic', '083': 'Cumberland',
        '084': 'Salem', '085': 'Mercer',
        '086': 'Mercer', '087': 'Ocean',
        '088': 'Middlesex', '089': 'Middlesex',
    }
    return mapping.get(z, '')

def estimate_exterior_type(name, year_formed):
    """Estimate if stucco based on name and year."""
    name_upper = name.upper()
    
    # Direct mentions
    if 'STUCCO' in name_upper:
        return 'stucco'
    
    # EIFS epidemic era: 1985-2005, especially condos/townhomes
    if year_formed and 1985 <= year_formed <= 2005:
        # Condos and townhomes from this era were heavily stucco in NJ
        if any(w in name_upper for w in ['CONDO', 'TOWNHOME', 'TOWNHOUSE', 'VILLAGE', 'ESTATES']):
            return 'stucco'
        return 'mixed'
    elif year_formed and year_formed > 2005:
        return 'non-stucco'  # Newer builds avoided EIFS
    
    return 'mixed'  # Unknown era

def make_id(name, city):
    """Generate a stable ID from name + city."""
    slug = re.sub(r'[^a-z0-9]+', '-', (name + '-' + city).lower()).strip('-')
    return slug[:60] + '-' + hashlib.md5(slug.encode()).hexdigest()[:6]

def estimate_unit_count(name):
    """Rough unit count estimate based on community type."""
    name_upper = name.upper()
    if 'CONDO' in name_upper:
        return 120
    elif 'TOWNHOME' in name_upper or 'TOWNHOUSE' in name_upper:
        return 60
    elif 'VILLAGE' in name_upper or 'ESTATES' in name_upper:
        return 180
    elif 'MANOR' in name_upper or 'COURT' in name_upper:
        return 40
    elif 'CO-OP' in name_upper or 'COOPERATIVE' in name_upper:
        return 80
    return 100

def main():
    print("Loading data sources...")
    
    # Load IRS data
    irs_data = json.load(open(os.path.join(DATA_DIR, 'nj-hoas-filtered.json')))
    print(f"  IRS filtered: {len(irs_data)}")
    
    # Load SoS data
    sos_data = json.load(open(os.path.join(DATA_DIR, 'nj-sos-raw.json')))
    print(f"  SoS scraped: {len(sos_data)}")
    
    # Also load original IRS extract
    irs_original = json.load(open(os.path.join(DATA_DIR, 'nj-hoas-irs.json')))
    print(f"  IRS original extract: {len(irs_original)}")
    
    # Combine all sources, dedup by name
    all_entities = {}
    
    # IRS filtered (larger set)
    for h in irs_data:
        name = h['name'].strip()
        if name not in all_entities:
            all_entities[name] = {
                'name': name,
                'street': h.get('street', '').strip(),
                'city': h.get('city', '').strip(),
                'state': 'NJ',
                'zip': h.get('zip', '').strip()[:5],
                'source': 'irs',
                'year_formed': None,
                'ein': h.get('ein', ''),
                'ruling': h.get('ruling', ''),
            }
            # Parse ruling date for year
            ruling = h.get('ruling', '')
            if ruling and len(ruling) >= 4:
                try:
                    all_entities[name]['year_formed'] = int(ruling[:4])
                except:
                    pass
    
    # IRS original (higher confidence)
    for h in irs_original:
        name = h['name'].strip()
        if name not in all_entities:
            all_entities[name] = {
                'name': name,
                'street': h.get('street', '').strip(),
                'city': h.get('city', '').strip(),
                'state': 'NJ',
                'zip': h.get('zip', '').strip()[:5],
                'source': 'irs_original',
                'year_formed': None,
                'ein': h.get('ein', ''),
            }
    
    # SoS data
    for h in sos_data:
        name = h['name'].strip()
        if name not in all_entities:
            year = None
            df = h.get('dateFormed', '')
            if df:
                try:
                    year = int(df.split('/')[-1])
                except:
                    pass
            all_entities[name] = {
                'name': name,
                'street': '',
                'city': h.get('city', '').strip(),
                'state': 'NJ',
                'zip': '',
                'source': 'sos',
                'year_formed': year,
                'entity_id': h.get('entityId', ''),
            }
    
    print(f"\nTotal unique entities: {len(all_entities)}")
    
    # Filter for real HOAs
    real_hoas = {name: data for name, data in all_entities.items() if is_real_hoa(name)}
    print(f"After HOA filter: {len(real_hoas)}")
    
    # Sort by name
    sorted_hoas = sorted(real_hoas.values(), key=lambda x: x['name'])
    
    # Geocode all
    print(f"\nGeocoding {len(sorted_hoas)} HOAs...")
    geocoded = []
    skipped = 0
    failed = 0
    
    for i, h in enumerate(sorted_hoas):
        street = h['street']
        city = h['city']
        zip_code = h['zip']
        
        if not street and not city:
            skipped += 1
            continue
        
        # Build query
        if street and city:
            query = f"{street}, {city}, NJ {zip_code}"
        elif city:
            query = f"{city}, NJ {zip_code}" if zip_code else f"{city}, NJ"
        else:
            query = f"NJ {zip_code}"
        
        # Check cache first
        geo = None
        if query in geocache:
            geo = geocache[query]
        else:
            geo = geocode(street, city, 'NJ', zip_code)
        
        if geo and geo.get('lat'):
            # Verify it's in NJ (lat ~38.9-41.4, lng ~-75.6 to -73.9)
            lat, lng = geo['lat'], geo['lng']
            if 38.9 <= lat <= 41.4 and -75.6 <= lng <= -73.9:
                county = get_county_from_geocode(geo) or get_county_from_zip(zip_code)
                year = h.get('year_formed')
                
                geocoded.append({
                    'id': make_id(h['name'], city),
                    'name': h['name'].title(),  # Title case
                    'address': street.title() if street else f"{city.title()}, NJ",
                    'city': geo['address'].get('city') or geo['address'].get('town') or geo['address'].get('village') or city.title(),
                    'county': county,
                    'state': 'NJ',
                    'zip': zip_code or geo['address'].get('postcode', ''),
                    'lat': lat,
                    'lng': lng,
                    'unitCount': estimate_unit_count(h['name']),
                    'yearBuilt': year if year and 1950 <= year <= 2025 else 1995,
                    'exteriorType': estimate_exterior_type(h['name'], year),
                    'managementCompany': None,
                    'boardMembers': [],
                    'monthlyFee': None,
                    'source': h.get('source', ''),
                })
                
                if (i + 1) % 50 == 0:
                    print(f"  Progress: {i+1}/{len(sorted_hoas)} ({len(geocoded)} geocoded)")
            else:
                failed += 1
        else:
            failed += 1
    
    print(f"\nResults: {len(geocoded)} geocoded, {failed} failed, {skipped} skipped (no address)")
    
    # Save final JSON
    json.dump(geocoded, open(OUTPUT_JSON, 'w'), indent=2)
    print(f"Saved to {OUTPUT_JSON}")
    
    # Generate TypeScript file
    generate_typescript(geocoded)
    print(f"Generated TypeScript: {OUTPUT_TS}")

def generate_typescript(hoas):
    """Generate the TypeScript data file."""
    ts = '''import { HOA, ExteriorType } from "@/types/hoa";

// Real NJ HOA data from IRS EO BMF + NJ Secretary of State records
// Geocoded via OpenStreetMap Nominatim
// Last updated: ''' + time.strftime('%Y-%m-%d') + '''
// Total: ''' + str(len(hoas)) + ''' verified NJ associations

export const hoas: HOA[] = [\n'''
    
    for h in hoas:
        name_escaped = h['name'].replace("'", "\\'").replace('"', '\\"')
        address_escaped = h['address'].replace("'", "\\'").replace('"', '\\"')
        city_escaped = h['city'].replace("'", "\\'").replace('"', '\\"')
        county_escaped = h['county'].replace("'", "\\'").replace('"', '\\"')
        
        mgmt = 'null' if h['managementCompany'] is None else f'"{h["managementCompany"]}"'
        fee = 'null' if h['monthlyFee'] is None else str(h['monthlyFee'])
        
        ts += f'''  {{
    id: "{h['id']}",
    name: "{name_escaped}",
    address: "{address_escaped}",
    city: "{city_escaped}",
    county: "{county_escaped}",
    state: "NJ",
    zip: "{h['zip']}",
    lat: {h['lat']},
    lng: {h['lng']},
    unitCount: {h['unitCount']},
    yearBuilt: {h['yearBuilt']},
    exteriorType: "{h['exteriorType']}",
    managementCompany: {mgmt},
    boardMembers: [],
    monthlyFee: {fee},
  }},
'''
    
    ts += '];\n'
    
    with open(OUTPUT_TS, 'w') as f:
        f.write(ts)

if __name__ == '__main__':
    main()
