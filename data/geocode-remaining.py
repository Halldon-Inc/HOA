"""
Batch geocode remaining NJ cities using Census Bureau geocoder (no rate limits).
Then apply city coordinates to all HOAs that need them.
"""
import json
import urllib.request
import urllib.parse
import time
import sys

DATA_DIR = '/Users/minime/Projects/nj-stucco-map/data'

def geocode_census(address):
    """Geocode using Census Bureau - no rate limits."""
    params = urllib.parse.urlencode({
        'address': address,
        'benchmark': 'Public_AR_Current',
        'format': 'json'
    })
    url = f'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?{params}'
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'NJHOAMap/1.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            matches = data.get('result', {}).get('addressMatches', [])
            if matches:
                coords = matches[0]['coordinates']
                return coords['y'], coords['x']
    except Exception as e:
        pass
    return None, None

def main():
    # Load data
    with open(f'{DATA_DIR}/sos-keyword-results.json') as f:
        hoas = json.load(f)
    
    with open(f'{DATA_DIR}/geocode-cache-v2.json') as f:
        cache = json.load(f)
    
    # Find cities we still need
    cities_needed = {}
    for h in hoas:
        city = (h.get('city') or '').strip()
        if not city:
            continue
        ckey = f'city:{city.upper()}'
        if ckey not in cache or not cache[ckey].get('lat'):
            if city.upper() not in cities_needed:
                cities_needed[city.upper()] = city
    
    print(f'Cities to geocode: {len(cities_needed)}', flush=True)
    
    geocoded = 0
    failed = 0
    
    for i, (city_upper, city_orig) in enumerate(cities_needed.items()):
        if (i + 1) % 20 == 0:
            print(f'  [{i+1}/{len(cities_needed)}] geocoded: {geocoded}, failed: {failed}', flush=True)
        
        # Try with NJ
        lat, lng = geocode_census(f'{city_orig}, NJ')
        
        if lat is None:
            # Try with "New Jersey"
            lat, lng = geocode_census(f'{city_orig}, New Jersey')
        
        ckey = f'city:{city_upper}'
        if lat is not None:
            cache[ckey] = {'lat': lat, 'lng': lng, 'source': 'census_city'}
            geocoded += 1
        else:
            cache[ckey] = {'lat': None, 'lng': None, 'source': 'failed'}
            failed += 1
        
        time.sleep(0.2)  # Small delay to be nice
    
    print(f'\nCity geocoding: {geocoded} success, {failed} failed', flush=True)
    
    # Now apply all coordinates to HOAs
    total_geocoded = 0
    total_failed = 0
    import random
    
    for h in hoas:
        eid = h.get('entityId') or h['name']
        
        # Check if already geocoded in cache
        if eid in cache and cache[eid].get('lat'):
            h['lat'] = cache[eid]['lat']
            h['lng'] = cache[eid]['lng']
            h['geoSource'] = cache[eid].get('source', 'cached')
            total_geocoded += 1
            continue
        
        # Try city-level
        city = (h.get('city') or '').strip().upper()
        if city:
            ckey = f'city:{city}'
            if ckey in cache and cache[ckey].get('lat'):
                # Add jitter so markers don't stack
                h['lat'] = cache[ckey]['lat'] + (random.random() - 0.5) * 0.01
                h['lng'] = cache[ckey]['lng'] + (random.random() - 0.5) * 0.01
                h['geoSource'] = 'city_center'
                cache[eid] = {'lat': h['lat'], 'lng': h['lng'], 'source': 'city_center'}
                total_geocoded += 1
                continue
        
        total_failed += 1
    
    print(f'\nFinal: {total_geocoded} geocoded, {total_failed} failed', flush=True)
    
    # Save cache
    with open(f'{DATA_DIR}/geocode-cache-v2.json', 'w') as f:
        json.dump(cache, f, indent=2)
    
    # Save geocoded HOAs for the map
    geocoded_hoas = [h for h in hoas if h.get('lat') and h.get('lng')]
    
    map_data = []
    for h in geocoded_hoas:
        map_data.append({
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
            'yearBuilt': None,
            'address': '',
            'buildingDesc': '',
        })
    
    with open(f'{DATA_DIR}/sos-hoas-geocoded.json', 'w') as f:
        json.dump(map_data, f, indent=2)
    
    print(f'Saved {len(map_data)} geocoded HOAs', flush=True)
    
    # Stats by city
    city_counts = {}
    for h in geocoded_hoas:
        c = h.get('city', 'Unknown')
        city_counts[c] = city_counts.get(c, 0) + 1
    
    print(f'\nTop 20 cities:', flush=True)
    for c, n in sorted(city_counts.items(), key=lambda x: x[1], reverse=True)[:20]:
        print(f'  {c}: {n}', flush=True)

if __name__ == '__main__':
    main()
