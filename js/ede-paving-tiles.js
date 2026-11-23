import * as THREE from 'three/webgpu';

const TILE_SIZE = 500;
const BUILD_MS = 3;
const RESIDENT_BYTES = 128 * 1024 * 1024;

export function createPavingTiles(scene, mergeBatches, byteLimit = RESIDENT_BYTES) {
  const group = new THREE.Group();
  group.name = 'Ede paving tiles';
  scene.add(group);

  const tiles = new Map();
  const resident = new Set();
  const stats = { resident: 0, residentBytes: 0, peakResidentBytes: 0 };
  let pending = null;

  function add(bounds, build) {
    const x = Math.floor((bounds.minX + bounds.maxX) / (2 * TILE_SIZE));
    const z = Math.floor((bounds.minZ + bounds.maxZ) / (2 * TILE_SIZE));
    const key = x + '/' + z;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { ...bounds, jobs: [] };
      tiles.set(key, tile);
    }
    tile.minX = Math.min(tile.minX, bounds.minX);
    tile.minZ = Math.min(tile.minZ, bounds.minZ);
    tile.maxX = Math.max(tile.maxX, bounds.maxX);
    tile.maxZ = Math.max(tile.maxZ, bounds.maxZ);
    tile.jobs.push(build);
  }

  function discard(tile) {
    tile.meshes.removeFromParent();
    tile.meshes.traverse(object => object.geometry?.dispose());
    tile.meshes = null;
    resident.delete(tile);
    stats.residentBytes -= tile.bytes;
  }

  function update({ x, z }, reach = 1200) {
    const distanceSq = tile => Math.max(tile.minX - x, 0, x - tile.maxX) ** 2 +
      Math.max(tile.minZ - z, 0, z - tile.maxZ) ** 2;
    const reachSq = reach ** 2;
    for (const tile of resident) {
      if (distanceSq(tile) > reachSq) discard(tile);
    }
    if (pending && distanceSq(pending.tile) > reachSq) {
      for (const geometries of pending.batches.values()) geometries.forEach(geometry => geometry.dispose());
      pending = null;
    }
    if (!pending) {
      const nearest = [];
      for (const tile of tiles.values()) {
        const distance = distanceSq(tile);
        if (distance <= reachSq) nearest.push({ tile, distance });
      }
      nearest.sort((a, b) => a.distance - b.distance);
      let bytes = 0;
      for (const { tile } of nearest) {
        // Keep the nearest tile even if its geometry exceeds the cache budget.
        if (bytes && bytes + (tile.bytes ?? 0) > byteLimit) continue;
        if (!tile.meshes) {
          pending = { tile, next: 0, batches: new Map() };
          break;
        }
        bytes += tile.bytes;
      }
      if (!pending) {
        stats.resident = resident.size;
        return false;
      }
    }

    const deadline = performance.now() + BUILD_MS;
    const { tile, batches } = pending;
    do {
      tile.jobs[pending.next++](batches);
    } while (pending.next < tile.jobs.length && performance.now() < deadline);
    if (pending.next < tile.jobs.length) return true;

    const meshes = new THREE.Group();
    mergeBatches(batches, meshes);
    let bytes = 0;
    for (const { geometry } of meshes.children) {
      bytes += geometry.index?.array.byteLength ?? 0;
      for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
    }
    tile.bytes = bytes;
    tile.meshes = meshes;
    group.add(meshes);
    meshes.updateMatrixWorld(true);
    resident.add(tile);
    stats.residentBytes += bytes;
    if (stats.residentBytes > byteLimit) {
      const farthestFirst = [...resident].sort((a, b) => distanceSq(b) - distanceSq(a));
      for (const entry of farthestFirst) {
        if (stats.residentBytes <= byteLimit || resident.size === 1) break;
        discard(entry);
      }
    }
    stats.resident = resident.size;
    stats.peakResidentBytes = Math.max(stats.peakResidentBytes, stats.residentBytes);
    pending = null;
    return true;
  }

  return { add, update, stats };
}
