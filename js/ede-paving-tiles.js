import * as THREE from 'three/webgpu';

const TILE_SIZE = 500;
const BUILD_MS = 3;
const UPLOAD_BYTES = 4 * 1024 * 1024;
const RESIDENT_BYTES = 128 * 1024 * 1024;

export function createPavingTiles(scene, mergeBatches, byteLimit = RESIDENT_BYTES, request = null, materials = {}, fallbackBuild = null) {
  const group = new THREE.Group();
  group.name = 'Ede paving tiles';
  scene.add(group);

  const tiles = new Map();
  const resident = new Set();
  const stats = { resident: 0, residentBytes: 0, peakResidentBytes: 0, workerTiles: 0, fallbackTiles: 0, frameUploadBytes: 0 };
  let pending = null;

  function add(bounds, build, data) {
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
    tile.jobs.push({ build, data });
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
    stats.frameUploadBytes = 0;
    for (const tile of resident) {
      if (distanceSq(tile) > reachSq) discard(tile);
    }
    if (pending && distanceSq(pending.tile) > reachSq) {
      pending.request?.cancel();
      for (const geometries of pending.batches.values()) geometries.forEach(geometry => geometry.dispose());
      if (pending.meshes) {
        pending.meshes.removeFromParent();
        for (const mesh of pending.meshes.children) mesh.geometry.dispose();
      }
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
          const job = { tile, next: 0, batches: new Map() };
          pending = job;
          if (request && tile.jobs.every(entry => entry.data)) {
            job.request = request(tile);
            if (job.request) {
              job.waiting = job.request.promise.then(chunks => {
                job.chunks = chunks;
                job.request = job.waiting = null;
              });
            }
          }
          break;
        }
        bytes += tile.bytes;
      }
      if (!pending) {
        stats.resident = resident.size;
        return false;
      }
    }

    if (pending.waiting) return true;
    const { tile, batches, chunks } = pending;
    const deadline = performance.now() + BUILD_MS;
    let meshes, bytes;
    if (chunks) {
      if (!pending.meshes) {
        pending.meshes = new THREE.Group();
        pending.firstByMaterial = new Map();
        pending.bytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
        // Evict before exposing uploads from the next tile.
        const farthestFirst = [...resident].sort((a, b) => distanceSq(b) - distanceSq(a));
        for (const entry of farthestFirst) {
          if (stats.residentBytes + pending.bytes <= byteLimit || distanceSq(entry) < distanceSq(tile)) break;
          discard(entry);
        }
        if (resident.size && stats.residentBytes + pending.bytes > byteLimit) {
          tile.bytes = pending.bytes;
          pending = null;
          stats.resident = resident.size;
          return true;
        }
        group.add(pending.meshes);
      }
      meshes = pending.meshes;
      const firstByMaterial = pending.firstByMaterial;
      for (; pending.next < chunks.length; pending.next++) {
        const { material, attributes, index, sphere, bytes: size } = chunks[pending.next];
        if (stats.frameUploadBytes && (stats.frameUploadBytes + size > UPLOAD_BYTES || performance.now() >= deadline)) return true;
        const geometry = new THREE.BufferGeometry();
        for (const [name, array, itemSize, normalized] of attributes) {
          geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
        }
        if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
        const [x, y, z, radius] = sphere;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), radius);
        const mesh = new THREE.Mesh(geometry, materials[material]);
        mesh.receiveShadow = true;
        if (firstByMaterial.has(material)) mesh.userData.sharesPipelineWith = firstByMaterial.get(material);
        else firstByMaterial.set(material, mesh);
        meshes.add(mesh);
        mesh.updateMatrixWorld(true);
        stats.frameUploadBytes += size;
      }
      bytes = pending.bytes;
      stats.workerTiles++;
    } else {
      do {
        const entry = tile.jobs[pending.next++];
        if (entry.build) entry.build(batches);
        else fallbackBuild(entry.data, batches);
      } while (pending.next < tile.jobs.length && performance.now() < deadline);
      if (pending.next < tile.jobs.length) return true;
      meshes = new THREE.Group();
      mergeBatches(batches, meshes);
      bytes = 0;
      for (const { geometry } of meshes.children) {
        bytes += geometry.index?.array.byteLength ?? 0;
        for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
      }
      group.add(meshes);
      meshes.updateMatrixWorld(true);
      stats.fallbackTiles++;
    }
    tile.bytes = bytes;
    tile.meshes = meshes;
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

  return { add, update, stats, pendingWork: () => pending?.waiting };
}
