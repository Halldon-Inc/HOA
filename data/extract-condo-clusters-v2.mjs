/**
 * Extract HOAs from NJGIN condo/townhouse clusters - simplified version.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, 'condo-cluster-hoas.json');
const NJGIN_URL = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function extractAddress(address) {
  if (!address) return '';
  return address
    .replace(/\s*(UNIT|APT|#|STE|SUITE|FL|FLOOR|RM|ROOM|\().*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function fetchAll(where) {
  let all = [];
  let offset = 0;
  
  while (true) {
    const params = new URLSearchParams({
      where,
      outFields: 'BLDG_DESC,MUN_NAME,COUNTY,PROP_LOC,YR_CONSTR',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
      resultOffset: String(offset),
      resultRecordCount: '2000',
    });

    const resp = await fetch(`${NJGIN_URL}?${params}`, { signal: AbortSignal.timeout(60000) });
    const data = await resp.json();
    
    if (data.error) {
      console.log(`Error at offset ${offset}: ${data.error.message}`);
      break;
    }
    
    const features = data.features || [];
    all.push(...features);
    process.stdout.write(`\r  ${all.length} parcels...`);
    
    if (!data.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
    if (offset >= 100000) break;
    await sleep(300);
  }
  console.log('');
  return all;
}

async function main() {
  console.log('Fetching CONDO parcels...');
  const condos = await fetchAll("BLDG_DESC LIKE '%CONDO%'");
  
  console.log('Fetching TOWNHOUSE parcels...');
  const townhouses = await fetchAll("BLDG_DESC LIKE '%TOWN%HSE%' OR BLDG_DESC LIKE '%TOWNHOUSE%' OR BLDG_DESC LIKE '%TWN%HSE%'");
  
  const parcels = [...condos, ...townhouses];
  console.log(`Total: ${parcels.length} parcels`);
  
  // Cluster by municipality + base address
  const clusters = new Map();
  
  for (const f of parcels) {
    const a = f.attributes;
    const g = f.geometry || {};
    
    const mun = (a.MUN_NAME || '').trim().toUpperCase();
    const addr = extractAddress(a.PROP_LOC || '');
    if (!mun || !addr) continue;
    
    const key = `${mun}|${addr}`;
    
    if (!clusters.has(key)) {
      clusters.set(key, {
        mun: a.MUN_NAME?.trim() || mun,
        county: (a.COUNTY || '').trim(),
        addr,
        count: 0,
        lats: [],
        lngs: [],
        descs: [],
        years: [],
        stucco: false,
      });
    }
    
    const c = clusters.get(key);
    c.count++;
    // Geometry is polygon (rings), compute centroid
    if (g.rings && g.rings[0]) {
      const ring = g.rings[0];
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      c.lngs.push(cx);
      c.lats.push(cy);
    }
    if (a.BLDG_DESC && c.descs.length < 3 && !c.descs.includes(a.BLDG_DESC)) c.descs.push(a.BLDG_DESC);
    if (a.YR_CONSTR && !c.years.includes(a.YR_CONSTR)) c.years.push(a.YR_CONSTR);
    if ((a.BLDG_DESC || '').toUpperCase().includes('STUC')) c.stucco = true;
  }
  
  console.log(`Total clusters: ${clusters.size}`);
  
  // Filter to 3+ units
  const hoas = [];
  for (const [key, c] of clusters) {
    if (c.count < 3) continue;
    
    if (c.lats.length === 0) continue;
    const lat = c.lats.reduce((a, b) => a + b, 0) / c.lats.length;
    const lng = c.lngs.reduce((a, b) => a + b, 0) / c.lngs.length;
    const year = c.years.length > 0 ? Math.min(...c.years) : null;
    
    hoas.push({
      name: `${c.addr} ${c.descs[0] === 'CONDO' ? 'Condominiums' : 'Townhomes'}, ${c.mun}`,
      municipality: c.mun,
      county: c.county,
      address: c.addr,
      unitCount: c.count,
      lat, lng,
      exteriorType: c.stucco ? 'stucco' : 'non-stucco',
      yearBuilt: year,
      buildingDescs: c.descs,
      geoSource: 'parcel_cluster',
    });
  }
  
  hoas.sort((a, b) => b.unitCount - a.unitCount);
  
  console.log(`HOAs (3+ units): ${hoas.length}`);
  
  const stuccoCount = hoas.filter(h => h.exteriorType === 'stucco').length;
  console.log(`Stucco HOAs: ${stuccoCount}`);
  
  // County stats
  const counties = {};
  for (const h of hoas) counties[h.county] = (counties[h.county] || 0) + 1;
  console.log('\nBy county:');
  Object.entries(counties).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${c}: ${n}`));
  
  console.log('\nTop 15 largest:');
  hoas.slice(0, 15).forEach(h => console.log(`  ${h.name}: ${h.unitCount} units`));
  
  const totalUnits = hoas.reduce((a, b) => a + b.unitCount, 0);
  console.log(`\nTotal units across all HOAs: ${totalUnits}`);
  
  writeFileSync(OUTPUT_FILE, JSON.stringify(hoas, null, 2));
  console.log(`Saved ${hoas.length} HOA clusters`);
}

main().catch(console.error);
