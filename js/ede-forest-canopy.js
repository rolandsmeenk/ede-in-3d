import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, interleavedGradientNoise, mix, positionWorld,
  screenCoordinate, smoothstep, uniform } from 'three/tsl';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';
import { terrainHeightAt } from './terrain.js';
import { treeSeasonNodes } from './tree-seasons.js';

const DIRECTORY = new URL('../assets/ede-forest-canopy/', import.meta.url);
const CELLS = 50;
const MAX_LOADS = 4;
const RESIDENT_LIMIT = 80;
const SWITCH_DISTANCE = 1200;
const FAR_LIMIT = 6500;
const FADE_START = 380, FADE_END = 580;
const FULL_EDGE = 2 ** CELLS - 1;
const BEVEL = 0.42;

async function request(file) {
  const response = await fetch(new URL(file, DIRECTORY));
  if (!response.ok) throw new Error(`Canopy ${file} returned HTTP ${response.status}`);
  return response;
}

export async function loadForestCanopy() {
  try {
    const { version, cells } = await request('manifest.json').then(response => response.json());
    if (version !== 1 || !Array.isArray(cells) || !cells.every(({ id, bounds, step, neighborMask }) =>
      typeof id === 'string' && /^[-_a-zA-Z0-9]+$/.test(id) && [10, 20].includes(step) &&
      bounds?.length === 4 && bounds.every(Number.isFinite) &&
      bounds[2] - bounds[0] === step * CELLS && bounds[3] - bounds[1] === step * CELLS &&
      (neighborMask === undefined || Array.isArray(neighborMask) && neighborMask.length === 4 &&
        neighborMask.every(bits => Number.isSafeInteger(bits) && bits >= 0 && bits <= FULL_EDGE)))) {
      throw new Error('Invalid Ede canopy manifest');
    }
    return cells;
  } catch (error) {
    console.warn('[forest canopy] using individual trees:', error);
    return null;
  }
}

