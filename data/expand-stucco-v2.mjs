#!/usr/bin/env node
/**
 * Expand stucco property search using correct NJGIN endpoint
 * Query by county for BLDG_DESC containing stucco indicators
 */
import fs from 'fs';

const BASE = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query';

const NJ_COUNTIES = [
  'ATLANTIC','BERGEN','BURLINGTON','CAMDEN','CAPE MAY','CUMBERLAND',
  'ESSEX','GLOUCESTER','HUDSON','HUNTERDON','MERCER','MIDDLESEX',
  'MONMOUTH','MORRIS','OCEAN','PASSAIC','SALEM','SOMERSET',
  'SUSSEX','UNION','WARREN'
];

const STUCCO_PATTERNS = [
  'STUC',  // matches STUCCO, 1SSTUCCO, etc
  'EIFS',  // synthetic stucco
];

async function queryStuccoByCounty(county, pattern) {
  const where = `MUN_NAME IS NOT NULL AND BLDG_DESC LIKE '%${pattern}%'`;
  const geometry = null; // We'll filter by county in the where clause if possible
  
  // Try a simpler where clause
  const simpleWhere = `BLDG_DESC LIKE '%${pattern}%'`;
  
  const params = new URLSearchParams({
    where: simpleWhere,
    outFields: 'BLDG_DESC,OWNER_NAME,PROP_LOC,MUN_NAME,PROP_CLASS,YR_CONSTR,DWELL',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '5000',
    f: 'json',
  });

  const url = `${BASE}?${params.toString()}`;
  
  try {
    const resp = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000)
    });
    const data = await resp.json();
    if (data.error) {
      console.error(`  Error: ${data.error.message}`);
      return [];
    }
    return data.features || [];
  } catch (err) {
    console.error(`  Fetch error: ${err.message}`);
    return [];
  }
}

function extractCoords(feature) {
  const geo = feature.geometry;
  if (!geo) return { lat: null, lng: null };
  if (geo.x && geo.y) return { lat: geo.y, lng: geo.x };
  if (geo.rings && geo.rings.length > 0) {
    const ring = geo.rings[0];
    let sumX = 0, sumY = 0;
    for (const [x, y] of ring) { sumX += x; sumY += y; }
    return { lat: sumY / ring.length, lng: sumX / ring.length };
  }
  return { lat: null, lng: null };
}

async function main() {
  console.log('=== Expanded NJGIN Stucco Search ===\n');
  
  const allStucco = new Map();
  
  // Load existing
  try {
    const existing = JSON.parse(fs.readFileSync('stucco-properties.json', 'utf8'));
    for (const s of existing) {
      allStucco.set(`${s.address}|${s.city}`, s);
    }
    console.log(`Loaded ${allStucco.size} existing properties`);
  } catch {}

  for (const pattern of STUCCO_PATTERNS) {
    console.log(`\n--- Searching for: ${pattern} ---`);
    const features = await queryStuccoByCounty('ALL', pattern);
    console.log(`Found ${features.length} features`);
    
    let newCount = 0;
    for (const f of features) {
      const a = f.attributes;
      const coords = extractCoords(f);
      const key = `${a.PROP_LOC || ''}|${a.MUN_NAME || ''}`;
      
      if (!allStucco.has(key) && a.PROP_LOC) {
        newCount++;
        allStucco.set(key, {
          owner: a.OWNER_NAME || '',
          address: a.PROP_LOC || '',
          city: a.MUN_NAME || '',
          county: '',  // Will be enriched later
          bldgDesc: a.BLDG_DESC || '',
          yearBuilt: a.YR_CONSTR || 0,
          units: a.DWELL || 0,
          propClass: a.PROP_CLASS || '',
          lat: coords.lat,
          lng: coords.lng,
        });
      }
    }
    console.log(`New: ${newCount}`);
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Also search for multi-family stucco (condos/townhouses)
  console.log('\n--- Searching: Multi-family with stucco ---');
  const multiParams = new URLSearchParams({
    where: "PROP_CLASS IN ('2','4A','4B','4C') AND BLDG_DESC LIKE '%STUC%'",
    outFields: 'BLDG_DESC,OWNER_NAME,PROP_LOC,MUN_NAME,PROP_CLASS,YR_CONSTR,DWELL',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '5000',
    f: 'json',
  });
  
  try {
    const resp = await fetch(`${BASE}?${multiParams.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000)
    });
    const data = await resp.json();
    if (!data.error && data.features) {
      let newCount = 0;
      for (const f of data.features) {
        const a = f.attributes;
        const coords = extractCoords(f);
        const key = `${a.PROP_LOC || ''}|${a.MUN_NAME || ''}`;
        if (!allStucco.has(key) && a.PROP_LOC) {
          newCount++;
          allStucco.set(key, {
            owner: a.OWNER_NAME || '',
            address: a.PROP_LOC || '',
            city: a.MUN_NAME || '',
            county: '',
            bldgDesc: a.BLDG_DESC || '',
            yearBuilt: a.YR_CONSTR || 0,
            units: a.DWELL || 0,
            propClass: a.PROP_CLASS || '',
            lat: coords.lat,
            lng: coords.lng,
          });
        }
      }
      console.log(`Found ${data.features.length}, New: ${newCount}`);
    } else {
      console.log('Error:', data.error?.message || 'no features');
    }
  } catch (err) {
    console.log('Fetch error:', err.message);
  }

  const results = [...allStucco.values()];
  fs.writeFileSync('stucco-properties-expanded.json', JSON.stringify(results, null, 2));
  console.log(`\n=== TOTAL STUCCO PROPERTIES: ${results.length} ===`);
  
  // Stats
  const withCoords = results.filter(r => r.lat && r.lng);
  console.log(`With coordinates: ${withCoords.length}`);
  
  // Building descriptions breakdown
  const descs = {};
  for (const r of results) {
    const d = r.bldgDesc || 'unknown';
    descs[d] = (descs[d] || 0) + 1;
  }
  const sorted = Object.entries(descs).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('\nTop building descriptions:');
  for (const [d, n] of sorted) {
    console.log(`  ${d}: ${n}`);
  }
}

main().catch(console.error);
