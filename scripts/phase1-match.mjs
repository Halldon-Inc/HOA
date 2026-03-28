import fs from 'fs';

const stucco = JSON.parse(fs.readFileSync('data/modiv-stucco-confirmed.json', 'utf8'));
const condos = JSON.parse(fs.readFileSync('data/modiv-condos.json', 'utf8'));
const hoas = JSON.parse(fs.readFileSync('public/data/hoas.json', 'utf8'));

// ---- Normalization helpers ----

function normCity(s) {
  return (s || '').toUpperCase()
    .replace(/\b(BORO|BOROUGH|TWP|TOWNSHIP|CITY|TOWN|VILLAGE)\b/g, '')
    .replace(/[^A-Z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStreet(addr) {
  if (!addr) return '';
  let s = addr.toUpperCase().trim();
  // Remove unit/apt/suite
  s = s.replace(/\b(UNIT|APT|STE|SUITE|#)\s*\S*/g, '');
  // Remove leading house numbers and ranges (e.g. "231-233")
  s = s.replace(/^\d+[\-\/]?\d*\s*/, '');
  // Normalize direction words
  s = s.replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W');
  // Normalize street type names
  s = s.replace(/\bSTREET\b/g, 'ST').replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD').replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bLANE\b/g, 'LN').replace(/\bROAD\b/g, 'RD')
    .replace(/\bCOURT\b/g, 'CT').replace(/\bCIRCLE\b/g, 'CIR')
    .replace(/\bPLACE\b/g, 'PL').replace(/\bTERRACE\b/g, 'TER')
    .replace(/\bPARKWAY\b/g, 'PKWY').replace(/\bHIGHWAY\b/g, 'HWY');
  return s.replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// ---- Build stucco indexes from both sources ----

// Collect all stucco properties (confirmed + stucco condos)
const allStucco = [];

for (const s of stucco) {
  allStucco.push({
    street: extractStreet(s.PROP_LOC),
    city: normCity(s.MUN_NAME),
    county: (s.COUNTY || '').toUpperCase().trim(),
    zip: s.ZIP5 || '',
    loc: s.PROP_LOC,
    source: 'modiv-stucco',
  });
}

let stuccoCondoCount = 0;
for (const c of condos) {
  const desc = (c.BLDG_DESC || '').toUpperCase();
  if (desc.startsWith('ST') || desc.includes('STUC')) {
    stuccoCondoCount++;
    allStucco.push({
      street: extractStreet(c.PROP_LOC),
      city: normCity(c.MUN_NAME),
      county: (c.COUNTY || '').toUpperCase().trim(),
      zip: c.ZIP5 || '',
      loc: c.PROP_LOC,
      source: 'modiv-condo',
    });
  }
}

console.log(`Total stucco properties: ${allStucco.length} (${stucco.length} confirmed + ${stuccoCondoCount} condos)`);

// Index by city (normalized)
const byCityMap = new Map();
// Index by county
const byCountyMap = new Map();
// Index by "city|street" for exact street matching
const byStreetMap = new Map();

for (const s of allStucco) {
  // By city
  if (s.city) {
    if (!byCityMap.has(s.city)) byCityMap.set(s.city, []);
    byCityMap.get(s.city).push(s);
  }
  // By county
  if (s.county) {
    if (!byCountyMap.has(s.county)) byCountyMap.set(s.county, []);
    byCountyMap.get(s.county).push(s);
  }
  // By city+street
  if (s.city && s.street) {
    const key = `${s.city}|${s.street}`;
    byStreetMap.set(key, (byStreetMap.get(key) || 0) + 1);
  }
}

console.log(`Unique cities: ${byCityMap.size}, Unique streets: ${byStreetMap.size}`);

// ---- Build city alias map from stucco data ----
// Map variant city names that share the same county
const cityByCounty = new Map();
for (const s of allStucco) {
  if (s.city && s.county) {
    const key = s.county;
    if (!cityByCounty.has(key)) cityByCounty.set(key, new Set());
    cityByCounty.get(key).add(s.city);
  }
}

// ---- Match HOAs ----

let stats = { streetMatch: 0, cityDensity: 0, countyFallback: 0, noMatch: 0 };
let before = { stucco: 0, mixed: 0, nonStucco: 0 };
hoas.forEach(h => {
  if (h.exteriorType === 'stucco') before.stucco++;
  else if (h.exteriorType === 'mixed') before.mixed++;
  else before.nonStucco++;
});

for (const hoa of hoas) {
  // HOA uses 'municipality' not 'city', and has no 'zip' field
  const hoaCity = normCity(hoa.municipality);
  const hoaCounty = (hoa.county || '').toUpperCase().trim();
  const hoaStreet = extractStreet(hoa.address);

  // 1. Exact street match: same city + same street name
  let streetMatchCount = 0;
  if (hoaCity && hoaStreet) {
    const key = `${hoaCity}|${hoaStreet}`;
    streetMatchCount = byStreetMap.get(key) || 0;

    // Try fuzzy city match within same county if no exact match
    if (!streetMatchCount && hoaCounty) {
      const citiesInCounty = cityByCounty.get(hoaCounty);
      if (citiesInCounty) {
        for (const altCity of citiesInCounty) {
          // Check if the HOA city name is a substring or vice versa
          if (altCity !== hoaCity && (altCity.includes(hoaCity) || hoaCity.includes(altCity))) {
            const altKey = `${altCity}|${hoaStreet}`;
            const altCount = byStreetMap.get(altKey) || 0;
            if (altCount > streetMatchCount) streetMatchCount = altCount;
          }
        }
      }
    }
  }

  // 2. City-level stucco density
  let cityStuccoCount = 0;
  if (hoaCity) {
    const entries = byCityMap.get(hoaCity);
    if (entries) {
      cityStuccoCount = entries.length;
    } else if (hoaCounty) {
      // Try fuzzy city match
      const citiesInCounty = cityByCounty.get(hoaCounty);
      if (citiesInCounty) {
        for (const altCity of citiesInCounty) {
          if (altCity.includes(hoaCity) || hoaCity.includes(altCity)) {
            const entries2 = byCityMap.get(altCity);
            if (entries2) cityStuccoCount += entries2.length;
          }
        }
      }
    }
  }

  // 3. County-level fallback
  let countyStuccoCount = 0;
  if (hoaCounty) {
    const entries = byCountyMap.get(hoaCounty);
    if (entries) countyStuccoCount = entries.length;
  }

  // ---- Determine exterior type ----
  let newType = hoa.exteriorType;
  let source = hoa.exteriorSource || null;
  let confirmed = hoa.exteriorConfirmed || false;

  if (streetMatchCount >= 3) {
    // Strong signal: 3+ stucco properties on same street in same city
    newType = 'stucco';
    source = 'MOD-IV street match';
    confirmed = true;
    stats.streetMatch++;
  } else if (streetMatchCount >= 1) {
    // At least 1 stucco on same street
    if (newType !== 'stucco') {
      newType = 'mixed';
      source = 'MOD-IV street match';
      confirmed = true;
    }
    stats.streetMatch++;
  } else if (cityStuccoCount >= 20) {
    // High stucco density in city
    if (newType === 'non-stucco') {
      newType = 'mixed';
      source = `MOD-IV city density (${cityStuccoCount})`;
      confirmed = false;
    }
    stats.cityDensity++;
  } else if (cityStuccoCount >= 1) {
    // Some stucco in city, don't change type but record count
    stats.cityDensity++;
  } else {
    stats.noMatch++;
  }

  hoa.exteriorType = newType;
  if (source) hoa.exteriorSource = source;
  if (confirmed) hoa.exteriorConfirmed = true;
  hoa.nearbyStuccoCount = Math.max(
    hoa.nearbyStuccoCount || 0,
    streetMatchCount || cityStuccoCount || 0
  );
}

// ---- Save ----
fs.writeFileSync('public/data/hoas.json', JSON.stringify(hoas, null, 2));

// ---- Report ----
let after = { stucco: 0, mixed: 0, nonStucco: 0 };
hoas.forEach(h => {
  if (h.exteriorType === 'stucco') after.stucco++;
  else if (h.exteriorType === 'mixed') after.mixed++;
  else after.nonStucco++;
});

console.log('\n=== MATCHING RESULTS ===');
console.log(`Street matches: ${stats.streetMatch}`);
console.log(`City density matches: ${stats.cityDensity}`);
console.log(`No match: ${stats.noMatch}`);
console.log(`\n=== BEFORE vs AFTER ===`);
console.log(`Stucco:     ${before.stucco} -> ${after.stucco} (${after.stucco > before.stucco ? '+' : ''}${after.stucco - before.stucco})`);
console.log(`Mixed:      ${before.mixed} -> ${after.mixed} (${after.mixed > before.mixed ? '+' : ''}${after.mixed - before.mixed})`);
console.log(`Non-stucco: ${before.nonStucco} -> ${after.nonStucco} (${after.nonStucco > before.nonStucco ? '+' : ''}${after.nonStucco - before.nonStucco})`);
console.log(`Total: ${hoas.length}`);

const confirmed = hoas.filter(h => h.exteriorConfirmed).length;
console.log(`\nConfirmed (exteriorConfirmed=true): ${confirmed}`);

// County breakdown
const byCounty = {};
for (const h of hoas.filter(h => h.exteriorType === 'stucco' || h.exteriorType === 'mixed')) {
  const k = `${h.county}|${h.exteriorType}`;
  byCounty[k] = (byCounty[k] || 0) + 1;
}
console.log('\nStucco/Mixed by county:');
const counties = [...new Set(Object.keys(byCounty).map(k => k.split('|')[0]))].sort();
for (const c of counties) {
  const s = byCounty[`${c}|stucco`] || 0;
  const m = byCounty[`${c}|mixed`] || 0;
  console.log(`  ${c}: ${s} stucco, ${m} mixed`);
}

// Show sample matches
console.log('\n=== SAMPLE STREET MATCHES ===');
const streetExamples = hoas
  .filter(h => h.exteriorSource === 'MOD-IV street match')
  .slice(0, 15);
for (const h of streetExamples) {
  console.log(`  [${h.exteriorType}] ${h.name} | ${h.municipality} | ${h.address} | ${h.nearbyStuccoCount} nearby`);
}

console.log('\nSaved updated hoas.json');
