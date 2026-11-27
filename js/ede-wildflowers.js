import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CELL = 16;
const SPACING = 2;
const REACH = 2;
const CAPACITY = (2 * REACH + 1) ** 2 * (CELL / SPACING) ** 2;
const DETAIL_SPACING = 0.8;
const DETAIL_STEP = 4;
const DETAIL_RADIUS = 18;
const DETAIL_CAPACITY = (2 * Math.ceil(DETAIL_RADIUS / DETAIL_SPACING) + 1) ** 2;
const TAU = 2 * Math.PI;

const HEATHER = {
  'dry-heath': { foliage: 'Struikhei foliage', flower: 'Struikhei blossom', species: 'calluna', chance: 0.76, size: 1.14 },
  'damp-heath': { foliage: 'Gewone dophei foliage', flower: 'Gewone dophei bells', species: 'erica', chance: 0.83, size: 1 },
};

// OpenStreetMap ways 1458783405 and 112307218 in the map's Oude Kerk coordinates.
// The first short branch represents wear where sheep leave the southern end of the Ginkelse fold.
const SHEEPFOLD_TRACKS = [
  { points: [[4338.6, 1084.1], [4337.5, 1092], [4335.8, 1103], [4332.6, 1112], [4327.1, 1120]], width: 1.65 },
  { points: [[4379.9, 1023], [4376.4, 1025.1], [4372.4, 1030], [4371.3, 1035.9], [4371.6, 1044.2], [4380.8, 1085.2]], width: 1.8 },
  { points: [[3285.8, 67.4], [3324.3, 100], [3350.6, 116.7]], width: 1.65 },
];

const NO_BLOOM = { calluna: 0, erica: 0, tormentil: 0, daisy: 0 };

