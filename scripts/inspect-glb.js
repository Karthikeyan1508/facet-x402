// Prints what a GLB actually contains, so you can see why an ingested asset looks the way
// it does before spending time guessing.
//
//   npm run inspect -- path/to/model.glb

import fs from "fs";
import { parseGlb } from "../lib/glb.js";

const file = process.argv[2];
if (!file) { console.error("\nUsage: npm run inspect -- <model.glb>\n"); process.exit(1); }
if (!fs.existsSync(file)) { console.error(`\nNo such file: ${file}\n`); process.exit(1); }

const { json: gltf } = parseGlb(fs.readFileSync(file));

console.log(`\n${file}`);
console.log(`  generator     ${gltf.asset?.generator ?? "unknown"}`);
console.log(`  meshes        ${gltf.meshes?.length ?? 0}`);
console.log(`  materials     ${gltf.materials?.length ?? 0}`);
console.log(`  textures      ${gltf.textures?.length ?? 0}`);
console.log(`  images        ${gltf.images?.length ?? 0}`);

let triangles = 0;
let texturedPrims = 0;
let totalPrims = 0;
for (const mesh of gltf.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    totalPrims++;
    if (prim.indices !== undefined) triangles += gltf.accessors[prim.indices].count / 3;
    else if (prim.attributes?.POSITION !== undefined) triangles += gltf.accessors[prim.attributes.POSITION].count / 3;
    const m = gltf.materials?.[prim.material];
    if (m?.pbrMetallicRoughness?.baseColorTexture) texturedPrims++;
  }
}
console.log(`  primitives    ${totalPrims}`);
console.log(`  triangles     ${Math.round(triangles).toLocaleString()}`);

console.log(`\nMATERIALS`);
if (!gltf.materials?.length) {
  console.log("  none — everything will render in Facet's default grey.");
} else {
  for (const [i, m] of gltf.materials.entries()) {
    const pbr = m.pbrMetallicRoughness ?? {};
    const f = pbr.baseColorFactor;
    const hasTex = Boolean(pbr.baseColorTexture);
    const hex = f
      ? "#" + f.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")
      : "(none -> defaults to white)";
    console.log(`  [${i}] ${(m.name ?? "unnamed").padEnd(24)} baseColor ${String(hex).padEnd(26)} ` +
      `metal ${String(pbr.metallicFactor ?? 1).padEnd(5)} rough ${String(pbr.roughnessFactor ?? 1).padEnd(5)} ` +
      `${hasTex ? "TEXTURED" : ""}`);
  }
}

console.log(`\nVERDICT`);
if (texturedPrims > 0) {
  console.log(`  ${texturedPrims} of ${totalPrims} primitives get their colour from a TEXTURE, not a colour value.`);
  console.log(`  Facet reads colour values only, so those parts will render white or near-white.`);
  console.log(`  Use a model whose materials carry solid baseColorFactor values, or accept the`);
  console.log(`  monochrome look. Reading textures needs image decoding — see the roadmap.`);
} else if (!gltf.materials?.length) {
  console.log(`  No materials at all — Facet will render this in its default grey.`);
} else {
  const distinct = new Set((gltf.materials ?? []).map((m) =>
    JSON.stringify(m.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3) ?? [1, 1, 1])));
  if (distinct.size === 1) {
    console.log(`  All ${gltf.materials.length} materials share one base colour, so the model is`);
    console.log(`  genuinely monochrome. Nothing is broken — that is what it looks like.`);
  } else {
    console.log(`  ${distinct.size} distinct base colours. These will come through in Facet.`);
  }
}
console.log("");
