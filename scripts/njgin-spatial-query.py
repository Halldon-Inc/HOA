#!/usr/bin/env python3
"""
Query NJGIN ArcGIS for parcels near unmatched HOAs to find stucco buildings.
Uses spatial queries with a buffer around each HOA's coordinates.
"""

import json
import urllib.request
import urllib.parse
import time
import re
from collections import Counter

# NJGIN MOD-IV endpoint
BASE_URL = "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query"

# Load unmatched HOAs
with open('public/data/hoas.json') as f:
    hoas = json.load(f)

unmatched = [h for h in hoas if h.get('matchMethod') == 'zip_density' and h.get('lat') and h.get('lng')]
print(f"Unmatched HOAs with coordinates: {len(unmatched)}")

# Group HOAs by approximate area (0.01 degree grid ~1km) to batch queries
grid = {}
for h in unmatched:
    key = (round(h['lat'], 2), round(h['lng'], 2))
    grid.setdefault(key, []).append(h)

print(f"Grid cells: {len(grid)}")

# We'll query a sample of the densest cells first
cells_by_density = sorted(grid.items(), key=lambda x: -len(x[1]))

# Results tracking
total_queries = 0
total_parcels_found = 0
hoas_matched = 0
new_links = []
stucco_patterns = re.compile(r'STCO|STUC', re.IGNORECASE)

# Query function
def query_parcels(lat, lng, buffer_m=500):
    """Query NJGIN for parcels within buffer meters of a point."""
    # Convert lat/lng to Web Mercator (EPSG:3857) for spatial query
    import math
    x = lng * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180) * 20037508.34 / 180
    
    params = {
        'where': '1=1',
        'geometry': json.dumps({
            'xmin': x - buffer_m,
            'ymin': y - buffer_m,
            'xmax': x + buffer_m,
            'ymax': y + buffer_m,
            'spatialReference': {'wkid': 3857}
        }),
        'geometryType': 'esriGeometryEnvelope',
        'spatialRel': 'esriSpatialRelIntersects',
        'outFields': 'PROP_LOC,BLDG_DESC,BLDG_CLASS,PROP_CLASS,MUN_NAME,ZIP5,FAC_NAME,OWNER_NAME',
        'returnGeometry': 'false',
        'resultRecordCount': 2000,
        'f': 'json'
    }
    
    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'Mozilla/5.0')
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read())
            features = data.get('features', [])
            return [f['attributes'] for f in features]
    except Exception as e:
        print(f"  Query error: {e}")
        return []

# Process cells (limit to avoid rate limiting)
max_queries = 500  # Conservative limit for overnight
processed = 0

for (grid_lat, grid_lng), cell_hoas in cells_by_density:
    if total_queries >= max_queries:
        break
    
    # Query the center of this grid cell
    parcels = query_parcels(grid_lat, grid_lng, buffer_m=800)
    total_queries += 1
    total_parcels_found += len(parcels)
    
    if parcels:
        # Count stucco in this area
        stucco_parcels = [p for p in parcels if p.get('BLDG_DESC') and stucco_patterns.search(p['BLDG_DESC'])]
        total_in_area = len(parcels)
        stucco_in_area = len(stucco_parcels)
        
        if stucco_in_area > 0 or total_in_area > 0:
            pct = (stucco_in_area / total_in_area * 100) if total_in_area > 0 else 0
            
            # Apply to all HOAs in this cell
            for h in cell_hoas:
                h['stuccoConfirmed'] = stucco_in_area
                h['totalParcels'] = total_in_area
                h['stuccoPercentage'] = round(pct, 1)
                h['matchMethod'] = 'njgin_spatial'
                
                if pct > 50:
                    h['exteriorType'] = 'stucco'
                elif pct > 10:
                    h['exteriorType'] = 'mixed'
                else:
                    h['exteriorType'] = 'non-stucco'
                
                hoas_matched += 1
                
                for sp in stucco_parcels[:5]:  # Link up to 5 parcels per HOA
                    new_links.append({
                        'parcel_address': sp.get('PROP_LOC',''),
                        'parcel_muni': sp.get('MUN_NAME',''),
                        'parcel_zip': sp.get('ZIP5',''),
                        'hoa_id': h.get('entityId',''),
                        'hoa_name': h['name'],
                        'match_method': 'njgin_spatial',
                        'is_stucco': True
                    })
    
    processed += 1
    if processed % 50 == 0:
        print(f"Progress: {processed}/{len(grid)} cells, {total_queries} queries, {hoas_matched} HOAs matched")
    
    # Rate limit: 200ms between queries
    time.sleep(0.2)

print(f"\n=== NJGIN Spatial Query Results ===")
print(f"Queries made: {total_queries}")
print(f"Total parcels found: {total_parcels_found}")
print(f"HOAs matched: {hoas_matched}")
print(f"New parcel links: {len(new_links)}")

# Final distribution
types = Counter(h.get('exteriorType','?') for h in hoas)
methods = Counter(h.get('matchMethod','none') for h in hoas)
print(f"\nFinal exterior distribution: {dict(types)}")
print(f"Match methods: {dict(methods)}")

# Save
with open('public/data/hoas.json', 'w') as f:
    json.dump(hoas, f)

# Append links
with open('data/parcel-hoa-links.json') as f:
    existing = json.load(f)
existing.extend(new_links)
with open('data/parcel-hoa-links.json', 'w') as f:
    json.dump(existing, f)

print(f"Total parcel links: {len(existing)}")
print("Saved.")
