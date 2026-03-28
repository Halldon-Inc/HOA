/**
 * Phase 2: Scrape NJ DCA Service Portal for HOA management company contacts
 *
 * Uses the DCA OData API via Chrome CDP to:
 * 1. Bulk-fetch all properties from the properties endpoint
 * 2. For each, get management company (authorized agent) info
 * 3. Match against our HOA data by name/address
 * 4. Cache results and produce a summary
 */

import fs from "fs";
import WebSocket from "ws";

const CACHE_FILE = "data/dca-contacts-cache.json";
const HOAS_FILE = "public/data/hoas.json";

// Load existing cache
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  console.log(`Loaded ${Object.keys(cache).length} cached entries`);
}

// Load HOA data
const hoas = JSON.parse(fs.readFileSync(HOAS_FILE, "utf8"));
console.log(`Loaded ${hoas.length} HOAs`);

// Get a tab to use
const tabsResp = await fetch("http://127.0.0.1:18800/json");
const tabs = await tabsResp.json();
const dcaTab = tabs.find(
  (t) =>
    t.type === "page" &&
    t.url.includes("serviceportal.dca.nj.gov")
);

if (!dcaTab) {
  console.error("No DCA tab found. Please open https://serviceportal.dca.nj.gov/ultra-bhi-home/ultra-bhi-propertysearch/ in Chrome first.");
  process.exit(1);
}

console.log(`Using tab: ${dcaTab.title} (${dcaTab.id})`);

const ws = new WebSocket(dcaTab.webSocketDebuggerUrl);

let msgId = 1;
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = msgId++;
    const timeout = setTimeout(() => {
      ws.off("message", handler);
      resolve({ timeout: true });
    }, 30000);
    ws.send(JSON.stringify({ id, method, params }));
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

