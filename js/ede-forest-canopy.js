import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, interleavedGradientNoise, mix, positionWorld,
  screenCoordinate, smoothstep, uniform, userData } from 'three/tsl';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';
import { terrainHeightAt } from './terrain.js';
import { buildCanopyGeometry, CELLS, FULL_EDGE, restoreLandscapeGeometry } from './ede-landscape-geometry.js';
import { runLandscapeJob } from './ede-landscape-jobs.js';
import { containsPlayablePoint, playableBoundsCovered, playableBoundsOverlap, playableBoundary } from './ede-playable-boundary.js';
import { treeSeasonNodes } from './tree-seasons.js';

const DIRECTORY = new URL('../assets/ede-forest-canopy/', import.meta.url);
const MAX_LOADS = 4;
const RESIDENT_LIMIT = 80;
const SWITCH_DISTANCE = 1200;
const TILE_FADE_MS = 400;
const FAR_LIMIT = 6500;
const FADE_START = 380, FADE_END = 580;

async function request(file, signal) {
  const response = await fetch(new URL(`${file}?v=20261123-municipal`, DIRECTORY), { signal });
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

export function canopyGeometry(buffer, cell) {
  return buildCanopyGeometry(buffer, cell, {
    napOrigin: SCENE_NAP_ORIGIN, terrainHeightAt, containsPlayablePoint, playableBoundsCovered, playableBoundsOverlap,
  });
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
  const visible = new Set(), ready = [], resident = new Set(), fading = new Set(), loading = new Map();
  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), box = new THREE.Box3();
  const stats = { visible: 0, loading: 0, resident: 0, residentBytes: 0, peakResidentBytes: 0, revision: 0 };
  let pending = 0, tick = 0, nextUpdate = 0;
  let viewX = 0, viewZ = 0, fullCanopyRadiusSq = FADE_END ** 2;
  function finish(cell) {
    loading.delete(cell);
    cell.loading = false;
    pending--;
  }

  function enqueue(cell) {
    if (cell.mesh || cell.loading || cell.retry > performance.now() || pending >= MAX_LOADS) return;
    const controller = new AbortController();
    const { signal } = controller;
    loading.set(cell, controller);
    cell.loading = true;
    pending++;
    request(`${cell.id}.bin`, signal).then(response => response.arrayBuffer()).then(async buffer => {
      if (signal.aborted) return;
      const { bounds, step, buffered, neighborMask } = cell;
      const [west, north, east, south] = bounds;
      const result = typeof Worker === 'undefined' ? null : await runLandscapeJob('canopy', buffer,
        { bounds, step, buffered, neighborMask }, [west - step, north - step, east + step, south + step],
        signal, { boundary: playableBoundary, napOrigin: SCENE_NAP_ORIGIN });
      if (!signal.aborted) ready.push({ cell, buffer: result ? null : buffer, result, signal });
    }).catch(error => {
      if (signal.aborted) return;
      finish(cell);
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
    while (ready[0]?.signal.aborted) ready.shift();
    const { x, y, z } = camera.position;
    const jumped = Math.hypot(x - viewX, z - viewZ) >= 500;
    const job = jumped ? null : ready.shift();
    if (job) {
      const { cell, buffer, result } = job;
      try {
        const { geometry, mask, outlines } = result
          ? { geometry: restoreLandscapeGeometry(result.mesh), mask: result.mask, outlines: result.outlines }
          : canopyGeometry(buffer, cell);
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
        finish(cell);
      }
    }
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
    if (now < nextUpdate && !job && !jumped) return;
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
    for (const [cell, controller] of loading) {
      if (cell.used === tick) continue;
      controller.abort();
      finish(cell);
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
