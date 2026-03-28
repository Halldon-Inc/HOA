#!/usr/bin/env node
/**
 * Phase 1: Download MOD-IV data from NJGIN ArcGIS for exterior wall types
 * The MOD-IV/parcels composite has construction fields
 */

// NJGIN ArcGIS REST API for parcels with MOD-IV data
// This is the statewide composite — we can query it directly
const BASE_URL = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services';

// First let's find the right service and its fields
async function findServices() {
  const res = await fetch(`${BASE_URL}?f=json`);
  const data = await res.json();
  console.log('Available services:');
  for (const svc of (data.services || [])) {
    if (svc.name.toLowerCase().includes('parcel') || svc.name.toLowerCase().includes('mod') || svc.name.toLowerCase().includes('tax')) {
      console.log(`  ${svc.name} (${svc.type})`);
    }
  }
  return data.services;
}

// Query the parcels layer for condo/HOA properties with construction type
async function queryParcels(layerUrl, where, outFields, resultOffset = 0) {
  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: 'false',
    resultOffset: String(resultOffset),
    resultRecordCount: '2000',
    f: 'json'
  });
  
  const res = await fetch(`${layerUrl}/query?${params}`);
  const data = await res.json();
  return data;
}

async function main() {
  console.log('=== Phase 1: MOD-IV Exterior Wall Types ===\n');
  
  // List available services
  const services = await findServices();
  
  // Try known service names for NJ parcels
  const candidates = [
    'Parcels_Composite_MOD_IV/FeatureServer',
    'NJ_Parcels/FeatureServer', 
    'Parcels_and_MOD_IV_Composite_of_NJ/FeatureServer',
    'MOD_IV_Tax_List/FeatureServer'
  ];
  
  for (const svc of candidates) {
    try {
      const url = `${BASE_URL}/${svc}/0`;
      console.log(`\nTrying: ${url}`);
      const res = await fetch(`${url}?f=json`);
      const meta = await res.json();
      if (meta.error) {
        console.log(`  Error: ${meta.error.message}`);
        continue;
      }
      console.log(`  Name: ${meta.name}`);
      console.log(`  Fields: ${(meta.fields || []).length}`);
      
      // Look for exterior/construction/wall fields
      const interestingFields = (meta.fields || []).filter(f => {
        const n = f.name.toLowerCase();
        return n.includes('wall') || n.includes('exterior') || n.includes('construct') || 
               n.includes('material') || n.includes('class') || n.includes('type') ||
               n.includes('bldg') || n.includes('building') || n.includes('prop') ||
               n.includes('condo') || n.includes('unit') || n.includes('year');
      });
      
      console.log(`\n  Interesting fields:`);
      for (const f of interestingFields) {
        console.log(`    ${f.name} (${f.type}) — ${f.alias}`);
      }
      
      // Try a small query
      const sample = await queryParcels(url, '1=1', '*', 0);
      if (sample.features && sample.features.length > 0) {
        console.log(`\n  Sample record fields:`);
        const attrs = sample.features[0].attributes;
        for (const [k, v] of Object.entries(attrs)) {
          if (v !== null && v !== '' && v !== 0) {
            const kl = k.toLowerCase();
            if (kl.includes('wall') || kl.includes('exterior') || kl.includes('construct') || 
                kl.includes('class') || kl.includes('type') || kl.includes('bldg') ||
                kl.includes('prop') || kl.includes('addr') || kl.includes('year') ||
                kl.includes('condo') || kl.includes('unit') || kl.includes('name')) {
              console.log(`    ${k}: ${v}`);
            }
          }
        }
      }
      
      break; // Found a working service
    } catch (e) {
      console.log(`  Failed: ${e.message}`);
    }
  }
}

main().catch(console.error);
