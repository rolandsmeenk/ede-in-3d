import * as THREE from 'three/webgpu';

const LOCAL_ASSETS = new URL('../assets/ede-murals/', import.meta.url);
const MAX_IN_FLIGHT = 2;
const EVICTION_MARGIN = 60;
const TEXTURE_BUDGET = 32 * 1024 * 1024;
const UPDATE_MS = 150;

function distanceTo(bounds, position) {
  const [x0, y0, z0, x1, y1, z1] = bounds;
  const x = Math.max(x0 - position.x, position.x - x1, 0);
  const y = Math.max(y0 - position.y, position.y - y1, 0);
  const z = Math.max(z0 - position.z, position.z - z1, 0);
  return Math.hypot(x, y, z);
}

function paintMesh(atlas, map, name, fallback) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(fallback ? atlas.f : atlas.p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(atlas.uv, 2));
  const index = [];
  for (let i = 0; i < atlas.p.length / 3; i += 4) index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    map, alphaTest: 0.50, roughness: 0.93, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}

export function createEdeMurals(scene, { enabled = true, isFallbackVisible = () => false } = {}) {
  const group = new THREE.Group();
  group.name = 'Ede murals';
  scene.add(group);
  const statistics = { sites: 0, batches: 0, resident: 0, inFlight: 0, textureBytes: 0, peakTextureBytes: 0, errors: 0 };
  const loader = new THREE.TextureLoader();
  const textures = new Map();
  let catalogue, manifest, lastUpdate = -Infinity;
  let entries = [];

  function needsFallback(entry) {
    return Boolean(entry.atlas.f && isFallbackVisible(entry.site.fallbackBuilding));
  }

  function release(texture, resource) {
    if (--resource.references) return;
    if (resource.map) {
      resource.map.dispose();
      statistics.textureBytes -= resource.bytes;
    }
    textures.delete(texture);
  }

  function remove(entry) {
    if (!entry.mesh) return;
    group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    release(entry.atlas.texture, entry.resource);
    statistics.resident--;
    entry.mesh = null;
    entry.resource = null;
  }

  function acquire(texture, version) {
    let resource = textures.get(texture);
    if (!resource) {
      resource = { references: 0 };
      const url = new URL(texture, LOCAL_ASSETS);
      if (version) url.searchParams.set('v', version);
      resource.promise = loader.loadAsync(url.href).then(map => {
        const bytes = Math.ceil(map.image.width * map.image.height * 4 * 4 / 3);
        if (statistics.textureBytes + bytes > TEXTURE_BUDGET) {
          map.dispose();
          return null;
        }
        map.colorSpace = THREE.SRGBColorSpace;
        map.minFilter = THREE.LinearMipmapLinearFilter;
        map.generateMipmaps = true;
        map.anisotropy = 4;
        Object.assign(resource, { map, bytes });
        statistics.textureBytes += bytes;
        statistics.peakTextureBytes = Math.max(statistics.peakTextureBytes, statistics.textureBytes);
        return map;
      });
      textures.set(texture, resource);
    }
    resource.references++;
    return resource;
  }

  function request(entry) {
    entry.loading = true;
    statistics.inFlight++;
    const { texture, version } = entry.atlas;
    const resource = acquire(texture, version);
    resource.promise.then(map => {
      if (!map) {
        entry.retryAt = performance.now() + 1500;
        return;
      }
      if (!enabled || !entry.wanted) return;
      entry.fallback = needsFallback(entry);
      entry.mesh = paintMesh(entry.atlas, map, entry.site.id, entry.fallback);
      entry.resource = resource;
      group.add(entry.mesh);
      statistics.resident++;
    }).catch(error => {
      entry.retryAt = performance.now() + 15000;
      statistics.errors++;
      console.warn('[murals] artwork unavailable:', texture, error);
    }).finally(() => {
      if (entry.resource !== resource) release(texture, resource);
      statistics.inFlight--;
      entry.loading = false;
    });
  }

  function update(position, now = performance.now()) {
    if (!enabled) return;
    if (!manifest) {
      manifest = fetch(new URL('placements-v1.json', LOCAL_ASSETS), { cache: 'no-cache' }).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }).then(data => {
        if (data.version !== 1) throw new Error('Unsupported mural asset version');
        catalogue = data;
        entries = catalogue.sites.flatMap(site => site.atlases.map(atlas => ({ site, atlas, wanted: false })));
        statistics.sites = catalogue.sites.length;
        statistics.batches = entries.length;
      }).catch(error => {
        statistics.errors++;
        console.warn('[murals] placements unavailable:', error);
      });
    }
    if (!catalogue || now - lastUpdate < UPDATE_MS) return;
    lastUpdate = now;
    const queue = [];
    for (const entry of entries) {
      const fallback = needsFallback(entry);
      if (entry.mesh && fallback !== entry.fallback) {
        const geometry = entry.mesh.geometry;
        const position = geometry.getAttribute('position');
        position.array.set(fallback ? entry.atlas.f : entry.atlas.p);
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        entry.fallback = fallback;
      }
      const distance = distanceTo(entry.site.bounds, position);
      const resident = entry.mesh || entry.loading;
      entry.wanted = distance <= entry.site.reach + (resident ? EVICTION_MARGIN : 0);
      if (!entry.wanted) remove(entry);
      else if (!resident && !(entry.retryAt > now)) queue.push({ entry, distance });
    }
    queue.sort((a, b) => a.distance - b.distance);
    for (const { entry } of queue) {
      if (statistics.inFlight >= MAX_IN_FLIGHT) break;
      if (statistics.textureBytes >= TEXTURE_BUDGET && !textures.has(entry.atlas.texture)) continue;
      request(entry);
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    group.visible = enabled;
    lastUpdate = -Infinity;
    if (enabled) return;
    for (const entry of entries) {
      entry.wanted = false;
      remove(entry);
    }
  }

  setEnabled(enabled);
  return { update, setEnabled, statistics };
}
