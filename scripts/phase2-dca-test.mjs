import WebSocket from "ws";

const TARGET_ID = "D490F33CEC02B30922E28A151271E0E8";
const ws = new WebSocket(`ws://127.0.0.1:18800/devtools/page/${TARGET_ID}`);

let id = 1;
function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = id++;
    const timeout = setTimeout(() => {
      ws.off("message", handler);
      resolve({ timeout: true });
    }, 15000);
    ws.send(JSON.stringify({ id: msgId, method, params }));
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === msgId) {
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
  return result.result?.result?.value;
}

ws.on("open", async () => {
  await new Promise((r) => setTimeout(r, 2000));

  // Test: Can we filter properties by ownership type = Condominium Association?
  // Value 240000001 based on the select options
  console.log("=== Properties with Condominium Association ownership ===");
  const condos = await evalPage(`
    (async function() {
      var resp = await fetch('/_odata/properties?$top=5&$filter=ultra_ownershiptype/Value eq 240000001');
      var json = await resp.json();
      return JSON.stringify(json.value?.map(function(p) {
        return {
          name: p.ultra_name,
          regNum: p.ultra_propertyregistrationnumber,
          bhiRegNum: p.ultra_bhiregistrationnumber,
          address: p.ultra_streetaddress,
          county: p.ultra_county ? p.ultra_county.Name : null,
          municipality: p.ultra_municipality ? p.ultra_municipality.Name : null,
          owner: p.ultra_propertyowner ? p.ultra_propertyowner.Name : null,
          agent: p.ultra_bhiauthorizedagent ? p.ultra_bhiauthorizedagent.Name : null,
          maintenance: p.ultra_elsamaintenancecompany ? p.ultra_elsamaintenancecompany.Name : null,
          units: p.ultra_unitcount,
          ownershipType: p.ultra_ownershiptype ? p.ultra_ownershiptype.Name : null
        };
      }) || json, null, 2);
    })()
  `);
  console.log(condos);

  // Try "Condominium Association" value
  console.log("\n=== Check ownership type options ===");
  const opts = await evalPage(`
    (async function() {
      // Get properties with different ownership types
      var resp = await fetch('/_odata/properties?$top=100');
      var json = await resp.json();
      var types = {};
      json.value.forEach(function(p) {
        var t = p.ultra_ownershiptype ? p.ultra_ownershiptype.Name + '=' + p.ultra_ownershiptype.Value : 'null';
        types[t] = (types[t] || 0) + 1;
      });
      return JSON.stringify(types, null, 2);
    })()
  `);
  console.log(opts);

  // Try filtering by name containing "CONDO"
  console.log("\n=== Properties with CONDO in name ===");
  const condoProps = await evalPage(`
    (async function() {
      var resp = await fetch("/_odata/properties?$top=5&$filter=substringof('CONDO', ultra_name)");
      var json = await resp.json();
      return JSON.stringify(json.value?.map(function(p) {
        return {
          name: p.ultra_name,
          address: p.ultra_streetaddress,
          owner: p.ultra_propertyowner ? p.ultra_propertyowner.Name : null,
          agent: p.ultra_bhiauthorizedagent ? p.ultra_bhiauthorizedagent.Name : null,
          maintenance: p.ultra_elsamaintenancecompany,
          units: p.ultra_unitcount,
          ownershipType: p.ultra_ownershiptype ? p.ultra_ownershiptype.Name : null
        };
      }) || json, null, 2);
    })()
  `);
  console.log(condoProps);

  ws.close();
  process.exit(0);
});
