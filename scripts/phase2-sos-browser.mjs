#!/usr/bin/env node
/**
 * Phase 2: Use browser CDP to search NJ SoS for HOA officers
 */
import fs from 'fs';
import WebSocket from 'ws';

const CDP_URL = 'ws://127.0.0.1:18800';

async function getTab() {
  const res = await fetch('http://127.0.0.1:18800/json');
  const tabs = await res.json();
  // Find an existing X tab to reuse, or use the first page tab
  const tab = tabs.find(t => t.type === 'page' && !t.url.includes('mail.google.com'));
  return tab;
}

async function cdpCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const timeout = setTimeout(() => reject(new Error('CDP timeout')), 15000);
    
    ws.once('message', (data) => {
      clearTimeout(timeout);
      const msg = JSON.parse(data.toString());
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    });
    
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const tab = await getTab();
  if (!tab) { console.log('No browser tab found'); return; }
  
  console.log('Using tab:', tab.title, tab.url);
  
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  
  // Navigate to SoS search
  await cdpCommand(ws, 'Page.navigate', { url: 'https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName' });
  await new Promise(r => setTimeout(r, 3000));
  
  // Type a test search
  const searchName = 'CRESTVIEW CONDOMINIUM';
  
  // Find input and type
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      const input = document.querySelector('input[name="BusinessName"], #BusinessName, input[type="text"]');
      if (input) {
        input.value = '${searchName}';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        'found input: ' + input.name + ' | ' + input.id;
      } else {
        'no input found. inputs: ' + [...document.querySelectorAll('input')].map(i => i.type + ':' + i.name + ':' + i.id).join(', ');
      }
    `,
    returnByValue: true
  });
  
  console.log('Input result:', result.result?.value);
  
  // Click search button
  await new Promise(r => setTimeout(r, 500));
  const btnResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      const btn = document.querySelector('input[type="submit"], button[type="submit"], .btn-primary, #searchButton');
      if (btn) { btn.click(); 'clicked: ' + btn.textContent; }
      else { 'no button. buttons: ' + [...document.querySelectorAll('button, input[type=submit]')].map(b => b.textContent || b.value).join(', '); }
    `,
    returnByValue: true
  });
  
  console.log('Button result:', btnResult.result?.value);
  
  // Wait for results
  await new Promise(r => setTimeout(r, 3000));
  
  // Extract results
  const extractResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      const rows = document.querySelectorAll('table tr, .search-result, .result-item, .entity-row');
      const results = [];
      rows.forEach(r => {
        const text = r.textContent.trim().substring(0, 200);
        if (text.length > 10) results.push(text);
      });
      
      // Also check for any links that might be entity details
      const links = document.querySelectorAll('a[href*="entity"], a[href*="detail"], a[href*="business"]');
      const linkInfo = [...links].map(l => l.href + ' | ' + l.textContent.trim().substring(0, 100));
      
      JSON.stringify({
        resultCount: results.length,
        results: results.slice(0, 5),
        links: linkInfo.slice(0, 10),
        pageText: document.body?.innerText?.substring(0, 500)
      });
    `,
    returnByValue: true
  });
  
  console.log('\nResults:', extractResult.result?.value);
  
  ws.close();
}

main().catch(console.error);
