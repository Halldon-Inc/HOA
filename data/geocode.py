#!/usr/bin/env python3
"""
Geocode NJ HOAs using OpenStreetMap Nominatim API (free, 1 req/sec)
"""
import json
import time
import urllib.request
import urllib.parse
import os
import sys

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_FILE = os.path.join(DATA_DIR, 'nj-hoas-filtered.json')
OUTPUT_FILE = os.path.join(DATA_DIR, 'nj-hoas-geocoded.json')
CACHE_FILE = os.path.join(DATA_DIR, 'geocode-cache.json')

# Load cache
cache = {}
if os.path.exists(CACHE_FILE):
    with open(CACHE_FILE) as f:
        cache = json.load(f)

def geocode(address, city, state, zip_code):
    """Geocode using Nominatim"""
    # Build query
    is_po_box = 'PO BOX' in address.upper() or 'P.O.' in address.upper()
    
    if is_po_box:
        # For PO Box, just geocode the city
        query = f"{city}, {state} {zip_code}"
    else:
        query = f"{address}, {city}, {state} {zip_code}"
    
    cache_key = query.strip().upper()
    if cache_key in cache:
        return cache[cache_key]
    
    # URL encode
    params = urllib.parse.urlencode({
        'q': query,
        'format': 'json',
        'countrycodes': 'us',
        'limit': 1,
        'addressdetails': 1,
    })
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    
    req = urllib.request.Request(url, headers={
        'User-Agent': 'NJStuccoMap/1.0 (research project)',
    })
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read())
            if data and len(data) > 0:
                result = {
                    'lat': float(data[0]['lat']),
                    'lng': float(data[0]['lon']),
                    'display': data[0].get('display_name', ''),
                    'type': data[0].get('type', ''),
                    'address': data[0].get('address', {}),
                }
                cache[cache_key] = result
                return result
            
            # Fallback: try just city + state + zip
            if not is_po_box:
                fallback_query = f"{city}, {state} {zip_code}"
                fallback_key = fallback_query.strip().upper()
                if fallback_key in cache:
                    cache[cache_key] = cache[fallback_key]
                    return cache[fallback_key]
                
                params2 = urllib.parse.urlencode({
                    'q': fallback_query,
                    'format': 'json',
                    'countrycodes': 'us',
                    'limit': 1,
                    'addressdetails': 1,
                })
                url2 = f"https://nominatim.openstreetmap.org/search?{params2}"
                req2 = urllib.request.Request(url2, headers={
                    'User-Agent': 'NJStuccoMap/1.0 (research project)',
                })
                time.sleep(1.1)
                with urllib.request.urlopen(req2, timeout=10) as resp2:
                    data2 = json.loads(resp2.read())
                    if data2 and len(data2) > 0:
                        result = {
                            'lat': float(data2[0]['lat']),
                            'lng': float(data2[0]['lon']),
                            'display': data2[0].get('display_name', ''),
                            'type': 'city_fallback',
                            'address': data2[0].get('address', {}),
                        }
                        cache[cache_key] = result
                        return result
            
            cache[cache_key] = None
            return None
    except Exception as e:
        print(f"  Geocode error for '{query}': {e}")
        return None


# NJ zip-to-county mapping (more precise)
ZIP_TO_COUNTY = {}
# We'll derive county from geocode results when available

