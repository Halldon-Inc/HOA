/**
 * Phase 2: Scrape NJ DCA Service Portal for HOA management company contacts
 *
 * Uses the DCA OData API via Chrome CDP to:
 * 1. Bulk-fetch all properties from the properties endpoint
 * 2. Match against our HOA data by name/address
 * 3. For matched condos with management agents, fetch contact detail pages
 * 4. Cache results to data/dca-contacts-cache.json
 */

import fs from "fs";
import WebSocket from "ws";

const CACHE_FILE = "data/dca-contacts-cache.json";
const DCA_DUMP_FILE = "data/dca-properties-dump.json";
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
    (t.url.includes("serviceportal.dca.nj.gov") ||
      t.url.includes("njportal.com")) &&
    !t.url.includes("x.com") &&
    !t.url.includes("twitter")
);

if (!dcaTab) {
  console.error("No usable tab found.");
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
    }, 60000);
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
    console.error(
      "Eval error:",
      result.result.exceptionDetails.text,
      result.result.exceptionDetails.exception?.description?.substring(0, 200)
    );
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

// Extract meaningful name words, removing generic HOA/legal suffixes
function extractCoreWords(name) {
  const stopWords = new Set([
    "HOA",
    "HOMEOWNERS",
    "HOMEOWNER",
    "HOME",
    "OWNERS",
    "OWNER",
    "ASSOCIATION",
    "ASSN",
    "ASSOC",
    "INC",
    "INCORPORATED",
    "LLC",
    "LP",
    "LLP",
    "CORP",
    "CORPORATION",
    "THE",
    "OF",
    "AT",
    "A",
    "AN",
    "AND",
    "NJ",
    "NEW",
    "JERSEY",
    "CONDOMINIUM",
    "CONDO",
    "CONDOS",
    "CONDOMINIUMS",
    "COMMUNITY",
    "COMMUNITIES",
    "PROPERTY",
    "PROPERTIES",
    "NONPROFIT",
    "NP",
    "CO",
    "COOPERATIVE",
    "LIMITED",
    "LIABILITY",
    "COMPANY",
    "URBAN",
    "RENEWAL",
    "MANAGEMENT",
    "GROUP",
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

  // Phase 1: Fetch all DCA properties (use dump if available)
  let allProperties;
  if (fs.existsSync(DCA_DUMP_FILE)) {
    console.log("Loading cached DCA property dump...");
    allProperties = JSON.parse(fs.readFileSync(DCA_DUMP_FILE, "utf8"));
    console.log(`Loaded ${allProperties.length} DCA properties from dump`);
  } else {
    console.log("\n=== Phase 1: Fetching all DCA properties ===");
    allProperties = [];
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
                agentName: p.ultra_bhiauthorizedagent ? p.ultra_bhiauthorizedagent.Name : null,
                ownershipType: p.ultra_ownershiptype ? p.ultra_ownershiptype.Name : null,
                unitCount: p.ultra_unitcount
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
      console.log(
        `  Got ${parsed.count} properties (total: ${allProperties.length})`
      );

      if (parsed.count < pageSize || !parsed.hasNext) {
        hasMore = false;
      } else {
        skip += pageSize;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Save dump for reuse
    fs.writeFileSync(DCA_DUMP_FILE, JSON.stringify(allProperties));
    console.log(`Saved ${allProperties.length} properties to ${DCA_DUMP_FILE}`);
  }

  console.log(`Total DCA properties: ${allProperties.length}`);

  // Phase 2: Match DCA properties to HOAs
  console.log("\n=== Phase 2: Matching DCA properties to HOAs ===");

  // Build lookup indices for DCA properties
  // Key by core name words (sorted for consistency)
  const dcaByCoreWords = new Map();
  const dcaByAddress = new Map();

  allProperties.forEach((p) => {
    const coreWords = extractCoreWords(p.name).sort().join(" ");
    if (coreWords && coreWords.split(" ").length >= 2) {
      if (!dcaByCoreWords.has(coreWords)) dcaByCoreWords.set(coreWords, []);
      dcaByCoreWords.get(coreWords).push(p);
    }

    const normAddr = normalize(p.address);
    if (normAddr) {
      const normMuni = normalize(p.municipality);
      const key = `${normAddr}|${normMuni}`;
      if (!dcaByAddress.has(key)) dcaByAddress.set(key, []);
      dcaByAddress.get(key).push(p);

      // Also index by just address + county
      const normCounty = normalize(p.county);
      const key2 = `${normAddr}|${normCounty}`;
      if (!dcaByAddress.has(key2)) dcaByAddress.set(key2, []);
      dcaByAddress.get(key2).push(p);
    }
  });

  let matched = 0;
  let matchedWithAgent = 0;
  let unmatched = 0;
  const matchResults = [];

  for (const hoa of hoas) {
    const hoaCoreWords = extractCoreWords(hoa.name).sort().join(" ");
    const hoaAddrNorm = normalize(hoa.address);
    const hoaMuniNorm = normalize(hoa.municipality);
    const hoaCountyNorm = normalize(hoa.county);

    let bestMatch = null;
    let matchType = null;

    // Strategy 1: Core name words exact match (most reliable)
    if (hoaCoreWords && hoaCoreWords.split(" ").length >= 2) {
      const candidates = dcaByCoreWords.get(hoaCoreWords);
      if (candidates) {
        // Prefer condo associations, then check county match
        const condoMatch = candidates.find(
          (c) =>
            c.ownershipType === "Condominium Association" ||
            c.ownershipType === "Cooperative"
        );
        const countyMatch = candidates.find(
          (c) => normalize(c.county) === hoaCountyNorm
        );
        bestMatch = condoMatch || countyMatch || candidates[0];
        matchType = "core_name";
      }
    }

    // Strategy 2: Address + municipality match
    if (!bestMatch && hoaAddrNorm && hoaMuniNorm) {
      const key = `${hoaAddrNorm}|${hoaMuniNorm}`;
      const candidates = dcaByAddress.get(key);
      if (candidates) {
        bestMatch = candidates[0];
        matchType = "address_municipality";
      }
    }

    // Strategy 3: Address + county match
    if (!bestMatch && hoaAddrNorm && hoaCountyNorm) {
      const key = `${hoaAddrNorm}|${hoaCountyNorm}`;
      const candidates = dcaByAddress.get(key);
      if (candidates) {
        bestMatch = candidates[0];
        matchType = "address_county";
      }
    }

    // Strategy 4: Strict fuzzy name match
    // All HOA core words must appear in DCA name, AND at least 60% of DCA core words must match
    if (!bestMatch && hoaCoreWords) {
      const hoaWords = hoaCoreWords.split(" ");
      if (hoaWords.length >= 2) {
        for (const [dcaCoreWords, props] of dcaByCoreWords) {
          const dcaWords = dcaCoreWords.split(" ");
          // All HOA words must be in DCA
          const allHoaInDca = hoaWords.every((w) => dcaWords.includes(w));
          // At least 60% of DCA words must be in HOA
          const dcaInHoa = dcaWords.filter((w) => hoaWords.includes(w)).length;
          const dcaRatio = dcaInHoa / dcaWords.length;

          if (allHoaInDca && dcaRatio >= 0.6 && dcaInHoa >= 2) {
            bestMatch = props[0];
            matchType = "strict_fuzzy";
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

  console.log(`Matched: ${matched} (${matchedWithAgent} with agent)`);
  console.log(`Unmatched: ${unmatched}`);
  console.log("Match types:");
  const typeCount = {};
  matchResults.forEach((r) => {
    typeCount[r.matchType] = (typeCount[r.matchType] || 0) + 1;
  });
  Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  saveCache();

  // Phase 3: Fetch contact details for properties with management agents
  console.log("\n=== Phase 3: Fetching contact details ===");

  const toFetch = matchResults.filter(
    (r) =>
      r.dcaPropertyId &&
      r.agentName &&
      r.agentName !== r.ownerName &&
      !cache[r.hoaEntityId]?.contactDetails
  );
  console.log(`Properties needing contact fetch: ${toFetch.length}`);

  // Fetch up to 50 detail pages
  const fetchLimit = Math.min(toFetch.length, 50);
  let fetched = 0;

  for (let i = 0; i < fetchLimit; i++) {
    const match = toFetch[i];
    console.log(
      `  [${i + 1}/${fetchLimit}] ${match.dcaName} (agent: ${match.agentName})...`
    );

    await send("Page.navigate", {
      url: `https://serviceportal.dca.nj.gov/ultra-bhi-home/ultra-bhi-propertysearch/ultra-bhi-propertyinterest?pid=${match.dcaPropertyId}`,
    });
    await new Promise((r) => setTimeout(r, 6000));

    const contactData = await evalPage(`
      (function() {
        var fields = {};
        document.querySelectorAll("input[type=text], textarea").forEach(function(inp) {
          if (inp.value && inp.value.trim()) {
            fields[inp.id || inp.name] = inp.value;
          }
        });

        // Parse contact table - look for rows with exactly 4 or 5 td cells
        var contacts = [];
        var seen = new Set();
        document.querySelectorAll("table tr").forEach(function(row) {
          var cells = row.querySelectorAll("td");
          if (cells.length >= 3 && cells.length <= 5) {
            var name = cells[0].textContent.trim();
            var type = cells[1].textContent.trim();
            var addr = cells[2].textContent.trim();
            var bizAddr = cells.length > 3 ? cells[3].textContent.trim() : "";
            // Filter to relevant contact types
            var validTypes = ["Manager", "Registered Agent", "Officer or General Partner",
              "Maintenance Service Provider", "Emergency Repair Expenditure Authorizer",
              "Associated Contact"];
            if (validTypes.includes(type) && name && name.length < 100) {
              var key = name + "|" + type;
              if (!seen.has(key)) {
                seen.add(key);
                contacts.push({ name: name, type: type, address: addr, businessAddress: bizAddr });
              }
            }
          }
        });

        return JSON.stringify({
          regNum: fields.ultra_bhiregistrationnumber,
          propertyName: fields.ultra_name,
          authorizedAgent: fields.ultra_bhiauthorizedagent_name,
          propertyType: fields.ultra_bhipropertyinteresttype,
          unitCount: fields.ultra_unitcount,
          contacts: contacts
        });
      })()
    `);

    if (contactData) {
      const parsed = JSON.parse(contactData);
      cache[match.hoaEntityId].contactDetails = parsed;
      fetched++;

      const manager = parsed.contacts.find((c) => c.type === "Manager");
      if (manager) {
        console.log(`    Manager: ${manager.name} - ${manager.address}`);
      } else {
        console.log(
          `    No manager contact (${parsed.contacts.length} contacts total)`
        );
      }
    }

    saveCache();
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Final summary
  console.log("\n========== FINAL SUMMARY ==========");
  console.log(`Total HOAs in dataset: ${hoas.length}`);
  console.log(`DCA properties searched: ${allProperties.length}`);
  console.log(`HOAs matched to DCA: ${matched} (${((matched / hoas.length) * 100).toFixed(1)}%)`);
  console.log(`  With management agent: ${matchedWithAgent}`);
  console.log(`  Contact details fetched: ${fetched}`);
  console.log(`Cache entries: ${Object.keys(cache).length}`);

  // Show quality matches
  console.log("\n=== High-Quality Matches (with management companies) ===");
  const goodMatches = matchResults
    .filter(
      (r) =>
        r.agentName &&
        r.agentName !== r.ownerName &&
        (r.matchType === "core_name" || r.matchType === "address_municipality")
    )
    .slice(0, 20);
  goodMatches.forEach((r) => {
    console.log(`  ${r.hoaName}`);
    console.log(`    DCA: ${r.dcaName} [${r.matchType}]`);
    console.log(`    Management: ${r.agentName}`);
    console.log(`    Owner: ${r.ownerName}`);
    console.log("");
  });

  ws.close();
  process.exit(0);
});
