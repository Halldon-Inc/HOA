#!/usr/bin/env node
/**
 * Phase 2: Scrape NJ Secretary of State for HOA registered agents/officers
 * URL: https://www.njportal.com/DOR/BusinessNameSearch
 */
import fs from 'fs';

const SEARCH_URL = 'https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName';
const DETAIL_URL = 'https://www.njportal.com/DOR/BusinessNameSearch/Search/GetEntityDetails';

// Load HOAs
const hoas = JSON.parse(fs.readFileSync('public/data/hoas.json', 'utf8'));
console.log(`Loaded ${hoas.length} HOAs\n`);

// Load existing cache
let cache = {};
try {
  cache = JSON.parse(fs.readFileSync('data/sos-officer-cache.json', 'utf8'));
  console.log(`Loaded ${Object.keys(cache).length} cached results\n`);
} catch(e) { /* no cache yet */ }

function saveCache() {
  fs.writeFileSync('data/sos-officer-cache.json', JSON.stringify(cache, null, 2));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Search for a business name and get results
async function searchBusiness(name) {
  try {
    const formData = new URLSearchParams();
    formData.append('BusinessName', name);
    formData.append('NameType', 'C'); // Contains
    
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0'
      },
      redirect: 'follow'
    });
    
    const html = await res.text();
    
    // Parse results from HTML
    const results = [];
    // Look for business entity links/data in the response
    const entityMatches = html.matchAll(/BusinessId["\s]*[:=]["\s]*(\d+)/gi);
    for (const m of entityMatches) {
      results.push(m[1]);
    }
    
    // Also look for table rows with entity data
    const nameMatches = html.matchAll(/<td[^>]*>(.*?)<\/td>/gs);
    
    return { html: html.substring(0, 500), entityIds: results };
  } catch(e) {
    return { error: e.message };
  }
}

async function main() {
  // Test with a known HOA
  const testName = 'WILLOWBROOK';
  console.log(`Testing search for: ${testName}`);
  const result = await searchBusiness(testName);
  console.log(`HTML preview: ${result.html?.substring(0, 300)}`);
  console.log(`Entity IDs found: ${result.entityIds?.length || 0}`);
  
  if (result.entityIds?.length > 0) {
    console.log('Entity IDs:', result.entityIds.slice(0, 5));
  }
}

main().catch(console.error);
