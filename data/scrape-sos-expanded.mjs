/**
 * Expanded NJ SoS keyword search - break capped keywords into sub-queries.
 * For keywords that returned 100 (the cap), prepend city names or add specificity.
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

// Additional keywords to expand the search
const EXTRA_KEYWORDS = [
  // Break "homeowners association" into sub-queries
  'homeowners association inc',
  'homeowners association of',
  'homeowners association at',
  
  // Break "condominium association" 
  'condominium association inc',
  'condominium association of',
  'condominium association at',
  
  // Break "condo association"
  'condo association inc',
  'condo association of',
  'condo association at',
  
  // Break "property owners association"
  'property owners association inc',
  'property owners association of',
  
  // Break "community association"
  'community association inc',
  'community association of',
  
  // Break "civic association"
  'civic association inc',
  'civic association of',
  
  // New patterns not yet tried
  'management corp homeowner',
  'housing association',
  'residential association',
  'club association homeowner',
  'co-op housing',
  'cooperative apartments',
  'tenant association',
  'tenants association',
  'owner association',
  'owners association',
  'condo corp',
  'condominium corp',
  'planned community',
  'planned unit development',
  'homeowners corp',
  'homeowners inc',
  
  // NJ specific patterns
  'at berkeley',
  'holiday city',
  'leisure village',
  'leisure technology',
  'leisure knoll',
  'rossmoor',
  'clearbrook',
  'concordia',
  'covered bridge',
  'whittingham',
  'mutual housing',
  'twin rivers',
  'society hill',
  'fox hollow',
  
  // More association types
  'unit owners',
  'lot owners',
  'property owners inc',
  'property owners corp',
  'home association',
  'homes association',
  'homeowners league',
  'homeowner league',
  
  // Management companies often in name
  'condo management',
  'condominium management',
  'association management',
  
  // Board of trustees/directors patterns
  'trustees homeowner',
  'trustees condo',
  'directors association',
];

async function searchKeyword(page, keyword) {
  try {
    await page.goto(SOS_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1000);

    // Click "Keyword Search" tab
    const links = await page.$$('a');
    for (const link of links) {
      const text = await link.evaluate(el => el.textContent.trim());
      if (text === 'Keyword Search') {
        await link.click();
        await sleep(1000);
        break;
      }
    }

    const inputs = await page.$$('input[type="text"]');
    if (inputs.length === 0) return [];
    
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(keyword, { delay: 10 });
    await sleep(300);

    const searchBtn = await page.$('input[type="submit"], button[type="submit"]');
    if (!searchBtn) return [];

    await Promise.all([
      searchBtn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    ]);
    await sleep(2000);

    // Show 100 entries
    try {
      const selects = await page.$$('select');
      for (const select of selects) {
        await select.select('100');
        await sleep(3000);
        break;
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
    console.log(`  Error: ${e.message.substring(0, 100)}`);
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

  for (const keyword of EXTRA_KEYWORDS) {
    if (cache[keyword]) {
      console.log(`[CACHED] "${keyword}": ${cache[keyword].length}`);
      continue;
    }

    console.log(`Searching: "${keyword}"...`);
    const results = await searchKeyword(page, keyword);
    console.log(`  Found ${results.length}`);
    
    cache[keyword] = results;
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    
    await sleep(2000);
  }

  await page.close();

  // Merge ALL cache results
  let allResults = [];
  for (const results of Object.values(cache)) {
    allResults = allResults.concat(results);
  }

  // Deduplicate by entity ID
  const seen = new Map();
  for (const r of allResults) {
    if (r.entityId && !seen.has(r.entityId)) {
      seen.set(r.entityId, r);
    }
  }
  
  const unique = Array.from(seen.values());
  
  console.log(`\nTotal raw: ${allResults.length}`);
  console.log(`Unique entities: ${unique.length}`);
  
  // Filter to likely HOA entities
  const hoaKeywords = [
    'HOMEOWNER', 'HOME OWNER', 'CONDOMINIUM', 'CONDO', 'PROPERTY OWNER',
    'COMMUNITY ASSOC', 'TOWNHOUSE', 'TOWNHOME', 'COOPERATIVE', 'CO-OP',
    'VILLAGE', 'ESTATES', 'COMMONS', 'MAINTENANCE', 'UNIT OWNER',
    'LOT OWNER', 'RESIDENTS', 'HOUSING', 'TENANT', 'NEIGHBORHOOD',
    'CIVIC', 'HOA', 'H.O.A'
  ];
  
  const hoaEntities = unique.filter(r => {
    const name = r.name.toUpperCase();
    return hoaKeywords.some(k => name.includes(k));
  });
  
  console.log(`HOA-related entities: ${hoaEntities.length}`);
  
  // Cities
  const cities = {};
  for (const h of hoaEntities) {
    const city = h.city || 'Unknown';
    cities[city] = (cities[city] || 0) + 1;
  }
  
  console.log(`\nTop 25 cities:`);
  Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([c, n]) => {
    console.log(`  ${c}: ${n}`);
  });

  writeFileSync(OUTPUT_FILE, JSON.stringify(hoaEntities, null, 2));
  console.log(`\nSaved ${hoaEntities.length} HOA entities to ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
