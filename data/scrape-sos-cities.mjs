/**
 * Break through 100-result cap by searching city-specific keywords.
 * If "homeowners association" returns 100, then:
 *   "jersey city homeowners" returns a subset
 *   "toms river homeowners" returns another subset
 * etc.
 * 
 * Also searches broader patterns that might catch HOAs not named "association"
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

// Major NJ cities/towns to use as search qualifiers
const NJ_CITIES = [
  'jersey city', 'newark', 'paterson', 'elizabeth', 'lakewood',
  'toms river', 'trenton', 'clifton', 'passaic', 'union city',
  'bayonne', 'east orange', 'vineland', 'north bergen', 'hoboken',
  'perth amboy', 'plainfield', 'hackensack', 'kearny', 'linden',
  'west new york', 'atlantic city', 'long branch', 'garfield',
  'westfield', 'millville', 'bloomfield', 'montclair', 'maplewood',
  'belleville', 'nutley', 'irvington', 'orange', 'south orange',
  'east brunswick', 'north brunswick', 'old bridge', 'woodbridge',
  'edison', 'piscataway', 'new brunswick', 'south brunswick',
  'middletown', 'marlboro', 'manalapan', 'freehold', 'howell',
  'jackson', 'brick', 'lacey', 'stafford', 'barnegat',
  'cherry hill', 'camden', 'gloucester', 'voorhees', 'haddonfield',
  'moorestown', 'mount laurel', 'burlington', 'willingboro',
  'hamilton', 'princeton', 'ewing', 'lawrence', 'west windsor',
  'bridgewater', 'somerville', 'hillsborough', 'franklin',
  'morris', 'morristown', 'parsippany', 'denville', 'randolph',
  'wayne', 'totowa', 'little falls', 'woodland park',
  'ridgewood', 'paramus', 'fair lawn', 'bergenfield', 'teaneck',
  'hackensack', 'fort lee', 'englewood', 'palisades park',
  'secaucus', 'north arlington', 'rutherford', 'lyndhurst',
  'wildwood', 'north wildwood', 'wildwood crest', 'cape may',
  'ocean city', 'sea isle city', 'avalon', 'stone harbor',
  'ventnor', 'margate', 'longport', 'brigantine',
  'manahawkin', 'waretown', 'forked river', 'lanoka harbor',
  'point pleasant', 'seaside heights', 'seaside park',
  'red bank', 'asbury park', 'belmar', 'spring lake',
  'monmouth beach', 'deal', 'long branch', 'eatontown',
  'tinton falls', 'holmdel', 'colts neck', 'rumson',
  'sparta', 'vernon', 'west milford', 'ringwood',
  'monroe', 'cranbury', 'plainsboro', 'east windsor',
  'robbinsville', 'bordentown',
];

// Core HOA keywords to combine with cities
const HOA_BASES = [
  'homeowners',
  'condominium',
  'condo',
  'property owners',
  'community assoc',
  'civic association',
  'cooperative',
  'townhouse',
];

// Additional standalone keywords
const STANDALONE = [
  'homeowners org',
  'property owners org',
  'community org',
  'neighborhood org',
  'association management',
  'common interest',
  'residential complex',
  'residential community',
  'gated community',
  'adult community',
  'senior community',
  'retirement community',
  'age restricted',
  'over 55',
  '55 plus',
  '55 and over',
  'active adult',
  // NJ senior communities (huge HOAs)
  'leisure village',
  'leisure park',
  'leisure knoll',
  'rossmoor',
  'clearbrook',
  'concordia monroe',
  'greenbriar',
  'greenbriar woodlands',
  'four seasons',
  'holiday city',
  'holiday heights',
  'silver ridge',
  'pine ridge',
  'cedar glen',
  'cedar village',
  'whittingham',
  'covered bridge',
  'twin rivers',
  'society hill',
  'foxmoor',
  'fox hollow',
  'renaissance',
  'regency',
  'pavilion',
  'harbour cove',
  'bayberry',
  'cranberry',
  'holly hills',
  'the ponds',
  'the willows',
  'the oaks',
  'the pines',
  'the elms',
  'the maples',
  'the birches',
  'the cedars',
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

  // Build query list: city + HOA base combinations
  const queries = [];
  
  // City + base keyword combos (only for keywords that were capped)
  for (const city of NJ_CITIES) {
    for (const base of HOA_BASES) {
      const q = `${city} ${base}`;
      if (!cache[q]) queries.push(q);
    }
  }
  
  // Standalone keywords
  for (const q of STANDALONE) {
    if (!cache[q]) queries.push(q);
  }
  
  console.log(`Queries to run: ${queries.length}`);
  
  let searched = 0;
  
  for (const keyword of queries) {
    if (cache[keyword]) continue;
    searched++;
    
    if (searched % 20 === 0) {
      const allIds = new Set();
      for (const results of Object.values(cache)) {
        for (const r of results) if (r.entityId) allIds.add(r.entityId);
      }
      console.log(`[${searched}/${queries.length}] Unique: ${allIds.size}`);
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }

    const results = await searchKeyword(page, keyword);
    if (results.length > 0) {
      process.stdout.write(`  "${keyword}": ${results.length}${results.length >= 100 ? ' [CAPPED]' : ''}\n`);
    }
    
    cache[keyword] = results;
    await sleep(1200);
  }

  await page.close();
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  // Merge all
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
  
  const HOA_KEYWORDS = [
    'HOMEOWNER', 'HOME OWNER', 'CONDOMINIUM', 'CONDO', 'PROPERTY OWNER',
    'COMMUNITY ASSOC', 'TOWNHOUSE', 'TOWNHOME', 'COOPERATIVE', 'CO-OP',
    'VILLAGE', 'ESTATES', 'COMMONS', 'MAINTENANCE', 'UNIT OWNER',
    'LOT OWNER', 'RESIDENTS', 'HOUSING', 'TENANT', 'NEIGHBORHOOD',
    'CIVIC', 'HOA', 'H.O.A', 'SWIM CLUB', 'COUNTRY CLUB',
    'SENIOR', 'RETIREMENT', 'ADULT COMMUNITY', 'OVER 55',
    'TOWER', 'COMPLEX', 'APARTMENT', 'GATED',
  ];
  
  const hoaEntities = unique.filter(r => {
    const name = r.name.toUpperCase();
    return HOA_KEYWORDS.some(k => name.includes(k));
  });
  
  console.log(`\nTotal raw: ${allResults.length}`);
  console.log(`Unique: ${unique.length}`);
  console.log(`HOA-related: ${hoaEntities.length}`);

  writeFileSync(OUTPUT_FILE, JSON.stringify(hoaEntities, null, 2));
  console.log(`Saved ${hoaEntities.length} HOA entities`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
