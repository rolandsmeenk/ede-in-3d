import * as THREE from 'three/webgpu';
import { attribute, mx_noise_float, positionWorld, normalWorld, float, smoothstep, fract, step, vertexColor } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GEO } from './nyc-geodata.js';
import { BLOCKS } from './city-config.js';
import { polygonContains } from './building-collision.js';
import { terrainHeightAt } from './terrain.js';
import { getAerialColors, sampleGroundColor, sampleRoofColor } from './aerial-colors.js';

// 3D BAG (LoD 2.2) 3D Tiles: real building volumes with roof shapes for the Netherlands.
// https://3dbag.nl — tiles are glTF with node matrices in ECEF (glTF axes: x = X, y = Z, z = -Y).
const BAG_BASE = 'https://3dbag.fsn1.your-objectstorage.com/v20250903/cesium3dtiles/lod22/';
const AFF = GEO.ede.meta.lonLatAffine;
const [MIN_X, MIN_Z, MAX_X, MAX_Z] = GEO.ede.meta.bounds;

const WGS84_A = 6378137, WGS84_E2 = 0.00669437999014;
const rad = (d) => d * Math.PI / 180;

function ecefFromLonLat(lon, lat, h = 0) {
  const sin = Math.sin(rad(lat)), cos = Math.cos(rad(lat));
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
  return new THREE.Vector3((n + h) * cos * Math.cos(rad(lon)), (n + h) * cos * Math.sin(rad(lon)), (n * (1 - WGS84_E2) + h) * sin);
}

// Matrix (double precision) from glTF-world ECEF coordinates to engine coordinates (x east, y up, z south, metres).
export function ecefToLocalMatrix(lon0 = AFF.lon0, lat0 = AFF.lat0) {
  const lon = rad(lon0), lat = rad(lat0);
  const e = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
  const n = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
  const u = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  const w = Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
  const prime = WGS84_A / w, meridian = WGS84_A * (1 - WGS84_E2) / (w * w * w);
  // Match the OSM data's equirectangular affine so that BAG and OSM layers coincide.
  const sx = AFF.x[1] / (rad(1) * prime * Math.cos(lat));
  const sz = -AFF.z[2] / (rad(1) * meridian);
  const origin = ecefFromLonLat(lon0, lat0);
  // ECEF -> engine: x = sx * E, y = U, z = -sz * N
  const ecefToLocal = new THREE.Matrix4().set(
    sx * e.x, sx * e.y, sx * e.z, 0,
    u.x, u.y, u.z, 0,
    -sz * n.x, -sz * n.y, -sz * n.z, 0,
    0, 0, 0, 1
  );
  const shift = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
  return new THREE.Matrix4().multiplyMatrices(ecefToLocal, shift);
}

// glTF world (y-up: X, Z, -Y of ECEF) -> engine coordinates.
export function gltfToLocalMatrix(ecefToLocal = ecefToLocalMatrix()) {
  const gltfToEcef = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1
  );
  return new THREE.Matrix4().multiplyMatrices(ecefToLocal, gltfToEcef);
}

const boxCorners = (box) => {
  const c = box.slice(0, 3), a = box.slice(3, 6), b = box.slice(6, 9), d = box.slice(9, 12);
  const out = [];
  for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) {
    out.push([0, 1, 2].map((m) => c[m] + i * a[m] + j * b[m] + k * d[m]));
  }
  return out;
};

// Local-space AABB of a 3D Tiles oriented box (given in glTF-world ECEF coordinates as used by the tileset).
export function boxLocalBounds(box, matrix) {
  const bounds = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const [x, y, z] of boxCorners(box)) bounds.expandByPoint(v.set(x, y, z).applyMatrix4(matrix));
  return bounds;
}

