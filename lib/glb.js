// Minimal binary-glTF (.glb) reader.
//
// Pulls every triangle primitive out of the file, applies each node's world transform,
// and merges the result into one indexed mesh. No dependencies — glTF's binary layout is
// well specified and this only needs the geometry, not materials, animation or skinning.

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_TYPES = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
};

const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("Not a .glb file (bad magic). If you have a .gltf + .bin pair, export as .glb instead.");
  }

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < view.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (chunkType === CHUNK_JSON) {
      json = JSON.parse(Buffer.from(buffer.buffer, buffer.byteOffset + start, chunkLength).toString("utf8"));
    } else if (chunkType === CHUNK_BIN) {
      bin = Buffer.from(buffer.buffer, buffer.byteOffset + start, chunkLength);
    }
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

function readAccessor(gltf, bin, index) {
  const accessor = gltf.accessors[index];
  const comp = COMPONENT_TYPES[accessor.componentType];
  if (!comp) throw new Error(`Unsupported componentType ${accessor.componentType}`);
  const numComponents = TYPE_COMPONENTS[accessor.type];
  if (!numComponents) throw new Error(`Unsupported accessor type ${accessor.type}`);

  const out = new Float64Array(accessor.count * numComponents);
  if (accessor.bufferView === undefined) return out; // spec allows an all-zero accessor

  const bufferView = gltf.bufferViews[accessor.bufferView];
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const elementSize = comp.size * numComponents;
  const stride = bufferView.byteStride || elementSize;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  const readOne = (byteOffset) => {
    switch (accessor.componentType) {
      case 5120: return dv.getInt8(byteOffset);
      case 5121: return dv.getUint8(byteOffset);
      case 5122: return dv.getInt16(byteOffset, true);
      case 5123: return dv.getUint16(byteOffset, true);
      case 5125: return dv.getUint32(byteOffset, true);
      case 5126: return dv.getFloat32(byteOffset, true);
      default: throw new Error("unreachable");
    }
  };

  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < numComponents; c++) {
      out[i * numComponents + c] = readOne(base + i * stride + c * comp.size);
    }
  }
  return out;
}

// --- 4x4 column-major matrix helpers (glTF convention) ---
const IDENTITY = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function fromTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  return fromTRS(node.translation, node.rotation, node.scale);
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function materialOf(gltf, index) {
  const m = gltf.materials?.[index];
  const pbr = m?.pbrMetallicRoughness;
  return {
    baseColor: pbr?.baseColorFactor?.slice(0, 3) ?? [0.8, 0.8, 0.82],
    metallic: pbr?.metallicFactor ?? 1.0,
    roughness: pbr?.roughnessFactor ?? 0.5,
  };
}

// Merge every triangle primitive in the file into one indexed mesh, in world space.
export function extractMesh(buffer) {
  const { json: gltf, bin } = parseGlb(buffer);
  if (!gltf.meshes?.length) throw new Error("GLB contains no meshes");

  const positions = [];
  const colors = [];
  const indices = [];
  const materialWeights = new Map(); // material index -> triangle count, to pick the dominant one
  let skippedNonTriangle = 0;

  const visitMesh = (meshIndex, world) => {
    for (const prim of gltf.meshes[meshIndex].primitives ?? []) {
      // mode 4 is TRIANGLES; default is 4 when omitted.
      if (prim.mode !== undefined && prim.mode !== 4) { skippedNonTriangle++; continue; }
      const posAccessor = prim.attributes?.POSITION;
      if (posAccessor === undefined) continue;

      const pos = readAccessor(gltf, bin, posAccessor);
      const vertexBase = positions.length / 3;
      const mat = materialOf(gltf, prim.material);

      for (let i = 0; i < pos.length; i += 3) {
        const [x, y, z] = transformPoint(world, pos[i], pos[i + 1], pos[i + 2]);
        positions.push(x, y, z);
        // Per-vertex colour, so a multi-material model survives being merged into one mesh.
        colors.push(mat.baseColor[0], mat.baseColor[1], mat.baseColor[2]);
      }

      let triangleCount;
      if (prim.indices !== undefined) {
        const idx = readAccessor(gltf, bin, prim.indices);
        for (let i = 0; i < idx.length; i++) indices.push(vertexBase + idx[i]);
        triangleCount = idx.length / 3;
      } else {
        const count = pos.length / 3;
        for (let i = 0; i < count; i++) indices.push(vertexBase + i);
        triangleCount = count / 3;
      }
      const key = prim.material ?? -1;
      materialWeights.set(key, (materialWeights.get(key) ?? 0) + triangleCount);
    }
  };

  const visitNode = (nodeIndex, parentMatrix) => {
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parentMatrix, nodeMatrix(node));
    if (node.mesh !== undefined) visitMesh(node.mesh, world);
    for (const child of node.children ?? []) visitNode(child, world);
  };

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (scene?.nodes?.length) {
    for (const n of scene.nodes) visitNode(n, IDENTITY);
  } else {
    // No scene graph — just take every mesh at the origin.
    for (let i = 0; i < gltf.meshes.length; i++) visitMesh(i, IDENTITY);
  }

  if (!indices.length) throw new Error("GLB contains no triangle geometry");

  // Metalness and roughness are global in the viewer, so take them from whichever material
  // covers the most triangles rather than whichever happens to be first.
  let dominant = -1;
  let bestWeight = -1;
  for (const [k, w] of materialWeights) {
    if (w > bestWeight) { bestWeight = w; dominant = k; }
  }
  const dominantMaterial = materialOf(gltf, dominant);

  return {
    positions,
    colors,
    indices,
    skippedNonTriangle,
    materialCount: gltf.materials?.length ?? 0,
    dominantMaterial,
  };
}
