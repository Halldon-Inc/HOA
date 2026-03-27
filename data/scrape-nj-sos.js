#!/usr/bin/env node
/**
 * NJ Secretary of State HOA Scraper
 * Searches the NJ Business Gateway for HOA/Condo/Community associations
 * Uses the browser to handle anti-forgery tokens and sessions
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SEARCH_TERMS = [
  'homeowners association',
  'homeowner association', 
  'home owners association',
  'condominium association',
  'condo association',
  'condominium owners',
  'property owners association',
  'townhome association',
  'townhouse association',
  'community association',
  'civic association',
  'HOA',
  'maintenance corporation',
  'maintenance association',
  'unit owners association',
  'village association',
  'estates association',
  'commons association',
  'manor association',
  'cooperative housing',
  'co-op housing',
  'planned community',
  'common interest'
];

const OUTPUT_FILE = path.join(__dirname, 'nj-sos-hoas.json');
const allResults = new Map(); // dedup by entity ID

async function scrapeSearch(page, searchTerm) {
  console.log(`Searching: "${searchTerm}"...`);
  
  try {
    await page.goto('https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName', {
      waitUntil: 'networkidle',
      timeout: 15000
    });
    
    // Fill search
    await page.fill('input[name="BusinessName"], #BusinessName', searchTerm);
    
    // Submit
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    
    // Check for results
    const content = await page.content();
    if (content.includes('No results found') || content.includes('no records')) {
      console.log(`  No results for "${searchTerm}"`);
      return [];
    }
    
    // Extract results from table
    const results = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, .search-results tr');
      return Array.from(rows).map(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return null;
        
        const link = row.querySelector('a');
        return {
          name: cells[0]?.textContent?.trim(),
          entityId: link?.href?.match(/\/(\d+)/)?.[1] || '',
          status: cells[1]?.textContent?.trim(),
          type: cells[2]?.textContent?.trim(),
          dateFormed: cells[3]?.textContent?.trim(),
        };
      }).filter(Boolean);
    });
    
    console.log(`  Found ${results.length} results`);
    
    // Get detail pages for first batch
    for (const result of results) {
      if (!allResults.has(result.entityId || result.name)) {
        allResults.set(result.entityId || result.name, result);
      }
    }
    
    // Check for pagination
    let pageNum = 1;
    while (pageNum < 10) { // max 10 pages per search
      const nextLink = await page.$('a:text("Next"), a.next-page, [aria-label="Next"]');
      if (!nextLink) break;
      
      await nextLink.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      pageNum++;
      
      const moreResults = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr, .search-results tr');
        return Array.from(rows).map(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return null;
          const link = row.querySelector('a');
          return {
            name: cells[0]?.textContent?.trim(),
            entityId: link?.href?.match(/\/(\d+)/)?.[1] || '',
            status: cells[1]?.textContent?.trim(),
            type: cells[2]?.textContent?.trim(),
            dateFormed: cells[3]?.textContent?.trim(),
          };
        }).filter(Boolean);
      });
      
      for (const result of moreResults) {
        if (!allResults.has(result.entityId || result.name)) {
          allResults.set(result.entityId || result.name, result);
        }
      }
      
      console.log(`  Page ${pageNum}: ${moreResults.length} more results (total unique: ${allResults.size})`);
    }
    
    return results;
  } catch (err) {
    console.error(`  Error searching "${searchTerm}": ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('Connecting to Chrome on port 18800...');
  
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  
  for (const term of SEARCH_TERMS) {
    await scrapeSearch(page, term);
    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }
  
  const results = Array.from(allResults.values());
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nTotal unique HOAs found: ${results.length}`);
  console.log(`Written to ${OUTPUT_FILE}`);
  
  await page.close();
}

main().catch(console.error);
