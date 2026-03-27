/**
 * Enrich HOA data with real exterior type from NJGIN parcel data.
 * For each HOA, queries parcels within 500m radius and checks BLDG_DESC for stucco indicators.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOAS_FILE = join(__dirname, 'final-hoas.json');
const OUTPUT_FILE = join(__dirname, 'final-hoas-enriched.json');

const ARCGIS_BASE = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query';

// NJ State Plane to Web Mercator is what the service uses
// But we can query with lat/lng using inSR=4326
async function queryParcelsNear(lat, lng, radiusMeters = 500) {
  // Buffer around point
  const params = new URLSearchParams({
    geometry: JSON.stringify({
      x: lng, y: lat,
      spatialReference: { wkid: 4326 }
    }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: radiusMeters.toString(),
    units: 'esriSRUnit_Meter',
    outFields: 'BLDG_DESC,BLDG_CLASS,YR_CONSTR,OWNER_NAME,PROP_LOC,PROP_CLASS,DWELL',
    returnGeometry: 'false',
    resultRecordCount: '50',
    f: 'json'
  });

  const url = `${ARCGIS_BASE}?${params}`;
  
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await resp.json();
    return data.features?.map(f => f.attributes) || [];
  } catch (e) {
    console.error(`  Query error: ${e.message}`);
    return [];
  }
}

function classifyExterior(parcels) {
  let stuccoCount = 0;
  let totalWithBldg = 0;
  const descriptions = new Set();

  for (const p of parcels) {
    const desc = (p.BLDG_DESC || '').toUpperCase();
    if (!desc) continue;
    totalWithBldg++;
    descriptions.add(desc);
    
    if (desc.includes('STU') || desc.includes('STUCCO') || desc.includes('EIFS')) {
      stuccoCount++;
    }
  }

  if (totalWithBldg === 0) return { type: 'unknown', confidence: 0, descriptions: [] };
  
  const ratio = stuccoCount / totalWithBldg;
  let type;
  if (ratio >= 0.5) type = 'stucco';
  else if (ratio >= 0.1) type = 'mixed';
  else type = 'non-stucco';

  return {
    type,
    confidence: Math.round(ratio * 100),
    stuccoCount,
    totalParcels: totalWithBldg,
    descriptions: [...descriptions].slice(0, 10)
  };
}

async function main() {
  const hoas = JSON.parse(readFileSync(HOAS_FILE, 'utf8'));
  console.log(`Enriching ${hoas.length} HOAs with parcel data...`);

  const enriched = [];
  let stuccoFound = 0;
  let mixedFound = 0;
  let nonStuccoFound = 0;
  let unknownFound = 0;

  for (let i = 0; i < hoas.length; i++) {
    const hoa = hoas[i];
    
    // Query parcels near this HOA
    const parcels = await queryParcelsNear(hoa.lat, hoa.lng, 400);
    const result = classifyExterior(parcels);
    
    // Update HOA with real data
    if (result.type !== 'unknown') {
      hoa.exteriorType = result.type;
      hoa.exteriorConfidence = result.confidence;
      hoa.parcelCount = result.totalParcels;
      hoa.stuccoCount = result.stuccoCount || 0;
      hoa.buildingDescriptions = result.descriptions;
    }

    switch (result.type) {
      case 'stucco': stuccoFound++; break;
      case 'mixed': mixedFound++; break;
      case 'non-stucco': nonStuccoFound++; break;
      default: unknownFound++;
    }

    enriched.push(hoa);

    if ((i + 1) % 10 === 0 || i === hoas.length - 1) {
      console.log(`  ${i + 1}/${hoas.length} | stucco:${stuccoFound} mixed:${mixedFound} non-stucco:${nonStuccoFound} unknown:${unknownFound}`);
    }

    // Small delay to be nice to the API
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nFinal: stucco=${stuccoFound} mixed=${mixedFound} non-stucco=${nonStuccoFound} unknown=${unknownFound}`);
  
  writeFileSync(OUTPUT_FILE, JSON.stringify(enriched, null, 2));
  console.log(`Saved to ${OUTPUT_FILE}`);
}

main().catch(console.error);
