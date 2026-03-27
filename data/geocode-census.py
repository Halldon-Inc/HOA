#!/usr/bin/env python3
"""
Geocode NJ HOAs using US Census Bureau Geocoder (free, batch supported)
https://geocoding.geo.census.gov/geocoder/
Batch: up to 10,000 addresses per file
"""
import json
import csv
import time
import urllib.request
import urllib.parse
import os
import sys
import io
import tempfile

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_FILE = os.path.join(DATA_DIR, 'nj-hoas-filtered.json')
OUTPUT_FILE = os.path.join(DATA_DIR, 'nj-hoas-geocoded.json')

def geocode_batch_census(addresses):
    """
    Geocode a batch of addresses using Census Bureau batch geocoder
    addresses: list of dicts with id, street, city, state, zip
    Returns: dict of id -> {lat, lng, matched_address}
    """
    # Create CSV in memory
    csv_content = io.StringIO()
    writer = csv.writer(csv_content)
    for addr in addresses:
        writer.writerow([
            addr['id'],
            addr['street'],
            addr['city'],
            addr['state'],
            addr['zip'][:5] if addr['zip'] else ''
        ])
    
    csv_bytes = csv_content.getvalue().encode('utf-8')
    
    # Upload to Census geocoder
    boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    body = (
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="addressFile"; filename="addresses.csv"\r\n'
        f'Content-Type: text/csv\r\n\r\n'
    ).encode() + csv_bytes + (
        f'\r\n--{boundary}\r\n'
        f'Content-Disposition: form-data; name="benchmark"\r\n\r\n'
        f'Public_AR_Current\r\n'
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="returntype"\r\n\r\n'
        f'locations\r\n'
        f'--{boundary}--\r\n'
    ).encode()
    
    url = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': f'multipart/form-data; boundary={boundary}',
        'User-Agent': 'NJStuccoMap/1.0',
    })
    
    results = {}
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            text = response.read().decode('utf-8')
            reader = csv.reader(io.StringIO(text))
            for row in reader:
                if len(row) >= 6:
                    addr_id = row[0].strip('"')
                    match_type = row[2].strip('"') if len(row) > 2 else ''
                    matched_addr = row[3].strip('"') if len(row) > 3 else ''
                    coords = row[5].strip('"') if len(row) > 5 else ''
                    
                    if match_type in ('Match', 'Exact') and coords:
                        lng_str, lat_str = coords.split(',')
                        results[addr_id] = {
                            'lat': float(lat_str.strip()),
                            'lng': float(lng_str.strip()),
                            'matched_address': matched_addr,
                            'match_type': match_type,
                        }
    except Exception as e:
        print(f"  Batch geocode error: {e}", flush=True)
    
    return results

def geocode_single_census(street, city, state, zip_code):
    """Single address geocode via Census Bureau"""
    params = urllib.parse.urlencode({
        'street': street,
        'city': city,
        'state': state,
        'zip': zip_code[:5] if zip_code else '',
        'benchmark': 'Public_AR_Current',
        'format': 'json',
    })
    url = f'https://geocoding.geo.census.gov/geocoder/locations/address?{params}'
    
    req = urllib.request.Request(url, headers={
        'User-Agent': 'NJStuccoMap/1.0',
    })
    
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read())
            matches = data.get('result', {}).get('addressMatches', [])
            if matches:
                coords = matches[0].get('coordinates', {})
                return {
                    'lat': coords.get('y', 0),
                    'lng': coords.get('x', 0),
                    'matched_address': matches[0].get('matchedAddress', ''),
                    'match_type': 'Match',
                }
    except Exception as e:
        pass
    return None

def geocode_single_nominatim(query):
    """Fallback to Nominatim for city-level geocoding"""
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
            if data:
                return {
                    'lat': float(data[0]['lat']),
                    'lng': float(data[0]['lon']),
                    'matched_address': data[0].get('display_name', ''),
                    'match_type': 'city_fallback',
                    'address_detail': data[0].get('address', {}),
                }
    except:
        pass
    return None

