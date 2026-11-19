import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GEO } from './nyc-geodata.js';
import { BLOCKS } from './city-config.js';
import { polygonContains } from './building-collision.js';
import { terrainHeightAt } from './terrain.js';
import { buildingPassageCuts } from './ede-grade.js';
import { getAerialColors, sampleGroundColor, sampleRoofColor } from './aerial-colors.js';
import { applyBagFacades, loadEdeFacades, meshBagFacadeFeatures, readBagFacadeFeatures } from './ede-facades.js';
import { buildFacadeMaskAtlas, buildFacadeMaskAtlasIncrementally, createBagFacadeMaterial, projectFacadeUv } from './ede-facade-material.js';
import { buildFacadePhotos } from './ede-facade-photos.js';
import { EDE_BUILDING_BASES } from './ede-building-bases.js';

// 3D BAG (LoD 2.2) 3D Tiles: real building volumes with roof shapes for the Netherlands.
// https://3dbag.nl — tiles are glTF with node matrices in ECEF (glTF axes: x = X, y = Z, z = -Y).
const BAG_BASE = 'https://3dbag.fsn1.your-objectstorage.com/v20250903/cesium3dtiles/lod22/';
const BASES_BY_TILE = new Map();
for (const record of EDE_BUILDING_BASES) {
  const url = BAG_BASE + record.tile;
  if (!BASES_BY_TILE.has(url)) BASES_BY_TILE.set(url, new Map());
  BASES_BY_TILE.get(url).set(record.bagId, record);
}
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

// Traverse the catalogue without starting one fetch for every matching external subtree.
async function selectTileRecords(matrix, { minX = MIN_X, maxX = MAX_X, minZ = MIN_Z, maxZ = MAX_Z, margin = 60, fetchJson } = {}) {
  const getJson = fetchJson || (async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
  const tiles = [], pending = [];
  const visit = (node) => {
    if (!node.boundingVolume?.box) return;
    const bounds = boxLocalBounds(node.boundingVolume.box, matrix);
    if (bounds.max.x < minX - margin || bounds.min.x > maxX + margin || bounds.max.z < minZ - margin || bounds.min.z > maxZ + margin) return;
    if (node.children?.length) { node.children.forEach(visit); return; }
    const uri = node.content?.uri;
    if (!uri) return;
    if (uri.endsWith('.json')) pending.push(BAG_BASE + uri);
    else tiles.push({ url: BAG_BASE + uri, bounds });
  };
  visit((await getJson(BAG_BASE + 'tileset.json')).root);
  while (pending.length) {
    const subtrees = await Promise.all(pending.splice(0, 4).map(getJson));
    for (const subtree of subtrees) visit(subtree.root);
  }
  return tiles;
}

export async function selectTiles(matrix, options) {
  return (await selectTileRecords(matrix, options)).map(tile => tile.url);
}

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function outsidePassage(polygon, planes) {
  const fragments = [];
  let inside = polygon;
  for (const [nx, ny, nz, c] of planes) {
    const inner = [], outer = [];
    let a = inside.at(-1), da = nx * a.x + ny * a.y + nz * a.z - c;
    for (const b of inside) {
      const db = nx * b.x + ny * b.y + nz * b.z - c;
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
          weights: a.weights.map((weight, i) => weight + (b.weights[i] - weight) * t) };
        inner.push(p);
        outer.push(p);
      }
      (db >= 0 ? inner : outer).push(b);
      a = b;
      da = db;
    }
    if (inner.length < 3) return [polygon];
    if (outer.length >= 3) fragments.push(outer);
    inside = inner;
  }
  return fragments;
}

