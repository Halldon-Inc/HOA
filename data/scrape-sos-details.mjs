/**
 * Scrape NJ SoS Business Name Search for HOA officer/agent details.
 * Uses CDP connection to existing Chrome instance.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOS_FILE = join(__dirname, 'nj-sos-raw.json');
const IRS_FILE = join(__dirname, 'nj-hoas-irs.json');
const OUTPUT_FILE = join(__dirname, 'hoa-contacts.json');
const CACHE_FILE = join(__dirname, 'sos-detail-cache.json');

const CDP_URL = 'http://127.0.0.1:18800';
const SOS_URL = 'https://www.njportal.com/DOR/BusinessNameSearch';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function searchAndGetDetails(page, searchTerm) {
  try {
    await page.goto(SOS_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(1500);

    // Fill search
    const input = await page.$('#BusinessName');
    if (!input) {
      // Try alternate selectors
      const inputs = await page.$$('input[type="text"]');
      if (inputs.length === 0) return null;
      await inputs[0].click({ clickCount: 3 });
      await inputs[0].type(searchTerm.substring(0, 50), { delay: 20 });
    } else {
      await input.click({ clickCount: 3 });
      await input.type(searchTerm.substring(0, 50), { delay: 20 });
    }
    await sleep(500);

    // Submit
    const btn = await page.$('input[type="submit"], button[type="submit"]');
    if (!btn) return null;
    
    await Promise.all([
      btn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    ]);
    await sleep(2000);

    // Get page content
    const bodyText = await page.evaluate(() => document.body.innerText);
    
    if (bodyText.includes('No results found') || bodyText.includes('0 results')) {
      return null;
    }

    // Try to find and click first result link
    const links = await page.$$('a[href*="BusinessName"]');
    const tableLinks = await page.$$('table a, .table a, td a');
    const allLinks = links.length > 0 ? links : tableLinks;
    
    if (allLinks.length === 0) {
      // Maybe results are inline, extract from current page
      return extractFromText(bodyText, searchTerm);
    }

    // Click first matching link
    for (const link of allLinks) {
      const text = await link.evaluate(el => el.textContent);
      if (text && text.toUpperCase().includes(searchTerm.substring(0, 20).toUpperCase())) {
        await Promise.all([
          link.click(),
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
        ]);
        await sleep(1500);
        
        const detailText = await page.evaluate(() => document.body.innerText);
        return extractFromText(detailText, searchTerm);
      }
    }

    // If no exact match link, click first link
    await Promise.all([
      allLinks[0].click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    ]);
    await sleep(1500);
    
    const detailText = await page.evaluate(() => document.body.innerText);
    return extractFromText(detailText, searchTerm);

  } catch (e) {
    console.log(`    Error: ${e.message.substring(0, 100)}`);
    return null;
  }
}

function extractFromText(text, searchTerm) {
  const result = {};
  
  // Registered Agent
  const agentMatch = text.match(/Registered Agent[:\s]*\n?\s*([^\n]+)/i);
  if (agentMatch) result.registeredAgent = agentMatch[1].trim();
  
  // Agent Address  
  const agentAddr = text.match(/Agent (?:Address|Office)[:\s]*\n?\s*([^\n]+(?:\n[^\n]+)?)/i);
  if (agentAddr) result.agentAddress = agentAddr[1].trim().replace(/\n/g, ', ');
  
  // Principal Office
  const principal = text.match(/Principal (?:Office|Business|Address)[:\s]*\n?\s*([^\n]+(?:\n[^\n]+)?)/i);
  if (principal) result.principalOffice = principal[1].trim().replace(/\n/g, ', ');

  // Status
  const status = text.match(/(?:Entity )?Status[:\s]*\n?\s*([^\n]+)/i);
  if (status) result.status = status[1].trim();

  // Formation date
  const formed = text.match(/(?:Date (?:of )?Form(?:ed|ation)|Effective Date)[:\s]*\n?\s*([^\n]+)/i);
  if (formed) result.dateFormed = formed[1].trim();

  // Officers section
  const officerSection = text.match(/(?:Officers?|Directors?|Members?)[:\s]*\n([\s\S]*?)(?=\n\s*(?:Registered|Filing|Annual|$))/i);
  if (officerSection) {
    const lines = officerSection[1].split('\n')
      .map(l => l.trim())
      .filter(l => l && l.length > 2 && !l.startsWith('Name') && !l.startsWith('Title'));
    
    const officers = [];
    for (let i = 0; i < lines.length && officers.length < 10; i++) {
      const line = lines[i];
      // Try to parse "Name - Title" or "Title: Name" patterns
      const titleMatch = line.match(/(President|Vice President|Secretary|Treasurer|Director|Member|Chair|Manager)[:\s-]+(.+)/i);
      if (titleMatch) {
        officers.push({ title: titleMatch[1].trim(), name: titleMatch[2].trim() });
      } else if (line.match(/^[A-Z][a-z]+ [A-Z]/)) {
        // Looks like a name
        officers.push({ name: line, title: lines[i+1]?.trim() || 'Unknown' });
      }
    }
    if (officers.length > 0) result.officers = officers;
  }

  // Only return if we found something useful
  if (Object.keys(result).length > 0) {
    return result;
  }
  return null;
}

async function main() {
  // Load SoS data with entity IDs
  const sosEntities = JSON.parse(readFileSync(SOS_FILE, 'utf8'));
  console.log(`SoS entities to process: ${sosEntities.length}`);

  // Load cache
  let cache = {};
  if (existsSync(CACHE_FILE)) {
    cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    console.log(`Cache: ${Object.keys(cache).length} entries`);
  }

  // Connect to Chrome
  const browser = await puppeteer.connect({
    browserURL: CDP_URL,
    defaultViewport: null
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < sosEntities.length; i++) {
    const entity = sosEntities[i];
    const name = entity.name;

    if (cache[name] && cache[name] !== null) {
      if (!cache[name].notFound) found++;
      else notFound++;
      continue;
    }

    console.log(`[${i+1}/${sosEntities.length}] ${name}`);
    
    const detail = await searchAndGetDetails(page, name);
    
    if (detail) {
      cache[name] = detail;
      found++;
      const agent = detail.registeredAgent || 'N/A';
      const officerCount = detail.officers?.length || 0;
      console.log(`    Agent: ${agent} | Officers: ${officerCount}`);
    } else {
      cache[name] = { notFound: true };
      notFound++;
      console.log(`    Not found`);
    }

    // Save cache every 5
    if ((i + 1) % 5 === 0) {
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    }

    await sleep(3000); // Be gentle
  }

  await page.close();
  
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 2));
  
  console.log(`\nDone: ${found} found, ${notFound} not found`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
