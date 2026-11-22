import * as THREE from 'three/webgpu';
import { CivicBatch } from './ede-civic-landmarks.js';
import { EDE_RENDER_CELL } from './ede-geometry.js';
import { readMapAsset } from './ede-geodata.js';

const CONCRETE = 0x8b8980, STONE = 0x77776e, WOOD = 0x685c49, STEEL = 0x5c6864;
const clamp = THREE.MathUtils.clamp;
const text = value => String(value ?? '').toLowerCase();
export const loadEdeWaterWorks = () => readMapAsset(new URL('../assets/ede-water-works.json.gz', import.meta.url), true);

function materialColor(material, fallback = CONCRETE) {
  const value = text(material);
  if (/hout|wood/.test(value)) return WOOD;
  if (/staal|metaal|steel/.test(value)) return STEEL;
  if (/metsel|baksteen|brick/.test(value)) return 0x856658;
  if (/kunststof|pvc|plastic/.test(value)) return 0x5d625e;
  if (/steen|breuk|rock|stone/.test(value)) return STONE;
  if (/beton|concrete/.test(value)) return CONCRETE;
  return fallback;
}

function localPlacement({ x, y, z, heading }, batch) {
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const point = (u, height, v) => [x + u * cos + v * sin, y + height, z - u * sin + v * cos];
  const box = (u, level, v, width, height, depth, color) => {
    batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(heading)
      .translate(...point(u, level, v)), color);
  };
  return { point, box };
}

function culvert(batch, record) {
  const width = clamp(record.width, 0.15, 8), height = clamp(record.height, 0.15, 5);
  const { point, box } = localPlacement(record, batch);
  const color = materialColor(record.material);
  const trim = clamp(Math.min(width, height) * 0.22, 0.12, 0.32);
  const half = width / 2 + trim;
  const front = 0.10, rear = -clamp(width * 0.45, 0.35, 1.15);
  const opening = /rond|round|circle|ovaal|ellips/.test(text(record.shape))
    ? Array.from({ length: 12 }, (_, i) => {
      const a = i * Math.PI / 6;
      return [Math.cos(a) * width / 2, (Math.sin(a) + 1) * height / 2];
    }) : [[-width / 2, 0], [width / 2, 0], [width / 2, height], [-width / 2, height]];
  const face = [[-half, -trim], [half, -trim], [half, height + trim], [-half, height + trim]];
  const rim = opening.map(([u, h]) => point(u, h, front));
  const recess = opening.map(([u, h]) => point(u, h, rear));
  batch.polygon([face.map(([u, h]) => point(u, h, front)), rim], color);
  batch.polygon([recess], 0x1c2424);
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    batch.quad(rim[i], rim[j], recess[j], recess[i], 0x454b46);
  }
  box(0, -trim / 2, -0.12, 2 * half, trim, 0.43, color);
  box(0, height + trim / 2, -0.15, 2 * half, trim, 0.49, color);
  for (const side of [-1, 1]) box(side * (half - trim / 2), height / 2, -0.12, trim, height, 0.43, color);
}

function weir(batch, record) {
  const width = clamp(record.width, 0.45, 22), top = clamp(record.height, 0.20, 2.6);
  const { box } = localPlacement(record, batch);
  const color = materialColor(record.material);
  const pier = clamp(width * 0.12, 0.18, 0.42);
  const adjustable = /klep|schuif|regel|gate/.test(text(record.type));
  const depth = adjustable ? 0.48 : 0.74;
  box(0, -0.24, 0, width + pier * 2, 0.48, depth, color);
  for (const side of [-1, 1]) {
    const u = side * (width + pier) / 2;
    box(u, (top - 0.42) / 2, 0, pier, top + 0.42, depth + 0.48, color);
    if (adjustable) box(u, top + 0.08, -0.13, pier * 0.56, 0.16, 0.20, STEEL);
  }
  if (adjustable) {
    const gate = Math.min(0.56, top * 0.75);
    box(0, gate / 2, -0.09, width, gate, 0.10, 0x475550);
    box(0, gate + 0.015, -0.09, width, 0.035, 0.14, STEEL);
  }
}

function bankProfile(record) {
  const type = text(record.type), material = text(record.material);
  if (/damwand|sheet/.test(type)) {
    return { half: 0.10, flare: 0.015, color: materialColor(material, STEEL), top: 0x6d7369 };
  }
  if (/talud|bodem|riprap/.test(type) || /breuksteen|stortsteen/.test(material)) {
    return { half: 0.15, flare: 0.66, color: materialColor(material, STONE), top: 0x88847a };
  }
  if (/beschoeiing|timber/.test(type) || /hout|wood/.test(material)) {
    return { half: 0.075, flare: 0.04, color: materialColor(material, WOOD), top: 0x796c54 };
  }
  return { half: 0.15, flare: 0.04, color: materialColor(material), top: 0x9b988c };
}

