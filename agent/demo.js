// Facet autonomous buyer agent.
//
// No human, no browser, no API key, no licence negotiation. The agent is handed a task,
// reads the seller's public price list, works out the minimum fidelity that task actually
// needs, pays for exactly that over x402, and stops. Two agents with different jobs spend
// different amounts against identical endpoints — which is the whole argument for metering
// 3D by fidelity instead of selling it all-or-nothing.
//
//   npm run agent -- thumbnail
//   npm run agent -- ar-tryon
//   npm run agent -- campaign
//
// Point it at a deployment with:
//   FACET_URL=https://your-app.vercel.app npm run agent -- campaign

import "dotenv/config";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme, toClientAvmSigner } from "@x402/avm";
import algosdk from "algosdk";

const BASE = (process.env.FACET_URL || "http://localhost:4020").replace(/\/$/, "");

const TASKS = {
  thumbnail: {
    goal: "Render a 512px product thumbnail for a parts-catalogue listing",
    needs: ["draft"],
    reasoning: "At 512px the silhouette is all that survives. Paying for 25k triangles or PBR would be waste.",
  },
  "ar-tryon": {
    goal: "Ship an AR 'view on my car' experience on a product page",
    needs: ["production", "pbr"],
    reasoning: "AR is viewed close-up against real surroundings, so it needs full mesh density and real materials — but not a redistribution licence.",
  },
  campaign: {
    goal: "Produce a hero render for a paid advertising campaign",
    needs: ["production", "pbr", "license"],
    reasoning: "Commercial distribution requires the licence tier on top of the full-fidelity asset.",
  },
};

const ORDER = ["draft", "production", "pbr", "license"];

function buildClient() {
  const pk = process.env.FACET_BUYER_PRIVATE_KEY;
  if (!pk) throw new Error("FACET_BUYER_PRIVATE_KEY is not set in .env");
  let base64 = pk.trim();
  if (base64.includes(" ")) base64 = Buffer.from(algosdk.mnemonicToSecretKey(base64).sk).toString("base64");
  const client = new x402Client();
  client.register("algorand:*", new ExactAvmScheme(toClientAvmSigner(base64)));
  return client;
}

async function payFor(item, client) {
  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  const res = await fetchWithPay(`${BASE}${item.route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`${item.key}: HTTP ${res.status}`);
  let txId;
  const header = res.headers.get("payment-response");
  if (header) {
    try { txId = JSON.parse(Buffer.from(header, "base64").toString("utf-8")).transaction; }
    catch { txId = header; }
  }
  return { payload: await res.json(), txId };
}

async function main() {
  const taskName = process.argv[2] || "thumbnail";
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Unknown task "${taskName}". Options: ${Object.keys(TASKS).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n\x1b[1mFacet buyer agent\x1b[0m`);
  console.log(`task   : ${task.goal}`);
  console.log(`seller : ${BASE}\n`);

  // 1. Read the public price list. Discovery is always free.
  const catalogue = await (await fetch(`${BASE}/api/catalog`)).json();
  console.log(`Read catalogue for "${catalogue.assetName}" — ${catalogue.tiers.length} priced tiers available.`);

  // 2. Decide the minimum sufficient fidelity.
  const wanted = ORDER.filter((k) => task.needs.includes(k));
  const items = wanted.map((k) => catalogue.tiers.find((t) => t.key === k)).filter(Boolean);
  const quoted = items.reduce((s, i) => s + parseFloat(i.price.replace(/[^0-9.]/g, "")), 0);

  console.log(`\nDecision: ${wanted.join(" + ")}  (quoted $${quoted.toFixed(3)})`);
  console.log(`Reasoning: ${task.reasoning}`);
  const skipped = catalogue.tiers.filter((t) => !wanted.includes(t.key)).map((t) => `${t.key} ${t.price}`);
  if (skipped.length) console.log(`Deliberately not buying: ${skipped.join(", ")}\n`);

  // 3. Pay for exactly those tiers.
  const client = buildClient();
  const receipts = [];
  let spent = 0;

  for (const item of items) {
    process.stdout.write(`paying ${item.price.padEnd(7)} for ${item.key.padEnd(11)} → ${item.payeeRole.padEnd(9)} … `);
    const started = Date.now();
    try {
      const { payload, txId } = await payFor(item, client);
      spent += parseFloat(item.price.replace(/[^0-9.]/g, ""));
      receipts.push({ tier: item.key, price: item.price, payee: item.payeeRole, txId });
      const detail = payload.triangleCount
        ? `${payload.triangleCount.toLocaleString()} tris`
        : payload.material ? payload.material.name : "licence issued";
      console.log(`\x1b[32msettled\x1b[0m in ${Date.now() - started}ms · ${detail}`);
    } catch (err) {
      console.log(`\x1b[31mfailed\x1b[0m — ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`\n\x1b[1mSpent $${spent.toFixed(3)} across ${receipts.length} on-chain payments.\x1b[0m`);
  for (const r of receipts) {
    console.log(`  ${r.price.padEnd(7)} ${r.tier.padEnd(11)} → ${r.payee.padEnd(9)} https://lora.algokit.io/testnet/transaction/${r.txId ?? "(no tx id)"}`);
  }
  console.log("");
}

main().catch((err) => { console.error(`\n\x1b[31magent failed:\x1b[0m ${err.message}\n`); process.exit(1); });
