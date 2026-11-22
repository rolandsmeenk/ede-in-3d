import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GEO } from './nyc-geodata.js';
import { projectLonLatInto } from './ede-scene-coordinates.js';
import { playableBoundsCovered, playableBoundsOverlap } from './ede-playable-boundary.js';
import { BLOCKS } from './city-config.js';
import { polygonContains } from './building-collision.js';
import { terrainHeightAt } from './terrain.js';
import { buildingPassageCuts } from './ede-grade.js';
import { landmarkBagExclusions, landmarkBuildingCuts } from './ede-landmark-sites.js';
import { getAerialColors, sampleGroundColor, sampleRoofColor } from './aerial-colors.js';
import { applyBagFacadeChunks, loadEdeFacades, meshBagFacadeFeatures, readBagFacadeFeatures, readBagBuildYears } from './ede-facades.js';
import { buildFacadeMaskAtlasIncrementally, createBagFacadeMaterial, createFacadeSurfaceTexture, projectFacadeUv } from './ede-facade-material.js';
import { EDE_BUILDING_BASES } from './ede-building-bases.js';
import { edeFacadeAt, isEdeShed } from './ede-neighbourhood-facades.js';
import { windowLightKey } from './ede-window-lights.js';

// 3D BAG (LoD 2.2) 3D Tiles: real building volumes with roof shapes for the Netherlands.
// https://3dbag.nl — LoD 2.2 tile bounds are ECEF boxes and content is glTF.
const BAG_BASE = 'https://3dbag.fsn1.your-objectstorage.com/v20250903/cesium3dtiles/lod22/';
const BASES_BY_TILE = new Map();
for (const record of EDE_BUILDING_BASES) {
  const url = BAG_BASE + record.tile;
  if (!BASES_BY_TILE.has(url)) BASES_BY_TILE.set(url, new Map());
  BASES_BY_TILE.get(url).set(record.bagId, record);
}
const AFF = GEO.ede.meta.lonLatAffine;
const [MIN_X, MIN_Z, MAX_X, MAX_Z] = GEO.ede.meta.bounds;

const WGS84_A = 6378137;
const WGS84_B = 6356752.314245179;
const WGS84_E2 = 1 - (WGS84_B / WGS84_A) ** 2;
const WGS84_EP2 = (WGS84_A / WGS84_B) ** 2 - 1;
const DEG = 180 / Math.PI;

export function projectEcefToScene(affine, point) {
  const { x, y, z } = point;
  const p = Math.sqrt(x * x + y * y);
  // Bowring inverse. Normalize the auxiliary vector to get sine and cosine without two extra trig calls.
  const za = z * WGS84_A, pb = p * WGS84_B;
  const auxiliary = 1 / Math.sqrt(za * za + pb * pb);
  const sinTheta = za * auxiliary, cosTheta = pb * auxiliary;
  const vertical = z + WGS84_EP2 * WGS84_B * sinTheta ** 3;
  const horizontal = p - WGS84_E2 * WGS84_A * cosTheta ** 3;
  const upright = 1 / Math.sqrt(vertical * vertical + horizontal * horizontal);
  const sinLat = vertical * upright, cosLat = horizontal * upright;
  // This is ellipsoid height. Use it only for relief. NAP comes from the scene terrain or survey.
  point.y = p * cosLat + z * sinLat - WGS84_A * Math.sqrt(1 - WGS84_E2 * sinLat ** 2);
  return projectLonLatInto(affine, Math.atan2(y, x) * DEG, Math.atan2(vertical, horizontal) * DEG, point);
}

const projectBagVertex = point => projectEcefToScene(AFF, point);

export function gltfToEcefMatrix(tileToEcef) {
  // glTF y-up becomes 3D Tiles z-up before the tile hierarchy transform.
  const yUp = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1
  );
  return new THREE.Matrix4().multiplyMatrices(tileToEcef, yUp);
}

export function boxLocalBounds(box, tileToEcef) {
  const bounds = new THREE.Box3(), corner = new THREE.Vector3();
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    corner.set(
      box[0] + a * box[3] + b * box[6] + c * box[9],
      box[1] + a * box[4] + b * box[7] + c * box[10],
      box[2] + a * box[5] + b * box[8] + c * box[11]
    ).applyMatrix4(tileToEcef);
    bounds.expandByPoint(projectBagVertex(corner));
  }
  return bounds;
}

