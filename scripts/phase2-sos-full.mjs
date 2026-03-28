#!/usr/bin/env node
import fs from 'fs';
import WebSocket from 'ws';

async function getTab() {
  const res = await fetch('http://127.0.0.1:18800/json');
  const tabs = await res.json();
  return tabs.find(t => t.type === 'page' && !t.url.includes('mail.google.com'));
}

let msgId = 1;
async function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function searchAndExtract(ws, hoaName) {
  // Navigate to search page
  await cdp(ws, 'Page.navigate', { url: 'https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName' });
  await sleep(2000);
  
  // Clean name for search
  const searchName = hoaName
    .replace(/\s*(HOA|HOMEOWNERS?|ASSOCIATION|INC\.?|CORP\.?|LLC\.?|OF NJ|OF NEW JERSEY)\s*/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  
  // Type and search
  await cdp(ws, 'Runtime.evaluate', {
    expression: `
      const input = document.querySelector('#BusinessName');
      if (input) { input.value = ''; input.value = '${searchName.replace(/'/g, "\\'")}'; input.dispatchEvent(new Event('input', {bubbles:true})); }
    `, returnByValue: true
  });
  await sleep(300);
  
  await cdp(ws, 'Runtime.evaluate', {
    expression: `document.querySelector('input[type="submit"]')?.click();`,
    returnByValue: true
  });
  await sleep(2500);
  
  // Extract entity IDs and names
  const searchResult = await cdp(ws, 'Runtime.evaluate', {
    expression: `
      const rows = [...document.querySelectorAll('table tbody tr')];
      const entities = rows.map(r => {
        const cells = [...r.querySelectorAll('td')];
        return {
          name: cells[0]?.textContent?.trim(),
          entityId: cells[1]?.textContent?.trim(),
          city: cells[2]?.textContent?.trim(),
          type: cells[3]?.textContent?.trim(),
          date: cells[4]?.textContent?.trim()
        };
      }).filter(e => e.name && e.entityId);
      JSON.stringify(entities);
    `, returnByValue: true
  });
  
  let entities = [];
  try { entities = JSON.parse(searchResult.result?.value || '[]'); } catch(e) {}
  
  if (entities.length === 0) return null;
  
  // Click on first matching entity to get details
  const entity = entities[0];
  
  await cdp(ws, 'Runtime.evaluate', {
    expression: `
      const firstLink = document.querySelector('table tbody tr td a') || document.querySelector('table tbody tr');
      if (firstLink) firstLink.click();
    `, returnByValue: true
  });
  await sleep(2500);
  
  // Extract officer/agent details
  const detailResult = await cdp(ws, 'Runtime.evaluate', {
    expression: `
      const text = document.body?.innerText || '';
      const info = {
        fullText: text.substring(0, 2000),
        agent: '',
        officers: [],
        status: '',
        formDate: ''
      };
      
      // Look for registered agent
      const agentMatch = text.match(/Registered Agent[:\\s]*(.*?)(?:\\n|$)/i);
      if (agentMatch) info.agent = agentMatch[1].trim();
      
      // Look for officers section
      const officerSection = text.match(/Officers?[:\\s]*([\\s\\S]*?)(?:Filing|Activity|$)/i);
      if (officerSection) {
        const lines = officerSection[1].split('\\n').filter(l => l.trim().length > 3);
        info.officers = lines.slice(0, 10).map(l => l.trim());
      }
      
      // Status
      const statusMatch = text.match(/Status[:\\s]*(Active|Inactive|Revoked|Dissolved)/i);
      if (statusMatch) info.status = statusMatch[1];
      
      JSON.stringify(info);
    `, returnByValue: true
  });
  
  let details = {};
  try { details = JSON.parse(detailResult.result?.value || '{}'); } catch(e) {}
  
  return {
    searchName,
    entityName: entity.name,
    entityId: entity.entityId,
    city: entity.city,
    type: entity.type,
    agent: details.agent,
    officers: details.officers,
    status: details.status,
    rawText: details.fullText?.substring(0, 500)
  };
}

async function main() {
  const hoas = JSON.parse(fs.readFileSync('public/data/hoas.json', 'utf8'));
  console.log(`HOAs to search: ${hoas.length}`);
  
  // Load cache
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync('data/sos-officer-cache-v2.json', 'utf8')); } catch(e) {}
  console.log(`Cache: ${Object.keys(cache).length} entries\n`);
  
  const tab = await getTab();
  if (!tab) { console.log('No tab'); return; }
  
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  
  let searched = 0;
  let found = 0;
  let withOfficers = 0;
  const MAX = 100; // Do 100 at a time
  
  for (const hoa of hoas) {
    if (cache[hoa.id]) { 
      if (cache[hoa.id].entityId) found++;
      continue; 
    }
    if (searched >= MAX) break;
    
    try {
      const result = await searchAndExtract(ws, hoa.name);
      cache[hoa.id] = result || { notFound: true };
      searched++;
      
      if (result?.entityId) {
        found++;
        if (result.officers?.length > 0) withOfficers++;
        process.stdout.write(`✅ ${searched}/${MAX} — ${hoa.name.substring(0,40)} => ${result.entityName?.substring(0,30)} (${result.officers?.length || 0} officers)\n`);
      } else {
        process.stdout.write(`❌ ${searched}/${MAX} — ${hoa.name.substring(0,40)} => not found\n`);
      }
      
      // Save every 10
      if (searched % 10 === 0) {
        fs.writeFileSync('data/sos-officer-cache-v2.json', JSON.stringify(cache, null, 2));
      }
      
      await sleep(1500); // Rate limit
    } catch(e) {
      console.log(`Error on ${hoa.name}: ${e.message}`);
      await sleep(3000);
    }
  }
  
  // Final save
  fs.writeFileSync('data/sos-officer-cache-v2.json', JSON.stringify(cache, null, 2));
  
  console.log(`\n=== Phase 2 Results ===`);
  console.log(`Searched: ${searched}`);
  console.log(`Found entities: ${found}`);
  console.log(`With officers: ${withOfficers}`);
  console.log(`Cache total: ${Object.keys(cache).length}`);
  
  ws.close();
}

main().catch(console.error);
