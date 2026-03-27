#!/usr/bin/env node
/**
 * Expand NJGIN stucco property search
 * Query the NJ parcel data for ALL stucco-related building descriptions
 * Also search for EIFS, synthetic stucco, and similar exterior types
 */

import fs from 'fs';

const NJGIN_URL = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services';
const PARCELS_URL = `${NJGIN_URL}/Parcels_in_NJ_Hosted/FeatureServer/0/query`;

const STUCCO_QUERIES = [
  // Original stucco variants
  "BLDG_DESC LIKE '%STUC%'",
  // EIFS (Exterior Insulation Finishing System) - synthetic stucco
  "BLDG_DESC LIKE '%EIFS%'",
  // Additional exterior types that might indicate stucco
  "BLDG_DESC LIKE '%PLASTER%'",
  "BLDG_DESC LIKE '%CEMENT%BOARD%'",
  // Multi-family/condo specific stucco
  "BLDG_DESC LIKE '%CONDO%' AND BLDG_DESC LIKE '%STUC%'",
  // Search by property class for condos/townhouses with stucco
  "PROP_CLASS = '2' AND BLDG_DESC LIKE '%STUC%'",
];

// Also query for large residential developments (likely HOAs)
const HOA_QUERIES = [
  // Condos not yet found
  "PROP_CLASS = '2' AND BLDG_DESC LIKE '%COND%' AND COUNTY NOT IN ('HUDSON','BERGEN','OCEAN','MONMOUTH','CAPE MAY')",
  // Townhouses in counties we may have missed
  "PROP_CLASS = '2' AND BLDG_DESC LIKE '%TOWN%' AND COUNTY NOT IN ('HUDSON','BERGEN','OCEAN','MONMOUTH','CAPE MAY')",
];

async function queryNJGIN(where, outFields = 'OBJECTID,OWNER,ADDR,CITY,COUNTY,BLDG_DESC,YR_BUILT', returnGeometry = true) {
  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: String(returnGeometry),
    returnCountOnly: 'false',
    f: 'json',
    resultRecordCount: '10000',
    outSR: '4326',
  });

  try {
    const resp = await fetch(`${PARCELS_URL}?${params}`);
    const data = await resp.json();
    if (data.error) {
      console.error(`Query error for "${where}":`, data.error.message);
      return [];
    }
    return data.features || [];
  } catch (err) {
    console.error(`Fetch error for "${where}":`, err.message);
    return [];
  }
}

function extractCoords(feature) {
  const geo = feature.geometry;
  if (!geo) return { lat: null, lng: null };
  
  // Point geometry
  if (geo.x && geo.y) return { lat: geo.y, lng: geo.x };
  
  // Polygon geometry - compute centroid
  if (geo.rings && geo.rings.length > 0) {
    const ring = geo.rings[0];
    let sumX = 0, sumY = 0;
    for (const [x, y] of ring) {
      sumX += x;
      sumY += y;
    }
    return { lat: sumY / ring.length, lng: sumX / ring.length };
  }
  
  return { lat: null, lng: null };
}

async function main() {
  console.log('=== NJGIN Stucco Expansion ===\n');
  
  // Load existing stucco data
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync('stucco-properties.json', 'utf8'));
  } catch {}
  console.log(`Existing stucco properties: ${existing.length}`);
  
  const allStucco = new Map();
  
  // Add existing
  for (const s of existing) {
    const key = `${s.address}|${s.city}`;
    allStucco.set(key, s);
  }
  
  // Run stucco queries
  for (const query of STUCCO_QUERIES) {
    console.log(`\nQuerying: ${query}`);
    const features = await queryNJGIN(query);
    console.log(`  Found: ${features.length} features`);
    
    let newCount = 0;
    for (const f of features) {
      const attrs = f.attributes;
      const coords = extractCoords(f);
      const key = `${attrs.ADDR}|${attrs.CITY}`;
      
      if (!allStucco.has(key)) {
        newCount++;
        allStucco.set(key, {
          owner: attrs.OWNER || '',
          address: attrs.ADDR || '',
          city: attrs.CITY || '',
          county: attrs.COUNTY || '',
          bldgDesc: attrs.BLDG_DESC || '',
          yearBuilt: attrs.YR_BUILT || 0,
          lat: coords.lat,
          lng: coords.lng,
        });
      }
    }
    console.log(`  New: ${newCount} (total: ${allStucco.size})`);
    
    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }
  
  const results = [...allStucco.values()];
  fs.writeFileSync('stucco-properties-expanded.json', JSON.stringify(results, null, 2));
  console.log(`\n=== TOTAL STUCCO PROPERTIES: ${results.length} ===`);
  
  // County breakdown
  const counties = {};
  for (const s of results) {
    counties[s.county] = (counties[s.county] || 0) + 1;
  }
  const sorted = Object.entries(counties).sort((a, b) => b[1] - a[1]);
  console.log('\nBy county:');
  for (const [c, n] of sorted) {
    console.log(`  ${c}: ${n}`);
  }
}

main().catch(console.error);
