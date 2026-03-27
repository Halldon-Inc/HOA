#!/usr/bin/env node
/**
 * Break down capped SoS keywords by adding city/county prefixes
 * to find entities beyond the 100-result cap.
 */
import fs from 'fs';

const SOS_URL = 'https://www.njportal.com/DOR/BusinessNameSearch/api/BusinessNameSearch/SearchByName';

// Top NJ cities to use as prefixes
const NJ_CITIES = [
  'jersey city', 'newark', 'paterson', 'elizabeth', 'trenton',
  'clifton', 'passaic', 'union city', 'bayonne', 'east orange',
  'vineland', 'new brunswick', 'hoboken', 'perth amboy', 'plainfield',
  'hackensack', 'sayreville', 'kearny', 'linden', 'atlantic city',
  'long branch', 'west new york', 'rahway', 'toms river', 'lakewood',
  'brick', 'cherry hill', 'edison', 'woodbridge', 'hamilton',
  'princeton', 'freehold', 'morristown', 'montclair', 'ridgewood',
  'wayne', 'parsippany', 'livingston', 'nutley', 'bloomfield',
  'west orange', 'maplewood', 'south orange', 'millburn', 'summit',
  'westfield', 'cranford', 'scotch plains', 'red bank', 'asbury park',
  'point pleasant', 'seaside', 'wildwood', 'cape may', 'ocean city',
  'margate', 'ventnor', 'brigantine', 'somers point', 'egg harbor',
];

// Focus on HOA-specific keywords that are capped
const HOA_KEYWORDS = [
  'homeowners association',
  'condominium association',
  'condo association',
  'property owners association',
  'community association',
  'owners association',
  'home association',
];

async function searchSoS(query) {
  const resp = await fetch(SOS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      BusinessName: query,
      BusinessType: '',
      BusinessStatus: '',
      PageNumber: 1,
      PageSize: 100,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await resp.json();
  return data.Items || data.items || [];
}

async function main() {
  // Load keyword cache
  const cache = JSON.parse(fs.readFileSync('sos-keyword-cache.json', 'utf8'));
  const allEntities = new Map();
  
  // Collect existing
  for (const [keyword, entities] of Object.entries(cache)) {
    for (const e of entities) {
      allEntities.set(e.entityId, e);
    }
  }
  const startCount = allEntities.size;
  console.log(`Starting entities: ${startCount}`);
  
  let queriesRun = 0;
  let newFound = 0;
  
  // Break down capped HOA keywords with city prefixes
  for (const keyword of HOA_KEYWORDS) {
    const existing = cache[keyword] || [];
    if (existing.length < 100) {
      console.log(`Skipping "${keyword}" (${existing.length} results, not capped)`);
      continue;
    }
    
    console.log(`\nBreaking down "${keyword}" (capped at ${existing.length}):`);
    
    for (const city of NJ_CITIES) {
      const query = `${city} ${keyword}`;
      if (cache[query]) continue; // Already searched
      
      try {
        const results = await searchSoS(query);
        cache[query] = results;
        queriesRun++;
        
        let cityNew = 0;
        for (const e of results) {
          if (!allEntities.has(e.entityId)) {
            allEntities.set(e.entityId, e);
            cityNew++;
            newFound++;
          }
        }
        
        if (results.length > 0) {
          console.log(`  "${query}": ${results.length} results (${cityNew} new)`);
        }
        
        // Rate limit
        await new Promise(r => setTimeout(r, 1200));
        
      } catch (err) {
        console.error(`  Error for "${query}": ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  
  console.log(`\nQueries run: ${queriesRun}`);
  console.log(`New entities found: ${newFound}`);
  console.log(`Total entities: ${allEntities.size} (was ${startCount})`);
  
  // Save updated cache
  fs.writeFileSync('sos-keyword-cache.json', JSON.stringify(cache, null, 2));
  
  // Save all results
  const allResults = [...allEntities.values()];
  fs.writeFileSync('sos-keyword-results.json', JSON.stringify(allResults));
  console.log(`Saved ${allResults.length} entities to sos-keyword-results.json`);
}

main().catch(console.error);
