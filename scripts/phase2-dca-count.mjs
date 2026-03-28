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

  // Count total properties
  console.log("=== Counting properties ===");
  const total = await evalPage(`
    (async function() {
      var resp = await fetch('/_odata/properties?$inlinecount=allpages&$top=0');
      var json = await resp.json();
      return JSON.stringify({ total: json['odata.count'], valueLen: json.value.length });
    })()
  `);
  console.log("Total properties:", total);

  // Count condominium associations (ownershiptype = 240000016)
  const condoCount = await evalPage(`
    (async function() {
      var resp = await fetch("/_odata/properties?$inlinecount=allpages&$top=0&$filter=ultra_ownershiptype/Value eq 240000016");
      var json = await resp.json();
      return json['odata.count'];
    })()
  `);
  console.log("Condo associations:", condoCount);

  // Count those with BHI registration (HOA/condo type)
  const bhiCount = await evalPage(`
    (async function() {
      var resp = await fetch("/_odata/properties?$inlinecount=allpages&$top=0&$filter=ultra_bhiregistrationnumber ne null");
      var json = await resp.json();
      return json['odata.count'];
    })()
  `);
  console.log("With BHI registration:", bhiCount);

  // Check how many records come in a single page fetch
  const pageSize = await evalPage(`
    (async function() {
      var resp = await fetch("/_odata/properties?$top=5000");
      var json = await resp.json();
      return JSON.stringify({
        returned: json.value.length,
        hasNext: !!json['odata.nextLink'],
        nextLink: json['odata.nextLink']?.substring(0, 200)
      });
    })()
  `);
  console.log("Page size test:", pageSize);

  ws.close();
  process.exit(0);
});
