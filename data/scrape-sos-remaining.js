#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Remaining terms from where we left off
const SEARCH_TERMS = [
  'meadows condominium',
  'landing homeowners',
  'landing condominium',
  'crossing homeowners',
  'crossing condominium',
  'pointe homeowners',
  'pointe condominium',
  'point homeowners',
  'point condominium',
  'glen homeowners',
  'glen condominium',
  'run homeowners',
  'run condominium',
  'hill homeowners',
  'hills homeowners',
  'hills condominium',
  'heights homeowners',
  'heights condominium',
  'terrace homeowners',
  'terrace condominium',
  'place homeowners',
  'place condominium',
  'square condominium',
  'square homeowners',
  // Additional terms to get more results
  'at homeowners',
  'hoa inc',
  'owners association inc',
  'condominium inc',
  'residents association',
  'tenant association',
  'tenants association',
  'housing cooperative',
  'mutual housing',
];

const OUTPUT_FILE = path.join(__dirname, 'nj-sos-raw.json');

// Load existing results
const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
const allResults = new Map();
existing.forEach(r => allResults.set(r.entityId, r));
console.log(`Loaded ${allResults.size} existing results`);

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function extractResults(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return null;
      return {
        name: (cells[0]?.textContent || '').trim(),
        entityId: (cells[1]?.textContent || '').trim(),
        city: (cells[2]?.textContent || '').trim(),
        type: (cells[3]?.textContent || '').trim(),
        dateFormed: (cells[4]?.textContent || '').trim(),
      };
    }).filter(Boolean);
  });
}

async function scrapeSearch(page, searchTerm) {
  try {
    await page.goto('https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName', {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    await delay(1000);
    const input = await page.$('#BusinessName, input[name="BusinessName"]');
    if (!input) return 0;
    await input.fill(searchTerm);
    await delay(300);
    const btn = await page.$('input[type="submit"], button[type="submit"]');
    if (btn) await btn.click(); else await input.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await delay(1500);
    
    const select = await page.$('select[name$="_length"]');
    if (select) { await select.selectOption('100'); await delay(1000); }
    
    const results = await extractResults(page);
    let newCount = 0;
    for (const r of results) {
      if (r.entityId && !allResults.has(r.entityId)) {
        r.searchTerm = searchTerm;
        allResults.set(r.entityId, r);
        newCount++;
      }
    }
    return newCount;
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return 0;
  }
}

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  
  let completed = 0;
  for (const term of SEARCH_TERMS) {
    const count = await scrapeSearch(page, term);
    completed++;
    console.log(`[${completed}/${SEARCH_TERMS.length}] "${term}" -> ${count} new (total: ${allResults.size})`);
    await delay(2500);
  }
  
  const results = Array.from(allResults.values());
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nDone! Total: ${results.length}`);
  await page.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
