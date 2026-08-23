// Facet discovering agent — the version with no hardcoded seller.
//
// agent/demo.js is pointed at a URL it was told about. This one is not told anything: it
// queries the x402 Bazaar for resources tagged with what its task needs, scores whatever
// comes back, and pays the winner. It has never heard of Facet specifically.
//
//   npm run agent:discover -- thumbnail
//   npm run agent:discover -- ar-tryon

import "dotenv/config";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme, toClientAvmSigner } from "@x402/avm";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { withBazaar } from "@x402/extensions/bazaar";
import algosdk from "algosdk";

const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";

// What each task needs, expressed as tags rather than URLs. This is the whole point: the
// agent describes its requirement, not its supplier.
const TASKS = {
  thumbnail: {
    goal: "Render a 512px product thumbnail for a parts-catalogue listing",
    needs: [["3d-asset", "low-poly"]],
    reasoning: "At 512px only the silhouette survives, so the cheapest low-poly mesh wins.",
  },
  "ar-tryon": {
    goal: "Ship an AR 'view on my car' experience on a product page",
    needs: [["3d-asset", "high-poly"], ["3d-asset", "pbr"]],
    reasoning: "AR is viewed close up, so it needs full mesh density and real materials.",
  },
  campaign: {
    goal: "Produce a hero render for a paid advertising campaign",
    needs: [["3d-asset", "high-poly"], ["3d-asset", "pbr"], ["3d-asset", "licence"]],
    reasoning: "Commercial distribution requires a licence on top of the full-fidelity asset.",
  },
};

function buildClient() {
  const pk = process.env.FACET_BUYER_PRIVATE_KEY;
  if (!pk) throw new Error("FACET_BUYER_PRIVATE_KEY is not set in .env");
  let base64 = pk.trim();
  if (base64.includes(" ")) base64 = Buffer.from(algosdk.mnemonicToSecretKey(base64).sk).toString("base64");
  const c = new x402Client();
  c.register("algorand:*", new ExactAvmScheme(toClientAvmSigner(base64)));
  return c;
}

function priceOf(resource) {
  const a = resource.accepts?.[0];
  const raw = a?.amount ?? a?.price ?? "999999999";
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? Infinity : n;
}

// Cheapest first. A production version would fold in observed success rate and latency,
// exactly as reputation scoring does in a multi-agent system.
function rank(candidates) {
  return [...candidates].sort((a, b) => priceOf(a) - priceOf(b));
}

// Buy from the cheapest seller that actually delivers.
//
// Picking the cheapest and giving up when it fails is not agent behaviour, it is a script.
// A seller advertised in the catalogue may be offline, may have moved, or may never have
// existed — discovery is an open network, so unreachable listings are normal rather than
// exceptional. Fall through the ranking until something settles.
async function buyFirstThatWorks(candidates, client) {
  const ranked = rank(candidates);
  const failures = [];

  for (const [i, candidate] of ranked.entries()) {
    const label = `${candidate.serviceName ?? "unnamed"} (${candidate.resource})`;
    if (i === 0) console.log(`  selected: ${candidate.resource}  (cheapest of ${ranked.length})`);
    else console.log(`  falling back to next-cheapest: ${candidate.resource}`);

    const started = Date.now();
    try {
      const fetchWithPay = wrapFetchWithPayment(fetch, client);
      const res = await fetchWithPay(candidate.resource, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      let txId;
      const header = res.headers.get("payment-response");
      if (header) {
        try { txId = JSON.parse(Buffer.from(header, "base64").toString("utf-8")).transaction; }
        catch { txId = header; }
      }
      const payload = await res.json();
      const detail = payload.triangleCount ? `${payload.triangleCount.toLocaleString()} tris`
        : payload.material ? payload.material.name
        : payload.licence ? "licence issued" : "delivered";
      console.log(`  \x1b[32msettled\x1b[0m in ${Date.now() - started}ms · ${detail}`);
      return { ok: true, candidate, txId, failures };
    } catch (err) {
      console.log(`  \x1b[33munreachable\x1b[0m — ${err.message}`);
      failures.push({ label, error: err.message });
    }
  }
  return { ok: false, failures };
}

async function main() {
  const taskName = process.argv[2] || "thumbnail";
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Unknown task "${taskName}". Options: ${Object.keys(TASKS).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n\x1b[1mFacet discovering agent\x1b[0m`);
  console.log(`task        : ${task.goal}`);
  console.log(`bazaar      : ${FACILITATOR_URL}`);
  console.log(`known seller: \x1b[2m(none — nothing is hardcoded)\x1b[0m\n`);

  const bazaar = withBazaar(new HTTPFacilitatorClient({ url: FACILITATOR_URL }));
  const { items = [], pagination } = await bazaar.extensions.bazaar.listResources({ type: "http", limit: 500 });
  console.log(`Queried the Bazaar: ${(pagination?.total ?? items.length).toLocaleString()} resources catalogued.`);

  const client = buildClient();
  const receipts = [];
  let spent = 0;

  for (const required of task.needs) {
    const candidates = items.filter((it) => required.every((t) => it.tags?.includes(t)));
    console.log(`\nNeed [${required.join(" + ")}] → ${candidates.length} matching resource(s)`);

    if (!candidates.length) {
      console.log(`  \x1b[33mnothing offers this yet\x1b[0m — no seller has advertised these tags.`);
      continue;
    }
    for (const c of rank(candidates).slice(0, 5)) {
      console.log(`    ${String(priceOf(c)).padStart(8)}  ${c.serviceName ?? "unnamed"}  ${c.resource}`);
    }

    const result = await buyFirstThatWorks(candidates, client);
    if (result.ok) {
      spent += priceOf(result.candidate) / 1e6;
      receipts.push({ resource: result.candidate.resource, txId: result.txId, skipped: result.failures.length });
    } else {
      console.log(`  \x1b[31mno seller could deliver\x1b[0m — tried ${result.failures.length}`);
      process.exitCode = 1;
    }
  }

  const skipped = receipts.reduce((n, r) => n + (r.skipped ?? 0), 0);
  console.log(`\n\x1b[1mSpent $${spent.toFixed(3)} across ${receipts.length} on-chain payments,\x1b[0m`);
  console.log(`\x1b[1mwith no seller URL supplied to this agent.\x1b[0m`);
  if (skipped) console.log(`\x1b[2m${skipped} cheaper listing(s) were unreachable and skipped.\x1b[0m`);
  for (const r of receipts) {
    console.log(`  https://lora.algokit.io/testnet/transaction/${r.txId ?? "(no tx id)"}`);
  }
  console.log("");
}

main().catch((err) => { console.error(`\n\x1b[31magent failed:\x1b[0m ${err.message}\n`); process.exit(1); });
