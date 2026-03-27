"""
Extract addresses from cluster HOA names and apply to main HOA data.
Cluster names are formatted as: "88 MORGAN ST. Townhomes, JERSEY CITY CITY"
"""
import json
import re

with open('/Users/minime/Projects/nj-stucco-map/public/data/hoas.json') as f:
    hoas = json.load(f)

with open('/Users/minime/Projects/nj-stucco-map/data/condo-cluster-hoas.json') as f:
    clusters = json.load(f)

# Build lookup from cluster name -> address
# Pattern: "88 MORGAN ST. Townhomes, JERSEY CITY" -> "88 MORGAN ST."
cluster_addrs = {}
for c in clusters:
    name = c.get('name', '')
    # Extract address: everything before " Townhomes," or " Condominiums," or " Condos,"
    m = re.match(r'^(.+?)\s+(?:Townhomes?|Condominiums?|Condos?|Apartments?),\s*(.+)', name)
    if m:
        addr = m.group(1).strip().rstrip('.')
        city = m.group(2).strip()
        cluster_addrs[name] = {'address': addr, 'city': city}

print(f'Cluster addresses extracted: {len(cluster_addrs)}')

# Match cluster HOAs to main HOA list by name
matched = 0
for hoa in hoas:
    if hoa.get('address') and hoa['address'].strip():
        continue  # Already has address
    
    name = hoa.get('name', '')
    if name in cluster_addrs:
        hoa['address'] = cluster_addrs[name]['address']
        matched += 1
        continue
    
    # Try fuzzy: cluster names might have been slightly modified in merge
    # Check if HOA name contains a street number at the start
    m = re.match(r'^(\d+[\-\d]*\s+.+?)(?:\s+(?:Townhomes?|Condos?|Condominiums?|Apartments?),)', name)
    if m:
        hoa['address'] = m.group(1).strip().rstrip('.')
        matched += 1

with open('/Users/minime/Projects/nj-stucco-map/public/data/hoas.json', 'w') as f:
    json.dump(hoas, f)

with_addr = sum(1 for h in hoas if h.get('address') and h['address'].strip())
print(f'Newly matched: {matched}')
print(f'Total with address: {with_addr} / {len(hoas)} ({100*with_addr//len(hoas)}%)')