function seededRandom(x, z) {
  let state = (Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ 0x417bb315) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function plantShapes() {
  const pieces = [];
  const leaf = new THREE.SphereGeometry(1, 5, 3);
  const blade = new THREE.CylinderGeometry(0.42, 1, 1, 3);
  const bell = new THREE.CylinderGeometry(0.46, 0.82, 1, 5);
  const color = new THREE.Color();
  function add(source, x, y, z, sx, sy, sz, tint, tilt = 0, angle = 0) {
    const part = source.clone().scale(sx, sy, sz).rotateZ(tilt).rotateY(angle).translate(x, y, z);
    color.setHex(tint);
    const colors = new Float32Array(part.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pieces.push(part);
  }
  function finish() {
    const geometry = mergeGeometries(pieces);
    pieces.length = 0;
    return geometry;
  }
  function heather(damp, flowers) {
    const count = damp ? 5 : 7;
    for (let i = 0; i < count; i++) {
      const angle = TAU * i / count;
      const spread = damp ? 0.115 : 0.23;
      const height = (damp ? 0.37 : 0.34) * (0.76 + (i % 3) * 0.12);
      const x = Math.cos(angle) * spread, z = -Math.sin(angle) * spread;
      if (!flowers) {
        add(blade, x / 2, height / 2, z / 2, 0.015, Math.hypot(height, spread), 0.015,
          damp ? 0x4d5840 : 0x534d32, -Math.atan2(spread, height), angle);
        for (const t of [0.37, 0.58, 0.77]) {
          add(leaf, x * t, height * t, z * t, damp ? 0.035 : 0.057, 0.024, 0.028,
            damp ? 0x64755a : t < 0.5 ? 0x495130 : 0x676b40, -0.38, angle);
        }
      } else if (damp) {
        for (let j = 0; j < 4; j++) {
          const a = angle + j * TAU / 4;
          add(bell, x + Math.cos(a) * 0.027, height - 0.002, z - Math.sin(a) * 0.027,
            0.023, 0.042, 0.023, j % 2 ? 0xdca6bd : 0xc582a6, -0.64, a);
        }
      } else {
        for (const t of [0.70, 0.82, 0.94, 1.05]) {
          add(leaf, x * t, height * t, z * t, 0.034, 0.028, 0.026,
            t < 0.85 ? 0x964170 : 0xb76199);
        }
      }
    }
    return finish();
  }
  function meadowFlower(daisy, closed = false) {
    const stemColor = daisy ? 0x657940 : 0x5c672f;
    const heads = daisy ? 4 : 3;
    for (let i = 0; i < heads; i++) {
      const angle = i * TAU / heads;
      const spread = daisy ? 0.13 : 0.17;
      const x = Math.cos(angle) * spread, z = Math.sin(angle) * spread;
      const h = (daisy ? 0.10 : 0.16) + i * 0.016;
      add(blade, x, h / 2, z, 0.005, h, 0.005, stemColor);
      for (const direction of [-1, 1]) {
        add(leaf, x + direction * 0.022, 0.023 + (daisy ? 0 : 0.02), z, 0.037, 0.012, 0.014,
          stemColor, direction * 0.26, angle);
      }
      if (closed) {
        add(leaf, x, h + 0.01, z, 0.013, 0.018, 0.013, 0xb9b495);
        add(leaf, x, h, z, 0.015, 0.008, 0.015, 0x667248);
        continue;
      }
      const petals = daisy ? 11 : 4;
      const radius = daisy ? 0.014 : 0.009;
      const tint = daisy ? 0xf5efdb : 0xeeb921;
      for (let j = 0; j < petals; j++) {
        const a = TAU * j / petals;
        add(leaf, x + radius * Math.cos(a), h, z - radius * Math.sin(a),
          daisy ? 0.012 : 0.008, 0.003, daisy ? 0.004 : 0.006, tint, 0, a);
      }
      add(leaf, x, h + 0.004, z, radius * 0.65, 0.006, radius * 0.65, daisy ? 0xd7a937 : 0xa77c20);
    }
    return finish();
  }
  const shapes = {
    [HEATHER['dry-heath'].foliage]: heather(false, false),
    [HEATHER['dry-heath'].flower]: heather(false, true),
    [HEATHER['damp-heath'].foliage]: heather(true, false),
    [HEATHER['damp-heath'].flower]: heather(true, true),
    'Tormentil flowers': meadowFlower(false),
    'Madeliefje open': meadowFlower(true),
    'Madeliefje closed': meadowFlower(true, true),
  };
  for (let i = 0; i < 7; i++) {
    const a = TAU * i / 7;
    const x = Math.cos(a) * 0.38, z = -Math.sin(a) * 0.38;
    const y = 0.31 + (i % 3) * 0.17;
    add(blade, x / 2, y / 2, z / 2, 0.031, Math.hypot(0.38, y), 0.031, 0x504733, -Math.atan2(0.38, y), a);
    add(leaf, x, y, z, 0.47, 0.22, 0.34, [0x59683a, 0x424f29, 0x758047][i % 3], 0.34, a);
  }
  shapes['Woodland edge scrub'] = finish();
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, radius = 0.13 * Math.sqrt(i);
    add(leaf, Math.cos(a) * radius, 0.015, Math.sin(a) * radius, 0.086, 0.013, 0.038,
      [0x735137, 0x896447, 0x99704a][i % 3], 0.12, a);
  }
  shapes['Woodland edge leaf litter'] = finish();
  return shapes;
}

function trackDistanceSquared(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
  return (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2;
}

function makeTracks(tracks, heightAt) {
  const group = new THREE.Group();
  group.name = 'Sheepfold worn tracks';
  const material = new THREE.MeshStandardNodeMaterial({
    vertexColors: true, transparent: true, depthWrite: false, roughness: 0.98, side: THREE.DoubleSide,
  });
  tracks.forEach(({ points, width }, index) => {
    const rows = [];
    const positions = [], colors = [], indices = [];
    const dirt = new THREE.Color(0x927854);
    const random = seededRandom(index, 27);
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      if (!length) continue;
      const steps = Math.ceil(length / 0.8);
      for (let j = 0; j < steps; j++) rows.push([ax + dx * j / steps, az + dz * j / steps]);
    }
    if (!rows.length) return;
    rows.push(points.at(-1));
    for (let i = 0; i < rows.length; i++) {
      const [x, z] = rows[i], a = rows[Math.max(i - 1, 0)], b = rows[Math.min(i + 1, rows.length - 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const half = (width / 2) * (0.87 + 0.25 * random()) / Math.hypot(dx, dz);
      const alpha = Math.min(1, i / 5, (rows.length - 1 - i) / 8) * (0.74 + 0.18 * random());
      for (const side of [-1, -0.54, 0, 0.54, 1]) {
        const sx = x - dz * side * half, sz = z + dx * side * half;
        const tint = 0.84 + 0.22 * random();
        positions.push(sx, heightAt(sx, sz) + 0.032, sz);
        colors.push(dirt.r * tint, dirt.g * tint, dirt.b * tint, alpha * (1 - side ** 4));
      }
      if (i === 0) continue;
      for (let j = 0; j < 4; j++) {
        const p = (i - 1) * 5 + j;
        indices.push(p, p + 1, p + 5, p + 1, p + 6, p + 5);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    group.add(new THREE.Mesh(geometry, material));
  });
  return group;
}

export function createEdeWildflowers(scene, { habitatAt, bounds, heightAt, tracks = SHEEPFOLD_TRACKS }) {
  const group = new THREE.Group();
  group.name = 'De Ginkel flowers and ground detail';
  group.visible = false;
  scene.add(group);

  const [minX, minZ, maxX, maxZ] = bounds;
  const trackSegments = tracks.flatMap(({ points, width }) => points.slice(1).map((b, i) => ({
    a: points[i], b, radius: (width / 2 + 0.25) ** 2,
  })));
  const tiles = new Map();
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let batches, trackGroup, activeTileX, activeTileZ, lastBloom, lastOpen, lastAutumn;
  let detailX, detailZ, placements = [];

  function populate() {
    const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 });
    batches = Object.fromEntries(Object.entries(plantShapes()).map(([name, geometry]) => {
      const extra = Object.values(HEATHER).some(({ foliage, flower }) => name === foliage || name === flower);
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY + (extra ? DETAIL_CAPACITY : 0));
      mesh.name = name;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      return [name, mesh];
    }));
    trackGroup = makeTracks(tracks, heightAt);
    group.add(trackGroup);
    group.updateMatrixWorld(true);
  }

  function sampleTile(tx, tz, detail = false) {
    const random = seededRandom(tx, detail ? tz + 4096 : tz);
    const spacing = detail ? DETAIL_SPACING : SPACING;
    const steps = Math.round(CELL / spacing);
    const samples = [];
    for (let row = 0; row < steps; row++) {
      for (let col = 0; col < steps; col++) {
        const x = tx * CELL + col * spacing + spacing * random();
        const z = tz * CELL + row * spacing + spacing * random();
        const chance = random(), bloom = random(), angle = TAU * random(), scale = 0.78 + 0.57 * random();
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        const habitat = habitatAt(x, z);
        const heather = HEATHER[habitat];
        if (!habitat || (detail && (!heather || chance >= heather.chance))) continue;
        if (trackSegments.some(({ a, b, radius }) => trackDistanceSquared(x, z, a, b) < radius)) continue;
        samples.push({ x, z, y: heightAt(x, z) + 0.006, habitat, chance, bloom, angle, scale });
      }
    }
    return samples;
  }

  function append(name, sample, size = 1, shade = 1) {
    const mesh = batches[name];
    const index = mesh.count++;
    dummy.position.set(sample.x, sample.y, sample.z);
    dummy.rotation.y = sample.angle;
    dummy.scale.setScalar(sample.scale * size);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, tint.setRGB(shade, shade, shade));
  }

  function appendHeather(heather, sample, bloom, scale = 1) {
    const size = scale * heather.size, shade = 0.76 + 0.32 * sample.chance;
    append(heather.foliage, sample, size, shade);
    if (sample.bloom < bloom[heather.species]) append(heather.flower, sample, size, shade);
  }

  return {
    update(camera, { month, daylight, bloom = NO_BLOOM } = {}, player = camera) {
      const margin = CELL * (REACH + 1);
      group.visible = camera.x >= minX - margin && camera.x <= maxX + margin &&
        camera.z >= minZ - margin && camera.z <= maxZ + margin;
      if (!group.visible) return;
      if (!batches) populate();
      const tx = Math.floor(camera.x / CELL), tz = Math.floor(camera.z / CELL);
      const moved = tx !== activeTileX || tz !== activeTileZ;
      const open = Number(daylight) > 0.18;
      const autumn = month >= 9 && month <= 11;
      const playerNearby = Math.hypot(player.x - camera.x, player.z - camera.z) < CELL * REACH;
      const nextDetailX = playerNearby ? Math.round(player.x / DETAIL_STEP) * DETAIL_STEP : null;
      const nextDetailZ = playerNearby ? Math.round(player.z / DETAIL_STEP) * DETAIL_STEP : null;
      if (!moved && detailX === nextDetailX && detailZ === nextDetailZ &&
          open === lastOpen && autumn === lastAutumn && lastBloom &&
          bloom.calluna === lastBloom.calluna && bloom.erica === lastBloom.erica &&
          bloom.tormentil === lastBloom.tormentil && bloom.daisy === lastBloom.daisy) return;
      detailX = nextDetailX;
      detailZ = nextDetailZ;
      lastBloom = { ...bloom };
      lastOpen = open;
      lastAutumn = autumn;
      if (moved) {
        activeTileX = tx;
        activeTileZ = tz;
        placements = [];
        for (const mesh of trackGroup.children) {
          const { center, radius } = mesh.geometry.boundingSphere;
          mesh.visible = Math.hypot(center.x - camera.x, center.z - camera.z) < 145 + radius;
        }
        const previous = new Map(tiles);
        tiles.clear();
        for (let dz = -REACH; dz <= REACH; dz++) for (let dx = -REACH; dx <= REACH; dx++) {
          const key = (tx + dx) + ',' + (tz + dz);
          const tile = previous.get(key) ?? { samples: sampleTile(tx + dx, tz + dz) };
          placements.push(...tile.samples);
          tiles.set(key, tile);
        }
      }
      for (const mesh of Object.values(batches)) mesh.count = 0;
      for (const sample of placements) {
        const { habitat, chance, bloom: threshold } = sample;
        const shade = 0.76 + 0.32 * chance;
        const heather = HEATHER[habitat];
        if (heather && chance < heather.chance) {
          appendHeather(heather, sample, bloom);
        } else if (habitat === 'dry-heath' && chance > 0.87 && threshold < bloom.tormentil) {
          append('Tormentil flowers', sample);
        } else if (habitat === 'grassland' && chance > 0.85 && threshold < bloom.tormentil) {
          append('Tormentil flowers', sample);
        } else if (habitat === 'mown-grass' && chance < 0.78 && threshold < bloom.daisy) {
          append(open ? 'Madeliefje open' : 'Madeliefje closed', sample);
        } else if (habitat === 'woodland-edge') {
          if (chance < 0.36) append('Woodland edge scrub', sample, 0.85, shade);
          if (chance < (autumn ? 0.91 : 0.45)) append('Woodland edge leaf litter', sample, autumn ? 1.3 : 0.85, shade);
        }
      }
      if (detailX !== null) {
        const west = Math.floor((detailX - DETAIL_RADIUS) / CELL), east = Math.floor((detailX + DETAIL_RADIUS) / CELL);
        const north = Math.floor((detailZ - DETAIL_RADIUS) / CELL), south = Math.floor((detailZ + DETAIL_RADIUS) / CELL);
        for (let z = north; z <= south; z++) for (let x = west; x <= east; x++) {
          const tile = tiles.get(x + ',' + z);
          if (!tile) continue;
          tile.detail ??= sampleTile(x, z, true);
          for (const sample of tile.detail) {
            const distance = Math.hypot(sample.x - detailX, sample.z - detailZ);
            if (distance < DETAIL_RADIUS) {
              const scale = 1 - THREE.MathUtils.smoothstep(distance, 10, DETAIL_RADIUS);
              appendHeather(HEATHER[sample.habitat], sample, bloom, scale);
            }
          }
        }
      }
      for (const mesh of Object.values(batches)) {
        mesh.visible = mesh.count > 0;
        if (!mesh.count) continue;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
  };
}
