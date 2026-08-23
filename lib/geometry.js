// Procedural automotive alloy-wheel generator.
//
// The whole point of Facet is that fidelity is the unit of sale, so the mesh has to be
// genuinely generated at different triangle budgets server-side — the client must never
// receive high-fidelity data it hasn't paid for. Everything here is plain math, no
// three.js on the server, so the seller stays dependency-light and deterministic.

// Wheel cross-section profile, revolved around the Z axis.
// Each point is [radius, depth]. Ordered front-face -> outer tread -> back-face.
// Rim + tyre cross-section, revolved around Z. This is a CLOSED loop: the wheel's centre
// is deliberately empty so the spokes are the visible structure spanning hub to rim,
// exactly like a real alloy. Ordered front-inner -> outward -> around the tyre -> back-inner.
const RIM_PROFILE = [
  [0.605,  0.030], // inner barrel, front lip
  [0.640,  0.070],
  [0.672,  0.125], // rim flange, front
  [0.712,  0.170],
  [0.780,  0.198], // tyre sidewall begins
  [0.900,  0.190],
  [0.965,  0.150],
  [1.000,  0.080], // tread, front edge
  [1.000, -0.080], // tread, back edge
  [0.965, -0.150],
  [0.900, -0.190],
  [0.780, -0.198],
  [0.712, -0.170],
  [0.672, -0.125], // rim flange, back
  [0.640, -0.095],
  [0.605, -0.055], // inner barrel, back lip
  [0.585, -0.040], // inner barrel wall, closing the loop back to the front lip
  [0.585,  0.015],
];

// The centre hub the spokes bolt into.
const HUB_PROFILE = [
  [0.000,  0.062],
  [0.150,  0.062],
  [0.205,  0.040],
  [0.215, -0.020],
  [0.180, -0.050],
  [0.000, -0.050],
];

// Catmull-Rom through the profile points, so higher tiers get a genuinely smoother
// silhouette rather than just more coplanar triangles.
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [0, 1].map((i) =>
    0.5 *
    ((2 * p1[i]) +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)
  );
}

function resampleProfile(profile, subdivisions, looped = false) {
  if (subdivisions <= 1) return profile.slice();
  const n = profile.length;
  const at = (i) => (looped ? profile[((i % n) + n) % n] : profile[Math.min(n - 1, Math.max(0, i))]);
  const out = [];
  const segments = looped ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    for (let s = 0; s < subdivisions; s++) {
      out.push(catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), s / subdivisions));
    }
  }
  if (!looped) out.push(profile[n - 1]);
  return out;
}

class MeshBuilder {
  constructor() {
    this.positions = [];
    this.indices = [];
  }
  addVertex(x, y, z) {
    this.positions.push(x, y, z);
    return this.positions.length / 3 - 1;
  }
  addTriangle(a, b, c) {
    // Wound so that face normals point OUT of the solid. Getting this backwards makes
    // every surface cull as a backface in the renderer and inverts the shading.
    this.indices.push(a, c, b);
  }
  addQuad(a, b, c, d) {
    this.addTriangle(a, b, c);
    this.addTriangle(a, c, d);
  }
  get triangleCount() {
    return this.indices.length / 3;
  }
  get vertexCount() {
    return this.positions.length / 3;
  }
}

