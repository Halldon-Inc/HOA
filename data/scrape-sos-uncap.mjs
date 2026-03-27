/**
 * Bust through the 100-result cap on SoS keyword searches by:
 * 1. Breaking capped keywords with letter prefixes (A-Z)
 * 2. Adding NJ city names as additional keywords
 * 3. Mining additional association patterns
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

// Capped keywords that need letter-prefix expansion
const CAPPED_KEYWORDS = [
  'homeowners association',
  'condominium association',
  'condo association',
  'property owners association',
  'community association', 
  'civic association',
  'owners association',
  'home association',
];

// Generate sub-queries: prepend numbers and letters
function expandKeyword(keyword) {
  const prefixes = [];
  // Numbers 1-9
  for (let i = 1; i <= 9; i++) prefixes.push(`${i} ${keyword}`);
  // Letters A-Z
  for (let c = 65; c <= 90; c++) prefixes.push(`${String.fromCharCode(c)} ${keyword}`);
  // Also try "at [keyword]", "the [keyword]", "of [keyword]"
  prefixes.push(`at ${keyword}`);
  prefixes.push(`the ${keyword}`);
  return prefixes;
}

// Additional keyword patterns to try
const EXTRA_PATTERNS = [
  // Specific NJ community names
  'whispering woods',
  'shadow lake',
  'greenbriar',
  'four seasons',
  'regency',
  'renaissance',
  'pavilion',
  'harbour',
  'harbor',
  'marina',
  'waterfront',
  'bayshore',
  'shore',
  'beach club',
  'country club',
  'golf club',
  'swim club',
  // More association patterns
  'homeowners group',
  'owners group',
  'property management assoc',
  'property assoc',
  'apartment association',
  'rental association',
  'building association',
  'complex association',
  'court homeowners',
  'place homeowners',
  'lane homeowners',
  'drive homeowners',
  'terrace homeowners',
  'circle homeowners',
  'way homeowners',
  // NJ specific large communities
  'leisure world',
  'leisure tower',
  'century village',
  'silver ridge',
  'pine ridge',
  'oak ridge',
  'cedar ridge',
  'maple ridge',
  'pine lake',
  'cedar lake',
  'oak lake',
  'crystal lake',
  // Remaining geographic patterns
  'point homeowners',
  'heights homeowners',
  'hills homeowners',
  'pines homeowners',
  'oaks homeowners',
  'springs homeowners',
  'falls homeowners',
  'valley homeowners',
  'view homeowners',
  'creek homeowners',
  'brook homeowners',
  'ridge homeowners',
  'woods homeowners',
  'forest homeowners',
  'park homeowners',
  'gardens homeowners',
  'meadows homeowners',
  'manor homeowners',
  'glen homeowners',
  'village homeowners',
  'estates homeowners',
  'landing homeowners',
  'crossing homeowners',
  'square homeowners',
  'plaza homeowners',
  'pointe homeowners',
  // Condo patterns
  'point condominium',
  'heights condominium',
  'tower condominium',
  'towers condominium',
  'plaza condominium',
  'court condominium',
  'park condominium',
  'gardens condominium',
  'village condominium',
  'square condominium',
];

async function searchKeyword(page, keyword) {
  try {
    await page.goto(SOS_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(800);

    const links = await page.$$('a');
    for (const link of links) {
      const text = await link.evaluate(el => el.textContent.trim());
      if (text === 'Keyword Search') {
        await link.click();
        await sleep(800);
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

    // Show 100 entries
    try {
      const selects = await page.$$('select');
      if (selects.length > 0) {
        await selects[0].select('100');
        await sleep(2000);
      }
    } catch (e) { /* ignore */ }

    const results = await page.evaluate(() => {
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

    return results;
  } catch (e) {
    return [];
  }
}

async function main() {
  let cache = {};
  if (existsSync(CACHE_FILE)) {
    cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Cache: ${Object.keys(cache).length} keywords cached`);
  }

  const browser = await puppeteer.connect({
    browserURL: CDP_URL,
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  // Phase 1: Expand capped keywords with letter prefixes
  let newQueries = [];
  for (const keyword of CAPPED_KEYWORDS) {
    const expanded = expandKeyword(keyword);
    for (const q of expanded) {
      if (!cache[q]) newQueries.push(q);
    }
  }
  
  // Phase 2: Extra patterns
  for (const p of EXTRA_PATTERNS) {
    if (!cache[p]) newQueries.push(p);
  }

  console.log(`New queries to run: ${newQueries.length}`);
  
  let searched = 0;
  let totalNew = 0;
  
  for (const keyword of newQueries) {
    if (cache[keyword]) continue;
    
    searched++;
    if (searched % 10 === 0) {
      // Count unique so far
      const allIds = new Set();
      for (const results of Object.values(cache)) {
        for (const r of results) {
          if (r.entityId) allIds.add(r.entityId);
        }
      }
      console.log(`[${searched}/${newQueries.length}] Unique entities so far: ${allIds.size}`);
    }

    const results = await searchKeyword(page, keyword);
    
    if (results.length > 0) {
      process.stdout.write(`  "${keyword}": ${results.length}\n`);
      totalNew += results.length;
    }
    
    cache[keyword] = results;
    
    // Save cache every 20 queries
    if (searched % 20 === 0) {
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }
    
    await sleep(1500);
  }

  await page.close();
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  // Merge all results
  let allResults = [];
  for (const results of Object.values(cache)) {
    allResults = allResults.concat(results);
  }

  const seen = new Map();
  for (const r of allResults) {
    if (r.entityId && !seen.has(r.entityId)) {
      seen.set(r.entityId, r);
    }
  }
  
  const unique = Array.from(seen.values());
  
  // HOA keyword filter
  const HOA_KEYWORDS = [
    'HOMEOWNER', 'HOME OWNER', 'CONDOMINIUM', 'CONDO', 'PROPERTY OWNER',
    'COMMUNITY ASSOC', 'TOWNHOUSE', 'TOWNHOME', 'COOPERATIVE', 'CO-OP',
    'VILLAGE', 'ESTATES', 'COMMONS', 'MAINTENANCE', 'UNIT OWNER',
    'LOT OWNER', 'RESIDENTS', 'HOUSING', 'TENANT', 'NEIGHBORHOOD',
    'CIVIC', 'HOA', 'H.O.A', 'SWIM CLUB', 'COUNTRY CLUB', 'BEACH CLUB',
    'MARINA', 'SHORE', 'WATERFRONT', 'GREENBRIAR', 'FOUR SEASONS',
    'REGENCY', 'RENAISSANCE', 'PAVILION', 'HARBOUR', 'HARBOR',
    'TOWER', 'COMPLEX', 'BUILDING ASSOC', 'APARTMENT',
  ];
  
  const hoaEntities = unique.filter(r => {
    const name = r.name.toUpperCase();
    return HOA_KEYWORDS.some(k => name.includes(k));
  });
  
  console.log(`\nTotal raw: ${allResults.length}`);
  console.log(`Unique entities: ${unique.length}`);
  console.log(`HOA-related: ${hoaEntities.length}`);
  console.log(`New results from this run: ${totalNew}`);

  writeFileSync(OUTPUT_FILE, JSON.stringify(hoaEntities, null, 2));
  console.log(`\nSaved ${hoaEntities.length} HOA entities`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
