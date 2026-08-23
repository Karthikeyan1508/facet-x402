// Offline stand-in for an x402 facilitator.
//
// Answers the /supported handshake and, with --bazaar, serves a /discovery/resources
// catalogue so the whole discovery loop can be exercised with no network. It cannot
// settle anything — real payments still need the real facilitator.
//
//   npm run stub-facilitator
//   npm run stub-facilitator -- --bazaar          (adds a discovery catalogue)
//   npm run stub-facilitator -- --bazaar --rival  (adds a cheaper competitor)

import express from "express";

const PORT = Number(process.env.STUB_PORT) || 4099;
const NETWORK = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
const withBazaar = process.argv.includes("--bazaar");
const withRival = process.argv.includes("--rival");
const FACET = process.env.FACET_URL || "http://localhost:4020";

const app = express();
app.use(express.json());

app.get("/supported", (_req, res) => {
  res.json({
    kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
    // Advertising "bazaar" is what makes the resource server bother declaring discovery.
    extensions: withBazaar ? ["bazaar"] : [],
    signers: {},
  });
});

function resource(url, amount, tags, description, serviceName) {
  return {
    resource: url,
    type: "http",
    x402Version: 2,
    accepts: [{ scheme: "exact", network: NETWORK, amount: String(amount), asset: "10458941", payTo: "STUB" }],
    lastUpdated: "2026-08-23T00:00:00.000Z",
    description,
    mimeType: "application/json",
    serviceName,
    tags,
  };
}

const catalogue = [
  resource(`${FACET}/api/asset/wheel-rt5/draft`, 5000, ["3d-asset", "mesh", "low-poly", "thumbnail"], "Draft mesh", "Facet"),
  resource(`${FACET}/api/asset/wheel-rt5/production`, 20000, ["3d-asset", "mesh", "high-poly", "configurator", "ar"], "Production mesh", "Facet"),
  resource(`${FACET}/api/asset/wheel-rt5/pbr`, 30000, ["3d-asset", "material", "pbr", "photoreal"], "PBR material set", "Facet"),
  resource(`${FACET}/api/asset/wheel-rt5/license`, 50000, ["3d-asset", "licence", "commercial-use"], "Commercial licence", "Facet"),
  // Unrelated resources, so filtering by tag is actually doing work.
  resource("https://example.com/weather", 1000, ["weather", "api"], "Weather API", "SomeoneElse"),
  resource("https://example.com/translate", 4000, ["translation"], "Translation", "SomeoneElse"),
];

if (withRival) {
  // A cheaper competitor offering the same capability. The host does not exist on purpose:
  // it proves two things at once — that selection really is price-driven, and that the
  // agent falls through to the next seller when the winner cannot deliver.
  catalogue.push(
    resource("https://rival.example.com/cheap-lowpoly", 1000, ["3d-asset", "mesh", "low-poly", "thumbnail"], "Budget low-poly mesh (deliberately unreachable)", "RivalStudio")
  );
}

app.get("/discovery/resources", (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  const items = catalogue.slice(offset, offset + limit);
  res.json({ x402Version: 2, items, pagination: { limit, offset, total: catalogue.length } });
});

app.listen(PORT, () => {
  console.log(`stub facilitator on :${PORT}` +
    (withBazaar ? `  [bazaar: ${catalogue.length} resources${withRival ? ", incl. a cheaper rival" : ""}]` : ""));
});
