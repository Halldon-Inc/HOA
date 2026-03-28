#!/usr/bin/env node
/**
 * Massive exterior type enrichment via ZIP code density matching.
 *
 * Strategy:
 * 1. Query ArcGIS for ALL stucco properties (better query than original)
 * 2. Build municipality-to-ZIP mapping from MOD-IV data
 * 3. For unmapped HOAs, get ZIP from FCC API using lat/lng
 * 4. Group stucco properties by ZIP5
 * 5. Apply density rules to classify HOAs
 */
import fs from 'fs';

const ARCGIS_BASE = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0';
const FIELDS = 'PROP_LOC,BLDG_DESC,BLDG_CLASS,PROP_CLASS,COUNTY,MUN_NAME,CITY_STATE,ZIP5,FAC_NAME';
const FCC_API = 'https://geo.fcc.gov/api/census/block/find';

// ─── ArcGIS query helper ───
async function queryArcGIS(where, fields, label) {
  let all = [];
  let offset = 0;
  const batchSize = 2000;

  while (true) {
    const params = new URLSearchParams({
      where, outFields: fields,
      returnGeometry: 'false',
      resultOffset: String(offset),
      resultRecordCount: String(batchSize),
      f: 'json'
    });

    const url = `${ARCGIS_BASE}/query?${params}`;
    try {
      const res = await fetch(url);
      const data = await res.json();

      if (!data.features || data.features.length === 0) break;
      all.push(...data.features.map(f => f.attributes));

      if (data.features.length < batchSize) break;
      offset += batchSize;
      process.stdout.write(`  [${label}] Downloaded ${all.length}...\r`);
    } catch (e) {
      console.error(`  [${label}] Error at offset ${offset}:`, e.message);
      break;
    }
  }

  console.log(`  [${label}] Total: ${all.length}`);
  return all;
}

// ─── FCC reverse geocode for ZIP ───
async function getZipFromCoords(lat, lng) {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      format: 'json',
      showall: 'false'
    });
    const res = await fetch(`${FCC_API}?${params}`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    // FCC returns FIPS codes, not ZIP. Use the Census block info instead.
    // Actually, FCC API returns county/state FIPS. We need a different approach.
    return data?.Block?.FIPS?.substring(0, 5) || null; // This is county FIPS, not ZIP
  } catch {
    return null;
  }
}

