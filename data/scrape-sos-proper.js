#!/usr/bin/env node
/**
 * NJ SoS HOA Scraper - Proper version
 * Extracts: name, entityId, city, type, dateFormed
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// More targeted search terms that will match NJ business name starts
const SEARCH_TERMS = [
  // Direct HOA terms
  'homeowners association',
  'homeowner association',
  'home owners association',
  // Condo terms  
  'condominium association',
  'condominium owners',
  'condo association',
  'condo owners',
  // Property/community
  'property owners association',
  'property owners inc',
  'community association',
  'civic association',
  // Townhome/house
  'townhome association',
  'townhouse association',
  'townhome owners',
  'townhouse owners',
  // Maintenance
  'maintenance corporation',
  'maintenance association',
  'maintenance inc',
  // Unit owners
  'unit owners association',
  'unit owners inc',
  // Other
  'cooperative housing',
  'planned community',
  'village association',
  'village condominium',
  'village condo',
  'village homeowners',
  // Common NJ community name patterns
  'estates homeowners',
  'estates condominium',
  'manor homeowners',
  'manor condominium',
  'commons homeowners',
  'commons condominium',
  'park condominium',
  'park homeowners',
  'gardens condominium',
  'gardens homeowners',
  'court condominium',
  'court homeowners',
  'ridge homeowners',
  'ridge condominium',
  'woods homeowners',
  'woods condominium',
  'meadow homeowners',
  'meadows homeowners',
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
];

const OUTPUT_FILE = path.join(__dirname, 'nj-sos-raw.json');
const allResults = new Map();

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await delay(1000);
    
    const input = await page.$('#BusinessName, input[name="BusinessName"]');
    if (!input) return 0;
    
    await input.fill(searchTerm);
    await delay(300);
    
    const btn = await page.$('input[type="submit"], button[type="submit"]');
    if (btn) await btn.click();
    else await input.press('Enter');
    
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await delay(1500);
    
    // Check total
    const info = await page.evaluate(() => 
      document.querySelector('.dataTables_info')?.textContent || ''
    );
    
    if (!info || info.includes('0 entries')) {
      return 0;
    }
    
    // Try to show 100 entries
    const select = await page.$('select[name$="_length"]');
    if (select) {
      await select.selectOption('100');
      await delay(1000);
    }
    
    // Extract
    const results = await extractResults(page);
    let newCount = 0;
    
    for (const r of results) {
      if (r.entityId && !allResults.has(r.entityId)) {
        r.searchTerm = searchTerm;
        allResults.set(r.entityId, r);
        newCount++;
      }
    }
    
    // Handle pagination
    let pageNum = 1;
    while (pageNum < 20) {
      const nextBtn = await page.$('.paginate_button.next:not(.disabled)');
      if (!nextBtn) break;
      
      await nextBtn.click();
      await delay(1000);
      pageNum++;
      
      const moreResults = await extractResults(page);
      for (const r of moreResults) {
        if (r.entityId && !allResults.has(r.entityId)) {
          r.searchTerm = searchTerm;
          allResults.set(r.entityId, r);
          newCount++;
        }
      }
    }
    
    return newCount;
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log('Connecting to Chrome CDP on port 18800...');
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  
  let completed = 0;
  for (const term of SEARCH_TERMS) {
    const count = await scrapeSearch(page, term);
    completed++;
    console.log(`[${completed}/${SEARCH_TERMS.length}] "${term}" -> ${count} new (total: ${allResults.size})`);
    await delay(2500);
    
    // Save intermediate results every 10 searches
    if (completed % 10 === 0) {
      const intermediate = Array.from(allResults.values());
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(intermediate, null, 2));
      console.log(`  [saved ${intermediate.length} results]`);
    }
  }
  
  const results = Array.from(allResults.values());
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nDone! Total unique entities: ${results.length}`);
  
  await page.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
