/**
 * Scrape NJ SoS Business Name Search via CDP browser automation.
 * Uses keyword search with many HOA-related terms to find thousands of associations.
 * The key insight: use the "Keyword Search" tab, not "Business Name" tab.
 * Keyword search is more flexible and returns partial matches.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, 'sos-keyword-results.json');
const CACHE_FILE = join(__dirname, 'sos-keyword-cache.json');

const CDP_URL = 'http://127.0.0.1:18800';
const SOS_URL = 'https://www.njportal.com/DOR/BusinessNameSearch';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Keywords to search for
const KEYWORDS = [
  'homeowners association',
  'homeowner association',
  'home owners association',
  'condominium association',
  'condo association',
  'property owners association',
  'community association',
  'townhouse association',
  'townhome association',
  'cooperative housing',
  'housing cooperative',
  'village association',
  'estates association',
  'commons association',
  'residents association',
  'master association',
  'maintenance association',
  'civic association',
  'neighborhood association',
  'manor association',
  'park association',
  'gardens association',
  'terrace association',
  'place association',
  'court association',
  'ridge association',
  'hill association',
  'lake association',
  'creek association',
  'brook association',
  'meadow association',
  'grove association',
  'glen association',
  'woods association',
  'forest association',
  'pointe association',
  'landing association',
  'crossing association',
  'run association',
  'square association',
  'plaza association',
];

async function searchKeyword(page, keyword) {
  try {
    // Navigate to SoS
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

    // Find and fill keyword input
    const inputs = await page.$$('input[type="text"]');
    if (inputs.length === 0) {
      console.log(`  No input found`);
      return [];
    }
    
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(keyword, { delay: 10 });
    await sleep(300);

    // Click Search button
    const searchBtn = await page.$('input[type="submit"], button[type="submit"]');
    if (!searchBtn) {
      console.log(`  No search button`);
      return [];
    }

    await Promise.all([
      searchBtn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    ]);
    await sleep(2000);

    // Show 100 entries if possible
    try {
      const selects = await page.$$('select');
      for (const select of selects) {
        const options = await select.$$('option');
        for (const opt of options) {
          const val = await opt.evaluate(el => el.value);
          if (val === '100') {
            await select.select('100');
            await sleep(3000);
            break;
          }
        }
      }
    } catch (e) { /* ignore */ }

    // Extract all results from table
    const results = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      const data = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 5) {
          const name = cells[0]?.innerText?.trim();
          if (name && name !== 'No Results Found') {
            data.push({
              name: name,
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

    // Check if there are more pages
    const totalText = await page.evaluate(() => {
      const info = document.querySelector('.dataTables_info');
      return info ? info.innerText : '';
    });

    let totalEntries = results.length;
    const match = totalText.match(/of (\d+) entries/);
    if (match) totalEntries = parseInt(match[1]);

    // If there are more results, paginate
    let allResults = [...results];
    
    if (totalEntries > 100) {
      let pages = Math.ceil(totalEntries / 100);
      if (pages > 20) pages = 20; // Cap at 2000 results per keyword
      
      for (let p = 2; p <= pages; p++) {
        try {
          const nextBtn = await page.$('.paginate_button.next:not(.disabled)');
          if (!nextBtn) break;
          
          await nextBtn.click();
          await sleep(2000);
          
          const pageResults = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr');
            const data = [];
            for (const row of rows) {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 5) {
                const name = cells[0]?.innerText?.trim();
                if (name && name !== 'No Results Found') {
                  data.push({
                    name: name,
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
          
          allResults = allResults.concat(pageResults);
        } catch (e) {
          break;
        }
      }
    }

    return allResults;
  } catch (e) {
    console.log(`  Error: ${e.message.substring(0, 100)}`);
    return [];
  }
}

async function main() {
  // Load cache
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
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  let allResults = [];
  
  for (const keyword of KEYWORDS) {
    if (cache[keyword]) {
      console.log(`[CACHED] "${keyword}": ${cache[keyword].length} results`);
      allResults = allResults.concat(cache[keyword]);
      continue;
    }

    console.log(`Searching: "${keyword}"...`);
    const results = await searchKeyword(page, keyword);
    console.log(`  Found ${results.length} entities`);
    
    cache[keyword] = results;
    allResults = allResults.concat(results);
    
    // Save cache
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    
    await sleep(2000); // Be gentle
  }

  await page.close();

  // Deduplicate by entity ID
  const seen = new Map();
  for (const r of allResults) {
    if (r.entityId && !seen.has(r.entityId)) {
      seen.set(r.entityId, r);
    }
  }
  
  const unique = Array.from(seen.values());
  
  // Filter to NJ HOA-like entities (NP = nonprofit, mostly)
  const hoaTypes = unique.filter(r => 
    ['NP', 'DP', 'LLC', 'PA'].includes(r.type)
  );

  console.log(`\nTotal raw results: ${allResults.length}`);
  console.log(`Unique entities: ${unique.length}`);
  console.log(`HOA-type entities: ${hoaTypes.length}`);
  
  // County distribution
  const cities = {};
  for (const h of unique) {
    cities[h.city || 'Unknown'] = (cities[h.city || 'Unknown'] || 0) + 1;
  }
  
  console.log(`\nTop cities:`);
  Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([c, n]) => {
    console.log(`  ${c}: ${n}`);
  });

  writeFileSync(OUTPUT_FILE, JSON.stringify(unique, null, 2));
  console.log(`\nSaved ${unique.length} unique entities to ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