function terrainCullingBounds(bounds) {
  const { min, max } = bounds;
  const relief = max.y - min.y;
  let groundLow = Infinity, groundHigh = -Infinity;
  for (const x of [min.x, (min.x + max.x) / 2, max.x]) {
    for (const z of [min.z, (min.z + max.z) / 2, max.z]) {
      const y = terrainHeightAt(x, z);
      groundLow = Math.min(groundLow, y);
      groundHigh = Math.max(groundHigh, y);
    }
  }
  // Culling precedes per-building seating. Leave room for unsampled slopes and corrected bases.
  min.y = groundLow - 24;
  max.y = groundHigh + relief + 24;
  return bounds;
}

// Transform accumulation crosses external tilesets, whose URIs resolve from their own catalogue.
async function selectTileRecords({ minX = MIN_X, maxX = MAX_X, minZ = MIN_Z, maxZ = MAX_Z, margin = 60, fetchJson,
  boundary = false } = {}) {
  const getJson = fetchJson || (async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  });
  const tiles = [], pending = [];
  const visit = (node, baseUrl, parent) => {
    if (!node.boundingVolume?.box) return;
    const transform = node.transform ? parent.clone().multiply(new THREE.Matrix4().fromArray(node.transform)) : parent;
    const bounds = boxLocalBounds(node.boundingVolume.box, transform);
    // The projection is nonlinear. Allow for bowing between corners of large parent boxes.
    const pad = ((bounds.max.x - bounds.min.x) ** 2 + (bounds.max.z - bounds.min.z) ** 2) / WGS84_A;
    if (bounds.max.x + pad < minX - margin || bounds.min.x - pad > maxX + margin
        || bounds.max.z + pad < minZ - margin || bounds.min.z - pad > maxZ + margin) return;
    if (boundary && !playableBoundsOverlap(bounds.min.x - pad, bounds.min.z - pad, bounds.max.x + pad, bounds.max.z + pad)) return;
    if (node.children?.length) {
      for (const child of node.children) visit(child, baseUrl, transform);
      return;
    }
    if (!node.content?.uri) return;
    const url = new URL(node.content.uri, baseUrl);
    if (url.pathname.endsWith('.json')) pending.push({ url: url.href, transform });
    else tiles.push({ url: url.href, bounds: terrainCullingBounds(bounds), transform });
  };
  const root = BAG_BASE + 'tileset.json';
  visit((await getJson(root)).root, root, new THREE.Matrix4());
  while (pending.length) {
    await Promise.all(pending.splice(0, 4).map(async ({ url, transform }) => {
      visit((await getJson(url)).root, url, transform);
    }));
  }
  return tiles;
}

export { selectTileRecords };