export function carveBagBuildingPassages(geometry) {
  const { position } = geometry.attributes;
  const { index, boundingBox: { min, max } } = geometry;
  const pad = 0.45;
  const cuts = [...buildingPassageCuts({ minX: min.x - pad, maxX: max.x + pad, minZ: min.z - pad, maxZ: max.z + pad })]
    .map(cut => ({
      ...cut, planes: [
        ...cut.planes.map(([nx, nz, c]) => [nx, 0, nz, c - pad * Math.hypot(nx, nz)]),
        [cut.ux * cut.slope, -1, cut.uz * cut.slope, -cut.roofAt(0, 0)],
        ...(cut.openingBaseAt ? [[-cut.ux * cut.slope, 1, -cut.uz * cut.slope, cut.openingBaseAt(0, 0)]] : [])
      ]
    }));
  if (!cuts.length) return;
  const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => ({ name, attribute, extra: [] }));
  let nextVertex = position.count, edited = false;
  const indexOut = [];
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const vertices = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
    const [ax, bx, cx] = vertices.map(j => position.getX(j)), [az, bz, cz] = vertices.map(j => position.getZ(j));
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    const nearby = cuts.filter(cut => minX <= cut.maxX + pad && maxX >= cut.minX - pad &&
      minZ <= cut.maxZ + pad && maxZ >= cut.minZ - pad);
    if (!nearby.length) {
      indexOut.push(...vertices);
      continue;
    }
    const original = vertices.map((vertex, j) => ({
      x: position.getX(vertex), y: position.getY(vertex), z: position.getZ(vertex),
      vertex, weights: [Number(j === 0), Number(j === 1), Number(j === 2)]
    }));
    let fragments = [original];
    for (const cut of nearby) fragments = fragments.flatMap(fragment => outsidePassage(fragment, cut.planes));
    if (fragments.length !== 1 || fragments[0] !== original) edited = true;
    for (const fragment of fragments) {
      const indices = fragment.map(p => {
        if (p.vertex !== undefined) return p.vertex;
        for (const { attribute: { array, itemSize }, extra } of attributes) {
          for (let k = 0; k < itemSize; k++) {
            extra.push(p.weights.reduce((value, weight, j) => value + weight * array[vertices[j] * itemSize + k], 0));
          }
        }
        return nextVertex++;
      });
      for (let j = 1; j + 1 < indices.length; j++) indexOut.push(indices[0], indices[j], indices[j + 1]);
    }
  }
  if (!edited) return;
  geometry.setIndex(indexOut);
  for (const { name, attribute: { array, itemSize, normalized }, extra } of attributes) {
    const expanded = new array.constructor(array.length + extra.length);
    expanded.set(array);
    expanded.set(extra, array.length);
    geometry.setAttribute(name, new THREE.BufferAttribute(expanded, itemSize, normalized));
  }
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

