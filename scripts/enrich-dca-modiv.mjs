#!/usr/bin/env node
/**
 * Enrichment script:
 * 1. Merge DCA contact data into hoas.json (by entityId)
 * 2. Improve MOD-IV exterior matching (by county+municipality, street names)
 */
import fs from 'fs';

const HOAS_FILE = 'public/data/hoas.json';
const DCA_FILE = 'data/dca-contacts-cache.json';
const MODIV_FILE = 'data/modiv-stucco-confirmed.json';

// Normalize municipality name for comparison
function normMuni(name) {
  if (!name) return '';
  return name
    .toUpperCase()
    .replace(/\b(TOWNSHIP|TWP|BORO|BOROUGH|CITY|TOWN|VILLAGE)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract street name from address (drop house number)
function extractStreet(addr) {
  if (!addr) return '';
  return addr
    .toUpperCase()
    .replace(/^\d+[-\d]*\s*/, '')  // remove leading house number
    .replace(/\s+(APT|UNIT|STE|SUITE|FL|FLOOR|#)\s*.*/i, '')  // remove unit
    .trim();
}

function main() {
  const hoas = JSON.parse(fs.readFileSync(HOAS_FILE, 'utf8'));
  const dca = JSON.parse(fs.readFileSync(DCA_FILE, 'utf8'));
  const modiv = JSON.parse(fs.readFileSync(MODIV_FILE, 'utf8'));

  console.log(`Loaded: ${hoas.length} HOAs, ${Object.keys(dca).length} DCA entries, ${modiv.length} MOD-IV stucco properties`);

  // === TASK 1: Merge DCA contacts ===
  let dcaMerged = 0;
  const entityIdMap = new Map();
  for (const hoa of hoas) {
    if (hoa.entityId) entityIdMap.set(hoa.entityId, hoa);
  }

  for (const [key, entry] of Object.entries(dca)) {
    const hoaEntityId = entry.hoaEntityId || key;
    const hoa = entityIdMap.get(hoaEntityId);
    if (!hoa) continue;

    if (entry.agentName) {
      hoa.dcaAgent = entry.agentName;
    }
    hoa.dcaRegistrationId = entry.dcaRegNum || key;

    // Also pull in unit count if we don't have one and DCA has it
    if ((!hoa.unitCount || hoa.unitCount === 0) && entry.unitCount > 0) {
      hoa.unitCount = entry.unitCount;
    }
    dcaMerged++;
  }
  console.log(`\nTASK 1: DCA merge`);
  console.log(`  Merged: ${dcaMerged} HOAs`);
  console.log(`  With agent names: ${hoas.filter(h => h.dcaAgent).length}`);
  console.log(`  With registration IDs: ${hoas.filter(h => h.dcaRegistrationId).length}`);

  // === TASK 3: Improved MOD-IV exterior matching ===
  // Build lookup: county -> normalized municipality -> set of street names
  const stuccoByCountyMuni = new Map();  // county -> normMuni -> count
  const stuccoStreetsByCounty = new Map(); // county -> Set<streetName>
  const stuccoByZip = new Map(); // zip -> count

  for (const prop of modiv) {
    const county = (prop.COUNTY || '').toUpperCase().trim();
    const muni = normMuni(prop.MUN_NAME);
    const street = extractStreet(prop.PROP_LOC);
    const zip = (prop.ZIP5 || '').trim();

    // County + muni grouping
    if (!stuccoByCountyMuni.has(county)) stuccoByCountyMuni.set(county, new Map());
    const muniMap = stuccoByCountyMuni.get(county);
    muniMap.set(muni, (muniMap.get(muni) || 0) + 1);

    // Street names by county
    if (street && street.length > 3) {
      if (!stuccoStreetsByCounty.has(county)) stuccoStreetsByCounty.set(county, new Map());
      const streetMap = stuccoStreetsByCounty.get(county);
      streetMap.set(street, (streetMap.get(street) || 0) + 1);
    }

    // ZIP grouping
    if (zip) {
      stuccoByZip.set(zip, (stuccoByZip.get(zip) || 0) + 1);
    }
  }

  // Before counts
  const beforeStucco = hoas.filter(h => h.exteriorType === 'stucco').length;
  const beforeMixed = hoas.filter(h => h.exteriorType === 'mixed').length;
  const beforeNonStucco = hoas.filter(h => h.exteriorType === 'non-stucco').length;

  let upgradedToStucco = 0;
  let upgradedToMixed = 0;

  for (const hoa of hoas) {
    const county = (hoa.county || '').toUpperCase().trim();
    const hoaMuni = normMuni(hoa.municipality);
    const hoaStreet = extractStreet(hoa.address);

    // Check if HOA's municipality has high stucco density
    const muniMap = stuccoByCountyMuni.get(county);
    const muniStuccoCount = muniMap ? (muniMap.get(hoaMuni) || 0) : 0;

    // Check street name match in same county
    const streetMap = stuccoStreetsByCounty.get(county);
    let streetMatch = false;
    if (streetMap && hoaStreet && hoaStreet.length > 3) {
      // Check if HOA's street appears in stucco data
      const streetHits = streetMap.get(hoaStreet) || 0;
      if (streetHits >= 2) {  // at least 2 stucco properties on same street
        streetMatch = true;
      }
    }

    // Update nearbyStuccoCount with better data
    if (muniStuccoCount > 0) {
      hoa.nearbyStuccoCount = Math.max(hoa.nearbyStuccoCount || 0, muniStuccoCount);
    }

    if (hoa.exteriorType === 'stucco') continue; // already confirmed

    // Upgrade logic
    if (hoa.exteriorType === 'non-stucco') {
      if (streetMatch) {
        // HOA address street matches stucco properties in same county -> mixed
        hoa.exteriorType = 'mixed';
        hoa.stuccoMatchSource = 'modiv_street';
        upgradedToMixed++;
      } else if (muniStuccoCount >= 20) {
        // High stucco density in municipality -> mixed
        hoa.exteriorType = 'mixed';
        hoa.stuccoMatchSource = 'modiv_muni_density';
        upgradedToMixed++;
      }
    } else if (hoa.exteriorType === 'mixed') {
      if (streetMatch && muniStuccoCount >= 10) {
        // Already mixed + street match + decent density -> stucco
        hoa.exteriorType = 'stucco';
        hoa.stuccoMatchSource = 'modiv_street_confirmed';
        upgradedToStucco++;
      }
    }
  }

  const afterStucco = hoas.filter(h => h.exteriorType === 'stucco').length;
  const afterMixed = hoas.filter(h => h.exteriorType === 'mixed').length;
  const afterNonStucco = hoas.filter(h => h.exteriorType === 'non-stucco').length;

  console.log(`\nTASK 3: MOD-IV exterior matching improvement`);
  console.log(`  Before: ${beforeStucco} stucco, ${beforeMixed} mixed, ${beforeNonStucco} non-stucco`);
  console.log(`  After:  ${afterStucco} stucco, ${afterMixed} mixed, ${afterNonStucco} non-stucco`);
  console.log(`  Upgraded to stucco: ${upgradedToStucco}`);
  console.log(`  Upgraded to mixed: ${upgradedToMixed}`);

  // Save
  fs.writeFileSync(HOAS_FILE, JSON.stringify(hoas, null, 2));
  console.log(`\nSaved ${hoas.length} HOAs to ${HOAS_FILE}`);

  // Summary stats
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total HOAs: ${hoas.length}`);
  console.log(`Exterior: ${afterStucco} stucco, ${afterMixed} mixed, ${afterNonStucco} non-stucco`);
  console.log(`With entityId: ${hoas.filter(h => h.entityId).length}`);
  console.log(`With DCA agent: ${hoas.filter(h => h.dcaAgent).length}`);
  console.log(`With DCA registration: ${hoas.filter(h => h.dcaRegistrationId).length}`);
  console.log(`With management company: ${hoas.filter(h => h.managementCompany).length}`);
  console.log(`With unit count > 0: ${hoas.filter(h => h.unitCount > 0).length}`);
}

main();