async function evalPage(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.result?.exceptionDetails) {
    console.error("Eval error:", result.result.exceptionDetails.text);
    return null;
  }
  return result.result?.result?.value;
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Normalize strings for matching
function normalize(s) {
  if (!s) return "";
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract core HOA name words for fuzzy matching
function extractNameWords(name) {
  const stopWords = new Set([
    "HOA", "HOMEOWNERS", "HOMEOWNER", "ASSOCIATION", "ASSN", "ASSOC",
    "INC", "INCORPORATED", "LLC", "LP", "CORP", "CORPORATION",
    "THE", "OF", "AT", "A", "AN", "NJ", "NEW", "JERSEY",
    "CONDOMINIUM", "CONDO", "CONDOS", "CONDOMINIUMS",
    "COMMUNITY", "COMMUNITIES", "OWNERS", "PROPERTY",
    "NONPROFIT", "NP", "CO", "COOPERATIVE",
  ]);
  return normalize(name)
    .split(" ")
    .filter((w) => w.length > 1 && !stopWords.has(w));
}

ws.on("open", async () => {
  await new Promise((r) => setTimeout(r, 2000));

  // Ensure we're on the DCA site
  const currentUrl = await evalPage("window.location.href");
  if (!currentUrl?.includes("serviceportal.dca.nj.gov")) {
    console.log("Navigating to DCA portal...");
    await send("Page.navigate", {
      url: "https://serviceportal.dca.nj.gov/ultra-bhi-home/ultra-bhi-propertysearch/",
    });
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Phase 1: Bulk fetch all properties from OData API
  console.log("\n=== Phase 1: Fetching all DCA properties ===");

  let allProperties = [];
  let skip = 0;
  const pageSize = 5000;
  let hasMore = true;

  while (hasMore) {
    console.log(`  Fetching properties skip=${skip}...`);
    const batch = await evalPage(`
      (async function() {
        var resp = await fetch('/_odata/properties?$top=${pageSize}&$skip=${skip}');
        var json = await resp.json();
        return JSON.stringify({
          count: json.value.length,
          hasNext: !!json['odata.nextLink'],
          values: json.value.map(function(p) {
            return {
              id: p.ultra_propertyinterestid,
              name: p.ultra_name,
              regNum: p.ultra_propertyregistrationnumber,
              bhiRegNum: p.ultra_bhiregistrationnumber,
              address: p.ultra_streetaddress,
              county: p.ultra_county ? p.ultra_county.Name : null,
              municipality: p.ultra_municipality ? p.ultra_municipality.Name : null,
              ownerName: p.ultra_propertyowner ? p.ultra_propertyowner.Name : null,
              ownerId: p.ultra_propertyowner ? p.ultra_propertyowner.Id : null,
              agentName: p.ultra_bhiauthorizedagent ? p.ultra_bhiauthorizedagent.Name : null,
              agentId: p.ultra_bhiauthorizedagent ? p.ultra_bhiauthorizedagent.Id : null,
              ownershipType: p.ultra_ownershiptype ? p.ultra_ownershiptype.Name : null,
              ownershipTypeValue: p.ultra_ownershiptype ? p.ultra_ownershiptype.Value : null,
              unitCount: p.ultra_unitcount,
              maintenance: p.ultra_elsamaintenancecompany
            };
          })
        });
      })()
    `);

    if (!batch) {
      console.error("  Failed to fetch batch, retrying...");
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    const parsed = JSON.parse(batch);
    allProperties = allProperties.concat(parsed.values);
    console.log(`  Got ${parsed.count} properties (total: ${allProperties.length})`);

    if (parsed.count < pageSize || !parsed.hasNext) {
      hasMore = false;
    } else {
      skip += pageSize;
      // Rate limit
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\nTotal DCA properties fetched: ${allProperties.length}`);

  // Analyze what we got
  const ownershipTypes = {};
  let withAgent = 0;
  let condoAssociations = 0;
  allProperties.forEach((p) => {
    const t = p.ownershipType || "null";
    ownershipTypes[t] = (ownershipTypes[t] || 0) + 1;
    if (p.agentName) withAgent++;
    if (
      t === "Condominium Association" ||
      t === "Cooperative" ||
      t === "Non-Profit"
    )
      condoAssociations++;
  });

  console.log("\nOwnership types:");
  Object.entries(ownershipTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${v} ${k}`));
  console.log(`Properties with authorized agent: ${withAgent}`);
  console.log(`Condo/Co-op/Non-profit properties: ${condoAssociations}`);

  // Phase 2: Match DCA properties to our HOAs
  console.log("\n=== Phase 2: Matching DCA properties to HOAs ===");

  // Build lookup indices for DCA properties
  const dcaByName = new Map();
  const dcaByAddress = new Map();

  allProperties.forEach((p) => {
    const normName = normalize(p.name);
    if (normName) {
      if (!dcaByName.has(normName)) dcaByName.set(normName, []);
      dcaByName.get(normName).push(p);
    }

    const normAddr = normalize(p.address);
    const normMuni = normalize(p.municipality);
    if (normAddr) {
      const key = `${normAddr}|${normMuni}`;
      if (!dcaByAddress.has(key)) dcaByAddress.set(key, []);
      dcaByAddress.get(key).push(p);
    }
  });

  let matched = 0;
  let matchedWithAgent = 0;
  let unmatched = 0;
  const matchResults = [];

  for (const hoa of hoas) {
    const hoaNameNorm = normalize(hoa.name);
    const hoaAddrNorm = normalize(hoa.address);
    const hoaMuniNorm = normalize(hoa.municipality);
    const hoaNameWords = extractNameWords(hoa.name);

    let bestMatch = null;
    let matchType = null;

    // Strategy 1: Exact name match
    if (dcaByName.has(hoaNameNorm)) {
      bestMatch = dcaByName.get(hoaNameNorm)[0];
      matchType = "exact_name";
    }

    // Strategy 2: Name without suffixes (HOA, INC, etc)
    if (!bestMatch) {
      const coreWords = hoaNameWords.join(" ");
      if (coreWords && dcaByName.has(coreWords)) {
        bestMatch = dcaByName.get(coreWords)[0];
        matchType = "core_name";
      }
    }

    // Strategy 3: Address + municipality match
    if (!bestMatch && hoaAddrNorm && hoaMuniNorm) {
      const key = `${hoaAddrNorm}|${hoaMuniNorm}`;
      if (dcaByAddress.has(key)) {
        bestMatch = dcaByAddress.get(key)[0];
        matchType = "address_municipality";
      }
    }

    // Strategy 4: Fuzzy name match - check if HOA name words are contained in DCA name
    if (!bestMatch && hoaNameWords.length >= 2) {
      for (const [dcaName, props] of dcaByName) {
        const dcaWords = dcaName.split(" ");
        const matchCount = hoaNameWords.filter((w) => dcaWords.includes(w)).length;
        if (matchCount >= Math.min(hoaNameWords.length, 3) && matchCount >= 2) {
          bestMatch = props[0];
          matchType = "fuzzy_name";
          break;
        }
      }
    }

    // Strategy 5: Address partial match (just street address, any municipality in same county)
    if (!bestMatch && hoaAddrNorm) {
      for (const [key, props] of dcaByAddress) {
        const [addr, muni] = key.split("|");
        if (addr === hoaAddrNorm) {
          // Check county matches
          const hoaCounty = normalize(hoa.county);
          const dcaCounty = normalize(props[0].county);
          if (hoaCounty === dcaCounty) {
            bestMatch = props[0];
            matchType = "address_county";
            break;
          }
        }
      }
    }

    if (bestMatch) {
      matched++;
      if (bestMatch.agentName) matchedWithAgent++;

      const result = {
        hoaName: hoa.name,
        hoaEntityId: hoa.entityId,
        dcaName: bestMatch.name,
        dcaRegNum: bestMatch.bhiRegNum || bestMatch.regNum,
        dcaPropertyId: bestMatch.id,
        matchType,
        agentName: bestMatch.agentName,
        ownerName: bestMatch.ownerName,
        ownershipType: bestMatch.ownershipType,
        unitCount: bestMatch.unitCount,
        dcaAddress: bestMatch.address,
        dcaMunicipality: bestMatch.municipality,
        dcaCounty: bestMatch.county,
      };

      cache[hoa.entityId] = result;
      matchResults.push(result);
    } else {
      unmatched++;
    }
  }

  console.log(`\nMatched: ${matched} (${matchedWithAgent} with agent)`);
  console.log(`Unmatched: ${unmatched}`);
  console.log(`Match types:`);
  const typeCount = {};
  matchResults.forEach((r) => {
    typeCount[r.matchType] = (typeCount[r.matchType] || 0) + 1;
  });
  Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Phase 3: For matched properties with agents, get contact details from property detail pages
  console.log("\n=== Phase 3: Fetching contact details for matched properties ===");

  const matchedWithAgentList = matchResults.filter(
    (r) => r.agentName && r.agentName !== r.ownerName // Agent is different from owner = likely management company
  );
  console.log(`Properties with distinct management agent: ${matchedWithAgentList.length}`);

  // Sample the first 20 to get contact details
  const toFetch = matchedWithAgentList.slice(0, 20);
  let fetched = 0;

  for (const match of toFetch) {
    if (match.dcaPropertyId && !cache[match.hoaEntityId]?.contactDetails) {
      console.log(`  [${++fetched}/${toFetch.length}] Fetching contacts for ${match.dcaName}...`);

      // Navigate to property detail page
      await send("Page.navigate", {
        url: `https://serviceportal.dca.nj.gov/ultra-bhi-home/ultra-bhi-propertysearch/ultra-bhi-propertyinterest?pid=${match.dcaPropertyId}`,
      });
      await new Promise((r) => setTimeout(r, 6000));

      // Extract contact info
      const contactData = await evalPage(`
        (function() {
          // Get form field values
          var fields = {};
          document.querySelectorAll("input[type=text], textarea").forEach(function(inp) {
            if (inp.value && inp.value.trim()) {
              fields[inp.id || inp.name] = inp.value;
            }
          });

          // Get contact table data
          var contacts = [];
          var tables = document.querySelectorAll("table");
          tables.forEach(function(t) {
            var rows = t.querySelectorAll("tr");
            rows.forEach(function(r) {
              var cells = r.querySelectorAll("td");
              if (cells.length >= 2) {
                var text = r.textContent;
                if (text.includes("Manager") || text.includes("Registered Agent") ||
                    text.includes("Officer") || text.includes("Maintenance")) {
                  contacts.push({
                    name: cells[0] ? cells[0].textContent.trim() : "",
                    type: cells[1] ? cells[1].textContent.trim() : "",
                    address: cells[2] ? cells[2].textContent.trim() : "",
                    businessAddress: cells[3] ? cells[3].textContent.trim() : ""
                  });
                }
              }
            });
          });

          return JSON.stringify({
            regNum: fields.ultra_bhiregistrationnumber,
            propertyName: fields.ultra_name,
            authorizedAgent: fields.ultra_bhiauthorizedagent_name,
            propertyType: fields.ultra_bhipropertyinteresttype,
            ownershipType: fields.ultra_ownershiptype,
            unitCount: fields.ultra_unitcount,
            contacts: contacts
          });
        })()
      `);

      if (contactData) {
        const parsed = JSON.parse(contactData);
        cache[match.hoaEntityId].contactDetails = parsed;
        console.log(`    Agent: ${parsed.authorizedAgent || "N/A"}`);
        console.log(`    Contacts: ${parsed.contacts.length}`);
        parsed.contacts.forEach((c) => {
          console.log(`      ${c.type}: ${c.name} - ${c.address}`);
        });
      }

      saveCache();
      // Rate limit
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Save final cache
  saveCache();

  // Print summary
  console.log("\n=== SUMMARY ===");
  console.log(`Total HOAs: ${hoas.length}`);
  console.log(`DCA properties fetched: ${allProperties.length}`);
  console.log(`Matched to HOAs: ${matched}`);
  console.log(`  With management agent: ${matchedWithAgent}`);
  console.log(`  With distinct agent (not self-managed): ${matchedWithAgentList.length}`);
  console.log(`Contact details fetched: ${fetched}`);
  console.log(`Cache entries: ${Object.keys(cache).length}`);
  console.log(`Cache saved to: ${CACHE_FILE}`);

  // Show some example matches
  console.log("\n=== Sample Matches ===");
  matchResults.slice(0, 10).forEach((r) => {
    console.log(`  ${r.hoaName}`);
    console.log(`    DCA: ${r.dcaName} (${r.matchType})`);
    console.log(`    Agent: ${r.agentName || "N/A"}`);
    console.log(`    Owner: ${r.ownerName || "N/A"}`);
    console.log("");
  });

  ws.close();
  process.exit(0);
});