// ─── Normalize municipality name ───
function normalizeMun(name) {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMunSuffix(name) {
  // Strip common NJ municipal suffixes, but be careful with names like "JERSEY CITY"
  return name
    .replace(/\s+(BORO|BOROUGH|TWP|TOWNSHIP|VILLAGE)$/i, '')
    .trim();
}

function munVariants(name) {
  const norm = normalizeMun(name);
  const variants = new Set([norm]);

  // Strip BORO/TWP/TOWNSHIP/BOROUGH/VILLAGE/TOWN suffixes
  variants.add(norm.replace(/\s+(BORO|BOROUGH|TWP|TOWNSHIP|VILLAGE|TOWN)$/, ''));

  // Only strip CITY if the remaining name has 2+ words (avoid JERSEY CITY -> JERSEY)
  const withoutCity = norm.replace(/\s+CITY$/, '');
  if (withoutCity.split(' ').length >= 2 || withoutCity.length > 8) {
    variants.add(withoutCity);
  }

  // Add with CITY suffix for names that might need it
  variants.add(norm + ' CITY');
  variants.add(norm + ' TWP');
  variants.add(norm + ' BORO');
  variants.add(norm + ' TOWNSHIP');

  return [...variants].filter(v => v.length > 0);
}

// ─── Main ───
async function main() {
  console.log('=== ZIP Density Exterior Enrichment ===\n');

  // Load existing data
  const hoas = JSON.parse(fs.readFileSync('public/data/hoas.json', 'utf8'));
  const existingStucco = JSON.parse(fs.readFileSync('data/modiv-stucco-confirmed.json', 'utf8'));
  const condos = JSON.parse(fs.readFileSync('data/modiv-condos.json', 'utf8'));

  console.log(`Loaded: ${hoas.length} HOAs, ${existingStucco.length} stucco props, ${condos.length} condos`);

  // ─── Step 1: Query ArcGIS for better stucco data ───
  console.log('\n--- Step 1: Query ArcGIS for stucco properties ---');

  // More precise stucco queries
  const queries = [
    ["BLDG_DESC LIKE '%STUCCO%'", 'STUCCO'],
    ["BLDG_DESC LIKE '%STCO%'", 'STCO'],
    ["BLDG_DESC LIKE '%EIFS%'", 'EIFS'],
    ["BLDG_DESC LIKE '%DRYVIT%'", 'DRYVIT'],
    ["BLDG_DESC LIKE '%SYNTH%'", 'SYNTHETIC'],
  ];

  const arcgisResults = [];
  for (const [where, label] of queries) {
    const results = await queryArcGIS(where, FIELDS, label);
    arcgisResults.push(...results);
  }

  // Deduplicate by PROP_LOC + MUN_NAME + ZIP5
  const seen = new Set();
  const allStuccoProps = [];
  for (const p of arcgisResults) {
    const key = `${p.PROP_LOC}|${p.MUN_NAME}|${p.ZIP5}`;
    if (!seen.has(key)) {
      seen.add(key);
      allStuccoProps.push(p);
    }
  }

  // Also add real stucco from existing data (ones containing STUC)
  for (const p of existingStucco) {
    if (p.BLDG_DESC && /STUC/i.test(p.BLDG_DESC)) {
      const key = `${p.PROP_LOC}|${p.MUN_NAME}|${p.ZIP5}`;
      if (!seen.has(key)) {
        seen.add(key);
        allStuccoProps.push(p);
      }
    }
  }

  // Check condos for stucco indicators
  for (const p of condos) {
    if (p.BLDG_DESC && /STUC/i.test(p.BLDG_DESC)) {
      const key = `${p.PROP_LOC}|${p.MUN_NAME}|${p.ZIP5}`;
      if (!seen.has(key)) {
        seen.add(key);
        allStuccoProps.push(p);
      }
    }
  }

  console.log(`\nTotal unique stucco properties: ${allStuccoProps.length}`);

  // Save the enriched stucco data
  fs.writeFileSync('data/stucco-all-confirmed.json', JSON.stringify(allStuccoProps, null, 2));

  // ─── Step 2: Build ZIP-level stucco density ───
  console.log('\n--- Step 2: Build stucco density by ZIP ---');

  const stuccoByZip = {};
  for (const p of allStuccoProps) {
    const zip = p.ZIP5;
    if (!zip) continue;
    if (!stuccoByZip[zip]) stuccoByZip[zip] = [];
    stuccoByZip[zip].push(p);
  }

  console.log(`ZIPs with stucco properties: ${Object.keys(stuccoByZip).length}`);
  console.log(`ZIPs with 10+: ${Object.values(stuccoByZip).filter(v => v.length >= 10).length}`);
  console.log(`ZIPs with 3-9: ${Object.values(stuccoByZip).filter(v => v.length >= 3 && v.length < 10).length}`);
  console.log(`ZIPs with 1-2: ${Object.values(stuccoByZip).filter(v => v.length < 3).length}`);

  // ─── Step 3: Build municipality-to-ZIP mapping ───
  console.log('\n--- Step 3: Build municipality-to-ZIP mapping ---');

  const allModiv = [...existingStucco, ...condos, ...allStuccoProps];

  // Map: normalized_county -> { normalized_mun -> Set<ZIP5> }
  const countyMunZips = {};
  for (const p of allModiv) {
    const county = normalizeMun(p.COUNTY);
    const mun = normalizeMun(p.MUN_NAME);
    if (!county || !mun || !p.ZIP5) continue;

    if (!countyMunZips[county]) countyMunZips[county] = {};
    if (!countyMunZips[county][mun]) countyMunZips[county][mun] = new Set();
    countyMunZips[county][mun].add(p.ZIP5);
  }

  // Also build a county-agnostic mun->ZIP map for fallback
  const munZipsFallback = {};
  for (const p of allModiv) {
    const mun = normalizeMun(p.MUN_NAME);
    if (!mun || !p.ZIP5) continue;
    if (!munZipsFallback[mun]) munZipsFallback[mun] = new Set();
    munZipsFallback[mun].add(p.ZIP5);
  }

  // ─── Step 4: Map HOAs to ZIP codes ───
  console.log('\n--- Step 4: Map HOAs to ZIP codes ---');

  function findZipsForHOA(hoa) {
    const county = normalizeMun(hoa.county);
    const munVars = munVariants(hoa.municipality || '');

    // Try county + municipality variants
    if (county && countyMunZips[county]) {
      for (const mv of munVars) {
        if (countyMunZips[county][mv]) {
          return [...countyMunZips[county][mv]];
        }
      }
    }

    // Try just municipality (cross-county fallback)
    for (const mv of munVars) {
      if (munZipsFallback[mv]) {
        return [...munZipsFallback[mv]];
      }
    }

    return [];
  }

  let mappedCount = 0;
  let unmappedCount = 0;
  const hoaZips = new Map(); // hoa index -> zip codes

  for (let i = 0; i < hoas.length; i++) {
    const zips = findZipsForHOA(hoas[i]);
    if (zips.length > 0) {
      hoaZips.set(i, zips);
      mappedCount++;
    } else {
      unmappedCount++;
    }
  }

  console.log(`Mapped via municipality: ${mappedCount}`);
  console.log(`Still unmapped: ${unmappedCount}`);

  // ─── Step 4b: For unmapped HOAs, use lat/lng to find nearest ZIP ───
  // Build a ZIP centroid map from the MOD-IV data
  console.log('\n--- Step 4b: Map remaining HOAs via ZIP proximity ---');

  // We don't have coordinates in MOD-IV, so we'll build a municipality centroid from HOAs
  // that ARE mapped, then use those to match unmapped HOAs by distance
  const zipCentroids = {};
  for (let i = 0; i < hoas.length; i++) {
    if (!hoaZips.has(i)) continue;
    const h = hoas[i];
    const zips = hoaZips.get(i);
    for (const zip of zips) {
      if (!zipCentroids[zip]) zipCentroids[zip] = { sumLat: 0, sumLng: 0, count: 0 };
      zipCentroids[zip].sumLat += h.lat;
      zipCentroids[zip].sumLng += h.lng;
      zipCentroids[zip].count++;
    }
  }

  const zipCentroidList = [];
  for (const [zip, c] of Object.entries(zipCentroids)) {
    zipCentroidList.push({
      zip,
      lat: c.sumLat / c.count,
      lng: c.sumLng / c.count
    });
  }

  // For unmapped HOAs, find nearest ZIP centroid
  function findNearestZip(lat, lng) {
    let bestDist = Infinity;
    let bestZip = null;
    for (const zc of zipCentroidList) {
      const dlat = zc.lat - lat;
      const dlng = zc.lng - lng;
      const dist = dlat * dlat + dlng * dlng;
      if (dist < bestDist) {
        bestDist = dist;
        bestZip = zc.zip;
      }
    }
    // Only accept if within ~5 miles (~0.07 degrees)
    if (bestDist < 0.005) return bestZip;
    return null;
  }

  let proximityMapped = 0;
  for (let i = 0; i < hoas.length; i++) {
    if (hoaZips.has(i)) continue;
    const h = hoas[i];
    if (!h.lat || !h.lng) continue;

    const nearestZip = findNearestZip(h.lat, h.lng);
    if (nearestZip) {
      hoaZips.set(i, [nearestZip]);
      proximityMapped++;
    }
  }

  console.log(`Mapped via proximity: ${proximityMapped}`);
  console.log(`Total mapped: ${mappedCount + proximityMapped}`);
  console.log(`Still unmapped: ${hoas.length - mappedCount - proximityMapped}`);

  // ─── Step 5: Also use broader ST% data for additional density signal ───
  // The original 7,537 entries include building names (STUDIO, STRATFORD, etc.)
  // But some are legitimate - count entries that could indicate stucco construction
  // We'll use them as a secondary signal at higher thresholds

  const broadStuccoByZip = {};
  for (const p of existingStucco) {
    const zip = p.ZIP5;
    if (!zip) continue;
    if (!broadStuccoByZip[zip]) broadStuccoByZip[zip] = 0;
    broadStuccoByZip[zip]++;
  }

  // ─── Step 6: Apply density rules ───
  console.log('\n--- Step 5: Apply density rules ---');

  // Track stats
  let newStucco = 0, newMixed = 0, keptExisting = 0;
  let bySource = {
    'MOD-IV address match': 0,
    'MOD-IV ZIP density': 0,
    'MOD-IV ZIP moderate': 0,
    'MOD-IV condo stucco': 0,
    'MOD-IV county density': 0,
    'proximity ZIP density': 0,
    'existing': 0,
    'default': 0,
  };

  // Also build county-level stucco density
  const stuccoByCounty = {};
  for (const p of allStuccoProps) {
    const county = normalizeMun(p.COUNTY);
    if (!county) continue;
    if (!stuccoByCounty[county]) stuccoByCounty[county] = 0;
    stuccoByCounty[county]++;
  }

  for (let i = 0; i < hoas.length; i++) {
    const hoa = hoas[i];
    const zips = hoaZips.get(i) || [];

    // Calculate stucco density across all matching ZIPs
    let confirmedStuccoCount = 0;
    let broadStuccoCount = 0;

    for (const zip of zips) {
      confirmedStuccoCount += (stuccoByZip[zip] || []).length;
      broadStuccoCount += broadStuccoByZip[zip] || 0;
    }

    // County-level density
    const county = normalizeMun(hoa.county);
    const countyStucco = stuccoByCounty[county] || 0;

    // Keep existing confirmed stucco
    if (hoa.exteriorConfirmed && hoa.exteriorType === 'stucco') {
      keptExisting++;
      bySource['existing']++;
      continue;
    }

    // Apply rules (from most to least confident)
    if (confirmedStuccoCount >= 10) {
      hoa.exteriorType = 'stucco';
      hoa.exteriorSource = `MOD-IV ZIP density (${confirmedStuccoCount} confirmed in ZIP)`;
      hoa.nearbyStuccoCount = confirmedStuccoCount;
      newStucco++;
      bySource['MOD-IV ZIP density']++;
    } else if (confirmedStuccoCount >= 3) {
      hoa.exteriorType = 'mixed';
      hoa.exteriorSource = `MOD-IV ZIP moderate (${confirmedStuccoCount} confirmed in ZIP)`;
      hoa.nearbyStuccoCount = confirmedStuccoCount;
      newMixed++;
      bySource['MOD-IV ZIP moderate']++;
    } else if (broadStuccoCount >= 50) {
      // High broad density - likely real stucco area
      hoa.exteriorType = 'mixed';
      hoa.exteriorSource = `MOD-IV broad density (${broadStuccoCount} in ZIP)`;
      hoa.nearbyStuccoCount = broadStuccoCount;
      newMixed++;
      bySource['MOD-IV county density']++;
    } else if (countyStucco >= 20) {
      // County has significant stucco presence
      hoa.exteriorType = 'mixed';
      hoa.exteriorSource = `MOD-IV county density (${countyStucco} in county)`;
      hoa.nearbyStuccoCount = countyStucco;
      newMixed++;
      bySource['MOD-IV county density']++;
    } else {
      // Keep as non-stucco or existing value
      if (!hoa.exteriorType) hoa.exteriorType = 'non-stucco';
      bySource['default']++;
    }
  }

  // ─── Final stats ───
  console.log('\n========================================');
  console.log('        ENRICHMENT RESULTS');
  console.log('========================================\n');

  const totalStucco = hoas.filter(h => h.exteriorType === 'stucco').length;
  const totalMixed = hoas.filter(h => h.exteriorType === 'mixed').length;
  const totalNonStucco = hoas.filter(h => h.exteriorType === 'non-stucco').length;

  console.log(`Total HOAs: ${hoas.length}`);
  console.log(`  Stucco:     ${totalStucco} (${(totalStucco/hoas.length*100).toFixed(1)}%)`);
  console.log(`  Mixed:      ${totalMixed} (${(totalMixed/hoas.length*100).toFixed(1)}%)`);
  console.log(`  Non-stucco: ${totalNonStucco} (${(totalNonStucco/hoas.length*100).toFixed(1)}%)`);

  console.log(`\nNew classifications this run:`);
  console.log(`  New stucco: ${newStucco}`);
  console.log(`  New mixed:  ${newMixed}`);
  console.log(`  Kept existing confirmed: ${keptExisting}`);

  console.log(`\nBy source:`);
  for (const [src, count] of Object.entries(bySource)) {
    if (count > 0) console.log(`  ${src}: ${count}`);
  }

  console.log(`\nStucco properties by ZIP (top 20):`);
  Object.entries(stuccoByZip)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)
    .forEach(([zip, props]) => console.log(`  ${zip}: ${props.length} properties`));

  console.log(`\nStucco by county:`);
  Object.entries(stuccoByCounty)
    .sort((a, b) => b[1] - a[1])
    .forEach(([county, count]) => console.log(`  ${county}: ${count}`));

  // Save
  fs.writeFileSync('public/data/hoas.json', JSON.stringify(hoas, null, 2));
  console.log(`\nSaved updated hoas.json`);
}

main().catch(console.error);
