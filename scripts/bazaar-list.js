// Query the x402 Bazaar and report whether this deployment's resources are catalogued.
//
//   npm run bazaar:list
//   npm run bazaar:list -- --mine https://facet-x402.vercel.app
//   npm run bazaar:list -- --tag 3d-asset

import "dotenv/config";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { withBazaar } from "@x402/extensions/bazaar";

const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";

const argv = process.argv.slice(2);
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const mine = argOf("--mine") || process.env.FACET_URL || null;
const tag = argOf("--tag");
const limit = Number(argOf("--limit")) || 200;

const client = withBazaar(new HTTPFacilitatorClient({ url: FACILITATOR_URL }));

console.log(`\nQuerying the Bazaar at ${FACILITATOR_URL}\n`);

let response;
try {
  response = await client.extensions.bazaar.listResources({ type: "http", limit });
} catch (err) {
  console.error(`Could not reach the Bazaar: ${err.message}\n`);
  process.exit(1);
}

const items = response.items ?? [];
const total = response.pagination?.total ?? items.length;
console.log(`  catalogued resources : ${total.toLocaleString()} (showing ${items.length})`);

// Every tag in use, so you can see what an agent could realistically filter on.
const tagCounts = new Map();
for (const it of items) for (const t of it.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
if (topTags.length) {
  console.log(`  most common tags     : ${topTags.map(([t, n]) => `${t}(${n})`).join(", ")}`);
}

if (tag) {
  const matches = items.filter((it) => it.tags?.includes(tag));
  console.log(`\nResources tagged "${tag}": ${matches.length}`);
  for (const m of matches.slice(0, 20)) {
    const price = m.accepts?.[0]?.amount ?? m.accepts?.[0]?.price ?? "?";
    console.log(`  ${String(price).padStart(9)}  ${m.resource}`);
  }
}

if (mine) {
  const host = new URL(mine).host;
  const ours = items.filter((it) => { try { return new URL(it.resource).host === host; } catch { return false; } });
  console.log(`\nYour resources (${host}): ${ours.length}`);
  if (!ours.length) {
    console.log(`  Not catalogued yet. Things to check, in order:
    · Is BAZAAR_ENABLED=1 set on the deployment?
    · Is the deployment reachable on a public URL? Facilitators skip localhost.
    · Has a 402 been served since enabling it? Registration happens when the route
      first advertises its payment requirements — hit each tier once, unpaid.`);
  } else {
    for (const o of ours) {
      const price = o.accepts?.[0]?.amount ?? "?";
      const hasSchema = o.extensions?.bazaar ? "with schema" : "no schema";
      console.log(`  ${String(price).padStart(9)}  ${o.resource}`);
      console.log(`             tags: ${(o.tags ?? []).join(", ") || "none"}  ·  ${hasSchema}`);
    }
  }
}
console.log("");
