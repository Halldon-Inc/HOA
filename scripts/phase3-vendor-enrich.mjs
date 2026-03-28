#!/usr/bin/env node
/**
 * Phase 3: Cross-reference management companies with CAI-NJ vendor directory.
 * Ensures all HOAs with a matching management company have phone, email, website.
 */
import fs from 'fs';

const HOAS_FILE = 'public/data/hoas.json';
const VENDORS_FILE = 'data/cainj-vendors.json';

function normalize(name) {
  return name
    .replace(/&#038;/g, '&')
    .replace(/,?\s*(Inc\.?|LLC|AAMC|AMO|Corp\.?|Corporation|Co\.|Services|Group)\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function main() {
  const hoas = JSON.parse(fs.readFileSync(HOAS_FILE, 'utf8'));
  const vendors = JSON.parse(fs.readFileSync(VENDORS_FILE, 'utf8'));
  const mgmtVendors = vendors.filter(v => v.isManagement);

  console.log(`Loaded ${hoas.length} HOAs, ${mgmtVendors.length} CAI-NJ management companies`);

  // Build fuzzy lookup
  const vendorMap = new Map();
  for (const v of mgmtVendors) {
    vendorMap.set(normalize(v.name), v);
  }

  let updated = 0;

  for (const hoa of hoas) {
    if (!hoa.managementCompany) continue;

    const hoaNorm = normalize(hoa.managementCompany);
    // Try exact normalized match
    let vendor = vendorMap.get(hoaNorm);

    // Try contains match
    if (!vendor) {
      for (const [key, v] of vendorMap) {
        if (key.includes(hoaNorm) || hoaNorm.includes(key)) {
          vendor = v;
          break;
        }
      }
    }

    if (!vendor) continue;

    let changed = false;
    if (!hoa.managementPhone && vendor.phone) {
      hoa.managementPhone = vendor.phone;
      changed = true;
    }
    if (!hoa.managementEmail && vendor.email) {
      hoa.managementEmail = vendor.email;
      changed = true;
    }
    if (!hoa.managementWebsite && vendor.website) {
      hoa.managementWebsite = vendor.website;
      changed = true;
    }
    // Add vendor contact name if we have a field for it
    if (!hoa.managementContact && vendor.contact) {
      hoa.managementContact = vendor.contact;
      changed = true;
    }
    if (changed) updated++;
  }

  fs.writeFileSync(HOAS_FILE, JSON.stringify(hoas, null, 2));
  console.log(`Updated ${updated} HOAs with CAI-NJ vendor contact info.`);

  // Report coverage
  const withPhone = hoas.filter(h => h.managementPhone).length;
  const withEmail = hoas.filter(h => h.managementEmail).length;
  const withWebsite = hoas.filter(h => h.managementWebsite).length;
  const withContact = hoas.filter(h => h.managementContact).length;
  console.log(`Coverage: phone=${withPhone}, email=${withEmail}, website=${withWebsite}, contact=${withContact}`);
}

main();