# County lookup from zip
def get_county_from_zip(zip_code):
    prefix = zip_code[:3] if len(zip_code) >= 3 else ''
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
    
    print(f"Processing {len(hoas)} HOAs...", flush=True)
    
    # Separate PO Box from real addresses
    real_addrs = []
    po_box_addrs = []
    
    for i, hoa in enumerate(hoas):
        street = hoa.get('street', '').strip()
        is_po = 'PO BOX' in street.upper() or 'P.O.' in street.upper() or not street
        
        entry = {
            'id': str(i),
            'street': street if not is_po else '',
            'city': hoa.get('city', ''),
            'state': 'NJ',
            'zip': hoa.get('zip', ''),
            'original': hoa,
        }
        
        if is_po:
            po_box_addrs.append(entry)
        else:
            real_addrs.append(entry)
    
    print(f"  Real addresses: {len(real_addrs)}", flush=True)
    print(f"  PO Box/no addr: {len(po_box_addrs)}", flush=True)
    
    # Batch geocode real addresses (up to 1000 at a time)
    all_geocoded = {}
    
    batch_size = 500
    for batch_start in range(0, len(real_addrs), batch_size):
        batch = real_addrs[batch_start:batch_start + batch_size]
        print(f"  Batch geocoding {batch_start+1}-{batch_start+len(batch)}...", flush=True)
        
        results = geocode_batch_census(batch)
        all_geocoded.update(results)
        print(f"    Matched: {len(results)}/{len(batch)}", flush=True)
        
        time.sleep(2)
    
    # For unmatched real addresses, try single geocode
    unmatched_real = [a for a in real_addrs if a['id'] not in all_geocoded]
    print(f"\n  Retrying {len(unmatched_real)} unmatched addresses individually...", flush=True)
    
    for i, addr in enumerate(unmatched_real):
        if i > 0 and i % 20 == 0:
            print(f"    Progress: {i}/{len(unmatched_real)}", flush=True)
        
        result = geocode_single_census(
            addr['street'], addr['city'], addr['state'], addr['zip']
        )
        if result:
            all_geocoded[addr['id']] = result
        else:
            # Try city-level via Nominatim
            city_query = f"{addr['city']}, NJ {addr['zip'][:5]}"
            result = geocode_single_nominatim(city_query)
            if result:
                all_geocoded[addr['id']] = result
            time.sleep(1.5)  # Nominatim rate limit
        
        time.sleep(0.3)  # Census rate limit (generous)
    
    # For PO Box addresses, geocode by city
    print(f"\n  Geocoding {len(po_box_addrs)} PO Box addresses by city...", flush=True)
    city_cache = {}
    
    for i, addr in enumerate(po_box_addrs):
        if i > 0 and i % 20 == 0:
            print(f"    Progress: {i}/{len(po_box_addrs)}", flush=True)
        
        city_key = f"{addr['city']}, NJ {addr['zip'][:5]}"
        
        if city_key in city_cache:
            all_geocoded[addr['id']] = city_cache[city_key]
            continue
        
        # Try Census first
        result = geocode_single_census('', addr['city'], 'NJ', addr['zip'])
        if not result:
            result = geocode_single_nominatim(city_key)
            time.sleep(1.5)
        
        if result:
            city_cache[city_key] = result
            all_geocoded[addr['id']] = result
        
        time.sleep(0.3)
    
    # Build final output
    print(f"\n  Building output...", flush=True)
    geocoded_hoas = []
    failed = []
    
    for i, hoa in enumerate(hoas):
        addr_id = str(i)
        if addr_id in all_geocoded:
            geo = all_geocoded[addr_id]
            lat = geo['lat']
            lng = geo['lng']
            
            # Verify NJ bounds
            if 38.9 <= lat <= 41.4 and -75.6 <= lng <= -73.8:
                county = get_county_from_zip(hoa.get('zip', ''))
                # Try to get county from geocode result
                if 'address_detail' in geo and 'county' in geo['address_detail']:
                    county = geo['address_detail']['county'].replace(' County', '')
                
                geocoded_hoas.append({
                    **hoa,
                    'lat': lat,
                    'lng': lng,
                    'county': county,
                    'geocode_type': geo.get('match_type', ''),
                })
            else:
                failed.append({**hoa, 'reason': f'outside NJ: {lat},{lng}'})
        else:
            failed.append({**hoa, 'reason': 'no geocode result'})
    
    # Save
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(geocoded_hoas, f, indent=2)
    
    failed_file = os.path.join(DATA_DIR, 'geocode-failed.json')
    with open(failed_file, 'w') as f:
        json.dump(failed, f, indent=2)
    
    print(f"\nDone!", flush=True)
    print(f"  Geocoded: {len(geocoded_hoas)}", flush=True)
    print(f"  Failed: {len(failed)}", flush=True)
    print(f"  Saved to: {OUTPUT_FILE}", flush=True)


if __name__ == '__main__':
    main()