function bank(batchAt, record) {
  const { points } = record;
  const height = clamp(record.height, 0.18, 2.8);
  if (/paaltjes|stakes/.test(text(record.type))) {
    const color = materialColor(record.material, WOOD);
    let next = 0;
    for (let i = 1; i < points.length; i++) {
      const [x, y, z] = points[i - 1], [bx, by, bz] = points[i];
      const length = Math.hypot(bx - x, bz - z);
      if (length < 0.03) continue;
      for (; next < length; next += 0.18) {
        const t = next / length;
        const px = x + (bx - x) * t, pz = z + (bz - z) * t;
        batchAt(px, pz).solid(new THREE.CylinderGeometry(0.082, 0.092, height, 5)
          .translate(px, y + (by - y) * t - height / 2, pz), color);
      }
      next -= length;
    }
    return;
  }
  const { half, flare, color, top } = bankProfile(record);
  const side = (a, b) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    return length > 0.01 ? [-dz / length, dx / length] : [0, 0];
  };
  const sections = points.map(([x, y, z], i) => {
    const [px, pz] = side(points[Math.max(i - 1, 0)], points[i]);
    const [nx, nz] = side(points[i], points[Math.min(i + 1, points.length - 1)]);
    const length = Math.hypot(px + nx, pz + nz);
    const ux = length > 0.01 ? (px + nx) / length : nx, uz = length > 0.01 ? (pz + nz) / length : nz;
    const offset = (width, level) => [x + ux * width, y + level, z + uz * width];
    return [offset(half, 0), offset(-half, 0), offset(-half - flare, -height), offset(half + flare, -height)];
  });
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i];
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]);
    if (length < 0.03) continue;
    const count = Math.ceil(length / 7);
    const mix = (t, from, to) => from.map((value, j) => value + (to[j] - value) * t);
    for (let j = 0; j < count; j++) {
      const from = a.map((p, k) => mix(j / count, p, b[k]));
      const to = a.map((p, k) => mix((j + 1) / count, p, b[k]));
      const batch = batchAt((from[0][0] + to[0][0]) / 2, (from[0][2] + to[0][2]) / 2);
      batch.quad(from[0], to[0], to[1], from[1], top);
      batch.quad(from[1], to[1], to[2], from[2], color);
      batch.quad(from[3], to[3], to[0], from[0], color);
      if (i === 1 && j === 0) batch.quad(from[0], from[1], from[2], from[3], color);
      if (i === sections.length - 1 && j === count - 1) batch.quad(to[3], to[2], to[1], to[0], color);
    }
  }
}

export function buildEdeWaterWorks(scene, asset) {
  const { version, culverts, weirs, banks } = asset;
  if (version !== 1 || ![culverts, weirs, banks].every(Array.isArray)) throw new Error('Invalid Ede water works asset');
  const group = new THREE.Group();
  group.name = 'Ede Water Works';
  const counts = { culverts: 0, weirs: 0, banks: 0, batches: 0 };
  const cells = new Map();
  function batchAt(x, z) {
    const key = `${Math.floor(x / EDE_RENDER_CELL)}/${Math.floor(z / EDE_RENDER_CELL)}`;
    if (!cells.has(key)) cells.set(key, new CivicBatch());
    return cells.get(key);
  }

  for (const [kind, records, build] of [['culverts', culverts, culvert], ['weirs', weirs, weir]]) {
    for (const record of records) {
      const { x, y, z, heading, width, height } = record;
      if (![x, y, z, heading, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
      build(batchAt(x, z), record);
      counts[kind]++;
    }
  }
  for (const record of banks) {
    if (!Array.isArray(record.points) || record.points.length < 2 || !Number.isFinite(record.height) ||
        !record.points.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) continue;
    bank(batchAt, record);
    counts.banks++;
  }

  let firstMesh;
  for (const batch of cells.values()) {
    const mesh = batch.mesh();
    if (firstMesh) {
      mesh.material.dispose();
      mesh.material = firstMesh.material;
      mesh.userData.sharesPipelineWith = firstMesh;
    } else firstMesh = mesh;
    mesh.name = 'Ede water works tile';
    mesh.castShadow = false;
    group.add(mesh);
    counts.batches++;
  }
  group.userData.counts = counts;
  scene.add(group);
  return group;
}
