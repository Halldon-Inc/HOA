"""
Reverse geocode HOA coordinates to get street addresses.
Uses Nominatim (OpenStreetMap) which is free but rate-limited (1 req/sec).
"""
import json
import time
import urllib.request
import urllib.parse

HOAS_FILE = '/Users/minime/Projects/nj-stucco-map/public/data/hoas.json'
CACHE_FILE = '/Users/minime/Projects/nj-stucco-map/data/reverse-geocode-cache.json'

# Load cache
try:
    with open(CACHE_FILE) as f:
        cache = json.load(f)
except:
    cache = {}

with open(HOAS_FILE) as f:
    hoas = json.load(f)

# Find HOAs without addresses that have coordinates
to_geocode = [h for h in hoas if (not h.get('address') or not h['address'].strip()) and h.get('lat') and h.get('lng')]
print(f'HOAs without address but with coords: {len(to_geocode)}')
print(f'Cache entries: {len(cache)}')

enriched = 0
errors = 0

for i, hoa in enumerate(to_geocode):
    lat = round(hoa['lat'], 5)
    lng = round(hoa['lng'], 5)
    cache_key = f'{lat},{lng}'
    
    if cache_key in cache:
        result = cache[cache_key]
    else:
        url = f'https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json&addressdetails=1'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'NJStuccoMap/1.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode())
                cache[cache_key] = result
        except Exception as e:
            errors += 1
            if errors > 10:
                print(f'Too many errors ({errors}), stopping')
                break
            time.sleep(3)
            continue
        
        # Rate limit: 1 request per second
        time.sleep(1.1)
    
    # Extract address
    addr = result.get('address', {})
    house_number = addr.get('house_number', '')
    road = addr.get('road', '')
    
    if house_number and road:
        hoa['address'] = f'{house_number} {road}'
        enriched += 1
    elif road:
        hoa['address'] = road
        enriched += 1
    
    # Progress
    if (i + 1) % 50 == 0:
        with_addr = sum(1 for h in hoas if h.get('address') and h['address'].strip())
        print(f'[{i+1}/{len(to_geocode)}] enriched: {enriched}, errors: {errors}, total with addr: {with_addr}')
        # Save progress
        with open(HOAS_FILE, 'w') as f:
            json.dump(hoas, f)
        with open(CACHE_FILE, 'w') as f:
            json.dump(cache, f)

# Final save
with open(HOAS_FILE, 'w') as f:
    json.dump(hoas, f)
with open(CACHE_FILE, 'w') as f:
    json.dump(cache, f)

with_addr = sum(1 for h in hoas if h.get('address') and h['address'].strip())
print(f'\nDone! Enriched: {enriched}, Errors: {errors}')
print(f'Total with address: {with_addr} / {len(hoas)} ({100*with_addr//len(hoas)}%)')
