#!/usr/bin/env node
/**
 * NJ Secretary of State HOA Scraper v2
 * Connects to Chrome CDP on 18800
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SEARCH_TERMS = [
  'homeowners association',
  'homeowner association',
  'condominium association',
  'condo association',
  'property owners association',
  'townhome association',
  'townhouse association',
  'community association',
  'maintenance corporation',
  'unit owners',
  'cooperative housing',
  'planned community',
];

const OUTPUT_FILE = path.join(__dirname, 'nj-sos-raw.json');
const allResults = new Map();

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scrapeSearch(page, searchTerm) {
  console.log(`\nSearching: "${searchTerm}"...`);
  
  try {
    await page.goto('https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    
    await delay(1500);
    
    // Try to find and fill the search input
    const input = await page.$('input[name="BusinessName"], #BusinessName, input[type="text"]');
    if (!input) {
      console.log('  Could not find search input, dumping page title...');
      console.log('  Title:', await page.title());
      return [];
    }
    
    await input.fill(searchTerm);
    await delay(500);
    
    // Submit form
    const submitBtn = await page.$('input[type="submit"], button[type="submit"], button:has-text("Search")');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await input.press('Enter');
    }
    
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await delay(2000);
    
    const pageContent = await page.content();
    
    // Check for no results
    if (pageContent.includes('No results') || pageContent.includes('no records') || pageContent.includes('0 results')) {
      console.log(`  No results for "${searchTerm}"`);
      return [];
    }
    
    // Extract all results from current page
    let pageNum = 1;
    let totalForTerm = 0;
    
    while (true) {
      const results = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr, .table tbody tr, table tr:not(:first-child)');
        const data = [];
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const link = row.querySelector('a');
            data.push({
              name: (cells[0]?.textContent || '').trim(),
              entityId: link?.href?.match(/[\/=](\d{6,})/)?.[1] || '',
              status: (cells[1]?.textContent || '').trim(),
              type: cells.length > 2 ? (cells[2]?.textContent || '').trim() : '',
              dateFormed: cells.length > 3 ? (cells[3]?.textContent || '').trim() : '',
              address: cells.length > 4 ? (cells[4]?.textContent || '').trim() : '',
            });
          }
        });
        return data;
      });
      
      if (results.length === 0 && pageNum === 1) {
        // Maybe results are in a different format
        const text = await page.evaluate(() => document.body.innerText.substring(0, 2000));
        console.log(`  No table results found. Page snippet: ${text.substring(0, 300)}`);
        break;
      }
      
      results.forEach(r => {
        const key = r.entityId || r.name;
        if (key && !allResults.has(key)) {
          r.searchTerm = searchTerm;
          allResults.set(key, r);
          totalForTerm++;
        }
      });
      
      console.log(`  Page ${pageNum}: ${results.length} results (${totalForTerm} new for term, ${allResults.size} total unique)`);
      
      // Check for next page
      const nextBtn = await page.$('a:has-text("Next"), a:has-text("»"), .pagination a:last-child, a[aria-label="Next"]');
      if (!nextBtn) break;
      
      const isDisabled = await nextBtn.evaluate(el => el.classList.contains('disabled') || el.parentElement?.classList.contains('disabled'));
      if (isDisabled) break;
      
      await nextBtn.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      await delay(2000);
      pageNum++;
      
      if (pageNum > 50) break; // safety valve
    }
    
    return totalForTerm;
  } catch (err) {
    console.error(`  Error searching "${searchTerm}": ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log('Connecting to Chrome on port 18800...');
  
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://localhost:18800');
  } catch (e) {
    console.error('Failed to connect to Chrome CDP:', e.message);
    process.exit(1);
  }
  
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  
  for (const term of SEARCH_TERMS) {
    await scrapeSearch(page, term);
    await delay(3000); // rate limit between searches
  }
  
  const results = Array.from(allResults.values());
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nDone! Total unique entities: ${results.length}`);
  console.log(`Written to ${OUTPUT_FILE}`);
  
  await page.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