// Revolve the profile around the Z axis.
function buildRevolve(mesh, profile, radialSegments, closed = false) {
  const ringStart = [];
  for (let i = 0; i < profile.length; i++) {
    const [r, z] = profile[i];
    const ring = [];
    for (let s = 0; s < radialSegments; s++) {
      const a = (s / radialSegments) * Math.PI * 2;
      ring.push(mesh.addVertex(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    ringStart.push(ring);
  }
  const last = closed ? profile.length : profile.length - 1;
  for (let i = 0; i < last; i++) {
    const ringA = ringStart[i];
    const ringB = ringStart[(i + 1) % profile.length];
    for (let s = 0; s < radialSegments; s++) {
      const n = (s + 1) % radialSegments;
      mesh.addQuad(ringA[s], ringA[n], ringB[n], ringB[s]);
    }
  }
  return ringStart;
}

// Cap the hub openings with a triangle fan so the wheel is a closed solid.
function capRing(mesh, ring, z, flip) {
  const center = mesh.addVertex(0, 0, z);
  const n = ring.length;
  for (let s = 0; s < n; s++) {
    const a = ring[s];
    const b = ring[(s + 1) % n];
    if (flip) mesh.addTriangle(center, b, a);
    else mesh.addTriangle(center, a, b);
  }
}

// Cap a spoke end using the ring's own centroid (the ring is not axis-centred).
function capRingCentroid(mesh, ring, flip) {
  let cx = 0, cy = 0, cz = 0;
  for (const idx of ring) {
    cx += mesh.positions[idx * 3];
    cy += mesh.positions[idx * 3 + 1];
    cz += mesh.positions[idx * 3 + 2];
  }
  const n = ring.length;
  const center = mesh.addVertex(cx / n, cy / n, cz / n);
  for (let s = 0; s < n; s++) {
    const a = ring[s];
    const b = ring[(s + 1) % n];
    if (flip) mesh.addTriangle(center, b, a);
    else mesh.addTriangle(center, a, b);
  }
}

function computeNormals(positions, indices) {
  const normals = new Float64Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  const out = new Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], y = normals[i + 1], z = normals[i + 2];
    const len = Math.hypot(x, y, z) || 1;
    out[i] = round(x / len);
    out[i + 1] = round(y / len);
    out[i + 2] = round(z / len);
  }
  return out;
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

// Fidelity tiers. These are the actual product SKUs — each is a separately priced
// x402 resource, and each genuinely produces a different mesh.
export const TIERS = {
  0: { key: "preview",    label: "Preview",          radialSegments: 14,  profileSubdiv: 1, spokes: { count: 5, lengthSegments: 2,  sectionSegments: 4  } },
  1: { key: "draft",      label: "Draft mesh",       radialSegments: 40,  profileSubdiv: 2, spokes: { count: 5, lengthSegments: 5,  sectionSegments: 8  } },
  2: { key: "production", label: "Production mesh",  radialSegments: 128, profileSubdiv: 4, spokes: { count: 5, lengthSegments: 14, sectionSegments: 20 } },
  3: { key: "pbr",        label: "PBR material set", radialSegments: 128, profileSubdiv: 4, spokes: { count: 5, lengthSegments: 14, sectionSegments: 20 } },
  4: { key: "license",    label: "Commercial licence", radialSegments: 128, profileSubdiv: 4, spokes: { count: 5, lengthSegments: 14, sectionSegments: 20 } },
};

// Physically-based material description, sold as tier 3. Withholding this is what makes
// the tier-2 mesh look like grey clay and the tier-3 mesh look like a real alloy wheel.
export const PBR_MATERIAL = {
  name: "Diamond-cut alloy, satin graphite",
  rim: { color: "#c9ced6", metalness: 1.0, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.18 },
  tyre: { color: "#14151a", metalness: 0.0, roughness: 0.92 },
  envIntensity: 1.15,
  tyreProfileRadius: 0.78,
};

export function buildWheel(tierId) {
  const tier = TIERS[tierId];
  if (!tier) throw new Error(`Unknown tier: ${tierId}`);

  const mesh = new MeshBuilder();

  // Rim + tyre: a closed-loop cross-section, so no caps and no solid centre disc.
  const rimProfile = resampleProfile(RIM_PROFILE, tier.profileSubdiv, true);
  buildRevolve(mesh, rimProfile, tier.radialSegments, true);

  // Hub: an open profile that starts and ends on the axis, so it needs no caps either.
  const hubProfile = resampleProfile(HUB_PROFILE, Math.max(1, tier.profileSubdiv - 1), false);
  buildRevolve(mesh, hubProfile, tier.radialSegments, false);

  // Spokes span the open gap between hub and rim — the reason this reads as an alloy.
  buildSpokesSafe(mesh, tier.spokes);

  const positions = mesh.positions.map(round);
  const normals = computeNormals(mesh.positions, mesh.indices);

  return {
    tier: tierId,
    tierKey: tier.key,
    label: tier.label,
    positions,
    normals,
    indices: mesh.indices,
    triangleCount: mesh.triangleCount,
    vertexCount: mesh.vertexCount,
    tyreProfileRadius: PBR_MATERIAL.tyreProfileRadius,
  };
}

function buildSpokesSafe(mesh, spec) {
  const innerR = 0.16;
  const outerR = 0.635;
  const { count, lengthSegments, sectionSegments } = spec;
  for (let k = 0; k < count; k++) {
    const spokeAngle = (k / count) * Math.PI * 2;
    const ca = Math.cos(spokeAngle);
    const sa = Math.sin(spokeAngle);
    const rings = [];
    for (let l = 0; l <= lengthSegments; l++) {
      const t = l / lengthSegments;
      const r = innerR + (outerR - innerR) * t;
      const halfWidth = 0.115 * (1 - 0.45 * t);
      const halfDepth = 0.048 * (1 - 0.35 * t);
      const zCenter = 0.052 - 0.012 * t;
      const ring = [];
      for (let s = 0; s < sectionSegments; s++) {
        const a = (s / sectionSegments) * Math.PI * 2;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        const shape = 0.65;
        const w = Math.sign(cx) * Math.pow(Math.abs(cx), shape) * halfWidth;
        const d = Math.sign(cz) * Math.pow(Math.abs(cz), shape) * halfDepth;
        ring.push(mesh.addVertex(ca * r - sa * w, sa * r + ca * w, zCenter + d));
      }
      rings.push(ring);
    }
    for (let l = 0; l < lengthSegments; l++) {
      const ringA = rings[l];
      const ringB = rings[l + 1];
      for (let s = 0; s < sectionSegments; s++) {
        const n = (s + 1) % sectionSegments;
        mesh.addQuad(ringA[s], ringA[n], ringB[n], ringB[s]);
      }
    }
    capRingCentroid(mesh, rings[0], false);
    capRingCentroid(mesh, rings[rings.length - 1], true);
  }
}