// Use a local Jacobian for source shading normals. Each vertex uses the full nonlinear position transform.
function projectedNormalMatrix(transform, position, project) {
  const matrix = new THREE.Matrix3();
  if (!project || !position.count) return matrix.getNormalMatrix(transform);
  const reference = new THREE.Vector3().fromBufferAttribute(position, 0).applyMatrix4(transform);
  const axes = ['x', 'y', 'z'].map(key => {
    const plus = reference.clone(), minus = reference.clone();
    plus[key] += 2;
    minus[key] -= 2;
    return project(plus).sub(project(minus)).multiplyScalar(0.25);
  });
  const [x, y, z] = axes;
  const local = new THREE.Matrix4().set(
    x.x, y.x, z.x, 0,
    x.y, y.y, z.y, 0,
    x.z, y.z, z.z, 0,
    0, 0, 0, 1
  );
  return matrix.getNormalMatrix(local.multiply(transform));
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

export function carveBagBuildingPassages(geometry, options) {
  finishBagWork(carveBagPassageChunks(geometry, options));
}

function* carveBagPassageChunks(geometry, { removeLandmarks = true, customCuts } = {}) {
  const { position } = geometry.attributes;
  const { index, boundingBox: { min, max } } = geometry;
  const pad = 0.45;
  const bounds = { minX: min.x - pad, maxX: max.x + pad, minZ: min.z - pad, maxZ: max.z + pad };
  const cuts = customCuts ? [...customCuts] : [...buildingPassageCuts(bounds)]
    .map(cut => ({
      ...cut, planes: [
        ...cut.planes.map(([nx, nz, c]) => [nx, 0, nz, c - pad * Math.hypot(nx, nz)]),
        [cut.ux * cut.slope, -1, cut.uz * cut.slope, -cut.roofAt(0, 0)],
        ...(cut.openingBaseAt ? [[-cut.ux * cut.slope, 1, -cut.uz * cut.slope, cut.openingBaseAt(0, 0)]] : [])
      ]
    }));
  if (removeLandmarks) cuts.push(...landmarkBuildingCuts(bounds));
  if (!cuts.length) return;
  const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => ({ name, attribute, extra: [] }));
  let nextVertex = position.count, edited = false;
  const indexOut = [];
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    if (i % 768 === 0) yield;
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
  return match;
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
      const id = mappedRoofAt(x, z)?.osmId;
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

function* colorBagRoofs(geometry, featureIds, roofColors, useAerial) {
  const { position, buildingHeight } = geometry.attributes;
  const positions = position.array, heights = buildingHeight.array;
  const index = geometry.index;
  const count = index?.count ?? position.count;
  const uses = index && new Uint8Array(position.count);
  const roofs = new Map();
  for (let i = 0; i + 2 < count; i += 3) {
    if (i % 1536 === 0) yield;
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ux = positions[b] - positions[a], uy = heights[ib] - heights[ia], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = heights[ic] - heights[ia], vz = positions[c + 2] - positions[a + 2];
    const area = uz * vx - ux * vz;
    const horizontalNormal = Math.hypot(uy * vz - uz * vy, ux * vy - uy * vx);
    const id = Math.round(featureIds.getX(ia));
    const roof = area > 0.35 * Math.hypot(horizontalNormal, area)
      && Math.max(heights[ia], heights[ib], heights[ic]) > 0.25
      && id === Math.round(featureIds.getX(ib)) && id === Math.round(featureIds.getX(ic));
    const tile = roof && roofColors.has(id) && horizontalNormal > area * 0.25;
    const kind = tile ? 4 : roof ? 1 : 2;
    if (uses) {
      uses[ia] |= kind; uses[ib] |= kind; uses[ic] |= kind;
    }
    if (!roof) continue;
    if (!roofs.has(id)) roofs.set(id, []);
    roofs.get(id).push({ i, a, b, c, area, kind });
  }
  const colors = geometry.attributes.color.array;
  const splits = new Map();
  let roofIndices;
  for (const [id, triangles] of roofs) {
    yield;
    const aerialTint = useAerial && triangles.some(triangle => triangle.kind === 1)
      ? estimateRoofColor(triangles, positions) : null;
    for (const { i, a, b, c, kind } of triangles) {
      const tint = kind === 4 ? roofColors.get(id) : aerialTint;
      if (!tint) continue;
      const vertices = [a / 3, b / 3, c / 3];
      for (let corner = 0; corner < 3; corner++) {
        const vertex = vertices[corner];
        if (!uses || uses[vertex] === kind) {
          colors.set(tint, vertex * 3);
          continue;
        }
        // Keep the tile indexed where both sides of an edge use the same finish.
        roofIndices ??= Uint32Array.from(index.array);
        const key = vertex * 2 + Number(kind === 4);
        if (!splits.has(key)) splits.set(key, { source: vertex, vertex: position.count + splits.size, tint });
        roofIndices[i + corner] = splits.get(key).vertex;
      }
    }
  }
  if (roofIndices) {
    const vertexCount = position.count + splits.size;
    for (const [name, { array, itemSize, normalized }] of Object.entries(geometry.attributes)) {
      yield;
      const expanded = new array.constructor(vertexCount * itemSize);
      expanded.set(array);
      for (const { source, vertex, tint } of splits.values()) {
        const values = name === 'color' ? tint : array.subarray(source * itemSize, (source + 1) * itemSize);
        expanded.set(values, vertex * itemSize);
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(expanded, itemSize, normalized));
    }
    geometry.setIndex(new THREE.BufferAttribute(vertexCount > 65536 ? roofIndices : Uint16Array.from(roofIndices), 1));
  }
  return geometry;
}

function* correctedBagBases(gltf, matrix, tables, meshes, project) {
  const byMesh = new Map(), rawById = new Map(), projected = new Map();
  const point = new THREE.Vector3();
  for (const o of meshes) {
    const matches = meshBagFacadeFeatures(gltf, o, tables);
    const { position, _feature_id_0: featureIds } = o.geometry.attributes;
    if (!matches?.size || !featureIds) continue;
    const full = new THREE.Matrix4().multiplyMatrices(matrix, o.matrixWorld);
    const found = new Map();
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      if ((i & 1023) === 0) yield;
      point.fromBufferAttribute(position, i).applyMatrix4(full);
      if (project) project(point);
      positions[i * 3] = point.x; positions[i * 3 + 1] = point.y; positions[i * 3 + 2] = point.z;
      const seed = Math.round(featureIds.getX(i));
      const record = matches.get(seed);
      if (!record) continue;
      found.set(seed, record);
      rawById.set(record.bagId, Math.min(rawById.get(record.bagId) ?? Infinity, positions[i * 3 + 1]));
    }
    projected.set(o, positions);
    if (found.size) byMesh.set(o, found);
  }
  for (const table of tables) for (const { bagId } of table.values()) {
    if (!rawById.has(bagId)) throw new Error(`Building elevation feature ${bagId} has no BAG geometry`);
  }
  return { byMesh, rawById, projected };
}