function linearColor(hex) {
  if (typeof hex !== 'string' || !/^#[a-f0-9]{6}$/i.test(hex)) return null;
  return new THREE.Color(hex).toArray();
}

function colorBagRoofs(geometry, featureIds, useAerial, facadeFeatures) {
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
  for (const [id, triangles] of roofs) {
    const appearances = facadeFeatures?.get(id);
    const observed = appearances?.reduce((best, wall) => (
      wall.status === 'observed' && wall.roofColor && (!best || wall.confidence > best.confidence) ? wall : best
    ), null);
    const fallback = observed?.roofColor ?? appearances?.find(wall => wall.roofColor)?.roofColor;
    const tint = (useAerial && estimateRoofColor(triangles, positions)) || linearColor(fallback);
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

function correctedBagBases(gltf, matrix, tables) {
  const byMesh = new Map(), rawById = new Map();
  const point = new THREE.Vector3();
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const matches = meshBagFacadeFeatures(gltf, o, tables);
    const { position, _feature_id_0: featureIds } = o.geometry.attributes;
    if (!matches?.size || !featureIds) return;
    const full = new THREE.Matrix4().multiplyMatrices(matrix, o.matrixWorld);
    const found = new Map();
    for (let i = 0; i < position.count; i++) {
      const seed = Math.round(featureIds.getX(i));
      const record = matches.get(seed);
      if (!record) continue;
      found.set(seed, record);
      point.fromBufferAttribute(position, i).applyMatrix4(full);
      rawById.set(record.bagId, Math.min(rawById.get(record.bagId) ?? Infinity, Math.fround(point.y)));
    }
    if (found.size) byMesh.set(o, found);
  });
  for (const table of tables) for (const { bagId } of table.values()) {
    if (!rawById.has(bagId)) throw new Error(`Building elevation feature ${bagId} has no BAG geometry`);
  }
  return { byMesh, rawById };
}

// Bakes a loaded tile into one engine-space mesh geometry with per-building colour variation.
export function bakeTile(gltf, matrix, tables, atlas, baseTables) {
  const geometries = [];
  const useAerial = getAerialColors();
  if (useAerial) mappedRoofs ??= mappedRoofIndex();
  gltf.scene.updateMatrixWorld(true);
  // A BAG building can have multiple primitives. Give them a common source bottom before applying the surveyed base.
  const bases = baseTables && correctedBagBases(gltf, matrix, baseTables);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const facadeFeatures = tables && meshBagFacadeFeatures(gltf, o, tables);
    const meshBases = bases?.byMesh.get(o);
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
    if (meshBases) for (const [seed, { bagId }] of meshBases) baseByBuilding.set(seed, bases.rawById.get(bagId));
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
    if (meshBases) for (const [seed, { y }] of meshBases) groundByBuilding.set(seed, y);
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
    if (fid && (useAerial || facadeFeatures?.size)) g = colorBagRoofs(g, fid, useAerial, facadeFeatures);
    if (fid && facadeFeatures?.size) {
      const applied = applyBagFacades(g, fid, facadeFeatures, groundByBuilding, atlas, projectFacadeUv, linearColor);
      if (applied) g.userData.facades = applied;
    }
    g.computeBoundingBox();
    carveBagBuildingPassages(g);
    g.computeBoundingSphere();
    geometries.push(g);
  });
  return geometries;
}

// A BAG tile's oriented bounds can enclose holes, adjacent tiles and missing buildings.
// Suppress a fallback only when its interior samples are actually covered by BAG surfaces.
export function coveredFallbackBuildings(geometries, fallback) {
  if (!geometries.length || !fallback) return [];
  const cell = 24, bins = new Map();
  const bounds = new THREE.Box3();
  for (const { attributes: { position }, index, boundingBox } of geometries) {
    bounds.union(boundingBox);
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
      const x = position.getX(a), z = position.getZ(a), bx = position.getX(b), bz = position.getZ(b);
      const cx = position.getX(c), cz = position.getZ(c);
      const ux = bx - x, uz = bz - z, vx = cx - x, vz = cz - z;
      const area = ux * vz - uz * vx;
      if (Math.abs(area) < 0.05) continue;
      const triangle = { x, z, ux, uz, vx, vz, area };
      for (let u = Math.floor(Math.min(x, bx, cx) / cell); u <= Math.floor(Math.max(x, bx, cx) / cell); u++) {
        for (let v = Math.floor(Math.min(z, bz, cz) / cell); v <= Math.floor(Math.max(z, bz, cz) / cell); v++) {
          const key = `${u}/${v}`;
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push(triangle);
        }
      }
    }
  }
  const hit = (x, z) => bins.get(`${Math.floor(x / cell)}/${Math.floor(z / cell)}`)?.some(t => {
    const dx = x - t.x, dz = z - t.z;
    const u = (dx * t.vz - dz * t.vx) / t.area, v = (t.ux * dz - t.uz * dx) / t.area;
    return u >= -0.001 && v >= -0.001 && u + v <= 1.001;
  });
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.hypot(bounds.max.x - center.x, bounds.max.z - center.z);
  const matches = [];
  for (const b of fallback.quadtree.queryRange(center.x, center.z, radius)) {
    if (b.minX < bounds.min.x - 2 || b.maxX > bounds.max.x + 2 || b.minZ < bounds.min.z - 2 || b.maxZ > bounds.max.z + 2) continue;
    const [footprint] = b.footprints;
    const polygon = { outer: footprint.pts, holes: footprint.holes };
    let samples = 0, covered = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const x = b.minX + (b.maxX - b.minX) * (i + 0.5) / 5;
      const z = b.minZ + (b.maxZ - b.minZ) * (j + 0.5) / 5;
      if (!polygonContains(polygon, x, z)) continue;
      samples++;
      if (hit(x, z)) covered++;
    }
    if (samples >= 4 && covered >= 0.84 * samples) matches.push(b.id);
  }
  return matches;
}

