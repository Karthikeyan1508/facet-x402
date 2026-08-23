// Vertex-clustering decimation.
//
// Overlay a 3D grid on the mesh, collapse every vertex in a cell to one representative,
// then drop triangles whose corners collapsed together. Crude next to quadric error
// metrics, but dependency-free, fast, and it degrades a mesh in a way you can see — which
// is exactly what a fidelity tier needs to demonstrate.

function boundingBox(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i];
    if (positions[i] > maxX) maxX = positions[i];
    if (positions[i + 1] < minY) minY = positions[i + 1];
    if (positions[i + 1] > maxY) maxY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// 95th-percentile edge length of the source mesh, sampled. Used as a floor for the
// sliver threshold: below this, the filter would be rejecting original geometry rather
// than clustering artifacts.
function sourceEdgeP95(positions, indices) {
  const lengths = [];
  const stride = Math.max(3, Math.floor(indices.length / 3 / 2000) * 3);
  for (let i = 0; i < indices.length; i += stride) {
    const a = indices[i] * 3, b = indices[i + 1] * 3;
    lengths.push(Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]));
  }
  if (!lengths.length) return Infinity;
  lengths.sort((x, y) => x - y);
  return lengths[Math.floor(lengths.length * 0.95)];
}

function clusterOnce(positions, indices, gridSize, edgeFloor) {
  const bb = boundingBox(positions);
  const spanX = Math.max(bb.maxX - bb.minX, 1e-9);
  const spanY = Math.max(bb.maxY - bb.minY, 1e-9);
  const spanZ = Math.max(bb.maxZ - bb.minZ, 1e-9);
  const longest = Math.max(spanX, spanY, spanZ);
  const cell = longest / gridSize;

  // Accumulate each cell's centroid.
  const cells = new Map();
  const vertexCell = new Int32Array(positions.length / 3);

  for (let v = 0; v < positions.length / 3; v++) {
    const gx = Math.floor((positions[v * 3] - bb.minX) / cell);
    const gy = Math.floor((positions[v * 3 + 1] - bb.minY) / cell);
    const gz = Math.floor((positions[v * 3 + 2] - bb.minZ) / cell);
    const key = `${gx},${gy},${gz}`;
    let entry = cells.get(key);
    if (!entry) {
      entry = { id: cells.size, x: 0, y: 0, z: 0, n: 0 };
      cells.set(key, entry);
    }
    entry.x += positions[v * 3];
    entry.y += positions[v * 3 + 1];
    entry.z += positions[v * 3 + 2];
    entry.n += 1;
    vertexCell[v] = entry.id;
  }

  const newPositions = new Array(cells.size * 3);
  for (const entry of cells.values()) {
    newPositions[entry.id * 3] = entry.x / entry.n;
    newPositions[entry.id * 3 + 1] = entry.y / entry.n;
    newPositions[entry.id * 3 + 2] = entry.z / entry.n;
  }

  // Keep only triangles whose three corners landed in three different cells, and drop
  // slivers. Clustering leaves long thin triangles wherever a face spanned several cells
  // across a thin feature (a rim flange, a panel edge); left in, they render as spikes and
  // read as a bug rather than as lower fidelity.
  const maxEdge = Math.max(cell * 2.5, edgeFloor * 1.5);
  const maxEdgeSq = maxEdge * maxEdge;
  const edgeTooLong = (i, j) => {
    const dx = newPositions[i * 3] - newPositions[j * 3];
    const dy = newPositions[i * 3 + 1] - newPositions[j * 3 + 1];
    const dz = newPositions[i * 3 + 2] - newPositions[j * 3 + 2];
    return dx * dx + dy * dy + dz * dz > maxEdgeSq;
  };

  const newIndices = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertexCell[indices[i]];
    const b = vertexCell[indices[i + 1]];
    const c = vertexCell[indices[i + 2]];
    if (a === b || b === c || a === c) continue;
    if (edgeTooLong(a, b) || edgeTooLong(b, c) || edgeTooLong(a, c)) continue;
    newIndices.push(a, b, c);
  }

  return { positions: newPositions, indices: newIndices };
}

// Binary-search the grid resolution until the triangle count lands near the target.
export function decimateToTarget(positions, indices, targetTriangles, { maxIterations = 12 } = {}) {
  const sourceTriangles = indices.length / 3;
  if (sourceTriangles <= targetTriangles) {
    return { positions: positions.slice(), indices: indices.slice(), gridSize: null, exact: true };
  }

  const edgeFloor = sourceEdgeP95(positions, indices);

  // The triangle count is monotonic in grid size only up to the point where the grid is
  // finer than the mesh itself; past that it plateaus. Rather than assume monotonicity —
  // an earlier version of this did, and walked straight off the far side of the curve —
  // scan a geometric ladder of grid sizes and keep the closest result.
  const candidates = [];
  for (let g = 4; g <= 512; g = Math.max(g + 1, Math.round(g * 1.35))) candidates.push(g);

  let best = null;
  for (const g of candidates) {
    const result = clusterOnce(positions, indices, g, edgeFloor);
    const count = result.indices.length / 3;
    if (count === 0) continue;
    if (!best || Math.abs(count - targetTriangles) < Math.abs(best.indices.length / 3 - targetTriangles)) {
      best = { ...result, gridSize: g };
    }
    // Once we are comfortably past the target there is nothing better further along.
    if (count >= targetTriangles * 1.05) break;
  }

  if (!best) return { positions: positions.slice(), indices: indices.slice(), gridSize: null, exact: true };
  return { ...best, exact: false };
}

export function computeNormals(positions, indices) {
  const acc = new Float64Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const e1x = positions[ib] - positions[ia];
    const e1y = positions[ib + 1] - positions[ia + 1];
    const e1z = positions[ib + 2] - positions[ia + 2];
    const e2x = positions[ic] - positions[ia];
    const e2y = positions[ic + 1] - positions[ia + 1];
    const e2z = positions[ic + 2] - positions[ia + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const base of [ia, ib, ic]) {
      acc[base] += nx; acc[base + 1] += ny; acc[base + 2] += nz;
    }
  }
  const out = new Array(positions.length);
  for (let i = 0; i < acc.length; i += 3) {
    const len = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
    out[i] = Math.round((acc[i] / len) * 10000) / 10000;
    out[i + 1] = Math.round((acc[i + 1] / len) * 10000) / 10000;
    out[i + 2] = Math.round((acc[i + 2] / len) * 10000) / 10000;
  }
  return out;
}

// Centre on the origin and scale so the longest axis is `targetSize`, so any model — a
// 2mm screw or a 5m car — frames correctly in the viewer without manual tweaking.
export function normalise(positions, targetSize = 2.0) {
  const bb = boundingBox(positions);
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const cz = (bb.minZ + bb.maxZ) / 2;
  const longest = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, bb.maxZ - bb.minZ, 1e-9);
  const scale = targetSize / longest;
  const out = new Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = Math.round((positions[i] - cx) * scale * 10000) / 10000;
    out[i + 1] = Math.round((positions[i + 1] - cy) * scale * 10000) / 10000;
    out[i + 2] = Math.round((positions[i + 2] - cz) * scale * 10000) / 10000;
  }
  return out;
}