NJ_COUNTY_MAP = {
    '07001': 'Union', '07002': 'Hudson', '07003': 'Essex', '07004': 'Passaic',
    '07005': 'Morris', '07006': 'Essex', '07007': 'Essex', '07008': 'Middlesex',
    '07009': 'Essex', '07010': 'Bergen', '07011': 'Passaic', '07012': 'Passaic',
    '07013': 'Passaic', '07014': 'Passaic', '07016': 'Union', '07017': 'Essex',
    '07018': 'Essex', '07020': 'Bergen', '07021': 'Essex', '07022': 'Bergen',
    '07023': 'Union', '07024': 'Bergen', '07026': 'Bergen', '07027': 'Union',
    '07028': 'Essex', '07029': 'Hudson', '07030': 'Hudson', '07031': 'Bergen',
    '07032': 'Hudson', '07033': 'Union', '07034': 'Morris', '07035': 'Morris',
    '07036': 'Union', '07039': 'Essex', '07040': 'Essex', '07041': 'Essex',
    '07042': 'Essex', '07043': 'Essex', '07044': 'Essex', '07045': 'Morris',
    '07046': 'Morris', '07047': 'Hudson', '07050': 'Essex', '07052': 'Essex',
    '07054': 'Morris', '07055': 'Passaic', '07057': 'Bergen', '07058': 'Morris',
    '07059': 'Somerset', '07060': 'Union', '07062': 'Union', '07063': 'Union',
    '07064': 'Middlesex', '07065': 'Union', '07066': 'Union', '07067': 'Union',
    '07068': 'Essex', '07069': 'Union', '07070': 'Bergen', '07071': 'Bergen',
    '07072': 'Bergen', '07073': 'Bergen', '07074': 'Bergen', '07075': 'Bergen',
    '07076': 'Union', '07077': 'Middlesex', '07078': 'Essex', '07079': 'Essex',
    '07080': 'Union', '07081': 'Union', '07082': 'Morris', '07083': 'Union',
    '07086': 'Hudson', '07087': 'Hudson', '07088': 'Union', '07090': 'Union',
    '07092': 'Union', '07093': 'Hudson', '07094': 'Hudson', '07095': 'Middlesex',
    '07096': 'Hudson',
}

def get_county_from_zip(zip_code):
    """Derive county from zip code prefix"""
    z = zip_code[:5] if len(zip_code) >= 5 else zip_code
    if z in NJ_COUNTY_MAP:
        return NJ_COUNTY_MAP[z]
    
    # Broader mapping by prefix
    prefix = z[:3]
    county_by_prefix = {
        '070': 'Essex', '071': 'Essex', '072': 'Middlesex',
        '073': 'Sussex', '074': 'Passaic', '075': 'Passaic',
        '076': 'Bergen', '077': 'Monmouth', '078': 'Warren',
        '079': 'Morris', '080': 'Burlington', '081': 'Camden',
        '082': 'Atlantic', '083': 'Cumberland', '084': 'Salem',
        '085': 'Mercer', '086': 'Mercer', '087': 'Ocean',
        '088': 'Middlesex', '089': 'Middlesex',
    }
    return county_by_prefix.get(prefix, 'Unknown')


def main():
    with open(INPUT_FILE) as f:
        hoas = json.load(f)
    
    print(f"Geocoding {len(hoas)} HOAs...")
    geocoded = []
    failed = []
    
    for i, hoa in enumerate(hoas):
        if i > 0 and i % 50 == 0:
            # Save intermediate
            with open(CACHE_FILE, 'w') as f:
                json.dump(cache, f)
            print(f"  Progress: {i}/{len(hoas)} ({len(geocoded)} success, {len(failed)} failed)")
        
        result = geocode(
            hoa.get('street', ''),
            hoa.get('city', ''),
            hoa.get('state', 'NJ'),
            hoa.get('zip', '')
        )
        
        time.sleep(1.1)  # Nominatim rate limit
        
        if result and result.get('lat'):
            lat = result['lat']
            lng = result['lng']
            
            # Verify it's in NJ (rough bounding box)
            if 38.9 <= lat <= 41.4 and -75.6 <= lng <= -73.8:
                # Get county from geocode result or zip
                county = ''
                addr = result.get('address', {})
                if 'county' in addr:
                    county = addr['county'].replace(' County', '')
                else:
                    county = get_county_from_zip(hoa.get('zip', ''))
                
                geocoded.append({
                    **hoa,
                    'lat': lat,
                    'lng': lng,
                    'county': county,
                    'geocode_type': result.get('type', ''),
                })
            else:
                failed.append({**hoa, 'reason': f'outside NJ bounds: {lat},{lng}'})
        else:
            failed.append({**hoa, 'reason': 'no geocode result'})
    
    # Save final cache
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f)
    
    # Save results
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(geocoded, f, indent=2)
    
    failed_file = os.path.join(DATA_DIR, 'geocode-failed.json')
    with open(failed_file, 'w') as f:
        json.dump(failed, f, indent=2)
    
    print(f"\nDone!")
    print(f"  Geocoded: {len(geocoded)}")
    print(f"  Failed: {len(failed)}")
    print(f"  Saved to: {OUTPUT_FILE}")


if __name__ == '__main__':
    main()
