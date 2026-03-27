/**
 * Extract HOAs from NJGIN parcel data by finding clusters of condos/townhouses.
 * 
 * Strategy: Query all CONDO and TOWNHOUSE properties, group by municipality + street,
 * and each cluster of 3+ units at the same location = 1 HOA.
 * 
 * This should find thousands of HOAs that don't appear in SoS records.
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, 'condo-cluster-hoas.json');

const NJGIN_URL = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function queryParcels(where, offset = 0) {
  const params = new URLSearchParams({
    where,
    outFields: 'BLDG_DESC,MUN_NAME,COUNTY,PROP_LOC,ST_ADDRESS,CITY_STATE,ZIP_CODE,YR_CONSTR,BLDG_CLASS',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: '2000',
  });

  try {
    const resp = await fetch(`${NJGIN_URL}?${params}`, { signal: AbortSignal.timeout(60000) });
    const data = await resp.json();
    if (data.error) {
      console.log(`API error at offset ${offset}: ${data.error.message}`);
      return { features: [], more: false };
    }
    return {
      features: data.features || [],
      more: data.exceededTransferLimit || false,
    };
  } catch (e) {
    console.log(`Fetch error at offset ${offset}: ${e.message.substring(0, 80)}`);
    return { features: [], more: false };
  }
}

async function queryAll(where) {
  let all = [];
  let offset = 0;
  
  while (true) {
    const { features, more } = await queryParcels(where, offset);
    all = all.concat(features);
    process.stdout.write(`\r  Fetched ${all.length} parcels...`);
    
    if (!more || features.length === 0) break;
    offset += features.length;
    
    // Safety cap at 100K
    if (offset >= 100000) {
      console.log('\n  Hit 100K cap');
      break;
    }
    
    await sleep(300);
  }
  
  console.log('');
  return all;
}

function extractStreetName(address) {
  if (!address) return '';
  // Keep the house number as part of the key (40 W 4TH ST and 42 W 4TH ST are different buildings)
  return address
    .replace(/\s*(UNIT|APT|#|STE|SUITE|FL|FLOOR|RM|ROOM|\().*/i, '')  // Remove unit numbers
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function main() {
  console.log('Extracting HOAs from NJGIN condo/townhouse clusters...\n');
  
  // Query condos
  console.log('Querying CONDO properties...');
  const condos = await queryAll("BLDG_DESC LIKE '%CONDO%'");
  
  // Query townhouses
  console.log('Querying TOWNHOUSE properties...');
  const townhouses = await queryAll("BLDG_DESC LIKE '%TOWN%' AND (BLDG_DESC LIKE '%HOUSE%' OR BLDG_DESC LIKE '%HOME%' OR BLDG_DESC LIKE '%TWN%')");
  
  const allParcels = [...condos, ...townhouses];
  console.log(`\nTotal parcels: ${allParcels.length}`);
  
  // Group by municipality + street name to find HOA clusters
  const clusters = {};
  
  for (const f of allParcels) {
    const a = f.attributes;
    const g = f.geometry;
    
    const mun = (a.MUN_NAME || '').trim().toUpperCase();
    const county = (a.COUNTY || '').trim();
    const address = a.PROP_LOC || a.ST_ADDRESS || '';
    const street = extractStreetName(address);
    
    if (!mun || !street) continue;
    
    const key = `${mun}|${street}`;
    
    if (!clusters[key]) {
      clusters[key] = {
        municipality: a.MUN_NAME?.trim() || '',
        county: county,
        street: street,
        units: [],
        lats: [],
        lngs: [],
        bldgDescs: new Set(),
        years: [],
        hasStucco: false,
      };
    }
    
    const c = clusters[key];
    c.units.push(address);
    if (g?.y && g?.x) {
      c.lats.push(g.y);
      c.lngs.push(g.x);
    }
    if (a.BLDG_DESC) {
      c.bldgDescs.add(a.BLDG_DESC);
      if (a.BLDG_DESC.toUpperCase().includes('STUC')) {
        c.hasStucco = true;
      }
    }
    if (a.YR_CONSTR) c.years.push(a.YR_CONSTR);
  }
  
  console.log(`Raw clusters: ${Object.keys(clusters).length}`);
  
  // Filter to clusters with 3+ units (likely HOAs)
  const hoaClusters = Object.values(clusters)
    .filter(c => c.units.length >= 3)
    .map(c => {
      const lat = c.lats.length > 0 ? c.lats.reduce((a, b) => a + b) / c.lats.length : null;
      const lng = c.lngs.length > 0 ? c.lngs.reduce((a, b) => a + b) / c.lngs.length : null;
      const year = c.years.length > 0 ? Math.min(...c.years) : null;
      
      return {
        name: `${c.street} ${c.municipality.includes('CONDO') ? '' : 'Condominiums'} ${c.municipality}`.trim(),
        municipality: c.municipality,
        county: c.county,
        street: c.street,
        unitCount: c.units.length,
        lat,
        lng,
        exteriorType: c.hasStucco ? 'stucco' : 'non-stucco',
        yearBuilt: year,
        buildingDescs: [...c.bldgDescs].slice(0, 3),
        geoSource: 'parcel_cluster',
      };
    })
    .filter(c => c.lat && c.lng)
    .sort((a, b) => b.unitCount - a.unitCount);
  
  console.log(`HOA clusters (3+ units): ${hoaClusters.length}`);
  
  const stuccoClusters = hoaClusters.filter(c => c.exteriorType === 'stucco');
  console.log(`Stucco clusters: ${stuccoClusters.length}`);
  
  // Stats
  const counties = {};
  for (const h of hoaClusters) {
    counties[h.county] = (counties[h.county] || 0) + 1;
  }
  console.log('\nBy county:');
  Object.entries(counties).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([c, n]) => {
    console.log(`  ${c}: ${n}`);
  });
  
  console.log('\nTop 10 largest:');
  hoaClusters.slice(0, 10).forEach(h => {
    console.log(`  ${h.name}: ${h.unitCount} units (${h.county})`);
  });
  
  writeFileSync(OUTPUT_FILE, JSON.stringify(hoaClusters, null, 2));
  console.log(`\nSaved ${hoaClusters.length} clusters to ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
