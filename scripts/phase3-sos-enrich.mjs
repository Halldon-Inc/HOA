#!/usr/bin/env node
/**
 * Phase 3: Search NJ SoS Business Name Search for HOAs without entityId.
 * Uses Chrome CDP on port 18800 to automate the search form.
 * Caches results to data/sos-entity-cache.json.
 * Rate limited to 2s between searches.
 */
import fs from 'fs';
import WebSocket from 'ws';

const HOAS_FILE = 'public/data/hoas.json';
const CACHE_FILE = 'data/sos-entity-cache.json';
const SOS_URL = 'https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName';
const BATCH_SIZE = parseInt(process.argv[2] || '50', 10);
const RATE_LIMIT_MS = 2000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Load or init cache
function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
  return {};
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Get a browser tab via CDP
async function getTab() {
  const res = await fetch('http://127.0.0.1:18800/json');
  const tabs = await res.json();
  // Prefer a non-Gmail page tab; fall back to any page tab
  const EXCLUDED_TAB = 'DF949FA2B1CCB0FB8F14D28278EA0C30';
  const tab = tabs.find(t => t.type === 'page' && t.id !== EXCLUDED_TAB && !t.url.includes('mail.google.com') && !t.url.includes('chat.google.com') && !t.url.includes('twitter.com') && !t.url.includes('x.com'))
    || tabs.find(t => t.type === 'page' && t.id !== EXCLUDED_TAB);
  if (!tab) throw new Error('No browser tab found. Start Chrome with --remote-debugging-port=18800');
  return tab;
}

// Send a CDP command and wait for response
let msgId = 1;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000);

    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Evaluate JS in the browser page and return value
async function evaluate(ws, expression) {
  const result = await cdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`JS error: ${result.exceptionDetails.text}`);
  }
  return result.result?.value;
}

