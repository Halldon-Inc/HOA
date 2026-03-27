/**
 * Query NJGIN Parcels_Composite to find all HOA/condo association-owned properties.
 * The OWNER_NAME field in parcel data contains the actual property owner.
 * HOA common areas are owned by the association itself.
 * 
 * Strategy: Query parcels where OWNER_NAME contains keywords like:
 * - HOMEOWNER, HOME OWNER, HOA
 * - CONDOMINIUM ASSOC, CONDO ASSOC
 * - PROPERTY OWNERS, COMMUNITY ASSOC
 * - TOWNHOUSE, TOWNHOME
 * - VILLAGE, ESTATES (with ASSOC)
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, 'njgin-hoa-parcels.json');
const CACHE_FILE = join(__dirname, 'njgin-query-cache.json');

const NJGIN_URL = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query';

const KEYWORDS = [
  "HOMEOWNER%27S ASSOCIATION",
  "HOMEOWNERS ASSOCIATION",
  "HOME OWNER%27S ASSOCIATION", 
  "HOME OWNERS ASSOCIATION",
  "HOMEOWNERS ASSOC",
  "HOMEOWNER%27S ASSOC",
  "CONDOMINIUM ASSOCIATION",
  "CONDOMINIUM ASSOC",
  "CONDO ASSOCIATION",
  "CONDO ASSOC",
  "PROPERTY OWNERS ASSOCIATION",
  "PROPERTY OWNERS ASSOC",
  "COMMUNITY ASSOCIATION",
  "COMMUNITY ASSOC",
  "TOWNHOUSE ASSOCIATION",
  "TOWNHOUSE ASSOC",
  "TOWNHOME ASSOCIATION",
  "TOWNHOME ASSOC",
  "COOPERATIVE ASSOCIATION",
  "CO-OP ASSOCIATION",
  "HOUSING COOPERATIVE",
  "HOA",
  "H.O.A.",
  "MASTER ASSOCIATION",
  "VILLAGE ASSOCIATION",
  "ESTATES ASSOCIATION",
  "COMMONS ASSOCIATION",
  "RESIDENTS ASSOCIATION",
  "TENANT%27S ASSOCIATION",
  "TENANTS ASSOCIATION",
];

const OUT_FIELDS = 'OWNER_NAME,PCL_MUN,PCL_CNTY,BLDG_DESC,PROP_CLASS,PROP_LOC,YR_CONSTR,OBJECTID';

async function queryParcels(whereClause, offset = 0) {
  const params = new URLSearchParams({
    where: whereClause,
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: '2000',
  });

  const url = `${NJGIN_URL}?${params}`;
  
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    
    if (data.error) {
      console.log(`    API error: ${JSON.stringify(data.error).substring(0, 100)}`);
      return { features: [], exceededTransferLimit: false };
    }
    
    return {
      features: data.features || [],
      exceededTransferLimit: data.exceededTransferLimit || false
    };
  } catch (e) {
    console.log(`    Fetch error: ${e.message.substring(0, 100)}`);
    return { features: [], exceededTransferLimit: false };
  }
}

async function queryAllForKeyword(keyword) {
  const where = `UPPER(OWNER_NAME) LIKE '%${keyword}%'`;
  let allFeatures = [];
  let offset = 0;
  
  while (true) {
    const result = await queryParcels(where, offset);
    allFeatures = allFeatures.concat(result.features);
    
    if (!result.exceededTransferLimit || result.features.length === 0) break;
    offset += result.features.length;
    
    // Safety: cap at 10K per keyword
    if (offset >= 10000) {
      console.log(`    Capped at 10K for this keyword`);
      break;
    }
  }
  
  return allFeatures;
}

function extractHOA(feature) {
  const attrs = feature.attributes;
  const geom = feature.geometry;
  
  return {
    ownerName: attrs.OWNER_NAME?.trim() || '',
    municipality: attrs.PCL_MUN?.trim() || '',
    county: attrs.PCL_CNTY?.trim() || '',
    buildingDesc: attrs.BLDG_DESC?.trim() || '',
    propClass: attrs.PROP_CLASS?.trim() || '',
    address: attrs.PROP_LOC?.trim() || '',
    yearBuilt: attrs.YR_CONSTR || null,
    lat: geom?.y || null,
    lng: geom?.x || null,
    objectId: attrs.OBJECTID,
  };
}

function deduplicateHOAs(parcels) {
  // Group by owner name + municipality to find unique HOAs
  const groups = {};
  
  for (const p of parcels) {
    // Normalize name
    const name = p.ownerName.toUpperCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '').trim();
    const key = `${name}|${p.municipality}`;
    
    if (!groups[key]) {
      groups[key] = {
        name: p.ownerName,
        municipality: p.municipality,
        county: p.county,
        parcels: [],
        addresses: [],
        hasStucco: false,
        buildingDescs: new Set(),
        yearBuilt: null,
        lat: null,
        lng: null,
      };
    }
    
    const g = groups[key];
    g.parcels.push(p);
    if (p.address) g.addresses.push(p.address);
    if (p.buildingDesc) g.buildingDescs.add(p.buildingDesc);
    if (p.yearBuilt && (!g.yearBuilt || p.yearBuilt < g.yearBuilt)) g.yearBuilt = p.yearBuilt;
    if (p.lat && p.lng && !g.lat) { g.lat = p.lat; g.lng = p.lng; }
    
    // Check for stucco in building description
    if (p.buildingDesc && p.buildingDesc.toUpperCase().includes('STUCCO')) {
      g.hasStucco = true;
    }
  }
  
  return Object.values(groups).map(g => ({
    name: g.name,
    municipality: g.municipality,
    county: g.county,
    parcelCount: g.parcels.length,
    addresses: [...new Set(g.addresses)].slice(0, 5), // Keep up to 5 unique addresses
    buildingDescs: [...g.buildingDescs].slice(0, 5),
    hasStucco: g.hasStucco,
    yearBuilt: g.yearBuilt,
    lat: g.lat,
    lng: g.lng,
  }));
}

async function main() {
  console.log('Querying NJGIN Parcels for HOA/association-owned properties...\n');
  
  // Load cache if exists
  let cache = {};
  if (existsSync(CACHE_FILE)) {
    cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Cache: ${Object.keys(cache).length} keyword results cached\n`);
  }
  
  let allParcels = [];
  
  for (const keyword of KEYWORDS) {
    const cacheKey = keyword;
    
    if (cache[cacheKey]) {
      console.log(`[CACHED] "${keyword}": ${cache[cacheKey].length} parcels`);
      allParcels = allParcels.concat(cache[cacheKey]);
      continue;
    }
    
    console.log(`Querying: "${keyword}"...`);
    const features = await queryAllForKeyword(keyword);
    const parcels = features.map(extractHOA);
    
    console.log(`  Found ${parcels.length} parcels`);
    
    cache[cacheKey] = parcels;
    allParcels = allParcels.concat(parcels);
    
    // Save cache after each keyword
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    
    // Small delay between queries
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\nTotal raw parcels: ${allParcels.length}`);
  
  // Deduplicate by owner name + municipality
  const uniqueHOAs = deduplicateHOAs(allParcels);
  
  console.log(`Unique HOAs/associations: ${uniqueHOAs.length}`);
  
  // Stats
  const withGeo = uniqueHOAs.filter(h => h.lat && h.lng);
  const withStucco = uniqueHOAs.filter(h => h.hasStucco);
  const counties = {};
  for (const h of uniqueHOAs) {
    counties[h.county] = (counties[h.county] || 0) + 1;
  }
  
  console.log(`With coordinates: ${withGeo.length}`);
  console.log(`With stucco: ${withStucco.length}`);
  console.log(`\nBy county:`);
  Object.entries(counties).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
    console.log(`  ${c}: ${n}`);
  });
  
  // Save
  writeFileSync(OUTPUT_FILE, JSON.stringify(uniqueHOAs, null, 2));
  console.log(`\nSaved to ${OUTPUT_FILE}`);
  
  // Also save geocoded ones for the map
  const mapData = withGeo.map(h => ({
    name: h.name,
    address: h.addresses[0] || '',
    municipality: h.municipality,
    county: h.county,
    parcelCount: h.parcelCount,
    exteriorType: h.hasStucco ? 'stucco' : 'non-stucco',
    yearBuilt: h.yearBuilt,
    lat: h.lat,
    lng: h.lng,
    buildingDesc: h.buildingDescs[0] || '',
  }));
  
  writeFileSync(join(__dirname, 'njgin-hoas-geocoded.json'), JSON.stringify(mapData, null, 2));
  console.log(`Geocoded HOAs for map: ${mapData.length}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
