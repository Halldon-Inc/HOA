/**
 * Targeted SoS scraping for highest-yield queries.
 * Focus on large residential cities and varied entity name patterns.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, 'sos-keyword-cache.json');
const OUTPUT_FILE = join(__dirname, 'sos-keyword-results.json');
const CDP_URL = 'http://127.0.0.1:18800';
const SOS_URL = 'https://www.njportal.com/DOR/BusinessNameSearch';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// These queries are most likely to find NEW entities
const QUERIES = [
  // Geographic patterns that catch named communities
  'at riverfront', 'at waterfront', 'at the shore',
  'on the hudson', 'on the river', 'by the sea',
  
  // Common NJ development names
  'the grande', 'the enclave', 'the preserve', 'the reserve',
  'the crossing', 'the summit', 'the plaza', 'the point',
  'the landings', 'the mews', 'the crest', 'the heights',
  'the commons', 'the gardens', 'the terrace',
  'the villas', 'the courts', 'the arbors',
  
  // Numbered developments
  'one hundred', 'two hundred', 'three hundred',
  'tower one', 'tower two', 'building one',
  
  // HOA management keywords
  'maintenance association', 'maintenance corp',
  'maintenance fund', 'unit owners',
  'lot owners', 'section owners',
  'tenant association', 'tenant corp',
  'resident association', 'resident council',
  'building association', 'building corp',
  
  // Senior/55+ communities (huge HOAs in NJ)
  'adult community', 'senior living',
  'retirement village', 'retirement community',
  'active adult', 'age restricted',
  'over 55', '55 and over', '55 plus',
  'golden years', 'leisure tower',
  
  // Specific NJ mega-communities
  'clearbrook', 'concordia', 'whittingham',
  'covered bridge', 'rossmoor', 'holiday city',
  'silver ridge', 'leisure village',
  'four seasons', 'greenbriar',
  'foxmoor', 'society hill', 'twin rivers',
  
  // Shore communities (huge condo market)
  'beach club', 'shore club', 'yacht club',
  'marina bay', 'harbor view', 'ocean view',
  'bayfront', 'waterside', 'riverside',
  'lakeside', 'pondside', 'creekside',
  
  // Development company patterns
  'associates homeowners', 'developers homeowners',
  'builders homeowners', 'partners homeowners',
  'management homeowners', 'realty homeowners',
  
  // More association patterns
  'neighborhood assoc', 'block assoc',
  'improvement assoc', 'betterment assoc',
  'beautification assoc',
  'area homeowners', 'zone homeowners',
  'district homeowners', 'section homeowners',
  'phase homeowners', 'cluster homeowners',
  
  // Cooperative housing (big in NJ)
  'cooperative housing', 'housing cooperative',
  'housing corp', 'housing assoc',
  'cooperative apartments', 'co-op apartments',
  'mutual housing',
];

async function searchKeyword(page, keyword) {
  try {
    await page.goto(SOS_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(600);

    const links = await page.$$('a');
    for (const link of links) {
      const text = await link.evaluate(el => el.textContent.trim());
      if (text === 'Keyword Search') {
        await link.click();
        await sleep(600);
        break;
      }
    }

    const inputs = await page.$$('input[type="text"]');
    if (inputs.length === 0) return [];
    
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(keyword, { delay: 5 });
    await sleep(200);

    const searchBtn = await page.$('input[type="submit"], button[type="submit"]');
    if (!searchBtn) return [];

    await Promise.all([
      searchBtn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    ]);
    await sleep(1500);

    try {
      const selects = await page.$$('select');
      if (selects.length > 0) {
        await selects[0].select('100');
        await sleep(2000);
      }
    } catch (e) {}

    return await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      const data = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 5) {
          const name = cells[0]?.innerText?.trim();
          if (name && name !== 'No Results Found') {
            data.push({
              name,
              entityId: cells[1]?.innerText?.trim() || '',
              city: cells[2]?.innerText?.trim() || '',
              type: cells[3]?.innerText?.trim() || '',
              dateFormed: cells[4]?.innerText?.trim() || '',
            });
          }
        }
      }
      return data;
    });
  } catch (e) {
    return [];
  }
}

async function main() {
  let cache = {};
  if (existsSync(CACHE_FILE)) {
    cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  }
  
  // Count existing unique
  const existingIds = new Set();
  for (const results of Object.values(cache)) {
    for (const r of results) if (r.entityId) existingIds.add(r.entityId);
  }
  console.log(`Starting with ${existingIds.size} unique entities from ${Object.keys(cache).length} keywords`);

  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  const newQueries = QUERIES.filter(q => !cache[q]);
  console.log(`New queries: ${newQueries.length}`);

  let searched = 0;
  let newFound = 0;

  for (const keyword of newQueries) {
    searched++;
    const results = await searchKeyword(page, keyword);
    
    // Count truly new entities
    let newInBatch = 0;
    for (const r of results) {
      if (r.entityId && !existingIds.has(r.entityId)) {
        existingIds.add(r.entityId);
        newInBatch++;
      }
    }
    
    if (results.length > 0) {
      const cap = results.length >= 100 ? ' [CAPPED]' : '';
      console.log(`  "${keyword}": ${results.length} (${newInBatch} new)${cap}`);
      newFound += newInBatch;
    }
    
    cache[keyword] = results;
    
    if (searched % 20 === 0) {
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
      console.log(`[${searched}/${newQueries.length}] Total unique: ${existingIds.size} (+${newFound} new)`);
    }
    
    await sleep(1200);
  }

  await page.close();
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  // Rebuild output
  let allResults = [];
  for (const results of Object.values(cache)) allResults = allResults.concat(results);
  
  const seen = new Map();
  for (const r of allResults) {
    if (r.entityId && !seen.has(r.entityId)) seen.set(r.entityId, r);
  }

  const HOA_KEYWORDS = [
    'HOMEOWNER', 'HOME OWNER', 'CONDOMINIUM', 'CONDO', 'PROPERTY OWNER',
    'COMMUNITY ASSOC', 'TOWNHOUSE', 'TOWNHOME', 'COOPERATIVE', 'CO-OP',
    'VILLAGE', 'ESTATES', 'COMMONS', 'MAINTENANCE', 'UNIT OWNER',
    'LOT OWNER', 'RESIDENTS', 'HOUSING', 'TENANT', 'NEIGHBORHOOD',
    'CIVIC', 'HOA', 'H.O.A', 'SWIM CLUB', 'COUNTRY CLUB',
    'SENIOR', 'RETIREMENT', 'ADULT COMMUNITY', 'TOWER', 'COMPLEX',
    'MARINA', 'SHORE', 'WATERFRONT', 'CLUB', 'MUTUAL',
    'PRESERVATION', 'IMPROVEMENT', 'BUILDING ASSOC', 'APARTMENT',
    'ENCLAVE', 'PRESERVE', 'RESERVE', 'CROSSING', 'LANDING',
    'MEWS', 'CREST', 'HEIGHTS', 'GARDENS', 'TERRACE', 'VILLAS',
    'COURTS', 'ARBORS', 'PLAZA', 'GRANDE',
  ];

  const hoaEntities = Array.from(seen.values()).filter(r => {
    const name = r.name.toUpperCase();
    return HOA_KEYWORDS.some(k => name.includes(k));
  });

  console.log(`\nFinal: ${seen.size} unique entities, ${hoaEntities.length} HOA-related`);
  console.log(`New entities found this run: ${newFound}`);

  writeFileSync(OUTPUT_FILE, JSON.stringify(hoaEntities, null, 2));
  console.log(`Saved ${hoaEntities.length} HOA entities`);
}

main().catch(console.error);
