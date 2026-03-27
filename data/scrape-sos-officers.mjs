/**
 * Scrape NJ Secretary of State for HOA officer/agent data.
 * Uses browser automation since NJ SoS requires anti-forgery tokens.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOAS_FILE = join(__dirname, 'final-hoas.json');
const OUTPUT_FILE = join(__dirname, 'hoa-officers.json');
const CACHE_FILE = join(__dirname, 'sos-cache.json');

const CDP_URL = 'http://127.0.0.1:18800';
const SOS_URL = 'https://www.njportal.com/DOR/BusinessNameSearch';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function searchSoS(page, hoaName) {
  try {
    // Navigate to search page
    await page.goto(SOS_URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(1000);
    
    // Find and fill search input
    const input = await page.$('input[name="BusinessName"]') || await page.$('#BusinessName');
    if (!input) {
      console.log('  Could not find search input');
      return null;
    }
    
    // Clear and type name
    await input.click({ clickCount: 3 });
    await input.type(hoaName.substring(0, 50), { delay: 30 });
    await sleep(500);
    
    // Click search button
    const searchBtn = await page.$('input[type="submit"]') || await page.$('button[type="submit"]');
    if (searchBtn) {
      await searchBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
      await sleep(1000);
    }
    
    // Look for results
    const content = await page.content();
    
    // Check for "no results"
    if (content.includes('No results') || content.includes('no matching')) {
      return null;
    }
    
    // Try to click on the first result link
    const firstLink = await page.$('table td a') || await page.$('.search-result a');
    if (firstLink) {
      await firstLink.click();
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
      await sleep(1000);
      
      // Extract detail page info
      const detail = await page.evaluate(() => {
        const text = document.body.innerText;
        const info = {};
        
        // Try to extract agent name
        const agentMatch = text.match(/Registered Agent[:\s]+([^\n]+)/i);
        if (agentMatch) info.registeredAgent = agentMatch[1].trim();
        
        // Try to extract agent address
        const agentAddr = text.match(/Agent Address[:\s]+([^\n]+)/i);
        if (agentAddr) info.agentAddress = agentAddr[1].trim();
        
        // Try to extract principal office
        const office = text.match(/Principal (Office|Business).*?Address[:\s]+([^\n]+)/i);
        if (office) info.principalOffice = office[2].trim();
        
        // Try to extract officers
        const officers = [];
        const officerSection = text.match(/Officers?.*?\n([\s\S]*?)(?=\n\s*\n|\nFiling|$)/i);
        if (officerSection) {
          const lines = officerSection[1].split('\n').filter(l => l.trim());
          for (const line of lines.slice(0, 6)) {
            officers.push(line.trim());
          }
        }
        if (officers.length) info.officers = officers;
        
        // Get full text for debugging
        info.fullText = text.substring(0, 2000);
        
        return info;
      });
      
      return detail;
    }
    
    return null;
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    return null;
  }
}

async function main() {
  const hoas = JSON.parse(readFileSync(HOAS_FILE, 'utf8'));
  console.log(`Processing ${hoas.length} HOAs for officer data...`);
  
  // Load cache
  let cache = {};
  if (existsSync(CACHE_FILE)) {
    cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Loaded ${Object.keys(cache).length} cached results`);
  }
  
  // Connect to existing Chrome
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: CDP_URL,
      defaultViewport: null
    });
  } catch (e) {
    console.error(`Could not connect to Chrome at ${CDP_URL}: ${e.message}`);
    process.exit(1);
  }
  
  const page = await browser.newPage();
  const results = {};
  let found = 0;
  
  for (let i = 0; i < hoas.length; i++) {
    const hoa = hoas[i];
    const name = hoa.name;
    
    // Check cache
    if (cache[name]) {
      results[name] = cache[name];
      if (cache[name].registeredAgent || cache[name].officers?.length) found++;
      continue;
    }
    
    console.log(`[${i + 1}/${hoas.length}] Searching: ${name}`);
    
    const detail = await searchSoS(page, name);
    
    if (detail) {
      results[name] = detail;
      cache[name] = detail;
      if (detail.registeredAgent || detail.officers?.length) found++;
      console.log(`  Found: agent=${detail.registeredAgent || 'N/A'}, officers=${detail.officers?.length || 0}`);
    } else {
      results[name] = { notFound: true };
      cache[name] = { notFound: true };
      console.log(`  Not found`);
    }
    
    // Save cache periodically
    if ((i + 1) % 5 === 0) {
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }
    
    await sleep(2000); // Rate limit
  }
  
  await page.close();
  
  // Save results
  writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`\nDone: ${found} HOAs with officer/agent data found`);
}

main().catch(console.error);
