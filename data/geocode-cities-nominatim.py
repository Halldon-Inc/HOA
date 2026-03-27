"""
Geocode remaining NJ city names via Nominatim.
Rate limit: 1 req/sec max.
Census failed on all city-only queries, so Nominatim is the fallback.
"""
import json
import urllib.request
import urllib.parse
import time
import sys

DATA_DIR = '/Users/minime/Projects/nj-stucco-map/data'

def geocode_nominatim(city):
    """Geocode city via Nominatim."""
    params = urllib.parse.urlencode({
        'q': f'{city}, New Jersey, USA',
        'format': 'json',
        'countrycodes': 'us',
        'limit': '1'
    })
    url = f'https://nominatim.openstreetmap.org/search?{params}'
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'NJHOAMap/1.0 (research project)'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data:
                lat = float(data[0]['lat'])
                lon = float(data[0]['lon'])
                # Validate NJ bounds
                if 38.5 < lat < 41.5 and -75.6 < lon < -73.8:
                    return lat, lon
    except Exception as e:
        if '429' in str(e):
            print(f'  Rate limited, waiting 5s...', flush=True)
            time.sleep(5)
    return None, None

def main():
    with open(f'{DATA_DIR}/geocode-cache-v2.json') as f:
        cache = json.load(f)
    
    # Find all cities that still need geocoding
    cities_needed = set()
    with open(f'{DATA_DIR}/sos-keyword-results.json') as f:
        hoas = json.load(f)
    
    for h in hoas:
        city = (h.get('city') or '').strip()
        if not city:
            continue
        ckey = f'city:{city.upper()}'
        if ckey not in cache or not cache[ckey].get('lat'):
            cities_needed.add(city)
    
    # Deduplicate by upper
    unique_cities = {}
    for c in cities_needed:
        unique_cities[c.upper()] = c
    
    print(f'Cities to geocode: {len(unique_cities)}', flush=True)
    
    geocoded = 0
    failed = 0
    
    for i, (city_upper, city_orig) in enumerate(unique_cities.items()):
        sys.stdout.write(f'\r  [{i+1}/{len(unique_cities)}] {city_orig:30s} ')
        sys.stdout.flush()
        
        lat, lng = geocode_nominatim(city_orig)
        
        ckey = f'city:{city_upper}'
        if lat is not None:
            cache[ckey] = {'lat': lat, 'lng': lng, 'source': 'nominatim_city'}
            geocoded += 1
            print(f'✓ ({lat:.4f}, {lng:.4f})', flush=True)
        else:
            # Try without "New Jersey" (some are out of state)
            cache[ckey] = {'lat': None, 'lng': None, 'source': 'failed'}
            failed += 1
            print(f'✗', flush=True)
        
        time.sleep(1.1)  # Rate limit
        
        # Save every 20
        if (i + 1) % 20 == 0:
            with open(f'{DATA_DIR}/geocode-cache-v2.json', 'w') as f:
                json.dump(cache, f, indent=2)
    
    print(f'\n\nResults: {geocoded} geocoded, {failed} failed', flush=True)
    
    # Save final cache
    with open(f'{DATA_DIR}/geocode-cache-v2.json', 'w') as f:
        json.dump(cache, f, indent=2)
    
    # Now rebuild the full geocoded output
    import random
    
    total_geo = 0
    for h in hoas:
        eid = h.get('entityId') or h['name']
        
        if eid in cache and cache[eid].get('lat'):
            h['lat'] = cache[eid]['lat']
            h['lng'] = cache[eid]['lng']
            h['geoSource'] = cache[eid].get('source', 'cached')
            total_geo += 1
            continue
        
        city = (h.get('city') or '').strip().upper()
        if city:
            ckey = f'city:{city}'
            if ckey in cache and cache[ckey].get('lat'):
                h['lat'] = cache[ckey]['lat'] + (random.random() - 0.5) * 0.01
                h['lng'] = cache[ckey]['lng'] + (random.random() - 0.5) * 0.01
                h['geoSource'] = 'city_center'
                total_geo += 1
                continue
    
    geocoded_hoas = [h for h in hoas if h.get('lat') and h.get('lng')]
    
    map_data = [{
        'name': h['name'],
        'municipality': h.get('city', ''),
        'county': '',
        'entityId': h.get('entityId', ''),
        'entityType': h.get('type', ''),
        'dateFormed': h.get('dateFormed', ''),
        'lat': h['lat'],
        'lng': h['lng'],
        'geoSource': h.get('geoSource', 'unknown'),
        'parcelCount': 0,
        'exteriorType': 'unknown',
    } for h in geocoded_hoas]
    
    with open(f'{DATA_DIR}/sos-hoas-geocoded.json', 'w') as f:
        json.dump(map_data, f, indent=2)
    
    print(f'\nTotal HOAs with coordinates: {len(map_data)}', flush=True)

if __name__ == '__main__':
    main()
