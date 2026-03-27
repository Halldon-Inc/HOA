"""
Scrape CAI-NJ Online Service Directory for management company contacts.
These are real companies that manage NJ HOAs.
"""
import json
import urllib.request
import re
import time

URL = 'https://cainj.org/online-service-directory/'
OUTPUT = '/Users/minime/Projects/nj-stucco-map/data/cainj-vendors.json'

def fetch_page(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode('utf-8')

def parse_vendors(html):
    """Parse vendor entries from the HTML."""
    vendors = []
    
    # Find all h4 entries (vendor names)
    # Pattern: <h4>Name</h4> followed by contact info
    blocks = re.split(r'<h4[^>]*>', html)
    
    for block in blocks[1:]:  # Skip first split (before first h4)
        # Extract name
        name_match = re.match(r'(.*?)</h4>', block, re.DOTALL)
        if not name_match:
            continue
        name = re.sub(r'<[^>]+>', '', name_match.group(1)).strip()
        if not name:
            continue
        
        # Get the rest of the block until next h4 or end
        rest = block[name_match.end():]
        
        # Extract contact person
        contact = ''
        lines = re.sub(r'<[^>]+>', '\n', rest).strip().split('\n')
        lines = [l.strip() for l in lines if l.strip()]
        if lines:
            contact = lines[0]
        
        # Extract phone
        phone_match = re.search(r'p\.\s*([\(\)\d\s\-]+)', rest)
        phone = phone_match.group(1).strip() if phone_match else ''
        
        # Extract email
        email_match = re.search(r'[\w\.\-]+@[\w\.\-]+\.\w+', rest)
        email = email_match.group(0) if email_match else ''
        
        # Extract address
        addr_lines = []
        for line in lines[1:]:
            if line.startswith('p.') or line.startswith('f.') or '@' in line:
                break
            if line and not line.startswith('http'):
                addr_lines.append(line)
        address = ', '.join(addr_lines[:3])
        
        # Detect if management company
        is_mgmt = any(kw in name.lower() for kw in [
            'management', 'associa', 'firstservice', 'property',
            'realty', 'cmc', 'residential', 'community services',
        ])
        
        vendors.append({
            'name': name,
            'contact': contact,
            'phone': phone,
            'email': email,
            'address': address,
            'isManagement': is_mgmt,
        })
    
    return vendors

def main():
    print('Fetching CAI-NJ directory...')
    html = fetch_page(URL)
    print(f'Got {len(html)} bytes')
    
    vendors = parse_vendors(html)
    print(f'Parsed {len(vendors)} vendors')
    
    mgmt = [v for v in vendors if v['isManagement']]
    print(f'Management companies: {len(mgmt)}')
    
    with_email = [v for v in vendors if v['email']]
    print(f'With email: {len(with_email)}')
    
    with_phone = [v for v in vendors if v['phone']]
    print(f'With phone: {len(with_phone)}')
    
    # Show management companies
    print('\nManagement companies:')
    for v in mgmt:
        print(f'  {v["name"]}: {v["contact"]} | {v["phone"]} | {v["email"]}')
    
    with open(OUTPUT, 'w') as f:
        json.dump(vendors, f, indent=2)
    
    print(f'\nSaved {len(vendors)} vendors to {OUTPUT}')

if __name__ == '__main__':
    main()
