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
  return box;
}

function weir(batch, record) {
  const width = clamp(record.width, 0.45, 22), top = clamp(record.height, 0.20, 2.6);
  const box = localPlacement(record, batch);
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

export function buildEdeWaterWorks(scene, asset) {
  const { version, weirs } = asset;
  if (version !== 1 || !Array.isArray(weirs)) throw new Error('Invalid Ede water works asset');
  const group = new THREE.Group();
  group.name = 'Ede Water Works';
  const counts = { weirs: 0, batches: 0 };
  const cells = new Map();
  function batchAt(x, z) {
    const key = `${Math.floor(x / EDE_RENDER_CELL)}/${Math.floor(z / EDE_RENDER_CELL)}`;
    if (!cells.has(key)) cells.set(key, new CivicBatch());
    return cells.get(key);
  }

  for (const record of weirs) {
    const { x, y, z, heading, width, height } = record;
    if (![x, y, z, heading, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    weir(batchAt(x, z), record);
    counts.weirs++;
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
