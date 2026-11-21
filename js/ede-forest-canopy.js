import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, interleavedGradientNoise, mix, positionWorld,
  screenCoordinate, smoothstep, uniform } from 'three/tsl';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';
import { treeSeasonNodes } from './tree-seasons.js';

const DIRECTORY = new URL('../assets/ede-forest-canopy/', import.meta.url);
const CELLS = 50;
const MAX_LOADS = 4;
const RESIDENT_LIMIT = 80;
const SWITCH_DISTANCE = 1200;
const FAR_LIMIT = 6500;

async function request(file) {
  const response = await fetch(new URL(file, DIRECTORY));
  if (!response.ok) throw new Error(`Canopy ${file} returned HTTP ${response.status}`);
  return response;
}

export async function loadForestCanopy() {
  try {
    const { version, cells } = await request('manifest.json').then(response => response.json());
    if (version !== 1 || !Array.isArray(cells) || !cells.every(({ id, bounds, step }) =>
      typeof id === 'string' && /^[-_a-zA-Z0-9]+$/.test(id) && [10, 20].includes(step) &&
      bounds?.length === 4 && bounds.every(Number.isFinite) &&
      bounds[2] - bounds[0] === step * CELLS && bounds[3] - bounds[1] === step * CELLS)) {
      throw new Error('Invalid Ede canopy manifest');
    }
    return cells;
  } catch (error) {
    console.warn('[forest canopy] using individual trees:', error);
    return null;
  }
}

function canopyGeometry(buffer, { bounds, step: size }) {
  const side = CELLS + 1;
  const offset = CELLS * CELLS;
  if (buffer.byteLength !== offset + side * side * 2) throw new Error('Invalid canopy cell size');
  const mask = new Uint8Array(buffer, 0, offset);
  const height = new DataView(buffer, offset);
  const positions = new Float32Array(side * side * 3);
  const shades = new Float32Array(side * side);
  const indices = [];
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const i = z * side + x;
    const worldX = bounds[0] + x * size, worldZ = bounds[1] + z * size;
    positions[i * 3] = worldX;
    positions[i * 3 + 1] = height.getInt16(i * 2, true) / 100 - SCENE_NAP_ORIGIN;
    positions[i * 3 + 2] = worldZ;
    shades[i] = 0.8 + 0.2 * Math.sin(worldX * 0.32) * Math.sin(worldZ * 0.23);
    if (x < CELLS && z < CELLS && mask[z * CELLS + x]) {
      indices.push(i, i + side, i + 1, i + 1, i + side, i + side + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('crownShade', new THREE.BufferAttribute(shades, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, mask };
}

export function createForestCanopy(scene, source, seasonal) {
  if (!source?.length) return null;
  const group = new THREE.Group();
  group.name = 'EdeForestCanopies';
  scene.add(group);
  const tint = seasonal ? treeSeasonNodes(float(0)) : null;
  const holdNear = uniform(0);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, alphaTest: 0.5 });
  material.name = 'Distant woodland canopy';
  const base = float(attribute('crownShade', 'float')).mul(new THREE.Color(0x3b5525));
  material.colorNode = tint ? base.mul(mix(1, tint.rgb, 0.55)).mul(mix(0.48, 1, tint.a)) : base;
  const distance = positionWorld.xz.distance(cameraPosition.xz);
  const visibility = mix(smoothstep(380, 580, distance), 1, holdNear);
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
    for (const size of [10, 20]) {
      if (!anchors.has(size)) continue;
      const cell = active[size].get(key(x, z, size));
      if (!cell) continue;
      const col = Math.floor((x - cell.bounds[0]) / size), row = Math.floor((z - cell.bounds[1]) / size);
      return cell.mask[row * CELLS + col] > 0;
    }
    return false;
  }

  function update(camera, treeField) {
    const job = ready.shift();
    if (job) {
      const { cell, buffer } = job;
      try {
        const { geometry, mask } = canopyGeometry(buffer, cell);
        cell.mesh = new THREE.Mesh(geometry, material);
        cell.mesh.visible = false;
        cell.mask = mask;
        cell.bytes = mask.byteLength + geometry.index.array.byteLength + Object.values(geometry.attributes)
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
    const { x, z } = camera.position;
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
        cell.mesh = cell.mask = null;
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