// Collects the leaf tile URLs of the tileset hierarchy that overlap the given local bounds.
export async function selectTiles(matrix, { minX = MIN_X, maxX = MAX_X, minZ = MIN_Z, maxZ = MAX_Z, margin = 60, fetchJson } = {}) {
  const getJson = fetchJson || (async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
  const overlaps = (box) => {
    const b = boxLocalBounds(box, matrix);
    return b.max.x >= minX - margin && b.min.x <= maxX + margin && b.max.z >= minZ - margin && b.min.z <= maxZ + margin;
  };
  const urls = [];
  const visit = async (node) => {
    if (!node.boundingVolume?.box || !overlaps(node.boundingVolume.box)) return;
    if (node.children?.length) { await Promise.all(node.children.map(visit)); return; }
    const uri = node.content?.uri;
    if (!uri) return;
    if (uri.endsWith('.json')) { const sub = await getJson(BAG_BASE + uri); await visit(sub.root); } else urls.push(BAG_BASE + uri);
  };
  await visit((await getJson(BAG_BASE + 'tileset.json')).root);
  return urls;
}

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const ROOF_CELL = 64;
let mappedRoofs;

function mappedRoofIndex() {
  const cells = new Map();
  for (const block of BLOCKS) {
    if (block.park || !block.osmId) continue;
    const footprint = { ...block, outer: block.poly };
    for (let x = Math.floor(block.minX / ROOF_CELL); x <= Math.floor(block.maxX / ROOF_CELL); x++) {
      for (let z = Math.floor(block.minZ / ROOF_CELL); z <= Math.floor(block.maxZ / ROOF_CELL); z++) {
        const key = `${x}/${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(footprint);
      }
    }
  }
  return cells;
}

function mappedRoofAt(x, z) {
  const cell = mappedRoofs.get(`${Math.floor(x / ROOF_CELL)}/${Math.floor(z / ROOF_CELL)}`);
  let match;
  for (const roof of cell || []) {
    if (x < roof.minX || x > roof.maxX || z < roof.minZ || z > roof.maxZ) continue;
    if ((!match || roof.area < match.area) && polygonContains(roof, x, z)) match = roof;
  }
  return match?.osmId;
}

const ROOF_WEIGHTS = [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.25, 0.25], [0.25, 0.5, 0.25], [0.25, 0.25, 0.5]];
const roofLuminance = ([r, g, b]) => r * 0.2126 + g * 0.7152 + b * 0.0722;

function estimateRoofColor(triangles, positions) {
  const votes = new Map(), points = [];
  let total = 0;
  // Larger projected triangles give cleaner interior samples than thin roof details.
  for (const { a, b, c, area } of [...triangles].sort((p, q) => q.area - p.area).slice(0, 8)) {
    const x0 = positions[a], z0 = positions[a + 2];
    const x1 = positions[b], z1 = positions[b + 2];
    const x2 = positions[c], z2 = positions[c + 2];
    total += area;
    const widestEdge = Math.max(Math.hypot(x1 - x0, z1 - z0), Math.hypot(x2 - x1, z2 - z1), Math.hypot(x0 - x2, z0 - z2));
    for (const [u, v, w] of ROOF_WEIGHTS) {
      const x = u * x0 + v * x1 + w * x2, z = u * z0 + v * z1 + w * z2;
      const id = mappedRoofAt(x, z);
      if (id !== undefined) votes.set(id, (votes.get(id) || 0) + area / ROOF_WEIGHTS.length);
      if (area / widestEdge >= 1.5) points.push([x, z]);
    }
  }
  const tint = [0, 0, 0];
  for (const [id, vote] of votes) {
    if (vote > total * 0.5 && sampleRoofColor(id, tint)) return tint;
  }
  const samples = [];
  for (const [x, z] of points) {
    if (sampleGroundColor(x, z, tint)) samples.push([...tint]);
  }
  if (samples.length < 3) return null;
  samples.sort((p, q) => roofLuminance(p) - roofLuminance(q));
  return samples[Math.floor((samples.length - 1) * 0.65)];
}

function colorBagRoofs(geometry, featureIds) {
  const { position, buildingHeight } = geometry.attributes;
  const positions = position.array, heights = buildingHeight.array;
  const index = geometry.index;
  const count = index?.count ?? position.count;
  const uses = index && new Uint8Array(position.count);
  const roofs = new Map();
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ux = positions[b] - positions[a], uy = heights[ib] - heights[ia], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = heights[ic] - heights[ia], vz = positions[c + 2] - positions[a + 2];
    const area = uz * vx - ux * vz;
    const id = Math.round(featureIds.getX(ia));
    const roof = area > 0.35 * Math.hypot(uy * vz - uz * vy, area, ux * vy - uy * vx)
      && Math.max(heights[ia], heights[ib], heights[ic]) > 0.25
      && id === Math.round(featureIds.getX(ib)) && id === Math.round(featureIds.getX(ic));
    if (uses) {
      const kind = roof ? 1 : 2;
      uses[ia] |= kind; uses[ib] |= kind; uses[ic] |= kind;
    }
    if (!roof) continue;
    if (!roofs.has(id)) roofs.set(id, []);
    roofs.get(id).push({ i, a, b, c, area });
  }
  const colors = geometry.attributes.color.array;
  const splits = new Map();
  let roofIndices;
  for (const triangles of roofs.values()) {
    const tint = estimateRoofColor(triangles, positions);
    if (!tint) continue;
    for (const { i, a, b, c } of triangles) {
      const vertices = [a / 3, b / 3, c / 3];
      for (let corner = 0; corner < 3; corner++) {
        const vertex = vertices[corner];
        if (uses?.[vertex] !== 3) {
          colors.set(tint, vertex * 3);
          continue;
        }
        // Keep the tile indexed and duplicate only vertices shared by tinted roofs and walls.
        roofIndices ??= Uint32Array.from(index.array);
        if (!splits.has(vertex)) splits.set(vertex, { vertex: position.count + splits.size, tint });
        roofIndices[i + corner] = splits.get(vertex).vertex;
      }
    }
  }
  if (roofIndices) {
    const vertexCount = position.count + splits.size;
    for (const [name, { array, itemSize, normalized }] of Object.entries(geometry.attributes)) {
      const expanded = new array.constructor(vertexCount * itemSize);
      expanded.set(array);
      for (const [source, { vertex, tint }] of splits) {
        const values = name === 'color' ? tint : array.subarray(source * itemSize, (source + 1) * itemSize);
        expanded.set(values, vertex * itemSize);
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(expanded, itemSize, normalized));
    }
    geometry.setIndex(new THREE.BufferAttribute(vertexCount > 65536 ? roofIndices : Uint16Array.from(roofIndices), 1));
  }
  return geometry;
}

// Bakes a loaded tile into one engine-space mesh geometry with per-building colour variation.
export function bakeTile(gltf, matrix) {
  const geometries = [];
  const useAerial = getAerialColors();
  if (useAerial) mappedRoofs ??= mappedRoofIndex();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const full = new THREE.Matrix4().multiplyMatrices(matrix, o.matrixWorld);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(full);
    const pos = src.attributes.position, nor = src.attributes.normal, fid = src.attributes._feature_id_0;
    const count = pos.count;
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    const v = new THREE.Vector3(), c = new THREE.Color();
    const baseByBuilding = new Map();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(full);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
      v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z;
      const seed = fid ? Math.round(fid.getX(i)) : 0;
      baseByBuilding.set(seed, Math.min(baseByBuilding.get(seed) ?? Infinity, positions[i * 3 + 1]));
      const r = hash(seed + 1), s = hash(seed * 7 + 3);
      if (v.y > 0.35) c.setHSL(0.03 + s * 0.04, 0.12 + r * 0.12, 0.17 + r * 0.1); // roofs: dark tile / slate
      else if (r < 0.62) c.setHSL(0.045 + s * 0.03, 0.34 + r * 0.2, 0.30 + s * 0.12); // brick
      else if (r < 0.85) c.setHSL(0.11 + s * 0.04, 0.12 + s * 0.12, 0.52 + r * 0.14); // plaster / stone
      else c.setHSL(0.08 + s * 0.05, 0.08, 0.40 + s * 0.15);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    // Use the low side of each footprint to seat the whole building without bending its roof.
    const relativeHeights = new Float32Array(count);
    const groundByBuilding = new Map();
    for (let i = 0; i < count; i++) {
      const seed = fid ? Math.round(fid.getX(i)) : 0, j = i * 3;
      const relativeHeight = positions[j + 1] - baseByBuilding.get(seed);
      relativeHeights[i] = relativeHeight;
      // The ECEF-to-local transform tilts a level building base slightly at the map edges.
      if (relativeHeight <= 0.25) {
        const ground = terrainHeightAt(positions[j], positions[j + 2]) - relativeHeight;
        groundByBuilding.set(seed, Math.min(groundByBuilding.get(seed) ?? Infinity, ground));
      }
    }
    for (let i = 0; i < count; i++) {
      const seed = fid ? Math.round(fid.getX(i)) : 0;
      positions[i * 3 + 1] = relativeHeights[i] + groundByBuilding.get(seed);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('buildingHeight', new THREE.BufferAttribute(relativeHeights, 1));
    if (src.index) g.setIndex(src.index.array instanceof Uint32Array || count > 65535 ? new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1) : new THREE.BufferAttribute(Uint16Array.from(src.index.array), 1));
    if (useAerial && fid) g = colorBagRoofs(g, fid);
    g.computeBoundingSphere(); g.computeBoundingBox();
    geometries.push(g);
  });
  return geometries;
}

function createMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  // Vertex colour with a subtle brightness grain and a window grid on walls.
  const grain = mx_noise_float(positionWorld.mul(0.7)).mul(0.1).add(0.95);
  const wall = step(normalWorld.y.abs(), 0.35);
  const along = positionWorld.x.mul(normalWorld.z.abs()).add(positionWorld.z.mul(normalWorld.x.abs()));
  const height = attribute('buildingHeight', 'float');
  const u = fract(along.div(3.1)), v = fract(height.div(3.2));
  const above = step(2.6, height);
  const win = smoothstep(0.18, 0.22, u).mul(smoothstep(0.82, 0.78, u)).mul(smoothstep(0.34, 0.38, v)).mul(smoothstep(0.82, 0.78, v));
  const glass = win.mul(wall).mul(above).mul(0.55);
  m.colorNode = vertexColor().mul(grain).mul(float(1).sub(glass));
  return m;
}

export async function loadBagBuildings(scene, { onProgress, concurrency = 4, fetchJson, loader } = {}) {
  const ecefMatrix = ecefToLocalMatrix();
  const matrix = gltfToLocalMatrix(ecefMatrix);
  const urls = await selectTiles(ecefMatrix, { fetchJson });
  if (!urls.length) throw new Error('no 3D BAG tiles overlap the city');
  const gltfLoader = loader || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const group = new THREE.Group();
  group.name = 'bag3d-buildings';
  const material = createMaterial();
  let next = 0, done = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const gltf = await gltfLoader.loadAsync(url);
      for (const g of bakeTile(gltf, matrix)) {
        const mesh = new THREE.Mesh(g, material);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      }
      onProgress?.(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  scene.add(group);
  group.userData = { city: 'Ede', source: '3D BAG LoD 2.2', tiles: urls.length };
  return group;
}
