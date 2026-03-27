/**
 * Final push: more SoS keywords targeting capped terms and new patterns.
 * Focus on specific geographic names and building types.
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

const QUERIES = [
  // Break "by the sea" cap with more specific sea/shore terms
  'by the bay', 'by the lake', 'by the creek', 'by the pond',
  'by the brook', 'by the river', 'by the park', 'by the woods',
  'by the beach', 'by the ocean', 'by the canal',
  
  // Break "building association" cap
  'building management', 'building owners', 'building fund',
  'building committee', 'building board',
  
  // More residential types
  'townhome', 'town home', 'garden apartment',
  'row house', 'rowhouse', 'duplex',
  'co-operative', 'cooperative housing',
  'mutual aid', 'mutual benefit',
  
  // Named patterns (NJ specific)
  'eagle ridge', 'deer run', 'fox run', 'hunters run',
  'eagle point', 'cedar point', 'pine point', 'oak point',
  'stone gate', 'iron gate', 'north gate', 'south gate',
  'east gate', 'west gate', 'main gate',
  'mill pond', 'mill run', 'mill creek',
  'spring meadow', 'spring valley', 'spring hill',
  'autumn ridge', 'winter ridge', 'summer ridge',
  'grand view', 'lake view', 'bay view', 'park view',
  'hill top', 'hilltop', 'hill crest', 'hillcrest',
  'windsor', 'princeton', 'cambridge', 'oxford',
  'nottingham', 'buckingham', 'hamilton', 'georgetown',
  'colonial', 'patriot', 'liberty', 'heritage',
  'presidential', 'executive', 'imperial', 'royal',
  
  // Water features (NJ has tons)
  'canal walk', 'canal point', 'canal view',
  'river edge', 'river walk', 'river view',
  'lake shore', 'lakeshore', 'sea shore',
  'bay shore', 'bayshore', 'bay walk',
  'harbour', 'harbor house', 'harbor point',
  'pier village', 'pier point', 'dock',
  'inlet', 'cove', 'estuary',
  
  // More condo patterns
  'metropolitan', 'cosmopolitan', 'renaissance at',
  'residences at', 'lofts at', 'flats at',
  'towers at', 'place at', 'plaza at',
  'park at', 'gardens at', 'village at',
  
  // Corporate structure variations
  'association inc', 'association corp',
  'association llc', 'association ltd',
  'council inc', 'council of',
  'board of', 'committee of',
];

async function searchKeyword(page, keyword) {
  try {
    await page.goto(SOS_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(600);

    const links = await page.$$('a');
    for (const link of links) {
      const text = await link.evaluate(el => el.textContent.trim());
      if (text === 'Keyword Search') { await link.click(); await sleep(600); break; }
    }

    const inputs = await page.$$('input[type="text"]');
    if (!inputs.length) return [];
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(keyword, { delay: 5 });
    await sleep(200);

    const btn = await page.$('input[type="submit"], button[type="submit"]');
    if (!btn) return [];
    await Promise.all([
      btn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    ]);
    await sleep(1500);

    try {
      const selects = await page.$$('select');
      if (selects.length) { await selects[0].select('100'); await sleep(2000); }
    } catch (e) {}

    return await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      return [...rows].map(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) return null;
        const name = cells[0]?.innerText?.trim();
        if (!name || name === 'No Results Found') return null;
        return {
          name,
          entityId: cells[1]?.innerText?.trim() || '',
          city: cells[2]?.innerText?.trim() || '',
          type: cells[3]?.innerText?.trim() || '',
          dateFormed: cells[4]?.innerText?.trim() || '',
        };
      }).filter(Boolean);
    });
  } catch (e) { return []; }
}

async function main() {
  let cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
  const existingIds = new Set();
  for (const results of Object.values(cache))
    for (const r of results) if (r.entityId) existingIds.add(r.entityId);
  
  console.log(`Starting: ${existingIds.size} unique entities, ${Object.keys(cache).length} keywords`);

  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

  const newQ = QUERIES.filter(q => !cache[q]);
  console.log(`New queries: ${newQ.length}`);

  let searched = 0, newFound = 0;
  for (const kw of newQ) {
    searched++;
    const results = await searchKeyword(page, kw);
    let nb = 0;
    for (const r of results) {
      if (r.entityId && !existingIds.has(r.entityId)) { existingIds.add(r.entityId); nb++; }
    }
    if (results.length > 0)
      console.log(`  "${kw}": ${results.length} (${nb} new)${results.length >= 100 ? ' [CAPPED]' : ''}`);
    cache[kw] = results;
    newFound += nb;
    if (searched % 20 === 0) {
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
      console.log(`[${searched}/${newQ.length}] Total: ${existingIds.size} (+${newFound} new)`);
    }
    await sleep(1200);
  }

  await page.close();
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  // Rebuild HOA output
  let all = [];
  for (const r of Object.values(cache)) all = all.concat(r);
  const seen = new Map();
  for (const r of all) if (r.entityId && !seen.has(r.entityId)) seen.set(r.entityId, r);

  const HOA_KW = [
    'HOMEOWNER', 'HOME OWNER', 'CONDOMINIUM', 'CONDO', 'PROPERTY OWNER',
    'COMMUNITY ASSOC', 'TOWNHOUSE', 'TOWNHOME', 'COOPERATIVE', 'CO-OP',
    'VILLAGE', 'ESTATES', 'COMMONS', 'MAINTENANCE', 'UNIT OWNER',
    'LOT OWNER', 'RESIDENTS', 'HOUSING', 'TENANT', 'NEIGHBORHOOD',
    'CIVIC', 'HOA', 'SWIM CLUB', 'COUNTRY CLUB', 'TOWER', 'COMPLEX',
    'MARINA', 'SHORE', 'WATERFRONT', 'CLUB', 'MUTUAL', 'BUILDING ASSOC',
    'ENCLAVE', 'PRESERVE', 'RESERVE', 'CROSSING', 'LANDING', 'MEWS',
    'CREST', 'HEIGHTS', 'GARDENS', 'TERRACE', 'VILLAS', 'COURTS',
    'ARBORS', 'PLAZA', 'GRANDE', 'SENIOR', 'RETIREMENT', 'APARTMENT',
    'LOFTS', 'FLATS', 'RESIDENCES', 'METROPOLITAN', 'PIER',
    'INLET', 'COVE', 'HARBOUR', 'HARBOR', 'DOCK',
    'RIDGE', 'GATE', 'POINT', 'WALK', 'VIEW',
  ];
  
  const hoaEntities = Array.from(seen.values()).filter(r =>
    HOA_KW.some(k => r.name.toUpperCase().includes(k))
  );

  console.log(`\nFinal: ${seen.size} unique, ${hoaEntities.length} HOA-related (+${newFound} new)`);
  writeFileSync(OUTPUT_FILE, JSON.stringify(hoaEntities, null, 2));
}

main().catch(console.error);
