#!/usr/bin/env node
/**
 * Check NJGIN parcels near each non-stucco HOA to find stucco buildings.
 * Reclassifies HOAs to 'mixed' or 'stucco' based on proximity.
 */
import fs from 'fs';

const ARCGIS_BASE = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query';
const HOAS_FILE = '/Users/minime/Projects/nj-stucco-map/public/data/hoas.json';
const CACHE_FILE = '/Users/minime/Projects/nj-stucco-map/data/njgin-proximity-cache.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Load cache
let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch {}

async function checkNearbyParcels(lat, lng, radiusMeters = 300) {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache[cacheKey] !== undefined) return cache[cacheKey];
  
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: radiusMeters.toString(),
    units: 'esriSRUnit_Meter',
    outFields: 'BLDG_DESC',
    returnGeometry: 'false',
    resultRecordCount: '50',
    f: 'json',
  });

  try {
    const resp = await fetch(`${ARCGIS_BASE}?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    if (data.error) {
      console.error(`  NJGIN error: ${data.error.message}`);
      return null;
    }
    
    const features = data.features || [];
    const bldgDescs = features.map(f => f.attributes?.BLDG_DESC || '').filter(Boolean);
    const stuccoCount = bldgDescs.filter(d => d.toUpperCase().includes('STUC')).length;
    
    const result = { total: features.length, stuccoCount, bldgDescs: bldgDescs.slice(0, 5) };
    cache[cacheKey] = result;
    return result;
  } catch (err) {
    console.error(`  Fetch error: ${err.message}`);
    return null;
  }
}

async function main() {
  const hoas = JSON.parse(fs.readFileSync(HOAS_FILE, 'utf8'));
  const toCheck = hoas.filter(h => h.exteriorType === 'non-stucco' && h.lat && h.lng);
  
  console.log(`Checking ${toCheck.length} non-stucco HOAs for nearby stucco...`);
  console.log(`Cache entries: ${Object.keys(cache).length}`);
  
  let reclassified = 0;
  let checked = 0;
  let errors = 0;
  
  for (const hoa of toCheck) {
    const result = await checkNearbyParcels(hoa.lat, hoa.lng);
    checked++;
    
    if (result === null) {
      errors++;
      if (errors > 20) {
        console.log('Too many errors, saving and exiting...');
        break;
      }
      await sleep(5000);
      continue;
    }
    
    if (result.stuccoCount > 0) {
      if (result.stuccoCount >= 3) {
        hoa.exteriorType = 'stucco';
      } else {
        hoa.exteriorType = 'mixed';
      }
      hoa.nearbyStuccoCount = result.stuccoCount;
      hoa.exteriorSource = 'njgin-proximity';
      reclassified++;
    }
    
    // Progress every 50
    if (checked % 50 === 0) {
      console.log(`[${checked}/${toCheck.length}] checked: ${checked}, reclassified: ${reclassified}, errors: ${errors}`);
      // Save progress
      fs.writeFileSync(HOAS_FILE, JSON.stringify(hoas));
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    }
    
    // Rate limit: 1.5s between requests
    await sleep(1500);
  }
  
  // Final save
  fs.writeFileSync(HOAS_FILE, JSON.stringify(hoas));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  
  // Stats
  const types = {};
  for (const h of hoas) {
    types[h.exteriorType] = (types[h.exteriorType] || 0) + 1;
  }
  
  console.log(`\nDone! Checked: ${checked}, Reclassified: ${reclassified}, Errors: ${errors}`);
  console.log('Final exterior types:', JSON.stringify(types));
}

main().catch(console.error);
