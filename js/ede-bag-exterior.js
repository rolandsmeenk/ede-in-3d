import * as THREE from 'three/webgpu';
import { terrainHeightAt } from './terrain.js';

const base = new URL('../assets/ede-bag-exterior/', import.meta.url);
const bagId = /^\d{16}$/;
const LOAD_DISTANCE = 3600;
const RETAIN_DISTANCE = 4250;
const LOADS = 3;
const RETAIN_TILES = 55;

async function readAsset(path, signal) {
  const response = await fetch(new URL(path, base), { signal });
  if (!response.ok) throw new Error(`Exterior BAG ${path} HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const body = new Response(data);
  return (data[0] === 31 && data[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body).json();
}

let footprints, ownership;

export function loadExteriorBagFootprints() {
  footprints ??= readAsset('footprints.json.gz').then(data => {
    if (!Array.isArray(data) || data.some(item => !bagId.test(item.id) || !Array.isArray(item.polygons))) {
      throw new Error('Invalid exterior BAG footprints');
    }
    return data;
  }).catch(error => {
    footprints = null;
    throw error;
  });
  return footprints;
}

export function loadBagBoundaryOwnership() {
  ownership ??= readAsset('ownership.json.gz').then(data => {
    if (!Array.isArray(data) || data.some(([id, inEde]) => !bagId.test(id) || typeof inEde !== 'boolean')) {
      throw new Error('Invalid BAG boundary ownership');
    }
    // Both sides must be truthy for the GLB metadata matcher.
    return new Map(data.map(([id, inEde]) => [id, inEde ? 1 : -1]));
  }).catch(error => {
    ownership = null;
    throw error;
  });
  return ownership;
}

export function buildExteriorBagColliders(footprints, sampleGround = terrainHeightAt) {
  const colliders = [];
  for (const building of footprints) {
    const { minX, minZ, maxX, maxZ, height = 3, sourceGround } = building;
    const center = sampleGround((minX + maxX) / 2, (minZ + maxZ) / 2);
    const top = Math.max(center, sourceGround ?? center) + height;
    for (const rings of building.polygons) {
      const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
      let ground = center;
      const [outer, ...holes] = rings.map(ring => {
        const points = [];
        for (let i = 0; i < ring.length; i += 2) {
          const x = ring[i], z = ring[i + 1];
          points.push({ x, z });
          bounds.minX = Math.min(bounds.minX, x);
          bounds.minZ = Math.min(bounds.minZ, z);
          bounds.maxX = Math.max(bounds.maxX, x);
          bounds.maxZ = Math.max(bounds.maxZ, z);
          ground = Math.min(ground, sampleGround(x, z));
        }
        return points;
      });
      colliders.push({ ...bounds, minY: ground - 0.25, maxY: top, polygon: { outer, holes } });
    }
  }
  return colliders;
}

export function buildExteriorBagTile(rows, footprintsById, x, z, sampleGround = terrainHeightAt) {
  const walls = [], roofs = [];
  for (const [id, lod, sourceGround, height, wall, roof] of rows) {
    const building = footprintsById.get(id);
    if (!building) throw new Error(`Exterior BAG footprint missing for ${id}`);
    const ground = sampleGround((building.minX + building.maxX) / 2, (building.minZ + building.maxZ) / 2);
    if (lod !== 'height') {
      const baseY = Math.max(ground, sourceGround);
      for (let i = 0; i < wall.length; i += 3) {
        const u = wall[i] / 100, v = wall[i + 2] / 100, relativeY = wall[i + 1] / 100;
        // Extend the lowest parts of the walls to the sampled AHN ground on sloping sites.
        const y = relativeY <= 0.02 ? Math.min(baseY + relativeY, sampleGround(x + u, z + v) - 0.25)
          : baseY + relativeY;
        walls.push(u, y, v);
      }
      for (let i = 0; i < roof.length; i += 3) roofs.push(roof[i] / 100, baseY + roof[i + 1] / 100, roof[i + 2] / 100);
      continue;
    }
    for (const [outer, ...holes] of building.polygons) {
      const rings = [outer, ...holes].map(ring => {
        const points = [];
        for (let i = 0; i < ring.length; i += 2) points.push(new THREE.Vector2(ring[i] - x, ring[i + 1] - z));
        return points;
      });
      const triangles = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1));
      const points = rings.flat();
      // shortcut: use a 3 m extrusion where roof-height measurements are unavailable.
      const top = ground + (height ?? 3);
      for (const tri of triangles) {
        for (const index of tri.reverse()) {
          const { x: u, y: v } = points[index];
          roofs.push(u, top, v);
        }
      }
      for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const ya = Math.min(ground, sampleGround(x + a.x, z + a.y)) - 0.25;
        const yb = Math.min(ground, sampleGround(x + b.x, z + b.y)) - 0.25;
        walls.push(a.x, ya, a.y, b.x, top, b.y, b.x, yb, b.y, a.x, ya, a.y, a.x, top, a.y, b.x, top, b.y);
      }
    }
  }
  const positions = new Float32Array(walls.length + roofs.length);
  positions.set(walls);
  positions.set(roofs, walls.length);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.addGroup(0, walls.length / 3, 0);
  geometry.addGroup(walls.length / 3, roofs.length / 3, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const distance = ({ min, max }, { x, z }) => Math.hypot(
  Math.max(min.x - x, 0, x - max.x), Math.max(min.z - z, 0, z - max.z)
);

export function createExteriorBagStream(scene) {
  const group = new THREE.Group();
  group.name = 'ede-exterior-bag';
  scene.add(group);
  const materials = [0x808080, 0x6b6b6b].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  const point = new THREE.Vector3(), lastPoint = new THREE.Vector3(Infinity, Infinity, Infinity);
  const direction = new THREE.Vector3(), lastDirection = new THREE.Vector3();
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4();
  const resident = new Map(), pending = new Map();
  let catalogue, footprintsById, request, disposed = false, retryAt = 0, candidates = [];
  const stats = { tiles: 0, resident: 0, buildings: 0, inFlight: 0, failed: 0, geometryBytes: 0, counts: null };

  function remove(tile) {
    const mesh = resident.get(tile);
    stats.buildings -= mesh.userData.buildings;
    stats.geometryBytes -= mesh.geometry.attributes.position.array.byteLength * 2;
    mesh.geometry.dispose();
    mesh.removeFromParent();
    resident.delete(tile);
    stats.resident = resident.size;
  }

  async function load(tile, controller) {
    try {
      const rows = await readAsset(tile.path, controller.signal);
      if (disposed || distance(tile.bounds, point) > RETAIN_DISTANCE) return;
      const geometry = buildExteriorBagTile(rows, footprintsById, tile.x, tile.z);
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.position.set(tile.x, 0, tile.z);
      mesh.receiveShadow = true;
      mesh.userData.buildings = rows.length;
      group.add(mesh);
      mesh.updateMatrixWorld(true);
      resident.set(tile, mesh);
      stats.resident = resident.size;
      stats.buildings += rows.length;
      stats.geometryBytes += geometry.attributes.position.array.byteLength * 2;
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') {
        tile.retryAt = performance.now() + 5000;
        stats.failed++;
        console.warn('[Exterior BAG]', error);
      }
    } finally {
      pending.delete(tile);
      stats.inFlight = pending.size;
    }
  }

  function update(camera) {
    if (disposed || globalThis.document?.hidden) return;
    const now = performance.now();
    if (!catalogue) {
      if (request || now < retryAt) return;
      request = new AbortController();
      Promise.all([readAsset('index.json', request.signal), loadExteriorBagFootprints()]).then(([index, all]) => {
        if (disposed) return;
        if (index.version !== 1 || !Array.isArray(index.tiles)) throw new Error('Invalid exterior BAG index');
        catalogue = index.tiles.map(([x, z, path, [minX, minZ, maxX, maxZ]]) => {
          if (![x, z, minX, minZ, maxX, maxZ].every(Number.isFinite) || !/^-?\d+_-?\d+\.json\.gz$/.test(path)) {
            throw new Error('Invalid exterior BAG tile');
          }
          const bounds = new THREE.Box3(new THREE.Vector3(minX, -30, minZ), new THREE.Vector3(maxX, 130, maxZ));
          return { x, z, path, bounds, retryAt: 0 };
        });
        footprintsById = new Map(all.map(item => [item.id, item]));
        stats.tiles = catalogue.length;
        stats.counts = index.counts;
      }).catch(error => {
        if (disposed) return;
        stats.failed++;
        retryAt = performance.now() + 5000;
        console.warn('[Exterior BAG]', error);
      }).finally(() => { request = null; });
      return;
    }
    camera.getWorldPosition(point);
    camera.getWorldDirection(direction);
    if (lastPoint.distanceToSquared(point) >= 32 ** 2 || lastDirection.dot(direction) < 0.985) {
      lastPoint.copy(point);
      lastDirection.copy(direction);
      view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(view, camera.coordinateSystem, camera.reversedDepth);
      candidates = catalogue.map(tile => [tile, distance(tile.bounds, point)])
        .filter(([tile, d]) => d <= LOAD_DISTANCE && (d <= 480 || frustum.intersectsBox(tile.bounds)))
        .sort((a, b) => a[1] - b[1]).slice(0, RETAIN_TILES).map(([tile]) => tile);
      for (const [tile, controller] of pending) if (distance(tile.bounds, point) > RETAIN_DISTANCE) controller.abort();
      for (const tile of resident.keys()) if (distance(tile.bounds, point) > RETAIN_DISTANCE) remove(tile);
    }
    for (const tile of candidates) {
      if (pending.size >= LOADS) break;
      if (resident.has(tile) || pending.has(tile) || tile.retryAt > now) continue;
      if (resident.size + pending.size >= RETAIN_TILES) {
        const stale = [...resident.keys()].find(key => !candidates.includes(key));
        if (!stale) break;
        remove(stale);
      }
      const controller = new AbortController();
      pending.set(tile, controller);
      stats.inFlight = pending.size;
      void load(tile, controller);
    }
  }

  function dispose() {
    disposed = true;
    request?.abort();
    for (const controller of pending.values()) controller.abort();
    for (const tile of resident.keys()) remove(tile);
    materials.forEach(material => material.dispose());
    group.removeFromParent();
  }

  return { update, dispose, stats };
}
