// Ingest a .glb and generate the fidelity tiers Facet sells.
//
//   npm run ingest -- path/to/model.glb
//   npm run ingest -- model.glb --name "Brake Caliper, 4-pot"
//
// Tiers are generated ahead of time and written to assets/tiers.json rather than being
// decimated per request: a serverless function has no writable disk and no budget to
// decimate a large mesh inside a request.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractMesh } from "../lib/glb.js";
import { decimateToTarget, normalise, computeNormals } from "../lib/decimate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "assets", "tiers.json");

// Tier budgets are RELATIVE to the source, not fixed numbers.
//
// This matters more than it looks. The top tier must be the seller's actual master —
// if it were a fixed budget, a studio ingesting a 180k-triangle model would find the
// most expensive tier silently decimated down to a fraction of what they uploaded, and
// the buyer could never receive the thing they paid for. Facet cannot invent detail, so
// the least it can do is never destroy the detail the seller actually has.
//
// The only cap is a practical one: a serverless response has a hard size limit. Measured
// on real payloads this geometry costs ~39 bytes per triangle as JSON, so 70k triangles
// is ~2.7 MB — comfortably inside Vercel's 4.5 MB response ceiling with room for the
// headers and the payment metadata. (An earlier 90k cap produced a 3.4 MB body, which
// left far too little margin.)
const MAX_TIER2_TRIANGLES = 70_000;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function tierTargets(sourceTriangles) {
  return {
    0: clamp(sourceTriangles * 0.03, 400, 1200),    // free preview — evaluation only
    1: clamp(sourceTriangles * 0.15, 2000, 12000),  // draft — thumbnails, listings
    2: Math.min(sourceTriangles, MAX_TIER2_TRIANGLES), // production — the master itself
  };
}

function parseArgs(argv) {
  const file = argv.find((a) => !a.startsWith("--"));
  const nameIndex = argv.indexOf("--name");
  const name = nameIndex >= 0 ? argv[nameIndex + 1] : null;
  return { file, name };
}

const { file, name } = parseArgs(process.argv.slice(2));

if (!file) {
  console.error(`
Usage: npm run ingest -- <model.glb> [--name "Display Name"]

Generates assets/tiers.json from a binary glTF file. Delete that file to go back to
the built-in procedural wheel.
`);
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`\nNo such file: ${file}\n`);
  process.exit(1);
}

console.log(`\nIngesting ${file}`);

let mesh;
try {
  mesh = extractMesh(fs.readFileSync(file));
} catch (err) {
  console.error(`\nCould not read that GLB: ${err.message}\n`);
  process.exit(1);
}

const sourceTriangles = mesh.indices.length / 3;
console.log(`  source          ${sourceTriangles.toLocaleString()} triangles, ${(mesh.positions.length / 3).toLocaleString()} vertices`);
console.log(`  materials       ${mesh.materialCount} in source; dominant metalness ${mesh.dominantMaterial.metallic.toFixed(2)}, roughness ${mesh.dominantMaterial.roughness.toFixed(2)}`);
if (mesh.skippedNonTriangle) {
  console.log(`  note            skipped ${mesh.skippedNonTriangle} non-triangle primitive(s)`);
}

// Centre and scale so any model — a 2 mm screw or a 5 m car — frames correctly.
const positions = normalise(mesh.positions, 2.0);

const TARGETS = tierTargets(sourceTriangles);

const tiers = {};
for (const [tier, target] of Object.entries(TARGETS)) {
  const started = Date.now();
  const d = decimateToTarget(positions, mesh.indices, target, { colors: mesh.colors });
  const normals = computeNormals(d.positions, d.indices);
  tiers[tier] = {
    positions: d.positions.map((n) => Math.round(n * 10000) / 10000),
    normals,
    indices: d.indices,
    triangleCount: d.indices.length / 3,
    vertexCount: d.positions.length / 3,
    ...(d.colors ? { colors: d.colors.map((n) => Math.round(n * 1000) / 1000) } : {}),
  };
  const pct = ((tiers[tier].triangleCount / sourceTriangles) * 100).toFixed(1);
  const note = tier === "2"
    ? (sourceTriangles <= MAX_TIER2_TRIANGLES ? "  <- the full master, untouched" : "  <- capped by response size limit")
    : "";
  console.log(
    `  tier ${tier}          ${String(tiers[tier].triangleCount).padStart(7)} triangles ` +
    `(${pct.padStart(5)}% of source)  ${Date.now() - started}ms${note}`
  );
}

if (sourceTriangles > MAX_TIER2_TRIANGLES) {
  console.log(`
  NOTE: the source has ${sourceTriangles.toLocaleString()} triangles, above the
  ${MAX_TIER2_TRIANGLES.toLocaleString()} that fits in a single serverless response, so the top tier is a
  decimated version rather than your master. Delivering masters above this size needs
  compression or chunked download — see "Scope of improvement" in the README.`);
}

if (tiers["2"].triangleCount < tiers["0"].triangleCount * 4) {
  console.log(`
  WARNING: this source is too low-poly for the tiers to differ meaningfully. Facet
  cannot invent detail that is not in the file — it can only ration detail that is.
  Ingest the high-poly master, not a preview someone else already decimated.`);
}

const payload = {
  assetName: name ?? path.basename(file, path.extname(file)),
  source: {
    file: path.basename(file),
    sourceTriangles,
    ingestedAt: new Date().toISOString(),
  },
  // An arbitrary model has no rim/tyre split; the viewer shades it with one material.
  tyreProfileRadius: 1e9,
  // Metalness and roughness come from the model's dominant material; per-vertex colours
  // carry the rest, so a multi-material model keeps looking like itself.
  material: {
    name: mesh.materialCount
      ? `From source · ${mesh.materialCount} material${mesh.materialCount === 1 ? "" : "s"}`
      : "Polished metal",
    rim: {
      color: "#ffffff", // white, so the per-vertex colours are not tinted
      metalness: mesh.dominantMaterial.metallic,
      roughness: Math.max(0.08, mesh.dominantMaterial.roughness),
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
    },
    tyre: { color: "#14151a", metalness: 0.0, roughness: 0.92 },
    envIntensity: 1.1,
    tyreProfileRadius: 1e9,
    useVertexColors: true,
  },
  tiers,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));

console.log(`
  wrote           assets/tiers.json (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)
  asset name      ${payload.assetName}

Restart the server to pick it up. Delete assets/tiers.json to return to the wheel.
`);