// Bakes a loaded tile into one engine-space mesh geometry with per-building colour variation.
export function bakeTile(...args) {
  return finishBagWork(bakeTileChunks(...args));
}

function* bakeTileChunks(gltf, matrix, tables, atlas, baseTables, exclusions, yearTables, project, limitToMunicipality) {
  const geometries = [];
  const useAerial = getAerialColors();
  mappedRoofs ??= mappedRoofIndex();
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  // Give all primitives of a BAG building a common source bottom before shifting its base.
  const bases = baseTables && (yield* correctedBagBases(gltf, matrix, baseTables, meshes, project));
  let completed = false;
  try {
    for (const o of meshes) {
      const facadeFeatures = tables && meshBagFacadeFeatures(gltf, o, tables);
      const years = yearTables?.length ? meshBagFacadeFeatures(gltf, o, yearTables) : null;
      const meshBases = bases?.byMesh.get(o);
      const src = o.geometry;
      const full = new THREE.Matrix4().multiplyMatrices(matrix, o.matrixWorld);
      const pos = src.attributes.position, nor = src.attributes.normal, fid = src.attributes._feature_id_0;
      const normalMatrix = projectedNormalMatrix(full, pos, project);
      const count = pos.count;
      const excluded = exclusions && meshBagFacadeFeatures(gltf, o, exclusions);
      const projected = bases?.projected.get(o);
      const positions = projected ?? new Float32Array(count * 3);
      const normals = new Float32Array(count * 3), colors = new Float32Array(count * 3);
      const v = new THREE.Vector3(), c = new THREE.Color();
      const baseByBuilding = new Map(), extents = new Map();
      for (let i = 0; i < count; i++) {
        if ((i & 1023) === 0) yield;
        if (!projected) {
          v.fromBufferAttribute(pos, i).applyMatrix4(full);
          if (project) project(v);
          positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
        }
        v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
        normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z;
        const seed = fid ? Math.round(fid.getX(i)) : 0;
        const y = positions[i * 3 + 1];
        baseByBuilding.set(seed, Math.min(baseByBuilding.get(seed) ?? Infinity, y));
        if (fid || limitToMunicipality) {
          const x = positions[i * 3], z = positions[i * 3 + 2];
          const bounds = extents.get(seed);
          if (bounds) {
            bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
            bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
            bounds.top = Math.max(bounds.top, y);
          } else {
            extents.set(seed, { minX: x, maxX: x, minZ: z, maxZ: z, top: y });
          }
        }
        const r = hash(seed + 1), s = hash(seed * 7 + 3);
        if (v.y > 0.35) c.setHSL(0.03 + s * 0.04, 0.12 + r * 0.12, 0.17 + r * 0.1); // roofs: dark tile / slate
        else if (r < 0.62) c.setHSL(0.045 + s * 0.03, 0.34 + r * 0.2, 0.30 + s * 0.12); // brick
        else if (r < 0.85) c.setHSL(0.11 + s * 0.04, 0.12 + s * 0.12, 0.52 + r * 0.14); // plaster / stone
        else c.setHSL(0.08 + s * 0.05, 0.08, 0.40 + s * 0.15);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      const facades = new Map(), roofColors = new Map(), omitted = new Set();
      for (const [seed, { minX, maxX, minZ, maxZ, top }] of extents) {
        if (limitToMunicipality && !playableBoundsCovered(minX, minZ, maxX, maxZ)) {
          omitted.add(seed);
          continue;
        }
        if (!fid) continue;
        const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
        // Require the whole BAG footprint to fit so an adjoining house keeps its own mesh.
        const footprint = mappedRoofAt(x, z);
        if (isEdeShed(footprint?.source, footprint?.area)
          && minX >= footprint.minX - 0.8 && maxX <= footprint.maxX + 0.8
          && minZ >= footprint.minZ - 0.8 && maxZ <= footprint.maxZ + 0.8) {
          omitted.add(seed);
          continue;
        }
        const year = years?.[seed] || footprint?.source?.buildYear;
        const style = edeFacadeAt(x, z, top - baseByBuilding.get(seed), year, footprint?.source?.kind);
        if (style) facades.set(seed, { x, z, layout: style.layout, windowKey: windowLightKey(footprint?.source, x, z),
          rgb: c.setHex(style.color).toArray(), planes: new Map() });
        if (style?.roofColor) roofColors.set(seed, c.setHex(style.roofColor).toArray());
      }
      let kept;
      if (!fid && omitted.has(0)) continue;
      if (fid && (excluded?.size || omitted.size)) {
        const omit = i => {
          const seed = Math.round(fid.getX(i));
          return excluded?.has(seed) || omitted.has(seed);
        };
        const srcCount = src.index?.count ?? count;
        kept = [];
        for (let i = 0; i < srcCount; i += 3) {
          if (i % 768 === 0) yield;
          const a = src.index?.getX(i) ?? i, b = src.index?.getX(i + 1) ?? i + 1, c = src.index?.getX(i + 2) ?? i + 2;
          if (!(omit(a) && omit(b) && omit(c))) kept.push(a, b, c);
        }
        if (!kept.length) continue;
      }
      if (meshBases) for (const [seed, { bagId }] of meshBases) baseByBuilding.set(seed, bases.rawById.get(bagId));
      // Use the low side of each footprint to seat the whole building without bending its roof.
      const relativeHeights = new Float32Array(count);
      const groundByBuilding = new Map();
      for (let i = 0; i < count; i++) {
        if ((i & 1023) === 0) yield;
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
      const facadeLayouts = new Float32Array(count * 4), facadeBays = new Float32Array(count * 3);
      const planeByVertex = facades.size ? new Array(count) : [];
      const indices = kept ?? src.index?.array;
      const wallDirections = new Float32Array(planeByVertex.length * 2);
      if (facades.size) for (let i = 0; i + 2 < (indices?.length ?? count); i += 3) {
        if (i % 768 === 0) yield;
        const a = indices?.[i] ?? i, b = indices?.[i + 1] ?? i + 1, c = indices?.[i + 2] ?? i + 2;
        if (!facades.has(Math.round(fid.getX(a)))) continue;
        const ax = positions[a * 3], az = positions[a * 3 + 2];
        const ux = positions[b * 3] - ax, uz = positions[b * 3 + 2] - az;
        const vx = positions[c * 3] - ax, vz = positions[c * 3 + 2] - az;
        const uy = relativeHeights[b] - relativeHeights[a], vy = relativeHeights[c] - relativeHeights[a];
        const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
        const horizontal = Math.hypot(nx, nz);
        if (horizontal < 0.0001 || Math.abs(uz * vx - ux * vz) > horizontal * 0.25) continue;
        // Source lighting normals can be smoothed. Use the wall triangle's physical plane for the bay layout.
        for (const vertex of [a, b, c]) {
          wallDirections[vertex * 2] = nx / horizontal;
          wallDirections[vertex * 2 + 1] = nz / horizontal;
        }
      }
      for (let i = 0; i < count; i++) {
        if ((i & 1023) === 0) yield;
        const seed = fid ? Math.round(fid.getX(i)) : 0, j = i * 3;
        positions[j + 1] = relativeHeights[i] + groundByBuilding.get(seed);
        const facade = facades.get(seed);
        const nx = wallDirections[i * 2], nz = wallDirections[i * 2 + 1];
        if (facade && (nx || nz)) {
          colors.set(facade.rgb, j);
          facadeLayouts.set(facade.layout, i * 4);
          const x = positions[j] - facade.x, z = positions[j + 2] - facade.z;
          const along = x * nz - z * nx;
          // Group each planar wall in feature-local space so the bays end at its corners.
          const key = [Math.round(nx * 32), Math.round(nz * 32), Math.round((x * nx + z * nz) * 5)].join('/');
          let plane = facade.planes.get(key);
          if (!plane) {
            plane = { min: Infinity, max: -Infinity, leftTop: 0, rightTop: 0, spacing: facade.layout[0] };
            facade.planes.set(key, plane);
          }
          const height = relativeHeights[i];
          // Take the roofline at the wall's ends. The gable peak is not another storey.
          const tolerance = 0.05;
          if (along <= plane.min + tolerance) {
            plane.leftTop = along < plane.min - tolerance ? height : Math.max(plane.leftTop, height);
            plane.min = Math.min(plane.min, along);
          }
          if (along >= plane.max - tolerance) {
            plane.rightTop = along > plane.max + tolerance ? height : Math.max(plane.rightTop, height);
            plane.max = Math.max(plane.max, along);
          }
          planeByVertex[i] = plane;
          facadeBays[i * 3] = along;
          facadeBays[i * 3 + 2] = facade.windowKey;
        }
      }
      for (let i = 0; i < planeByVertex.length; i++) {
        if ((i & 1023) === 0) yield;
        const plane = planeByVertex[i];
        if (!plane) continue;
        const width = plane.max - plane.min;
        const bays = Math.max(1, Math.round(width / plane.spacing));
        const index = i * 3;
        facadeBays[index] = width >= 1.7 ? (facadeBays[index] - plane.min) * bays / width : 0;
        facadeBays[index + 1] = Math.min(plane.leftTop, plane.rightTop);
      }
      let g = new THREE.BufferGeometry();
      geometries.push(g);
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.setAttribute('buildingHeight', new THREE.BufferAttribute(relativeHeights, 1));
      g.setAttribute('edeFacadeLayout', new THREE.BufferAttribute(facadeLayouts, 4));
      g.setAttribute('edeFacadeBay', new THREE.BufferAttribute(facadeBays, 3));
      if (indices) {
        const IndexArray = count > 65535 ? Uint32Array : Uint16Array;
        g.setIndex(new THREE.BufferAttribute(IndexArray.from(indices), 1));
      }
      if (fid && (useAerial || roofColors.size)) yield* colorBagRoofs(g, fid, roofColors, useAerial);
      if (fid && facadeFeatures?.size) {
        const applied = yield* applyBagFacadeChunks(g, fid, facadeFeatures, groundByBuilding, atlas, projectFacadeUv, linearColor);
        if (applied) g.userData.facades = applied;
      }
      g.computeBoundingBox();
      yield* carveBagPassageChunks(g);
      g.computeBoundingSphere();
    }
    completed = true;
    return geometries;
  } finally {
    if (!completed) for (const geometry of geometries) geometry.dispose();
  }
}

// A BAG tile's oriented bounds can enclose holes, adjacent tiles and missing buildings.
// Suppress a fallback only when its interior samples are actually covered by BAG surfaces.
export function coveredFallbackBuildings(geometries, fallback) {
  return finishBagWork(coveredFallbackChunks(geometries, fallback));
}

function* coveredFallbackChunks(geometries, fallback) {
  if (!geometries.length || !fallback) return [];
  const cell = 24, bins = new Map();
  const bounds = new THREE.Box3();
  for (const { attributes: { position }, index, boundingBox } of geometries) {
    bounds.union(boundingBox);
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      if (i % 768 === 0) yield;
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
    yield;
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

function finishBagWork(work) {
  let step;
  do step = work.next(); while (!step.done);
  return step.value;
}

async function finishBagWorkIncrementally(work, stillWanted, pacing) {
  const sliceTime = 2.5;
  let start = performance.now(), budget = sliceTime, completed = false;
  try {
    for (let step; stillWanted(); ) {
      step = work.next();
      if (step.done) {
        completed = true;
        pacing.longestMs = Math.max(pacing.longestMs, performance.now() - start);
        return step.value;
      }
      const spent = performance.now() - start;
      if (spent < budget) continue;
      pacing.longestMs = Math.max(pacing.longestMs, spent);
      pacing.yields++;
      budget = await new Promise(resolve => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(deadline => resolve(deadline.didTimeout ? 1.25
            : Math.min(sliceTime, Math.max(0.35, deadline.timeRemaining() - 0.5))), { timeout: 32 });
        } else setTimeout(() => resolve(sliceTime), 0);
      });
      start = performance.now();
    }
    return null;
  } finally {
    if (!completed) work.return();
  }
}

function disposeFacadeAtlas(atlas) {
  atlas?.texture.dispose();
  atlas?.palette.dispose();
}

async function bagGeometry(gltf, facades, tile, stillWanted = () => true, pacing, replacementBagIds) {
  let features, atlas;
  const excluded = landmarkBagExclusions(tile.bounds);
  for (const id of replacementBagIds ?? []) excluded.set(id, true);
  let byId = facades && await facades.forBounds(tile.bounds);
  if (excluded.size && byId?.size) {
    byId = new Map(byId);
    for (const id of excluded.keys()) byId.delete(id);
  }
  if (byId?.size && stillWanted()) {
    features = await readBagFacadeFeatures(gltf, byId).catch(error => {
      console.warn('[facades] BAG feature IDs unavailable:', error.message);
      return null;
    });
    const walls = new Set();
    for (const table of features ?? []) for (const list of table.values()) {
      for (const wall of list) walls.add(wall);
    }
    if (walls.size && stillWanted()) atlas = await buildFacadeMaskAtlasIncrementally([...walls], stillWanted);
  }
  if (!stillWanted()) {
    disposeFacadeAtlas(atlas);
    return null;
  }
  try {
    const corrections = BASES_BY_TILE.get(tile.url);
    const bases = corrections && await readBagFacadeFeatures(gltf, corrections);
    if (corrections && new Set(bases.flatMap(table => [...table.values()])).size !== corrections.size) {
      throw new Error('Surveyed BAG building identifiers are missing. Keep the corrected OSM fallback.');
    }
    const exclusions = excluded.size ? await readBagFacadeFeatures(gltf, excluded) : null;
    const years = await readBagBuildYears(gltf).catch(() => []);
    const matrix = gltfToEcefMatrix(tile.transform);
    const { min, max } = tile.bounds;
    const limitToMunicipality = !playableBoundsCovered(min.x, min.z, max.x, max.z);
    const work = bakeTileChunks(gltf, matrix, atlas ? features : null, atlas, bases, exclusions, years, projectBagVertex,
      limitToMunicipality);
    const geometries = pacing ? await finishBagWorkIncrementally(work, stillWanted, pacing) : finishBagWork(work);
    if (!geometries) {
      disposeFacadeAtlas(atlas);
      return null;
    }
    if (atlas && !geometries.some(geometry => geometry.userData.facades)) {
      disposeFacadeAtlas(atlas);
      atlas = null;
    }
    return { geometries, atlas };
  } catch (error) {
    disposeFacadeAtlas(atlas);
    throw error;
  }
}

function addBagGeometry(group, geometries, material, detailedMaterial) {
  const matched = new Set();
  let recesses = 0;
  for (const geometry of geometries) {
    const detail = geometry.userData.facades;
    if (detail) {
      for (const wall of detail.matched) matched.add(wall);
      recesses += detail.recesses;
      delete geometry.userData.facades;
      // Keep detailed façades within WebGPU's eight vertex buffer slots.
      const { edeFacadeLayout: layout, edeFacadeBay: bay } = geometry.attributes;
      const interleaved = new THREE.InterleavedBuffer(new Float32Array(layout.count * 7), 7);
      const data = interleaved.array;
      for (let i = 0; i < layout.count; i++) {
        const offset = i * 7;
        data[offset] = layout.getX(i);
        data[offset + 1] = layout.getY(i);
        data[offset + 2] = layout.getZ(i);
        data[offset + 3] = layout.getW(i);
        data[offset + 4] = bay.getX(i);
        data[offset + 5] = bay.getY(i);
        data[offset + 6] = bay.getZ(i);
      }
      geometry.setAttribute('edeFacadeLayout', new THREE.InterleavedBufferAttribute(interleaved, 4, 0));
      geometry.setAttribute('edeFacadeBay', new THREE.InterleavedBufferAttribute(interleaved, 3, 4));
    }
    const mesh = new THREE.Mesh(geometry, detail ? detailedMaterial : material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { walls: matched.size, observed: [...matched].filter(wall => wall.status === 'observed').length, recesses };
}

export async function loadBagBuildings(scene, { onProgress, concurrency = 4, fetchJson, loader, replacementBagIds } = {}) {
  const [tiles, facades] = await Promise.all([
    selectTileRecords({ fetchJson, boundary: true }),
    loadEdeFacades().catch(error => {
      console.warn('[facades] using procedural walls:', error.message);
      return null;
    }),
  ]);
  if (!tiles.length) throw new Error('no 3D BAG tiles overlap the city');
  const gltfLoader = loader || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const group = new THREE.Group();
  group.name = 'bag3d-buildings';
  const material = createBagFacadeMaterial();
  const stats = { walls: 0, observed: 0, recesses: 0, maskTextureBytes: 0, surfaceTextureBytes: 0 };
  let surface, next = 0, done = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const tile = tiles[next++];
      const gltf = await gltfLoader.loadAsync(tile.url);
      const { geometries, atlas } = await bagGeometry(gltf, facades, tile, undefined, undefined, replacementBagIds);
      let detailedMaterial;
      if (atlas) {
        surface ??= createFacadeSurfaceTexture();
        detailedMaterial = createBagFacadeMaterial(atlas, surface.texture);
        stats.maskTextureBytes += atlas.byteLength;
        stats.surfaceTextureBytes = surface.byteLength;
      }
      const measured = addBagGeometry(group, geometries, material, detailedMaterial);
      for (const key of Object.keys(measured)) stats[key] += measured[key];
      onProgress?.(++done, tiles.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker));
  scene.add(group);
  group.userData = { city: 'Ede', source: '3D BAG LoD 2.2', tiles: tiles.length, facades: stats };
  return group;
}

const STREAM_ENTER = 650;
const STREAM_LEAVE = 1050;
const STREAM_ACTIVE = 12;
const STREAM_RESIDENT = 18;
const STREAM_FETCHES = 2;
const STREAM_BYTES = 48 * 1024 * 1024;
const STREAM_MASK_BYTES = 8 * 1024 * 1024;
const tileDistance = ({ min, max }, { x, z }) => Math.hypot(
  Math.max(min.x - x, 0, x - max.x), Math.max(min.z - z, 0, z - max.z)
);

async function fetchTile(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

export function createBagBuildingStream(scene, { fallback, fetchJson, loadBuffer = fetchTile, loader, replacementBagIds } = {}) {
  const group = new THREE.Group();
  group.name = 'bag3d-buildings';
  scene.add(group);
  const stats = { catalogue: 0, requested: 0, completed: 0, evicted: 0, failed: 0, resident: 0, inFlight: 0,
    geometryBytes: 0, peakGeometryBytes: 0, sourceBytes: 0, coveredBuildings: 0, lastBuildMs: 0,
    maskTextureBytes: 0, surfaceTextureBytes: 0, facadeWalls: 0, observedWalls: 0, recesses: 0,
    lastBuildSliceMs: 0, lastBuildYields: 0 };
  const gltfLoader = loader || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4();
  const current = new THREE.Vector3(), lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  const direction = new THREE.Vector3(), lastDirection = new THREE.Vector3();
  const material = createBagFacadeMaterial();
  const resident = new Map(), fetching = new Map(), buffered = new Map();
  let tiles, facades, surface, desired = new Map(), enabled = true, disposed = false, building = false;
  let catalogueRequested = false, generation = 0;

  function removeTile(tile) {
    const record = resident.get(tile);
    disposeFacadeAtlas(record.atlas);
    record.detailedMaterial?.dispose();
    stats.maskTextureBytes -= record.atlas?.byteLength ?? 0;
    stats.facadeWalls -= record.measured.walls;
    stats.observedWalls -= record.measured.observed;
    stats.recesses -= record.measured.recesses;
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
    selectTileRecords({ fetchJson, boundary: true }).then(value => {
      if (disposed) return;
      tiles = value;
      stats.catalogue = value.length;
      lastPosition.x = Infinity;
    }).catch(error => {
      stats.failed++;
      console.warn('[bag3d] using OSM buildings:', error);
    });
    facades = loadEdeFacades().catch(error => {
      console.warn('[facades] using procedural walls:', error.message);
      return null;
    });
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

  function makeRoom(tile, bytes, maskBytes) {
    while (resident.size >= STREAM_RESIDENT || stats.geometryBytes + bytes > STREAM_BYTES
           || stats.maskTextureBytes + maskBytes > STREAM_MASK_BYTES) {
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
    const pacing = { longestMs: 0, yields: 0 };
    let atlas, geometries, detailedMaterial, added = false;
    try {
      const gltf = await gltfLoader.parseAsync(buffer, new URL('.', tile.url).href);
      if (!stillWanted()) return;
      const appearance = await bagGeometry(gltf, await facades, tile, stillWanted, pacing, replacementBagIds);
      if (!appearance) return;
      ({ geometries, atlas } = appearance);
      const covered = await finishBagWorkIncrementally(coveredFallbackChunks(geometries, fallback), stillWanted, pacing);
      if (!covered) return;
      const bytes = geometries.reduce((sum, geometry) => sum + (geometry.index?.array.byteLength ?? 0)
        + Object.values(geometry.attributes).reduce((size, attr) => size + attr.array.byteLength, 0), 0);
      const maskBytes = atlas?.byteLength ?? 0;
      if (!stillWanted() || !makeRoom(tile, bytes, maskBytes)) {
        tile.retryAt = performance.now() + 5000;
        return;
      }
      if (atlas) {
        surface ??= createFacadeSurfaceTexture();
        detailedMaterial = createBagFacadeMaterial(atlas, surface.texture);
        stats.surfaceTextureBytes = surface.byteLength;
      }
      const tileGroup = new THREE.Group();
      const measured = addBagGeometry(tileGroup, geometries, material, detailedMaterial);
      tileGroup.updateMatrixWorld(true);
      group.add(tileGroup);
      fallback?.replaceBuildings(covered, true);
      resident.set(tile, { group: tileGroup, atlas, detailedMaterial, measured, covered, bytes });
      added = true;
      stats.resident = resident.size;
      stats.completed++;
      stats.coveredBuildings += covered.length;
      stats.facadeWalls += measured.walls;
      stats.observedWalls += measured.observed;
      stats.recesses += measured.recesses;
      stats.maskTextureBytes += maskBytes;
      stats.geometryBytes += bytes;
      stats.peakGeometryBytes = Math.max(stats.peakGeometryBytes, stats.geometryBytes);
      stats.lastBuildMs = performance.now() - start;
      stats.lastBuildSliceMs = pacing.longestMs;
      stats.lastBuildYields = pacing.yields;
    } catch (error) {
      failure(tile, error);
    } finally {
      if (!added) {
        geometries?.forEach(geometry => geometry.dispose());
        disposeFacadeAtlas(atlas);
        detailedMaterial?.dispose();
      }
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
    surface?.texture.dispose();
    surface = null;
    stats.surfaceTextureBytes = 0;
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