// Clean HOA name for search (strip common suffixes for broader match)
function cleanName(name) {
  return name
    .replace(/\s+(inc\.?|incorporated|llc|corp\.?|corporation|a nj nonprofit corporation)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Search SoS for a single HOA name
async function searchSoS(ws, hoaName) {
  const searchName = cleanName(hoaName);

  // Navigate to search page
  await cdp(ws, 'Page.navigate', { url: SOS_URL });
  await sleep(2500);

  // Clear input field and type the search name
  const inputResult = await evaluate(ws, `
    (() => {
      const input = document.querySelector('#BusinessName')
        || document.querySelector('input[name="BusinessName"]')
        || document.querySelector('input[type="text"]');
      if (!input) return JSON.stringify({ error: 'no input found' });
      input.value = '';
      input.focus();
      input.value = ${JSON.stringify(searchName)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ ok: true, inputId: input.id });
    })()
  `);

  const inputInfo = JSON.parse(inputResult);
  if (inputInfo.error) {
    console.error(`  Input error for "${searchName}":`, inputInfo.error);
    return null;
  }

  // Click search/submit button
  await evaluate(ws, `
    (() => {
      const btn = document.querySelector('input[type="submit"]')
        || document.querySelector('button[type="submit"]')
        || document.querySelector('.btn-primary');
      if (btn) btn.click();
      return btn ? 'clicked' : 'no button';
    })()
  `);

  // Wait for results to load
  await sleep(3000);

  // Extract table results
  const rawResults = await evaluate(ws, `
    (() => {
      const rows = document.querySelectorAll('table tbody tr');
      if (rows.length === 0) {
        // Check for "no results" message
        const body = document.body.innerText;
        if (body.includes('No Records Found') || body.includes('no records') || body.includes('No results')) {
          return JSON.stringify({ results: [], noResults: true });
        }
        // Maybe results are in a different structure
        const allTables = document.querySelectorAll('table');
        if (allTables.length === 0) {
          return JSON.stringify({ results: [], noResults: true, hint: 'no tables' });
        }
        // Try the last table
        const lastTable = allTables[allTables.length - 1];
        const trs = lastTable.querySelectorAll('tr');
        const entities = [];
        for (let i = 1; i < trs.length; i++) {
          const cells = trs[i].querySelectorAll('td');
          if (cells.length >= 4) {
            entities.push({
              name: cells[0]?.textContent?.trim(),
              entityId: cells[1]?.textContent?.trim(),
              city: cells[2]?.textContent?.trim(),
              type: cells[3]?.textContent?.trim(),
              dateFormed: cells[4]?.textContent?.trim() || '',
              status: cells[5]?.textContent?.trim() || '',
            });
          }
        }
        return JSON.stringify({ results: entities });
      }

      const entities = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
          entities.push({
            name: cells[0]?.textContent?.trim(),
            entityId: cells[1]?.textContent?.trim(),
            city: cells[2]?.textContent?.trim(),
            type: cells[3]?.textContent?.trim(),
            dateFormed: cells[4]?.textContent?.trim() || '',
            status: cells[5]?.textContent?.trim() || '',
          });
        }
      });
      return JSON.stringify({ results: entities });
    })()
  `);

  return JSON.parse(rawResults);
}

// Find the best match from SoS results for a given HOA name
function findBestMatch(hoaName, results) {
  if (!results || results.length === 0) return null;
  const target = hoaName.toUpperCase();

  // Exact match first
  const exact = results.find(r => r.name?.toUpperCase() === target);
  if (exact) return exact;

  // Contains match (entity name contains HOA name or vice versa)
  const contains = results.find(r => {
    const rName = r.name?.toUpperCase() || '';
    return rName.includes(target) || target.includes(rName);
  });
  if (contains) return contains;

  // Fuzzy: compare key words
  const targetWords = target.split(/\s+/).filter(w => w.length > 2);
  let bestScore = 0;
  let bestMatch = null;
  for (const r of results) {
    const rWords = (r.name || '').toUpperCase().split(/\s+/).filter(w => w.length > 2);
    const overlap = targetWords.filter(w => rWords.includes(w)).length;
    const score = overlap / Math.max(targetWords.length, rWords.length);
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = r;
    }
  }
  return bestMatch;
}

async function main() {
  console.log(`Phase 3: SoS Entity Enrichment (batch size: ${BATCH_SIZE})`);

  const hoas = JSON.parse(fs.readFileSync(HOAS_FILE, 'utf8'));
  const cache = loadCache();

  // Find HOAs without entityId that are not yet cached
  const needSearch = hoas
    .filter(h => !h.entityId)
    .filter(h => !(h.name in cache))
    .slice(0, BATCH_SIZE);

  console.log(`HOAs without entityId: ${hoas.filter(h => !h.entityId).length}`);
  console.log(`Already cached: ${Object.keys(cache).length}`);
  console.log(`Will search: ${needSearch.length}`);

  if (needSearch.length === 0) {
    console.log('Nothing to search. Applying cached results...');
    applyCache(hoas, cache);
    return;
  }

  // Connect to browser
  const tab = await getTab();
  console.log(`Connected to tab: ${tab.title}`);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  await cdp(ws, 'Page.enable');

  let found = 0;
  let notFound = 0;

  for (let i = 0; i < needSearch.length; i++) {
    const hoa = needSearch[i];
    const pct = ((i + 1) / needSearch.length * 100).toFixed(0);
    process.stdout.write(`[${i + 1}/${needSearch.length} ${pct}%] "${hoa.name}" ... `);

    try {
      const searchResult = await searchSoS(ws, hoa.name);
      const results = searchResult?.results || [];
      const match = findBestMatch(hoa.name, results);

      if (match) {
        cache[hoa.name] = {
          entityId: match.entityId,
          entityName: match.name,
          city: match.city,
          type: match.type,
          dateFormed: match.dateFormed,
          status: match.status,
          searchedAt: new Date().toISOString(),
        };
        found++;
        console.log(`FOUND -> ${match.entityId} (${match.name})`);
      } else {
        cache[hoa.name] = { noMatch: true, resultCount: results.length, searchedAt: new Date().toISOString() };
        notFound++;
        console.log(`no match (${results.length} results)`);
      }

      saveCache(cache);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      cache[hoa.name] = { error: err.message, searchedAt: new Date().toISOString() };
      saveCache(cache);
    }

    // Rate limit
    if (i < needSearch.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  ws.close();
  console.log(`\nDone. Found: ${found}, Not found: ${notFound}`);
  console.log('Applying cached results to HOA data...');
  applyCache(hoas, cache);
}

function applyCache(hoas, cache) {
  let enriched = 0;
  for (const hoa of hoas) {
    if (hoa.entityId) continue;
    const cached = cache[hoa.name];
    if (cached && cached.entityId) {
      hoa.entityId = cached.entityId;
      hoa.entityType = cached.type || 'NP';
      hoa.dateFormed = cached.dateFormed || null;
      if (cached.city && !hoa.municipality) {
        hoa.municipality = cached.city;
      }
      enriched++;
    }
  }
  fs.writeFileSync(HOAS_FILE, JSON.stringify(hoas, null, 2));
  console.log(`Enriched ${enriched} HOAs with SoS entity data.`);
  console.log(`Total HOAs with entityId: ${hoas.filter(h => h.entityId).length}/${hoas.length}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
