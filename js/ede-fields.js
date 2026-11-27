import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, Fn, interleavedGradientNoise, mix, mx_noise_float, positionLocal,
  positionWorld, screenCoordinate, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { readMapAsset } from './ede-geodata.js';
import { applySnowMaterial } from './ede-snow.js';
import { FIELD_CROP_CODES, FIELD_PROFILES, fieldCropState, fieldFlowerState } from './ede-field-phenology.js';
import { FIELD_TILE_SIZE, buildFieldTile, containsFieldPoint, decodeFieldTile } from './ede-field-tiles.js';
import { fieldPlantGeometry } from './ede-field-plants.js';

const DIRECTORY = new URL('../assets/ede-fields-v1/', import.meta.url);
const MAX_LOADS = 3;
const SOIL = new THREE.Color(0x725d46);
const STEMS = 1;
const SPARSE = 2;

function sampleSeed(id, row, index) {
  let value = id ^ Math.imul(row, 0x9e3779b1) ^ Math.imul(index, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function boxDistance([west, north, east, south], x, z) {
  return Math.hypot(Math.max(west - x, 0, x - east), Math.max(north - z, 0, z - south));
}

function stageFor(field, date, flowerCache) {
  const crop = fieldCropState(field.code || 331, date, field.id);
  const recipe = field.recipe || ([1926, 657].includes(field.code) ? 'A6' : null);
  if (!flowerCache.has(recipe)) flowerCache.set(recipe, recipe ? fieldFlowerState(recipe, date) ?? [] : []);
  return { crop, flowers: flowerCache.get(recipe) };
}

function maizeHeight(crop) {
  return crop.family === 'maize' && crop.stage !== 'winter-cover' ? Math.max(0, crop.height - 0.12) : 0;
}

function setTileDate(tile, stateFor) {
  const attributes = tile.geometry.base.attributes;
  const tint = new THREE.Color(), petals = new THREE.Color(), flowerColor = new THREE.Color();
  tile.hasCanopy = false;
  for (const { field, first, end } of tile.geometry.spans) {
    const { crop, flowers } = stateFor(field);
    const total = flowers.reduce((sum, flower) => sum + flower.bloom, 0);
    petals.setRGB(0, 0, 0);
    if (total) {
      for (const flower of flowers) petals.add(flowerColor.set(flower.color).multiplyScalar(flower.bloom / total));
    } else if (crop.bloom && crop.bloomColor && crop.family !== 'maize') {
      petals.set(crop.bloomColor);
    }
    tint.set(crop.color).multiplyScalar(0.88 + 0.24 * sampleSeed(field.id, 124, 71));
    const strength = total ? Math.min(0.60, total / Math.max(2, flowers.length / 3)) :
      crop.bloomColor && crop.family !== 'maize' ? crop.bloom * (crop.family === 'flower' ? 0.6 : 0.23) : 0;
    const abundance = field.flags & SPARSE ? 0.35 : field.code === 1926 ? 0.62 : 1;
    const cover = field.flags & STEMS ? Math.max(0.29, crop.cover) : crop.cover;
    const height = maizeHeight(crop);
    if (height > 0.18) tile.hasCanopy = true;
    for (let i = first; i < end; i++) {
      attributes.fieldColor.setXYZ(i, tint.r, tint.g, tint.b);
      attributes.fieldStage.setXYZW(i, height, cover, crop.rowWidth ? 1 / crop.rowWidth : 0,
        field.family === 'maize' && crop.stage !== 'winter-cover' ? 2 : field.code ? 0 : 1);
      attributes.fieldBloom.setXYZW(i, petals.r, petals.g, petals.b, strength * abundance);
    }
  }
  for (const name of ['fieldColor', 'fieldStage', 'fieldBloom']) attributes[name].needsUpdate = true;
}

function fieldPhotographs(aerial) {
  const layers = [aerial?.expansion, aerial?.ground].filter(Boolean).map(({ width, height, minX, minZ, step, data }) => {
    const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const image = new THREE.DataTexture(pixels, width, height);
    image.colorSpace = THREE.SRGBColorSpace;
    image.magFilter = THREE.LinearFilter;
    image.minFilter = THREE.LinearMipmapLinearFilter;
    image.generateMipmaps = true;
    image.needsUpdate = true;
    return { image, width, height, minX, minZ, step };
  });
  if (!layers.length) return (seasonal) => seasonal;
  return Fn(([seasonal, strength, grade]) => {
    const photo = vec4(0).toVar();
    for (const { image, width, height, minX, minZ, step } of layers) {
      const point = positionWorld.xz.sub(vec2(minX, minZ)).div(step);
      const toEdge = point.min(vec2(width - 1, height - 1).sub(point));
      const coverage = smoothstep(0, 2, toEdge.x.min(toEdge.y));
      const sampled = texture(image, point.add(0.5).div(vec2(width, height))).rgb;
      photo.assign(mix(photo, vec4(sampled, 1), coverage));
    }
    const rgb = photo.rgb.div(photo.a.max(0.001));
    const light = rgb.dot(vec3(0.2126, 0.7152, 0.0722));
    const toned = seasonal.mul(light.div(0.18).clamp(0.22, 3).sqrt());
    const greenness = tint => smoothstep(-0.035, 0.085, tint.g.sub(tint.r).div(tint.g.add(tint.r).add(0.02)));
    const match = greenness(seasonal).sub(greenness(rgb)).abs().oneMinus();
    // Use photo brightness and local detail even when the captured cover differs from the preview.
    return mix(seasonal, mix(rgb, toned, mix(0.97, grade, match.mul(match))), photo.a.mul(strength));
  });
}

function fieldMaterials(nearDistance, aerialOffset, compact, aerial) {
  const pattern = interleavedGradientNoise(screenCoordinate.xy);
  const distance = positionWorld.xz.distance(cameraPosition.xz).add(aerialOffset);
  const canopyBlend = smoothstep(nearDistance.sub(40).max(5), nearDistance, distance);
  const photograph = fieldPhotographs(aerial);
  const coords = attribute('fieldRow', 'vec2');
  const stage = attribute('fieldStage', 'vec4');
  const color = attribute('fieldColor', 'vec3');
  const bloom = attribute('fieldBloom', 'vec4');
  const phase = coords.y.mul(stage.z).fract().sub(0.5).abs().mul(2);
  const fineDetail = float(1).sub(smoothstep(0.25, 0.8, coords.y.mul(stage.z).fwidth()));
  const rowEdge = stage.y.mul(1.3).clamp(0.035, 1.25);
  const rowCoverage = float(1).sub(smoothstep(rowEdge.sub(0.13), rowEdge.add(0.1), phase));
  const rows = mix(stage.y, rowCoverage, stage.z.min(1).mul(fineDetail));
  const patches = mx_noise_float(positionWorld.xz.mul(0.12), 0.85, 0.5).clamp();
  const broadPatches = mx_noise_float(positionWorld.xz.mul(0.016), 1.2, 0.5).clamp();
  const groundShade = mix(broadPatches, patches, 0.25).mul(0.33).add(0.83);
  const ridge = float(1).sub(smoothstep(0.18, 0.97, phase)).mul(fineDetail);
  const ground = new THREE.MeshStandardNodeMaterial({ roughness: 0.98, alphaTest: 0.5 });
  ground.name = 'Seasonal field surface';
  const maizeFloor = mix(SOIL, color, rows.mul(0.29)).mul(ridge.mul(0.10).add(0.91));
  const soil = mix(mix(SOIL, color, rows), maizeFloor, smoothstep(1, 2, stage.w));
  ground.colorNode = photograph(soil, 0.92, mix(0.65, 0.34, stage.y)).mul(groundShade);
  ground.colorNode = mix(ground.colorNode, bloom.rgb, smoothstep(0.28, 0.9, patches).mul(bloom.a));
  const meadow = stage.w.greaterThan(0.5).and(stage.w.lessThan(1.5));
  // Close views can use the aerial terrain detail where that texture is available.
  const meadowBlend = compact ? float(1) : smoothstep(20, 65, distance);
  ground.opacityNode = float(pattern.lessThan(mix(1, meadowBlend, float(meadow))));
  applySnowMaterial(ground, { exposure: 0.86, retention: 0.78 });

  const canopy = new THREE.MeshStandardNodeMaterial({ roughness: 0.91, alphaTest: 0.5 });
  canopy.name = 'Maize row canopy';
  const edge = attribute('fieldEdge', 'float');
  const wall = edge.min(1);
  const lift = float(2).sub(edge.max(1));
  canopy.positionNode = positionLocal.add(vec3(0, stage.x.mul(lift), 0));
  const leafCoords = positionWorld.xz.add(vec2(0.26, 0.58).mul(positionWorld.y));
  const leaves = mx_noise_float(leafCoords.mul(1.45), 0.9, 0.5).clamp();
  const crownShade = groundShade.mul(0.88).add(ridge.mul(0.19)).add(leaves.mul(fineDetail).mul(0.09));
  const wallShade = mix(0.49, 0.99, lift).mul(leaves.mul(0.31).add(0.79));
  canopy.colorNode = photograph(color, 0.81, 0.60).mul(mix(crownShade, wallShade, wall));
  const openSide = mix(0.62, 1, lift).mul(smoothstep(0.07, 0.42, leaves));
  const sideCover = mix(openSide, 1, smoothstep(0.70, 0.93, stage.y));
  const closure = smoothstep(0.18, 0.9, stage.x).mul(mix(smoothstep(0.12, 0.58, rows), sideCover, wall));
  canopy.opacityNode = float(pattern.lessThan(canopyBlend.mul(closure)));
  applySnowMaterial(canopy, { exposure: 0.52, retention: 0.25 });

  const plants = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
  plants.name = 'Instanced field plants';
  plants.opacityNode = float(pattern.greaterThanEqual(canopyBlend));
  return { ground, canopy, plants };
}

function nearbyPlants(tiles, stateFor, x, z, radius, compact) {
  const plants = [];
  function samplePart(part, reach, dense) {
    if (boxDistance(part.bounds, x, z) > reach) return;
    const { field } = part;
    const { crop, flowers } = stateFor(field);
    const standing = Boolean(field.flags & STEMS);
    const maize = crop.family === 'maize' && crop.stage !== 'winter-cover';
    if (crop.height < 0.045 && !standing && !flowers.length) return;
    const target = maize ? 0.7 : dense ? (compact ? 0.75 : 0.55) : compact ? 1.7 : 1.28;
    const rowStep = crop.rowWidth ? Math.ceil(target / crop.rowWidth) * crop.rowWidth : target;
    const stride = maize ? (compact ? 2.35 : 1.74) : crop.family === 'woody' ? 2.8 : target;
    const aligned = x * field.cos + z * field.sin, across = -x * field.sin + z * field.cos;
    const [west, north, east, south] = part.bounds;
    const corners = [[west, north], [west, south], [east, north], [east, south]];
    const alongBox = corners.map(([u, v]) => u * field.cos + v * field.sin);
    const crossBox = corners.map(([u, v]) => -u * field.sin + v * field.cos);
    const limits = (origin, extent, step) => [Math.floor(Math.max(origin - reach, Math.min(...extent)) / step),
      Math.ceil(Math.min(origin + reach, Math.max(...extent)) / step)];
    const [firstRow, lastRow] = limits(across, crossBox, rowStep);
    const [firstPlant, lastPlant] = limits(aligned, alongBox, stride);
    for (let row = firstRow; row <= lastRow; row++) for (let i = firstPlant; i <= lastPlant; i++) {
      const seed = sampleSeed(dense ? field.id ^ 0x44ee7a39 : field.id, row, i);
      if (seed > Math.max(standing ? 0.34 : 0, crop.cover * 1.2)) continue;
      const u = (i + 0.5 + (seed - 0.5) * 0.76) * stride;
      const v = row * rowStep + (crop.rowWidth || rowStep) * 0.5 +
        (sampleSeed(field.id, i, row) - 0.5) * rowStep * (maize ? 0.17 : crop.rowWidth ? 0.25 : 0.83);
      const px = u * field.cos - v * field.sin, pz = u * field.sin + v * field.cos;
      const distance = Math.hypot(px - x, pz - z);
      if (distance > reach || px < west || px > east || pz < north || pz > south || !containsFieldPoint(part, px, pz)) continue;
      const scale = dense ? 1 - THREE.MathUtils.smoothstep(distance, reach - 6, reach) : 1;
      if (scale > 0.08) plants.push({ x: px, z: pz, distance, seed, field, crop, flowers, standing, dense, scale });
    }
  }
  for (const tile of tiles) for (const part of tile.parts) {
    samplePart(part, radius, false);
    if (!part.field.code) samplePart(part, compact ? 16 : 20, true);
  }
  return plants;
}

function drawPlantBatches(group, batches, material, plants, heightAt, budget) {
  const instances = new Map();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let extras = budget - plants.length;
  function append(kind, tint, width, height) {
    if (!instances.has(kind)) instances.set(kind, []);
    instances.get(kind).push([dummy.position.x, dummy.position.y, dummy.position.z, dummy.rotation.y, tint, width, height]);
  }
  for (const { x, z, distance, seed, field, crop, flowers, standing, dense, scale } of plants) {
    const { family, stage } = crop;
    dummy.position.set(x, heightAt(x, z) + 0.05, z);
    dummy.rotation.y = -field.bearing + (seed - 0.5) * (family === 'maize' ? 0.34 : Math.PI * 2);
    const width = (0.69 + seed * 0.52) * (dense ? 0.68 : 1) * scale;
    const height = crop.height * (0.86 + seed * 0.26) * (dense ? 0.76 : 1) * scale;
    if (family === 'maize' && stage !== 'winter-cover') {
      const kind = stage === 'stubble' ? 'maize stalks' : distance < 32 ? 'maize' : 'maize distant';
      append(kind, crop.color, width * Math.min(1, 0.35 + height * 0.48), height);
      if (distance < 45 && height > 0.75 && crop.bloom > seed * 0.8 && extras > 0) {
        append('maize tassels', crop.bloomColor, width, height);
        extras--;
      }
      continue;
    }
    const flowerChance = field.flags & SPARSE ? 0.25 : field.code ? 0.43 : 0.86;
    if (flowers.length && seed < flowerChance) {
      const species = flowers[Math.floor(sampleSeed(field.id, Math.round(x * 8), Math.round(z * 8)) * flowers.length)];
      const blooms = species.bloom > seed * 1.35;
      const structure = Math.max(species.structure ?? 0, standing ? 0.42 : 0, species.cover ?? 0, species.bloom);
      if (structure > 0.08) {
        const stemHeight = species.height * structure * (0.78 + seed * 0.5) * scale;
        append('flower stem', blooms ? 0x677a39 : standing && species.cover < 0.3 ? 0x827154 : crop.color, width, stemHeight);
        if (blooms && extras > 0) {
          append(`flower ${species.shape ?? 'daisy'}`, species.color, dense ? width * 1.35 : width, stemHeight);
          extras--;
        }
        continue;
      }
    }
    if (height < 0.045) continue;
    const kind = family === 'cereal' && (stage === 'heading' || stage === 'ripening') ? 'cereal' :
      family === 'woody' && stage === 'dormant' ? 'woody dormant' :
        ['woody', 'tall', 'broadleaf', 'narrowleaf'].includes(family) ? family : 'grass';
    append(kind, crop.color, width, height);
    if (!flowers.length && crop.bloomColor && crop.bloom > seed && distance < 40 && extras > 0) {
      append('flower daisy', crop.bloomColor, width, height);
      extras--;
    }
  }

  for (const mesh of batches.values()) mesh.visible = false;
  for (const [kind, values] of instances) {
    let mesh = batches.get(kind);
    if (!mesh || mesh.instanceMatrix.count < values.length) {
      const geometry = mesh?.geometry ?? fieldPlantGeometry(kind);
      if (mesh) {
        group.remove(mesh);
        mesh.dispose();
      }
      mesh = new THREE.InstancedMesh(geometry, material, 2 ** Math.ceil(Math.log2(values.length)));
      mesh.name = kind;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batches.set(kind, mesh);
      group.add(mesh);
    }
    mesh.count = values.length;
    mesh.visible = true;
    for (let i = 0; i < values.length; i++) {
      const [x, y, z, bearing, tint, width, height] = values[i];
      dummy.position.set(x, y, z);
      dummy.rotation.y = bearing;
      dummy.scale.set(width, height, width);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  return [...instances.values()].reduce((count, items) => count + items.length, 0);
}

export function createEdeFields(scene, { heightAt, compact = false, aerial,
  read = file => readMapAsset(new URL(`${file}?v=20261127-clear-paths`, DIRECTORY)) } = {}) {
  const group = new THREE.Group(), detail = new THREE.Group();
  group.name = 'Seasonal crop and wildflower fields';
  detail.name = 'Near field vegetation';
  group.add(detail);
  scene.add(group);
  const maxActive = compact ? 24 : 64, plantBudget = compact ? 4000 : 12000;
  const detailRadius = compact ? 82 : 110;
  const nearDistance = uniform(detailRadius), aerialOffset = uniform(0);
  let materials;
  const stats = { tiles: 0, resident: 0, visible: 0, loading: 0, failures: 0, plants: 0, maizeTiles: 0 };
  const entries = new Map(), fields = new Map(), batches = new Map();
  const ready = [], resident = new Set();
  const stageCache = new Map(), flowerCache = new Map();
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), box = new THREE.Box3();
  let active = new Set(), date, nearKey = '', nextSelection = 0, selectedX = Infinity, selectedZ = Infinity;
  let manifestStarted = false, pending = 0, tick = 0;

  function setDate(value) {
    if (date === value) return;
    date = value;
    stageCache.clear();
    flowerCache.clear();
  }
  function stateFor(field) {
    if (!stageCache.has(field.id)) stageCache.set(field.id, stageFor(field, date, flowerCache));
    return stageCache.get(field.id);
  }
  function loadManifest() {
    manifestStarted = true;
    Promise.all([read('index.json'), aerial]).then(([manifest, photo]) => {
      if (manifest.version !== 1 || manifest.tileSize !== FIELD_TILE_SIZE || !Array.isArray(manifest.tiles) || !manifest.fields) {
        throw new Error('Invalid Ede field manifest');
      }
      for (const [id, [code, bearing, recipe, source, flags]] of Object.entries(manifest.fields)) {
        const family = code ? FIELD_PROFILES[FIELD_CROP_CODES[code]]?.family : 'flower';
        if (!family || family === 'retain') continue;
        fields.set(Number(id), { id: Number(id), code, bearing, recipe, source, flags,
          family, sin: Math.sin(bearing), cos: Math.cos(bearing) });
      }
      for (const id of manifest.tiles) {
        if (!/^-?\d+_-?\d+$/.test(id)) throw new Error(`Invalid Ede field tile ${id}`);
        const [x, z] = id.split('_').map(value => Number(value) * FIELD_TILE_SIZE);
        entries.set(id, { id, bounds: [x, z, x + FIELD_TILE_SIZE, z + FIELD_TILE_SIZE], used: 0 });
      }
      materials = fieldMaterials(nearDistance, aerialOffset, compact, photo);
      stats.tiles = entries.size;
      nextSelection = 0;
    }).catch(error => {
      stats.failures++;
      console.warn('[fields] using existing terrain cover:', error);
    });
  }
  function queue(tile) {
    if (pending >= MAX_LOADS || tile.requested) return;
    pending++;
    tile.requested = true;
    stats.loading = pending;
    read(`${tile.id}.json.gz`).then(rows => ready.push({ tile, rows })).catch(error => fail(tile, error));
  }
  function fail(tile, error) {
    tile.failedUntil = performance.now() + 8000;
    tile.requested = false;
    stats.loading = --pending;
    stats.failures++;
    if (!tile.reported) console.warn('[fields]', tile.id, error);
    tile.reported = true;
  }
  function install({ tile, rows }) {
    try {
      if (active.has(tile)) {
        tile.parts = decodeFieldTile(rows, tile, fields);
        tile.geometry = buildFieldTile(tile.parts, heightAt, tile.bounds);
        tile.meshes = [new THREE.Mesh(tile.geometry.base, materials.ground)];
        if (tile.geometry.canopy) tile.meshes.push(new THREE.Mesh(tile.geometry.canopy, materials.canopy));
        for (const mesh of tile.meshes) {
          mesh.name = `Fields ${tile.id}`;
          group.add(mesh);
        }
        resident.add(tile);
      }
      tile.requested = false;
      stats.loading = --pending;
    } catch (error) {
      fail(tile, error);
    }
  }
  function selectTiles(camera, now, altitude) {
    const { x, z } = camera.position;
    const farLimit = compact ? 1450 + Math.min(750, altitude) : 2100 + Math.min(2000, altitude * 2);
    camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem, camera.reversedDepth);
    const candidates = [];
    for (const tile of entries.values()) {
      const distance = boxDistance(tile.bounds, x, z);
      if (distance > farLimit) continue;
      if (distance > 780) {
        const [w, n, e, s] = tile.bounds;
        box.min.set(w, -50, n);
        box.max.set(e, 180, s);
        if (!frustum.intersectsBox(box)) continue;
      }
      candidates.push({ tile, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    active = new Set(candidates.slice(0, maxActive).map(({ tile }) => tile));
    tick++;
    selectedX = x;
    selectedZ = z;
    for (const tile of active) {
      tile.used = tick;
      if (!tile.geometry && now >= (tile.failedUntil || 0)) queue(tile);
    }
    nextSelection = now + 90;
  }
  function update(camera, value, { altitude = 0 } = {}) {
    if (!value) return;
    if (!manifestStarted) loadManifest();
    if (!entries.size) return;
    setDate(value);
    const now = performance.now(), { x, z } = camera.position;
    const jumped = Math.hypot(x - selectedX, z - selectedZ) > 160;
    const job = ready.shift();
    if (now >= nextSelection || jumped) selectTiles(camera, now, altitude);
    if (job) install(job);
    const nearby = [];
    stats.visible = stats.maizeTiles = 0;
    for (const tile of resident) {
      const visible = active.has(tile);
      if (visible && tile.date !== date) {
        setTileDate(tile, stateFor);
        tile.date = date;
      }
      tile.meshes[0].visible = visible;
      if (tile.meshes[1]) tile.meshes[1].visible = visible && tile.hasCanopy;
      if (!visible) continue;
      stats.visible++;
      if (tile.hasCanopy) stats.maizeTiles++;
      if (boxDistance(tile.bounds, x, z) <= detailRadius + 9) nearby.push(tile);
    }
    if (resident.size > maxActive) {
      const discard = [...resident].filter(tile => !active.has(tile)).sort((a, b) => a.used - b.used);
      for (const tile of discard.slice(0, resident.size - maxActive)) {
        group.remove(...tile.meshes);
        tile.geometry.base.dispose();
        tile.geometry.canopy?.dispose();
        resident.delete(tile);
        tile.geometry = tile.parts = tile.meshes = tile.date = null;
      }
    }
    stats.resident = resident.size;
    aerialOffset.value = Math.max(0, altitude - 12) * 3.7;
    detail.visible = aerialOffset.value < detailRadius && nearby.length > 0;
    if (!detail.visible) {
      nearDistance.value = 8;
      nearKey = '';
      stats.plants = 0;
      return;
    }
    const step = 6, sx = Math.floor(x / step) * step + step / 2, sz = Math.floor(z / step) * step + step / 2;
    const key = `${date}/${sx}/${sz}/${nearby.map(tile => tile.id).join(',')}`;
    if (key === nearKey) return;
    nearKey = key;
    const plants = nearbyPlants(nearby, stateFor, sx, sz, detailRadius + 5, compact);
    nearDistance.value = detailRadius;
    const plantLimit = Math.floor(plantBudget * 0.88);
    if (plants.length > plantLimit) {
      plants.sort((a, b) => a.distance - b.distance);
      plants.length = plantLimit;
      nearDistance.value = Math.min(detailRadius, Math.max(8, plants.at(-1).distance - 5));
    }
    stats.plants = drawPlantBatches(detail, batches, materials.plants, plants, heightAt, plantBudget);
  }

  return { stats, update, fieldAt(x, z) {
    const tile = entries.get(`${Math.floor(x / FIELD_TILE_SIZE)}_${Math.floor(z / FIELD_TILE_SIZE)}`);
    return tile?.parts?.filter(part => containsFieldPoint(part, x, z)).map(({ field }) => ({
      id: field.id, code: field.code, recipe: field.recipe, source: field.source, ...stateFor(field).crop,
    })) ?? [];
  } };
}
