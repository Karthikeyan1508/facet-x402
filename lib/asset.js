// Resolves which asset the server sells.
//
// If `assets/tiers.json` exists (produced by `npm run ingest -- model.glb`) the tiers come
// from that ingested model. Otherwise it falls back to the built-in procedural wheel, so a
// fresh clone works with no asset file at all.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildWheel, PBR_MATERIAL, TIERS } from "./geometry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIERS_FILE = path.join(__dirname, "..", "assets", "tiers.json");

function loadIngested() {
  try {
    if (!fs.existsSync(TIERS_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(TIERS_FILE, "utf8"));
    if (!parsed?.tiers?.["0"]) return null;
    return parsed;
  } catch {
    // A malformed asset file must not take the whole service down — fall back silently
    // to the procedural asset, which always works.
    return null;
  }
}

const ingested = loadIngested();

export const IS_INGESTED = Boolean(ingested);

export const ASSET_NAME = ingested?.assetName ?? 'RT5 Diamond-Cut Alloy Wheel · 18"';

export const SOURCE_INFO = ingested?.source ?? { generator: "procedural", sourceTriangles: null };

// Mesh tiers are 0 (free preview), 1 (draft) and 2 (production). Tiers 3 and 4 sell the
// material set and the licence, and reuse the tier-2 mesh.
export function getMesh(tierId) {
  if (ingested) {
    const key = String(Math.min(tierId, 2));
    const t = ingested.tiers[key];
    return {
      tier: tierId,
      tierKey: TIERS[tierId]?.key ?? key,
      label: TIERS[tierId]?.label ?? "",
      positions: t.positions,
      normals: t.normals,
      indices: t.indices,
      // Per-vertex colours, present only for ingested assets that had materials.
      ...(t.colors ? { colors: t.colors } : {}),
      triangleCount: t.triangleCount,
      vertexCount: t.vertexCount,
      // An arbitrary model has no meaningful rim/tyre split, so push the threshold beyond
      // any possible radius and let the viewer shade it with a single material.
      tyreProfileRadius: ingested.tyreProfileRadius ?? 1e9,
    };
  }
  return buildWheel(tierId);
}

export function getMaterial() {
  return ingested?.material ?? PBR_MATERIAL;
}

export function triangleCountFor(tierId) {
  if (ingested) return ingested.tiers[String(Math.min(tierId, 2))].triangleCount;
  return buildWheel(tierId).triangleCount;
}