async function bagGeometry(gltf, matrix, facades, atlas, url) {
  const features = atlas && await readBagFacadeFeatures(gltf, facades.byId).catch(error => {
    console.warn('[facades] BAG feature IDs unavailable:', error.message);
    return null;
  });
  const corrections = BASES_BY_TILE.get(url);
  const bases = corrections && await readBagFacadeFeatures(gltf, corrections);
  if (corrections && new Set(bases.flatMap(table => [...table.values()])).size !== corrections.size) {
    throw new Error('Surveyed BAG building identifiers are missing. Keep the corrected OSM fallback.');
  }
  return bakeTile(gltf, matrix, features, atlas, bases);
}

function addBagGeometry(group, geometries, material, detailedMaterial, matched, panels) {
  let recesses = 0;
  for (const geometry of geometries) {
    const detail = geometry.userData.facades;
    if (detail) {
      for (const wall of detail.matched) matched.add(wall);
      panels.push(...detail.panels);
      recesses += detail.recesses;
      delete geometry.userData.facades;
    }
    const mesh = new THREE.Mesh(geometry, detail ? detailedMaterial : material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return recesses;
}

export async function loadBagBuildings(scene, { onProgress, concurrency = 4, fetchJson, loader } = {}) {
  const ecefMatrix = ecefToLocalMatrix();
  const matrix = gltfToLocalMatrix(ecefMatrix);
  const [urls, facades] = await Promise.all([
    selectTiles(ecefMatrix, { fetchJson }),
    loadEdeFacades().catch(error => {
      console.warn('[facades] using procedural walls:', error.message);
      return null;
    }),
  ]);
  if (!urls.length) throw new Error('no 3D BAG tiles overlap the city');
  const gltfLoader = loader || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const group = new THREE.Group();
  group.name = 'bag3d-buildings';
  const material = createBagFacadeMaterial();
  const atlas = facades && buildFacadeMaskAtlas(facades.walls);
  const detailedMaterial = atlas && createBagFacadeMaterial(atlas.texture);
  const matched = new Set(), panels = [];
  let recesses = 0;
  let next = 0, done = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const gltf = await gltfLoader.loadAsync(url);
      const geometries = await bagGeometry(gltf, matrix, facades, atlas, url);
      recesses += addBagGeometry(group, geometries, material, detailedMaterial, matched, panels);
      onProgress?.(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  scene.add(group);
  group.userData = { city: 'Ede', source: '3D BAG LoD 2.2', tiles: urls.length,
    facades: { walls: matched.size, observed: [...matched].filter(wall => wall.status === 'observed').length,
      recesses, maskTextureBytes: atlas?.byteLength ?? 0 },
    facadePhotos: buildFacadePhotos(group, panels) };
  return group;
}

const STREAM_ENTER = 650;
const STREAM_LEAVE = 1050;
const STREAM_ACTIVE = 12;
const STREAM_RESIDENT = 18;
const STREAM_FETCHES = 2;
const STREAM_BYTES = 48 * 1024 * 1024;
const tileDistance = ({ min, max }, { x, z }) => Math.hypot(
  Math.max(min.x - x, 0, x - max.x), Math.max(min.z - z, 0, z - max.z)
);

async function fetchTile(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

export function createBagBuildingStream(scene, { fallback, fetchJson, loadBuffer = fetchTile, loader } = {}) {
  const origin = ecefToLocalMatrix();
  const matrix = gltfToLocalMatrix(origin);
  const group = new THREE.Group();
  group.name = 'bag3d-buildings';
  scene.add(group);
  const stats = { catalogue: 0, requested: 0, completed: 0, evicted: 0, failed: 0, resident: 0, inFlight: 0,
    geometryBytes: 0, peakGeometryBytes: 0, sourceBytes: 0, coveredBuildings: 0, lastBuildMs: 0,
    maskTextureBytes: 0, get photoTextureBytes() {
      let bytes = 0;
      for (const { photos } of resident.values()) bytes += photos?.stats.textureBytes ?? 0;
      return bytes;
    } };
  const gltfLoader = loader || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4();
  const current = new THREE.Vector3(), lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  const direction = new THREE.Vector3(), lastDirection = new THREE.Vector3();
  const material = createBagFacadeMaterial();
  const resident = new Map(), fetching = new Map(), buffered = new Map();
  let tiles, facades, atlas, detailedMaterial, desired = new Map(), enabled = true, disposed = false, building = false;
  let catalogueRequested = false, generation = 0;

  function removeTile(tile) {
    const record = resident.get(tile);
    record.photos?.dispose();
    record.group.traverse(mesh => mesh.geometry?.dispose());
    record.group.removeFromParent();
    fallback?.replaceBuildings(record.covered, false);
    stats.geometryBytes -= record.bytes;
    stats.coveredBuildings -= record.covered.length;
    resident.delete(tile);
    stats.resident = resident.size;
    stats.evicted++;
  }

  function requestCatalogue() {
    if (catalogueRequested) return;
    catalogueRequested = true;
    selectTileRecords(origin, { fetchJson }).then(value => {
      if (disposed) return;
      tiles = value;
      stats.catalogue = value.length;
      lastPosition.x = Infinity;
    }).catch(error => {
      stats.failed++;
      console.warn('[bag3d] using OSM buildings:', error);
    });
    loadEdeFacades().then(value => { if (!disposed) facades = value; })
      .catch(error => console.warn('[facades] using procedural walls:', error.message));
  }

  function nextView(camera) {
    if (lastPosition.distanceToSquared(current) < 24 ** 2 && lastDirection.dot(direction) > 0.978) return;
    lastPosition.copy(current);
    lastDirection.copy(direction);
    view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(view, camera.coordinateSystem, camera.reversedDepth);
    const ordered = [];
    for (const tile of tiles) {
      const distance = tileDistance(tile.bounds, current);
      if (distance <= STREAM_ENTER && (distance <= 175 || frustum.intersectsBox(tile.bounds))) ordered.push([tile, distance]);
    }
    desired = new Map(ordered.sort((a, b) => a[1] - b[1] || a[0].url.localeCompare(b[0].url)).slice(0, STREAM_ACTIVE));
    for (const [tile, request] of fetching) if (!desired.has(tile)) request.abort();
    for (const tile of buffered.keys()) if (!desired.has(tile)) buffered.delete(tile);
    for (const tile of resident.keys()) if (tileDistance(tile.bounds, current) > STREAM_LEAVE) removeTile(tile);
  }

  function failure(tile, error) {
    tile.retryAt = performance.now() + 15000;
    stats.failed++;
    console.warn('[bag3d] keeping OSM fallback for tile:', error);
  }

  function fetchNearby() {
    for (const tile of desired.keys()) {
      if (fetching.size + buffered.size >= STREAM_FETCHES) break;
      if (resident.has(tile) || tile.building || fetching.has(tile) || buffered.has(tile) || tile.retryAt > performance.now()) continue;
      const request = new AbortController();
      fetching.set(tile, request);
      stats.requested++;
      stats.inFlight = fetching.size;
      loadBuffer(tile.url, request.signal).then(buffer => {
        stats.sourceBytes += buffer.byteLength;
        if (!request.signal.aborted && enabled && desired.has(tile)) buffered.set(tile, buffer);
      }).catch(error => {
        if (!request.signal.aborted) failure(tile, error);
      }).finally(() => {
        fetching.delete(tile);
        stats.inFlight = fetching.size;
      });
    }
  }

  function makeRoom(tile, bytes) {
    while (resident.size >= STREAM_RESIDENT || stats.geometryBytes + bytes > STREAM_BYTES) {
      const candidates = [...resident.keys()].filter(other => !desired.has(other) || desired.get(other) > desired.get(tile));
      candidates.sort((a, b) => tileDistance(b.bounds, current) - tileDistance(a.bounds, current));
      if (!candidates.length) return false;
      removeTile(candidates[0]);
    }
    return true;
  }

  async function buildNearest() {
    const tile = [...desired.keys()].find(candidate => buffered.has(candidate));
    if (!tile) return;
    const buffer = buffered.get(tile);
    buffered.delete(tile);
    tile.building = building = true;
    const start = performance.now();
    const requestedGeneration = generation;
    const stillWanted = () => enabled && requestedGeneration === generation && desired.has(tile);
    try {
      const gltf = await gltfLoader.parseAsync(buffer, new URL('.', tile.url).href);
      if (!stillWanted()) return;
      const hasDetail = facades?.walls.some(({ a }) => a[0] >= tile.bounds.min.x - 2 && a[0] <= tile.bounds.max.x + 2
        && a[1] >= tile.bounds.min.z - 2 && a[1] <= tile.bounds.max.z + 2);
      if (hasDetail && !atlas) {
        const bakedAtlas = await buildFacadeMaskAtlasIncrementally(facades.walls, stillWanted);
        if (!stillWanted()) { bakedAtlas?.texture.dispose(); return; }
        atlas = bakedAtlas;
        if (atlas) {
          detailedMaterial = createBagFacadeMaterial(atlas.texture);
          stats.maskTextureBytes = atlas.byteLength;
        }
      }
      const geometries = await bagGeometry(gltf, matrix, facades, hasDetail ? atlas : null, tile.url);
      // Let rendering run between geometry construction and the fallback coverage scan.
      await new Promise(resolve => setTimeout(resolve, 0));
      const bytes = geometries.reduce((sum, geometry) => sum + (geometry.index?.array.byteLength ?? 0)
        + Object.values(geometry.attributes).reduce((size, attr) => size + attr.array.byteLength, 0), 0);
      if (!stillWanted() || !makeRoom(tile, bytes)) {
        geometries.forEach(geometry => geometry.dispose());
        tile.retryAt = performance.now() + 5000;
        return;
      }
      const tileGroup = new THREE.Group(), panels = [], matched = new Set();
      const covered = coveredFallbackBuildings(geometries, fallback);
      addBagGeometry(tileGroup, geometries, material, detailedMaterial, matched, panels);
      const photos = buildFacadePhotos(tileGroup, panels);
      tileGroup.updateMatrixWorld(true);
      group.add(tileGroup);
      fallback?.replaceBuildings(covered, true);
      resident.set(tile, { group: tileGroup, photos, covered, bytes });
      stats.resident = resident.size;
      stats.completed++;
      stats.coveredBuildings += covered.length;
      stats.geometryBytes += bytes;
      stats.peakGeometryBytes = Math.max(stats.peakGeometryBytes, stats.geometryBytes);
      stats.lastBuildMs = performance.now() - start;
    } catch (error) {
      failure(tile, error);
    } finally {
      tile.building = building = false;
    }
  }

  function update(camera) {
    if (!enabled || document.hidden) return;
    requestCatalogue();
    if (!tiles) return;
    camera.getWorldPosition(current);
    camera.getWorldDirection(direction);
    nextView(camera);
    fetchNearby();
    if (!building && buffered.size) void buildNearest();
    for (const { photos } of resident.values()) photos?.update(current);
  }

  function setEnabled(value) {
    if (disposed || enabled === value) return;
    enabled = value;
    if (value) { lastPosition.x = Infinity; return; }
    generation++;
    for (const request of fetching.values()) request.abort();
    desired.clear();
    buffered.clear();
    for (const tile of resident.keys()) removeTile(tile);
    atlas?.texture.dispose();
    detailedMaterial?.dispose();
    atlas = detailedMaterial = null;
    stats.maskTextureBytes = 0;
  }

  function dispose() {
    setEnabled(false);
    disposed = true;
    material.dispose();
    group.removeFromParent();
  }
  group.userData = { city: 'Ede', source: '3D BAG LoD 2.2', update, setEnabled, stats, dispose };
  return group;
}
