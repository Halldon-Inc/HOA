import WebSocket from "ws";

const TARGET_ID = "D490F33CEC02B30922E28A151271E0E8";
const ws = new WebSocket(`ws://127.0.0.1:18800/devtools/page/${TARGET_ID}`);

let id = 1;
function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = id++;
    const timeout = setTimeout(() => { ws.off("message", handler); resolve({ timeout: true }); }, 15000);
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

  // Try the properties endpoint
  console.log("=== Properties endpoint ===");
  const props = await evalPage(
    `(async function() { var resp = await fetch('/_odata/properties?$top=1'); var json = await resp.json(); return JSON.stringify(json, null, 2); })()`
  );
  console.log(props?.substring(0, 3000));

  // Check what contact types exist
  console.log("\n=== Contact types ===");
  const contacts = await evalPage(
    `(async function() {
      var resp = await fetch('/_odata/propertycontacts?$top=50');
      var json = await resp.json();
      var types = {};
      json.value.forEach(function(c) {
        var t = c.ultra_contacttype ? c.ultra_contacttype.Name : 'null';
        types[t] = (types[t] || 0) + 1;
      });
      return JSON.stringify(types, null, 2);
    })()`
  );
  console.log(contacts);

  // Check the bhibuildings endpoint for management company data - look at all fields
  console.log("\n=== Buildings endpoint - check for management fields ===");
  const buildings = await evalPage(
    `(async function() {
      var resp = await fetch('/_odata/bhibuildings?$top=1');
      var json = await resp.json();
      return JSON.stringify(Object.keys(json.value[0]), null, 2);
    })()`
  );
  console.log(buildings);

  // Try the accounts endpoint (might have management companies)
  console.log("\n=== Accounts endpoint ===");
  const accounts = await evalPage(
    `(async function() { var resp = await fetch('/_odata/accounts?$top=1'); var json = await resp.json(); return JSON.stringify(json, null, 2); })()`
  );
  console.log(accounts?.substring(0, 2000));

  ws.close();
  process.exit(0);
});
