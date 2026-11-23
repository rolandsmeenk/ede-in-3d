import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, interleavedGradientNoise, mix, positionWorld,
  screenCoordinate, smoothstep, uniform, userData } from 'three/tsl';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';
import { terrainHeightAt } from './terrain.js';
import { containsPlayablePoint, playableBoundsCovered, playableBoundsOverlap } from './ede-playable-boundary.js';
import { treeSeasonNodes } from './tree-seasons.js';

const DIRECTORY = new URL('../assets/ede-forest-canopy/', import.meta.url);
const CELLS = 50;
const MAX_LOADS = 4;
const RESIDENT_LIMIT = 80;
const SWITCH_DISTANCE = 1200;
const TILE_FADE_MS = 400;
const FAR_LIMIT = 6500;
const FADE_START = 380, FADE_END = 580;
const FULL_EDGE = 2 ** CELLS - 1;
const BEVEL = 0.42;
const SKIRT_BASE = [1, 1, 0.42];
const CROWN_PROFILE = [[0, 0.22, 0.94], [0.16, 0.59, 0.72], SKIRT_BASE];
const DISTANT_CROWN_PROFILE = [[0, 0.28, 0.92], SKIRT_BASE];

async function request(file) {
  const response = await fetch(new URL(`${file}?v=20261123-municipal`, DIRECTORY));
  if (!response.ok) throw new Error(`Canopy ${file} returned HTTP ${response.status}`);
  return response;
}

export async function loadForestCanopy() {
  try {
    const { version, cells, northernTreeSamples = [] } = await request('manifest.json').then(response => response.json());
    if (![1, 2].includes(version) || !Array.isArray(cells) || !cells.every(({ id, bounds, step, neighborMask, maxY }) =>
      typeof id === 'string' && /^[-_a-zA-Z0-9]+$/.test(id) && [10, 20].includes(step) &&
      bounds?.length === 4 && bounds.every(Number.isFinite) &&
      (version === 1 || Number.isFinite(maxY)) && bounds[2] - bounds[0] === step * CELLS && bounds[3] - bounds[1] === step * CELLS &&
      (neighborMask === undefined || Array.isArray(neighborMask) && neighborMask.length === 4 &&
        neighborMask.every(bits => Number.isSafeInteger(bits) && bits >= 0 && bits <= FULL_EDGE)))) {
      throw new Error('Invalid Ede canopy manifest');
    }
    const samples = Array.isArray(northernTreeSamples) && northernTreeSamples.every(sample =>
      Array.isArray(sample) && sample.length === 3 && sample.every(Number.isFinite));
    return { cells: version === 2 ? cells.map(cell => ({ ...cell, buffered: true }))
      : cells.filter(cell => playableBoundsOverlap(...cell.bounds)), northernTreeSamples: samples ? northernTreeSamples : [] };
  } catch (error) {
    console.warn('[forest canopy] using individual trees:', error);
    return null;
  }
}

