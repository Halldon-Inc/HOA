"""
Extract street addresses from HOA names that contain them.
Many NJ HOAs are named after their street address.
"""
import json
import re

with open('/Users/minime/Projects/nj-stucco-map/public/data/hoas.json') as f:
    hoas = json.load(f)

# Pattern: starts with a number, followed by street name
# e.g., "125 ROXBORO ROAD HOMEOWNERS ASSOCIATION"
addr_pattern = re.compile(
    r'^(\d+[\-\d]*\s+[A-Z][A-Z\s]+(?:ROAD|RD|STREET|ST|AVENUE|AVE|DRIVE|DR|LANE|LN|BOULEVARD|BLVD|COURT|CT|PLACE|PL|CIRCLE|WAY|TERRACE|TERR|PIKE|HIGHWAY|HWY|PARKWAY|PKWY|PATH|TRAIL))',
    re.IGNORECASE
)

# Also: "AT [PLACE]" pattern
at_pattern = re.compile(r'(?:THE\s+)?(?:VILLAGE|MANOR|ESTATES|GARDENS|PARK|PLAZA|TOWERS?|RIDGE|HILLS?|GLEN|MEADOWS?|WOODS?|POINTE?)\s+(?:AT|OF|ON)\s+(.+?)(?:\s+(?:HOME|CONDO|TOWN|ASSOC|INC|CORP|LLC))', re.IGNORECASE)

extracted = 0
for hoa in hoas:
    name = hoa['name']
    
    # Try address extraction
    match = addr_pattern.match(name)
    if match:
        addr = match.group(1).strip()
        # Clean up: remove trailing direction words that aren't part of address
        addr = re.sub(r'\s+(HOMEOWNERS?|CONDOMINIUM|TOWNHOUSE|ASSOCIATION|HOA|INC|CORP).*$', '', addr, flags=re.IGNORECASE)
        hoa['address'] = addr
        extracted += 1
        continue
    
    # Try extracting from names that ARE the address
    # e.g., "1901 NEW ROAD TOWNHOMES HOMEOWNERS ASSOCIATION"
    simple_match = re.match(r'^(\d+[\-\d]*\s+\w[\w\s]*?)(?:\s+(?:HOMEOWNERS?|CONDOMINIUM|TOWNHOUSE|TOWN\s?HOMES?|ASSOCIATION|HOA|INC|CORP|LLC|A\s+NJ|NONPROFIT))', name, re.IGNORECASE)
    if simple_match:
        addr = simple_match.group(1).strip()
        if len(addr) > 5:  # Must be meaningful
            hoa['address'] = addr
            extracted += 1
            continue

print(f'Extracted addresses from {extracted} / {len(hoas)} HOA names')

# Save
with open('/Users/minime/Projects/nj-stucco-map/public/data/hoas.json', 'w') as f:
    json.dump(hoas, f)

# Stats
with_addr = sum(1 for h in hoas if h.get('address'))
print(f'HOAs with address: {with_addr}')

# Sample extracted
samples = [h for h in hoas if h.get('address')][:15]
for s in samples:
    print(f'  {s["name"]} => {s["address"]}')
