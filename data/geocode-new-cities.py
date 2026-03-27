"""
Geocode new cities from expanded SoS results and rebuild geocoded HOA output.
"""
import json
import urllib.request
import urllib.parse
import time
import sys
import random

DATA_DIR = '/Users/minime/Projects/nj-stucco-map/data'

def geocode_nominatim(city):
    params = urllib.parse.urlencode({
        'q': f'{city}, New Jersey, USA',
        'format': 'json',
        'countrycodes': 'us',
        'limit': '1'
    })
    url = f'https://nominatim.openstreetmap.org/search?{params}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'NJHOAMap/1.0 (research)'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data:
                lat = float(data[0]['lat'])
                lon = float(data[0]['lon'])
                if 38.5 < lat < 41.5 and -75.6 < lon < -73.5:
                    return lat, lon
    except Exception as e:
        if '429' in str(e):
            time.sleep(5)
    return None, None

def main():
    with open(f'{DATA_DIR}/sos-keyword-results.json') as f:
        hoas = json.load(f)
    with open(f'{DATA_DIR}/geocode-cache-v2.json') as f:
        cache = json.load(f)
    
    # Find unique cities needing geocoding
    cities_needed = {}
    for h in hoas:
        city = (h.get('city') or '').strip()
        if not city:
            continue
        ckey = f'city:{city.upper()}'
        if ckey not in cache or not cache[ckey].get('lat'):
            cities_needed[city.upper()] = city
    
    print(f'Cities to geocode: {len(cities_needed)}', flush=True)
    
    geocoded = 0
    failed = 0
    
    for i, (city_upper, city_orig) in enumerate(cities_needed.items()):
        if (i + 1) % 20 == 0:
            print(f'  [{i+1}/{len(cities_needed)}] geocoded: {geocoded}, failed: {failed}', flush=True)
            with open(f'{DATA_DIR}/geocode-cache-v2.json', 'w') as f:
                json.dump(cache, f, indent=2)
        
        lat, lng = geocode_nominatim(city_orig)
        ckey = f'city:{city_upper}'
        if lat:
            cache[ckey] = {'lat': lat, 'lng': lng, 'source': 'nominatim_city'}
            geocoded += 1
        else:
            cache[ckey] = {'lat': None, 'lng': None, 'source': 'failed'}
            failed += 1
        
        time.sleep(1.1)
    
    print(f'\nCity geocoding: {geocoded} success, {failed} failed', flush=True)
    
    # Save cache
    with open(f'{DATA_DIR}/geocode-cache-v2.json', 'w') as f:
        json.dump(cache, f, indent=2)
    
    # Now build the full geocoded output
    total_geo = 0
    for h in hoas:
        eid = h.get('entityId') or h['name']
        
        # Entity-level cache
        if eid in cache and cache[eid].get('lat'):
            h['lat'] = cache[eid]['lat']
            h['lng'] = cache[eid]['lng']
            h['geoSource'] = cache[eid].get('source', 'cached')
            total_geo += 1
            continue
        
        # City-level cache with jitter
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