export function canopyGeometry(buffer, { bounds, step: size, buffered = false, neighborMask = [FULL_EDGE, FULL_EDGE, FULL_EDGE, FULL_EDGE] }) {
  const side = CELLS + 1;
  const offset = CELLS * CELLS;
  if (buffer.byteLength !== offset + side * side * 2) throw new Error('Invalid canopy cell size');
  const rawMask = new Uint8Array(buffer, 0, offset);
  const mask = !buffered && playableBoundsCovered && !playableBoundsCovered(...bounds) ? rawMask.slice() : rawMask;
  if (mask !== rawMask) for (let z = 0; z < CELLS; z++) for (let x = 0; x < CELLS; x++) {
    const i = z * CELLS + x;
    if (!mask[i]) continue;
    const left = bounds[0] + x * size, top = bounds[1] + z * size;
    if (!playableBoundsCovered(left, top, left + size, top + size)) mask[i] = 0;
  }
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
  const outlines = new Map(), isolated = new Set();
  const coveredOnNeighbor = (edge, index) => Math.floor(neighborMask[edge] / 2 ** index) % 2;
  function covered(x, z) {
    if (z < 0) return coveredOnNeighbor(0, x);
    if (x >= CELLS) return coveredOnNeighbor(1, z);
    if (z >= CELLS) return coveredOnNeighbor(2, x);
    if (x < 0) return coveredOnNeighbor(3, z);
    return mask[z * CELLS + x] ? 1 : 0;
  }

  const walls = [], insets = new Map(), previousVertex = new Map(), nextVertex = new Map();
  function wall(a, b) {
    const dx = positions[b * 3] - positions[a * 3];
    const dz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const length = Math.hypot(dx, dz);
    for (const i of [a, b]) {
      if (!insets.has(i)) insets.set(i, [0, 0]);
      const inset = insets.get(i);
      inset[0] -= dz / length;
      inset[1] += dx / length;
    }
    walls.push([a, b]);
    nextVertex.set(a, b);
    previousVertex.set(b, a);
  }
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
    const north = covered(x, z - 1), east = covered(x + 1, z);
    const south = covered(x, z + 1), west = covered(x - 1, z);
    const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
    if (north && east && south && west) {
      indices.push(a, c, b, b, c, d);
      continue;
    }
    const corners = [a, b, d, c];
    const neighbors = [north, east, south, west];
    const ring = [];
    const starts = [], ends = [];
    for (let i = 0; i < 4; i++) {
      const previous = (i + 3) % 4, next = (i + 1) % 4;
      if (neighbors[previous] || neighbors[i]) {
        starts[i] = ends[i] = corners[i];
        ring.push(corners[i]);
        continue;
      }
      starts[i] = bevel(corners[i], corners[previous]);
      ends[i] = bevel(corners[i], corners[next]);
      ring.push(starts[i], ends[i]);
      wall(starts[i], ends[i]);
    }
    if (!neighbors.some(Boolean)) for (const vertex of ring) isolated.add(vertex);
    outlines.set(cell, ring);
    for (let i = 1; i < ring.length - 1; i++) indices.push(ring[0], ring[i + 1], ring[i]);
    for (let i = 0; i < 4; i++) {
      if (!neighbors[i]) wall(ends[i], starts[(i + 1) % 4]);
    }
  }

  // Both tiles solve a shared rim vertex using the same four coverage samples.
  // Keep it on the seam whenever covered cells connect across it.
  function alignSeam(x, z, vertical) {
    const i = z * side + x;
    const nw = covered(x - 1, z - 1), ne = covered(x, z - 1);
    const sw = covered(x - 1, z), se = covered(x, z);
    if (!insets.has(i) && nw + ne + sw + se !== 3) return;
    const joins = vertical ? (nw && ne) || (sw && se) : (nw && sw) || (ne && se);
    const dx = joins && vertical ? 0 : ne + se - nw - sw;
    const dz = joins && !vertical ? 0 : sw + se - nw - ne;
    insets.set(i, [dx, dz]);
  }
  for (let j = 1; j < CELLS; j++) {
    alignSeam(j, 0, false);
    alignSeam(j, CELLS, false);
    alignSeam(0, j, true);
    alignSeam(CELLS, j, true);
  }
  // Corner neighbours aren't represented in the tile mask.
  for (const i of [0, CELLS, CELLS * side, side * side - 1]) {
    if (insets.has(i)) insets.set(i, [0, 0]);
  }

  // Smooth the traced polygon before rolling its sides down. Tile joins stay pinned,
  // and a concave turn can move only a little into a mapped clearing.
  const smoothed = new Map();
  for (const [i, [inwardX, inwardZ]] of insets) {
    const col = i % side, row = Math.floor(i / side);
    if (row < side && (col === 0 || col === CELLS || row === 0 || row === CELLS)) continue;
    const a = previousVertex.get(i), b = nextVertex.get(i);
    if (a === undefined || b === undefined) continue;
    const x = positions[i * 3], z = positions[i * 3 + 2];
    const ax = positions[a * 3] - x, az = positions[a * 3 + 2] - z;
    const bx = positions[b * 3] - x, bz = positions[b * 3 + 2] - z;
    const lengthA = Math.hypot(ax, az), lengthB = Math.hypot(bx, bz);
    const step = Math.min(lengthA, lengthB) * 0.33;
    const shiftX = (ax / lengthA + bx / lengthB) * step;
    const shiftZ = (az / lengthA + bz / lengthB) * step;
    const limit = shiftX * inwardX + shiftZ * inwardZ < 0 ? Math.min(1.15, size * 0.115) : size * 0.20;
    const scale = Math.min(1, limit / (Math.hypot(shiftX, shiftZ) || 1));
    smoothed.set(i, [x + shiftX * scale, z + shiftZ * scale]);
  }

  const rings = new Map(), profile = size === 10 ? CROWN_PROFILE : DISTANT_CROWN_PROFILE;
  for (const [i, [dx, dz]] of insets) {
    const [x, z] = smoothed.get(i) ?? [positions[i * 3], positions[i * 3 + 2]];
    const top = positions[i * 3 + 1];
    const height = top - terrainHeightAt(x, z);
    // The short edges between two diagonal cuts need a smaller inset.
    const radius = Math.max(0, Math.min(size * (i < side * side ? 0.30 : 0.15), height * 0.36));
    const scale = radius / (Math.hypot(dx, dz) || 1);
    const insetX = dx * scale, insetZ = dz * scale;
    const footX = x + insetX, footZ = z + insetZ;
    const ground = Math.min(top - 0.08, terrainHeightAt(footX, footZ) + 0.18);
    // Leave air below a single detached crown rather than putting a skirt all the way to the ground.
    const base = isolated.has(i) ? ground + (top - ground) * 0.38 : ground;
    positions[i * 3] = footX;
    positions[i * 3 + 2] = footZ;
    const ring = [i];
    // Roll out from the roof, then bend back in toward the ground.
    for (const [inset, drop, shade] of profile) {
      ring.push(positions.length / 3);
      positions.push(x + insetX * inset, top + (base - top) * drop, z + insetZ * inset);
      shades.push(shades[i] * shade);
    }
    rings.set(i, ring);
  }
  for (const [a, b] of walls) {
    const left = rings.get(a), right = rings.get(b);
    for (let j = 1; j < left.length; j++) {
      indices.push(left[j - 1], right[j - 1], left[j], left[j], right[j - 1], right[j]);
    }
  }

  for (const outline of outlines.values()) {
    for (let i = 0; i < outline.length; i++) outline[i] = rings.get(outline[i])?.[1] ?? outline[i];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('crownShade', new THREE.Float32BufferAttribute(shades, 1));
  const exterior = new Float32Array(positions.length / 3);
  if (buffered && playableBoundsOverlap && !playableBoundsOverlap(...bounds)) exterior.fill(1);
  else if (buffered && containsPlayablePoint && !playableBoundsCovered(...bounds)) {
    for (let i = 0; i < exterior.length; i++) {
      exterior[i] = Number(!containsPlayablePoint(positions[i * 3], positions[i * 3 + 2]));
    }
  }
  geometry.setAttribute('exteriorCanopy', new THREE.BufferAttribute(exterior, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, mask, outlines };
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
  const nearTrees = mix(smoothstep(FADE_START, FADE_END, distance), 1, holdNear);
  const visibility = mix(nearTrees, 1, attribute('exteriorCanopy', 'float'));
  const pattern = interleavedGradientNoise(screenCoordinate.xy);
  const range = userData('lodRange', 'vec2');
  // The parent and children occupy complementary parts of the same screen-door pattern.
  material.opacityNode = float(pattern.greaterThanEqual(range.x.mul(visibility))
    .and(pattern.lessThan(range.y.mul(visibility))));

  const cells = new Map(source.map(cell => [cell.id, { ...cell }]));
  const owned = new Set(source.flatMap(cell => cell.children ?? []));
  const roots = [...cells.values()].filter(cell => !owned.has(cell.id));
  for (const root of roots) {
    root.lodRange = new THREE.Vector2(0, 1);
    root.childLodRange = new THREE.Vector2(0, 1);
    root.childTiles = (root.children ?? []).map(id => cells.get(id)).filter(Boolean);
    for (const child of root.childTiles) child.lodRange = root.childLodRange;
  }
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
  const visible = new Set(), ready = [], resident = new Set(), fading = new Set();
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
      const index = row * CELLS + col;
      if (!cell.mask[index]) return false;
      const outline = cell.outlines.get(index);
      if (!outline) return true;
      const points = cell.mesh.geometry.attributes.position;
      let inside = false;
      for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const az = points.getZ(outline[j]), bz = points.getZ(outline[i]);
        if ((az > z) === (bz > z)) continue;
        const ax = points.getX(outline[j]), bx = points.getX(outline[i]);
        if (x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
      }
      return inside;
    }
    return false;
  }

  function setBlend(root, blend) {
    root.blend = blend;
    root.lodRange.x = blend;
    root.childLodRange.y = blend;
  }

  function selectBlend(root, target, now, canFade) {
    if (!canFade || root.blend === undefined) {
      fading.delete(root);
      setBlend(root, target);
    } else if (root.target !== target) {
      root.fadeFrom = root.blend;
      root.fadeStart = now;
      if (root.fadeFrom === target) fading.delete(root);
      else fading.add(root);
    }
    root.target = target;
  }

  function update(camera, treeField) {
    const job = ready.shift();
    if (job) {
      const { cell, buffer } = job;
      try {
        const { geometry, mask, outlines } = canopyGeometry(buffer, cell);
        cell.mesh = new THREE.Mesh(geometry, material);
        cell.mesh.visible = false;
        cell.mesh.userData.lodRange = cell.lodRange;
        cell.mask = mask;
        cell.outlines = outlines;
        const outlineBytes = [...outlines.values()].reduce((sum, outline) => sum + outline.length * 4, 0);
        cell.bytes = mask.byteLength + outlineBytes + geometry.index.array.byteLength + Object.values(geometry.attributes)
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
    for (const root of fading) {
      const t = Math.min(1, (now - root.fadeStart) / TILE_FADE_MS);
      const blend = t * t * (3 - 2 * t);
      setBlend(root, root.fadeFrom + (root.target - root.fadeFrom) * blend);
      if (t === 1) {
        fading.delete(root);
        nextUpdate = 0;
      }
    }
    if (now < nextUpdate && !job) return;
    nextUpdate = now + 90;
    tick++;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem, camera.reversedDepth);
    const inView = ({ bounds: [w, n, e, s], maxY }) => {
      // Leave room for the crowns and the range of terrain elevations in the expansion.
      box.min.set(w, -20, n);
      box.max.set(e, maxY ?? 110, s);
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
      const children = root.childTiles;
      const preferDetail = d < SWITCH_DISTANCE && children.length > 0;
      const detailReady = children.length > 0 && children.every(child => child.mesh);
      if (preferDetail) {
        for (const child of children) {
          child.used = tick;
          if (!child.mesh) candidates.push([child, distance(child)]);
        }
      }
      if (!root.mesh && (!preferDetail || !detailReady)) candidates.push([root, d - 400]);
      if (!root.mesh && !detailReady) continue;
      const target = detailReady && (preferDetail || !root.mesh) ? 1 : 0;
      selectBlend(root, target, now, root.mesh && detailReady);
      if (root.mesh && (root.blend < 1 || target === 0)) next.add(root);
      if (detailReady && (root.blend > 0 || target === 1)) {
        for (const child of children) {
          child.used = tick;
          next.add(child);
        }
      }
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
        cell.mesh = cell.mask = cell.outlines = null;
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
