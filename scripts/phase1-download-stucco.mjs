#!/usr/bin/env node
/**
 * Download all stucco properties from NJGIN MOD-IV ArcGIS
 * Then match against our HOA addresses
 */
import fs from 'fs';

const BASE = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0';
const FIELDS = 'PROP_LOC,BLDG_DESC,BLDG_CLASS,PROP_CLASS,COUNTY,MUN_NAME,CITY_STATE,ZIP5,FAC_NAME';

async function queryAll(where, fields) {
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
    
    const res = await fetch(`${BASE}/query?${params}`);
    const data = await res.json();
    
    if (!data.features || data.features.length === 0) break;
    all.push(...data.features.map(f => f.attributes));
    
    if (data.features.length < batchSize) break;
    offset += batchSize;
    process.stdout.write(`  Downloaded ${all.length}...\r`);
  }
  
  return all;
}

async function main() {
  console.log('=== Phase 1: Downloading confirmed stucco properties ===\n');
  
  // Download ALL stucco properties
  const stuccoWhere = "BLDG_DESC LIKE 'ST%' OR BLDG_DESC LIKE '%STUC%'";
  console.log('Downloading stucco properties...');
  const stucco = await queryAll(stuccoWhere, FIELDS);
  console.log(`  Got ${stucco.length} stucco properties\n`);
  
  fs.writeFileSync('data/modiv-stucco-confirmed.json', JSON.stringify(stucco, null, 2));
  
  // Download ALL condo properties (for cross-referencing)
  console.log('Downloading condo properties (4C)...');
  const condos = await queryAll("PROP_CLASS LIKE '4C%'", FIELDS);
  console.log(`  Got ${condos.length} condo properties\n`);
  
  fs.writeFileSync('data/modiv-condos.json', JSON.stringify(condos, null, 2));
  
  // Now load our HOAs and match
  const hoaData = JSON.parse(fs.readFileSync('public/data/hoas.json', 'utf8'));
  console.log(`Our HOAs: ${hoaData.length}\n`);
  
  // Build lookup by normalized city+address
  const normalize = (s) => (s||'').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  
  const stuccoByCity = {};
  for (const s of stucco) {
    const city = normalize(s.MUN_NAME || s.CITY_STATE || '');
    if (!stuccoByCity[city]) stuccoByCity[city] = [];
    stuccoByCity[city].push(s);
  }
  
  // For each HOA, check if its city has stucco properties
  let matched = 0;
  let stuccoHoas = 0;
  let mixedHoas = 0;
  
  for (const hoa of hoaData) {
    const city = normalize(hoa.city);
    const cityStucco = stuccoByCity[city] || [];
    
    if (cityStucco.length > 0) {
      matched++;
      
      // Check address proximity
      const hoaAddr = normalize(hoa.address);
      const streetMatch = cityStucco.some(s => {
        const sAddr = normalize(s.PROP_LOC);
        // Check if same street name
        const hoaStreet = hoaAddr.replace(/^\d+\s*/, '');
        const sStreet = sAddr.replace(/^\d+\s*/, '');
        return hoaStreet && sStreet && hoaStreet === sStreet;
      });
      
      if (streetMatch) {
        hoa.exteriorType = 'stucco';
        hoa.exteriorConfirmed = true;
        hoa.exteriorSource = 'MOD-IV address match';
        stuccoHoas++;
      } else if (cityStucco.length > 20) {
        // City has significant stucco presence
        hoa.exteriorType = 'mixed';
        hoa.exteriorConfirmed = false;
        hoa.exteriorSource = 'MOD-IV city proximity (' + cityStucco.length + ' stucco in city)';
        mixedHoas++;
      }
    }
  }
  
  console.log('=== Matching Results ===');
  console.log(`HOAs in cities with stucco: ${matched}`);
  console.log(`Confirmed stucco (address match): ${stuccoHoas}`);
  console.log(`Mixed (city has stucco): ${mixedHoas}`);
  
  // Save updated data
  fs.writeFileSync('public/data/hoas.json', JSON.stringify(hoaData, null, 2));
  console.log('\nUpdated hoas.json with confirmed exterior types');
  
  // Stats
  const confirmed = hoaData.filter(h => h.exteriorConfirmed).length;
  const totalStucco = hoaData.filter(h => h.exteriorType === 'stucco').length;
  const totalMixed = hoaData.filter(h => h.exteriorType === 'mixed').length;
  console.log(`\nFinal: ${totalStucco} stucco, ${totalMixed} mixed, ${confirmed} confirmed`);
}

main().catch(console.error);