export function canopyGeometry(buffer, { bounds, step: size, neighborMask = [FULL_EDGE, FULL_EDGE, FULL_EDGE, FULL_EDGE] }) {
  const side = CELLS + 1;
  const offset = CELLS * CELLS;
  if (buffer.byteLength !== offset + side * side * 2) throw new Error('Invalid canopy cell size');
  const mask = new Uint8Array(buffer, 0, offset);
  const height = new DataView(buffer, offset);
  const positions = new Array(side * side * 3);
  const shades = new Array(side * side);
  const indices = [];
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const i = z * side + x;
    const worldX = bounds[0] + x * size, worldZ = bounds[1] + z * size;
    positions[i * 3] = worldX;
    positions[i * 3 + 1] = height.getInt16(i * 2, true) / 100 - SCENE_NAP_ORIGIN;
    positions[i * 3 + 2] = worldZ;
    const shade = Math.sin(worldX * 0.743 + worldZ * 0.513) * 43758.5453;
    shades[i] = 0.70 + 0.30 * (shade - Math.floor(shade));
  }
  // Keep the sides of connected crowns in the same mesh, using the surveyed
  // neighbouring mask to leave the interior of a forest open across tile seams.
  const sides = new Map();
  function sideVertices(i) {
    let pair = sides.get(i);
    if (!pair) {
      const x = positions[i * 3], top = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const base = Math.min(top - 0.08, terrainHeightAt(x, z) + 0.2);
      pair = [positions.length / 3, positions.length / 3 + 1];
      positions.push(x, top, z, x, base, z);
      shades.push(shades[i] * 0.82, shades[i] * 0.36);
      sides.set(i, pair);
    }
    return pair;
  }
  function wall(a, b) {
    const [topA, lowA] = sideVertices(a), [topB, lowB] = sideVertices(b);
    indices.push(topA, topB, lowA, lowA, topB, lowB);
  }
  const cuts = new Uint8Array(CELLS * CELLS);
  const coveredOnNeighbor = (edge, index) => Math.floor(neighborMask[edge] / 2 ** index) % 2;
  function bevel(corner, toward) {
    const index = positions.length / 3;
    for (let axis = 0; axis < 3; axis++) {
      const start = positions[corner * 3 + axis], end = positions[toward * 3 + axis];
      positions.push(start + (end - start) * BEVEL);
    }
    shades.push(shades[corner] + (shades[toward] - shades[corner]) * BEVEL);
    return index;
  }
  for (let z = 0; z < CELLS; z++) for (let x = 0; x < CELLS; x++) {
    const cell = z * CELLS + x;
    if (!mask[cell]) continue;
    const north = z > 0 ? mask[cell - CELLS] : coveredOnNeighbor(0, x);
    const east = x + 1 < CELLS ? mask[cell + 1] : coveredOnNeighbor(1, z);
    const south = z + 1 < CELLS ? mask[cell + CELLS] : coveredOnNeighbor(2, x);
    const west = x > 0 ? mask[cell - 1] : coveredOnNeighbor(3, z);
    const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
    if (north && east && south && west) {
      indices.push(a, c, b, b, c, d);
      continue;
    }
    const corners = [a, b, d, c];
    const neighbors = [north, east, south, west];
    const connected = neighbors.some(Boolean);
    const ring = [];
    const starts = [], ends = [];
    for (let i = 0; i < 4; i++) {
      const previous = (i + 3) % 4, next = (i + 1) % 4;
      if (neighbors[previous] || neighbors[i]) {
        starts[i] = ends[i] = corners[i];
        ring.push(corners[i]);
        continue;
      }
      cuts[cell] |= 1 << i;
      starts[i] = bevel(corners[i], corners[previous]);
      ends[i] = bevel(corners[i], corners[next]);
      ring.push(starts[i], ends[i]);
      if (connected) wall(starts[i], ends[i]);
    }
    for (let i = 1; i < ring.length - 1; i++) indices.push(ring[0], ring[i + 1], ring[i]);
    if (connected) {
      for (let i = 0; i < 4; i++) {
        if (!neighbors[i]) wall(ends[i], starts[(i + 1) % 4]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('crownShade', new THREE.Float32BufferAttribute(shades, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, mask, cuts };
}

export function createForestCanopy(scene, source, seasonal) {
  if (!source?.length) return null;
  const group = new THREE.Group();
  group.name = 'EdeForestCanopies';
  scene.add(group);
  const tint = seasonal ? treeSeasonNodes(float(0)) : null;
  const holdNear = uniform(0), aerialOffset = uniform(0);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, alphaTest: 0.5 });
  material.name = 'Distant woodland canopy';
  const base = float(attribute('crownShade', 'float')).mul(new THREE.Color(0x3b5525));
  material.colorNode = tint ? base.mul(mix(1, tint.rgb, 0.55)).mul(mix(0.48, 1, tint.a)) : base;
  const distance = positionWorld.xz.distance(cameraPosition.xz).add(aerialOffset);
  const visibility = mix(smoothstep(FADE_START, FADE_END, distance), 1, holdNear);
  material.opacityNode = float(interleavedGradientNoise(screenCoordinate.xy).lessThan(visibility));

  const cells = new Map(source.map(cell => [cell.id, { ...cell }]));
  const owned = new Set(source.flatMap(cell => cell.children ?? []));
  const roots = [...cells.values()].filter(cell => !owned.has(cell.id));
  const anchors = new Map();
  for (const cell of source) {
    if (!anchors.has(cell.step)) anchors.set(cell.step, cell.bounds);
  }
  const key = (x, z, step) => {
    const [west, north] = anchors.get(step);
    const size = step * CELLS;
    return `${Math.floor((x - west) / size)}/${Math.floor((z - north) / size)}`;
  };
  const active = { 10: new Map(), 20: new Map() };
  const visible = new Set(), ready = [], resident = new Set();
  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), box = new THREE.Box3();
  const stats = { visible: 0, loading: 0, resident: 0, residentBytes: 0, peakResidentBytes: 0, revision: 0 };
  let pending = 0, tick = 0, nextUpdate = 0;
  let viewX = 0, viewZ = 0, fullCanopyRadiusSq = FADE_END ** 2;
  function enqueue(cell) {
    if (cell.mesh || cell.loading || cell.retry > performance.now() || pending >= MAX_LOADS) return;
    cell.loading = true;
    pending++;
    request(`${cell.id}.bin`).then(response => response.arrayBuffer()).then(buffer => ready.push({ cell, buffer }))
      .catch(error => {
        pending--;
        cell.loading = false;
        cell.retry = performance.now() + 5000;
        console.warn('[forest canopy]', cell.id, error);
      });
  }

  function covers(x, z) {
    if (!group.visible || (x - viewX) ** 2 + (z - viewZ) ** 2 < fullCanopyRadiusSq) return false;
    for (const size of [10, 20]) {
      if (!anchors.has(size)) continue;
      const cell = active[size].get(key(x, z, size));
      if (!cell) continue;
      const u = (x - cell.bounds[0]) / size, v = (z - cell.bounds[1]) / size;
      const col = Math.floor(u), row = Math.floor(v);
      const index = row * CELLS + col, cornerCuts = cell.cuts[index];
      if (!cell.mask[index]) return false;
      const dx = u - col, dz = v - row;
      return (!(cornerCuts & 1) || dx + dz >= BEVEL) &&
        (!(cornerCuts & 2) || 1 - dx + dz >= BEVEL) &&
        (!(cornerCuts & 4) || 2 - dx - dz >= BEVEL) &&
        (!(cornerCuts & 8) || dx + 1 - dz >= BEVEL);
    }
    return false;
  }

  function update(camera, treeField) {
    const job = ready.shift();
    if (job) {
      const { cell, buffer } = job;
      try {
        const { geometry, mask, cuts } = canopyGeometry(buffer, cell);
        cell.mesh = new THREE.Mesh(geometry, material);
        cell.mesh.visible = false;
        cell.mask = mask;
        cell.cuts = cuts;
        cell.bytes = mask.byteLength + cuts.byteLength + geometry.index.array.byteLength + Object.values(geometry.attributes)
          .reduce((sum, attr) => sum + attr.array.byteLength, 0);
        group.add(cell.mesh);
        resident.add(cell);
        stats.residentBytes += cell.bytes;
        stats.peakResidentBytes = Math.max(stats.peakResidentBytes, stats.residentBytes);
      } catch (error) {
        cell.retry = performance.now() + 5000;
        console.warn('[forest canopy]', cell.id, error);
      } finally {
        pending--;
        cell.loading = false;
      }
    }
    const { x, y, z } = camera.position;
    viewX = x;
    viewZ = z;
    aerialOffset.value = Math.min(FADE_END, Math.max(0, (y - terrainHeightAt(x, z) - 40) * 4));
    fullCanopyRadiusSq = (FADE_END - aerialOffset.value) ** 2;
    holdNear.value = treeField.coveragePending?.(x, z) ? 1 : 0;
    const now = performance.now();
    if (now < nextUpdate && !job) return;
    nextUpdate = now + 90;
    tick++;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem, camera.reversedDepth);
    const inView = ({ bounds: [w, n, e, s] }) => {
      // Leave room for the crowns and the range of terrain elevations in the expansion.
      box.min.set(w, -20, n);
      box.max.set(e, 85, s);
      return frustum.intersectsBox(box);
    };
    const distance = ({ bounds: [w, n, e, s] }) =>
      Math.hypot(Math.max(w - x, 0, x - e), Math.max(n - z, 0, z - s));
    const candidates = [];
    const next = new Set();
    for (const root of roots) {
      const d = distance(root);
      if (d > FAR_LIMIT || (d > 650 && !inView(root))) continue;
      root.used = tick;
      const children = d < SWITCH_DISTANCE && root.children?.map(id => cells.get(id)).filter(Boolean);
      if (children?.length) {
        for (const child of children) {
          child.used = tick;
          if (!child.mesh) candidates.push([child, distance(child)]);
        }
        if (children.every(cell => cell.mesh)) {
          children.forEach(cell => next.add(cell));
          continue;
        }
      }
      if (root.mesh) next.add(root);
      else candidates.push([root, d - 400]);
    }
    candidates.sort((a, b) => a[1] - b[1]);
    for (const [cell] of candidates) {
      if (pending >= MAX_LOADS) break;
      enqueue(cell);
    }
    if (next.size !== visible.size || [...next].some(cell => !visible.has(cell))) stats.revision++;
    for (const cell of visible) {
      if (next.has(cell)) continue;
      cell.mesh.visible = false;
      active[cell.step].delete(key(cell.bounds[0], cell.bounds[1], cell.step));
    }
    visible.clear();
    for (const cell of next) {
      cell.mesh.visible = true;
      visible.add(cell);
      active[cell.step].set(key(cell.bounds[0], cell.bounds[1], cell.step), cell);
    }
    if (resident.size > RESIDENT_LIMIT) {
      const stale = [...resident].filter(cell => cell.used !== tick).sort((a, b) => a.used - b.used);
      for (const cell of stale) {
        if (resident.size <= RESIDENT_LIMIT) break;
        group.remove(cell.mesh);
        cell.mesh.geometry.dispose();
        cell.mesh = cell.mask = cell.cuts = null;
        resident.delete(cell);
        stats.residentBytes -= cell.bytes;
      }
    }
    stats.visible = next.size;
    stats.loading = pending;
    stats.resident = resident.size;
  }
  return { group, covers, update, stats };
}
