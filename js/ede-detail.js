import * as THREE from 'three/webgpu';
import { drapeEdeSurface, edeBounds, edePolygonGeometry, overlapsEdeTravelPavement } from './ede-geometry.js';
import { playgroundEquipment } from './ede-playground-equipment.js';
import { gradeProfileAt, gradeWayAt } from './ede-grade.js';
import { fitEdeSignalSpan } from './ede-signal-hardware.js?v=20261121-signal-optics';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const CELL = 180;
const ROAD_REACH = 14;
const STEEL = 0x68747b, GALVANIZED = 0xafb8b9, WOOD = 0x785335;
const FOLIAGE = [0x4d673b, 0x4d633e, 0x51693e, 0x435c37];
const BARRIERS = {
  hedge: { width: 0.85, height: 1.1, color: 0x405d2e },
  fence: { width: 0.10, height: 1.2, color: 0x56605a, spacing: 2.5 },
  guardrail: { width: 0.20, height: 0.80, color: GALVANIZED, spacing: 4 },
  balustrade: { width: 0.10, height: 1.15, color: STEEL, spacing: 2.2 },
  noiseBarrier: { width: 0.16, height: 2.8, color: 0x6a7266 },
  waterEdge: { width: 0.35, height: 0.15, color: 0x586046 },
};

const PARCEL_STYLES = {
  clippedHedge: { color: 0x4c6539, taper: 0.20 },
  denseHedge: { color: 0x3c5633, taper: 0.26 },
  timber: { color: 0x867463, spacing: 1.8, solid: true },
  lowTimber: { color: 0x8e8270, spacing: 1.8, solid: true },
  metalMesh: { color: 0x53615a, spacing: 2.4, mesh: true },
  ivyMesh: { color: 0x42573a, spacing: 2.4, mesh: true },
};
const PARCEL_SURFACES = { path: 0xa4a097, patio: 0xaaa197, plantingBed: 0x74634c, lawn: 0x7b874e, parking: 0x777b79 };

const infrastructure = new Set(['balustrade', 'guardrail', 'gutter', 'drain',
  'canopy', 'landing', 'steps', 'bin', 'container']);

const WASTE_COLORS = {
  residual: 0x43494a, restafval: 0x43494a, glass: 0x398253, glas: 0x398253,
  textiles: 0x806450, textile: 0x806450, textiel: 0x806450, paper: 0x316b9a, papier: 0x316b9a,
  pmd: 0xc47736, organic: 0x638044, gft: 0x638044, 'food-waste': 0x638044,
};
const PLAY_SURFACES = { sand: 0xbba984, bark: 0x84664e, gravel: 0xaca394, rubber: 0x794c45, path: 0x9d927f };

async function readPacked(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = new Response(bytes);
  return bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body;
}

async function loadLandCover() {
  try {
    const response = await readPacked(new URL('../assets/ede-bgt-land.bin.gz', import.meta.url));
    const bytes = await response.arrayBuffer();
    const header = new DataView(bytes);
    if (bytes.byteLength < 24 || header.getUint32(0, true) !== 0x314c4742) throw new Error('invalid land mask header');
    const width = header.getUint32(4, true), height = header.getUint32(8, true);
    const minX = header.getFloat32(12, true), minZ = header.getFloat32(16, true), step = header.getFloat32(20, true);
    if (!width || !height || ![minX, minZ, step].every(Number.isFinite) || step <= 0 ||
        bytes.byteLength !== 24 + width * height) throw new Error('invalid land mask extent');
    const texture = new THREE.DataTexture(new Uint8Array(bytes, 24), width, height, THREE.RedFormat);
    texture.needsUpdate = true;
    const palette = new THREE.DataTexture(new Uint8Array([
      0, 0, 0, 0,       // outside mapped cover
      71, 76, 47, 255,  // woodland
      128, 109, 78, 255, // heath
      92, 120, 56, 255,  // grass
      108, 86, 60, 255,  // planting bed
      137, 126, 114, 255 // courtyard
    ]), 6, 1);
    palette.colorSpace = THREE.SRGBColorSpace;
    palette.needsUpdate = true;
    return { texture, palette, minX, minZ, sizeX: width * step, sizeZ: height * step };
  } catch (error) {
    console.warn(`[BGT land cover] ${error.message}`);
    return null;
  }
}

export async function loadEdeDetail({
  bgt = true, motorway = true, directional = motorway, bgtStage = 'all', municipal = true,
  parcels = false, utilities = false,
} = {}) {
  const files = { bgt: 'ede-bgt-detail', '1gis': 'ede-1gis-detail', nbd: 'ede-nbd-signs',
    municipal: 'ede-municipal-detail', parcel: 'ede-parcel-detail', utility: 'ede-utility-detail' };
  const requests = [bgt && 'bgt', motorway && '1gis', directional && 'nbd',
    bgt && bgtStage === 'all' && municipal && 'municipal',
    bgt && bgtStage === 'all' && parcels && 'parcel', utilities && 'utility'].filter(Boolean);
  const assetUrl = (source, extension) => new URL(`../assets/${files[source]}.${extension}`, import.meta.url);
  let nbdTexture, parcelTiles;
  const replacedBgt = new Set();
  const land = bgt && bgtStage === 'all' ? loadLandCover() : null;
  const assets = await Promise.all(requests.map(async source => {
    try {
      const asset = await (await readPacked(assetUrl(source, source === 'parcel' ? 'json.gz?v=20261121-map' : 'json.gz'))).json();
      if (asset.version !== 1 || !Array.isArray(asset.features)) throw new Error('invalid asset format');
      if (source === 'municipal' || source === 'parcel') {
        if (!Array.isArray(asset.replaces) || asset.replaces.some(id => typeof id !== 'string')) {
          throw new Error('invalid BGT replacement list');
        }
        if (source === 'parcel' && asset.features.some(feature => !validParcelFeature(feature))) {
          throw new Error('invalid parcel geometry');
        }
        if (source === 'parcel') parcelTiles = (asset.tiles ?? []).filter(validParcelTile);
        for (const id of asset.replaces) replacedBgt.add(id);
      }
      if (source === 'nbd' && asset.features.length) {
        nbdTexture = await new THREE.TextureLoader().loadAsync(assetUrl(source, 'png?v=20261120-traffic-blue').href);
        nbdTexture.colorSpace = THREE.SRGBColorSpace;
        nbdTexture.anisotropy = 4;
      }
      const rows = source === 'bgt' && bgtStage === 'street'
        ? asset.features.filter(feature => !infrastructure.has(feature.type)) : asset.features;
      return rows.map(feature => ({ ...feature, source }));
    } catch (error) {
      console.warn(`[${source} detail] ${error.message}`);
      return [];
    }
  }));
  const features = assets.flat().filter(feature => feature.source !== 'bgt' || !replacedBgt.has(feature.id));
  return { features: features.filter(f => f.type !== 'marking'), markings: features.filter(f => f.type === 'marking'),
    nbdTexture, parcelTiles, landCover: await land };
}

function groundAt(feature, x, z, surveyY, height = 0) {
  const coarse = terrainHeightAt(x, z);
  const localInventory = ['bgt', 'municipal', 'parcel'].includes(feature.source);
  const kind = feature.level > 0 ? 'bridge' : feature.level < 0 ? 'underpass' : null;
  const explicit = feature.profileId && gradeProfileAt(x, z, undefined, undefined, undefined, feature.profileId, ROAD_REACH);
  if (explicit && explicit.id === feature.profileId && (!kind || explicit.kind === kind)) return explicit.y;
  // A ground-level motorway object can be beside a raised road and keep its own surface.
  const matched = (kind || localInventory) && feature.wayId && gradeWayAt(feature.wayId, x, z, ROAD_REACH);
  if (matched && (!kind || matched.span.profile.site?.kind === kind)) return matched.y;
  if (Number.isFinite(surveyY)) return surveyY - (getTerrain()?.napOrigin ?? SCENE_NAP_ORIGIN) - height;
  if (!localInventory) return kind ? undefined : coarse;
  const local = gradeProfileAt(x, z, 'foot', undefined, coarse);
  if (local && (local.kind === 'platform' && !(feature.level < 0) || local.kind === 'surface' && !kind)) return local.y;
  return kind ? undefined : coarse;
}

export function bikeRackGround(feature, x, z) {
  const y = groundAt(feature, x, z, feature.surveyY ?? feature.topY, feature.surveyY == null ? feature.height ?? .85 : 0);
  return y === undefined ? undefined : y + (feature.baseOffset ?? 0);
}

const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const validLine = points => Array.isArray(points) && points.length >= 2 && points.every(validPoint);
const validPolygon = feature => Array.isArray(feature.polygon) && feature.polygon.length >= 3 &&
  feature.polygon.every(validPoint) && (feature.holes === undefined || Array.isArray(feature.holes) &&
    feature.holes.every(hole => Array.isArray(hole) && hole.length >= 3 && hole.every(validPoint)));
function validParcelTile(tile) {
  return tile && /^-?\d+_-?\d+$/.test(tile.id) && Number.isInteger(tile.count) && tile.count > 0 &&
    Array.isArray(tile.bounds) && tile.bounds.length === 4 && tile.bounds.every(Number.isFinite) &&
    tile.bounds[0] <= tile.bounds[2] && tile.bounds[1] <= tile.bounds[3];
}
function validParcelFeature(feature) {
  if (!feature || typeof feature.id !== 'string' || !Number.isInteger(feature.level) ||
      !['observed', 'inferred'].includes(feature.status)) return false;
  if (feature.type === 'parcelSurface') return feature.level === 0 && Object.hasOwn(PARCEL_SURFACES, feature.surface) && validPolygon(feature);
  return ['hedge', 'fence'].includes(feature.type) && (validPolygon(feature) || validLine(feature.points));
}

const dimension = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const facePattern = [0, 1, 2, 0, 2, 3];

function fenceMeshTexture() {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    data.fill(255, i, i + 3);
    data[i + 3] = x < 4 || y < 4 ? 255 : 0;
  }
  const map = new THREE.DataTexture(data, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

function lineSamples(feature, height, resolve) {
  const sites = feature.points;
  const surveyed = feature.surveyY ?? feature.topY;
  const top = feature.surveyY == null && feature.topY != null ? height : 0;
  const out = [];
  for (let i = 1; i < sites.length; i++) {
    const [ax, az] = sites[i - 1], [bx, bz] = sites[i];
    const size = Math.hypot(bx - ax, bz - az);
    if (size < 0.03) continue;
    const count = Math.ceil(size / 8);
    for (let j = i === 1 || !out.length ? 0 : 1; j <= count; j++) {
      const t = j / count, x = lerp(ax, bx, t), z = lerp(az, bz, t);
      const nativeY = Array.isArray(surveyed) ? lerp(surveyed[i - 1], surveyed[i], t) : surveyed;
      const y = resolve(feature, x, z, nativeY, top);
      if (!Number.isFinite(y)) return null;
      out.push({ x, z, y });
    }
  }
  return out;
}

function strokeEdges(points, halfWidth) {
  const axis = (a, b) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return [(a.z - b.z) / len, (b.x - a.x) / len];
  };
  return points.map((p, i) => {
    const first = axis(points[Math.max(0, i - 1)], points[Math.max(1, i)]);
    const last = axis(points[Math.min(points.length - 2, i)], points[Math.min(points.length - 1, i + 1)]);
    const dot = first[0] * last[0] + first[1] * last[1];
    const scale = halfWidth / Math.max(0.6, 1 + dot);
    const dx = dot < -0.95 ? last[0] * halfWidth : (first[0] + last[0]) * scale;
    const dz = dot < -0.95 ? last[1] * halfWidth : (first[1] + last[1]) * scale;
    return [{ x: p.x + dx, z: p.z + dz, y: p.y }, { x: p.x - dx, z: p.z - dz, y: p.y }];
  });
}

function buildMarkerAtlas(labels) {
  if (!labels.length || typeof document === 'undefined') return null;
  const cellWidth = 96, cellHeight = 40, columns = Math.min(labels.length, 12);
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellWidth;
  canvas.height = Math.ceil(labels.length / columns) * cellHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = 'bold 22px Arial';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const cells = new Map();
  labels.forEach((text, i) => {
    const left = i % columns * cellWidth, top = Math.floor(i / columns) * cellHeight;
    ctx.fillStyle = '#fff'; ctx.fillRect(left, top, cellWidth, cellHeight);
    ctx.fillStyle = '#1a5935'; ctx.fillRect(left + 5, top + 5, cellWidth - 10, cellHeight - 10);
    ctx.fillStyle = '#fff'; ctx.fillText(text, left + cellWidth / 2, top + cellHeight / 2, cellWidth - 16);
    cells.set(text, [(left + 1) / canvas.width, 1 - (top + cellHeight - 1) / canvas.height,
      (left + cellWidth - 1) / canvas.width, 1 - (top + 1) / canvas.height]);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return { cells, texture };
}

function detailResources() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.83 });
  const surface = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, vertexColors: true, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x78a9a2, roughness: 0.32, transparent: true, opacity: 0.42, depthWrite: false });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const leaf = new THREE.IcosahedronGeometry(0.5, 1);
  const leafPosition = leaf.getAttribute('position');
  for (let i = 0; i < leafPosition.count; i++) {
    const x = leafPosition.getX(i), y = leafPosition.getY(i), z = leafPosition.getZ(i);
    const ripple = 1 + 0.11 * Math.sin(x * 16 + y * 25) * Math.cos(z * 21);
    leafPosition.setXYZ(i, x * ripple, y * ripple, z * ripple);
  }
  const shapes = { box, glass: box, pole: new THREE.CylinderGeometry(0.5, 0.5, 1, 6), round: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    leaf, tuft: new THREE.IcosahedronGeometry(0.5) };
  return { material, surface, glass, shapes };
}

export function buildEdeDetail(scene, features = [], { deckProfiles, mappedLamps = [], signalSupportIds, nbdTexture, resources, parcelTile = false } = {}) {
  const group = new THREE.Group();
  group.name = 'EdeImportedDetail';
  const batches = new Map(), stopIds = new Set(), gantryLampMounts = new Map(), colliders = [];
  const gantries = [], signSupports = [], portalPanels = new Map(), directionalPanels = [];
  const stats = { bgt: 0, '1gis': 0, nbd: 0, municipal: 0, parcel: 0, utility: 0, counts: {}, unresolved: [], instances: 0, chunks: 0, triangles: 0, colliders: 0, sharedLampSupports: 0 };
  const replacements = { bag: new Set(), osm: new Set() };
  group.userData.stats = stats;
  group.userData.replacements = replacements;
  group.userData.stopIds = [];
  if (!features.length) {
    scene.add(group);
    return { group, colliders, stopIds, gantryLampMounts, gantries, signSupports, stats, resources };
  }
  resources ??= detailResources();
  const { material, surface, glass, shapes } = resources;
  const atlas = buildMarkerAtlas([...new Set(features.filter(f => f.type === 'hectometre' && typeof f.label === 'string' && f.label.length).map(f => f.label))]);
  const signs = atlas && new THREE.MeshBasicNodeMaterial({ map: atlas.texture });
  const directionalSigns = nbdTexture && new THREE.MeshBasicNodeMaterial({ map: nbdTexture });
  const color = new THREE.Color(), dummy = new THREE.Object3D();
  const pipelines = new Map();
  const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3();
  const across = new THREE.Vector3(), normal = new THREE.Vector3(), basis = new THREE.Matrix4();

  function resolveGround(feature, x, z, surveyY, height) {
    const deck = feature.surfaceId && deckProfiles?.get(feature.surfaceId);
    return deck?.(x, z) ?? groundAt(feature, x, z, surveyY, height);
  }

  function batch(kind, x, z, source, range) {
    const cell = kind === 'inset' || source === 'municipal' ? 90 : CELL;
    const groupKey = parcelTile ? '' : `${Math.floor(x / cell)}/${Math.floor(z / cell)}`;
    const key = `${kind}/${source}/${range ?? ''}/${groupKey}`;
    if (!batches.has(key)) batches.set(key, { kind, source, range, instances: [], positions: [], indices: [], colors: [], uv: [] });
    return batches.get(key);
  }

  function instance(source, kind, x, y, z, sx, sy, sz, angle, paint, range) {
    batch(kind, x, z, source, range).instances.push([x, y, z, sx, sy, sz, angle, paint]);
  }

  function face(target, points, paint) {
    const base = target.positions.length / 3;
    for (const p of points) target.positions.push(p.x, p.y, p.z);
    const pattern = points.length === 3 ? facePattern.slice(0, 3) : facePattern;
    for (const index of pattern) target.indices.push(base + index);
    if (paint !== undefined) {
      color.setHex(paint);
      for (let i = 0; i < points.length; i++) target.colors.push(color.r, color.g, color.b);
    }
  }

  function directionalPanel(feature) {
    if (!directionalSigns || !validPoint(feature.position) || !Number.isFinite(feature.centerY) ||
        !Number.isFinite(feature.angle) || !feature.uv || feature.uv.length !== 4 || !feature.uv.every(Number.isFinite) ||
        !(feature.width > 0 && feature.height > 0)) return false;
    let [x, z] = feature.position;
    const { angle, width, height } = feature;
    const y = feature.centerY - (getTerrain()?.napOrigin ?? SCENE_NAP_ORIGIN);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const backing = 0.095;
    const mount = feature.mountId && gantries.find(gantry => gantry.id === feature.mountId);
    const side = mount?.halfDepth ? Math.sign(sin * mount.uz - cos * mount.ux) || 1 : 0;
    if (side) {
      const offset = (x - mount.x) * mount.uz - (z - mount.z) * mount.ux;
      const shift = Math.max(0, mount.halfDepth + 0.23 - offset * side) * side;
      x += mount.uz * shift;
      z -= mount.ux * shift;
    }
    if (feature.support) {
      const base = resolveGround(feature, x, z, feature.surveyY);
      const poleHeight = y - base - height * 0.25;
      if (!(poleHeight > 0.5)) return false;
      const diameter = 0.12;
      const depth = -(backing + diameter) / 2;
      for (const offset of width > 2.5 ? [-width * 0.31, width * 0.31] : [0]) {
        instance(feature.source, 'pole', x + cos * offset + sin * depth, base + poleHeight / 2,
          z - sin * offset + cos * depth, diameter, poleHeight, diameter, angle, GALVANIZED);
      }
    }
    const corners = depth => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
      x: x + cos * u * width / 2 + sin * depth,
      z: z - sin * u * width / 2 + cos * depth,
      y: y + v * height / 2
    }));
    const front = corners(backing / 2), back = corners(-backing / 2);
    const tile = batch('directionalSign', x, z, feature.source);
    face(tile, front);
    // The textured face closes the panel. A metal front behind it can compete in the depth buffer.
    const shell = batch('solid', x, z, feature.source);
    face(shell, [back[3], back[2], back[1], back[0]], STEEL);
    for (let i = 0; i < front.length; i++) {
      const next = (i + 1) % front.length;
      face(shell, [back[i], back[next], front[next], front[i]], STEEL);
    }
    const [u0, v0, u1, v1] = feature.uv;
    tile.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    if (feature.mountId) {
      if (!portalPanels.has(feature.mountId)) portalPanels.set(feature.mountId, []);
      portalPanels.get(feature.mountId).push({ x, y, z, angle, width, height });
    }
    if (validPoint(feature.bracket)) {
      let [bx, bz] = feature.bracket;
      if (side) {
        const offset = (bx - mount.x) * mount.uz - (bz - mount.z) * mount.ux;
        const shift = side * mount.halfDepth - offset;
        bx += mount.uz * shift;
        bz -= mount.ux * shift;
      }
      const joint = { x: bx, y: Number.isFinite(feature.bracketY) ? y + feature.bracketY - feature.centerY : y, z: bz };
      const back = { x: x - sin * backing / 2, y, z: z - cos * backing / 2 };
      if (Math.hypot(back.x - bx, back.z - bz) > 0.1) {
        const [a, b] = strokeEdges([back, joint], 0.07);
        stripe(feature.source, a, b, -0.06, 0.06, GALVANIZED, { caps: true });
      }
    }
    return true;
  }

  const at = (p, offset) => ({ ...p, y: p.y + offset });

  function stripe(source, a, b, low, high, paint, { caps = false, taper = 0, kind = 'solid', range } = {}) {
    const target = batch(kind, (a[0].x + b[0].x) / 2, (a[0].z + b[0].z) / 2, source, range);
    const [al, ar] = a, [bl, br] = b;
    const crown = (p, other) => ({ x: lerp(p.x, other.x, taper), y: p.y + high, z: lerp(p.z, other.z, taper) });
    const l0 = at(al, low), r0 = at(ar, low), l1 = crown(al, ar), r1 = crown(ar, al);
    const m0 = at(bl, low), n0 = at(br, low), m1 = crown(bl, br), n1 = crown(br, bl);
    face(target, [l1, m1, n1, r1], paint);
    face(target, [l0, m0, m1, l1], paint);
    face(target, [r0, r1, n1, n0], paint);
    if (caps) {
      face(target, [l0, l1, r1, r0], paint);
      face(target, [m0, n0, n1, m1], paint);
      face(target, [l0, r0, n0, m0], paint);
    }
  }

  function lineCollider(a, b, width, height) {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const hx = length / 2, hz = width / 2, cs = dx / length, sn = -dz / length;
    const rx = Math.abs(cs) * hx + Math.abs(sn) * hz, rz = Math.abs(sn) * hx + Math.abs(cs) * hz;
    const ground = (x, z) => lerp(a.y, b.y, Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (length * length))));
    colliders.push({ minX: cx - rx, maxX: cx + rx, minZ: cz - rz, maxZ: cz + rz,
      minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) + height,
      obb: { cx, cz, hx, hz, cs, sn }, kind: 'surveyed-barrier', minYAt: ground, maxYAt: (x, z) => ground(x, z) + height });
  }

  function barrier(feature) {
    const spec = BARRIERS[feature.type];
    const style = feature.source === 'parcel' && Object.hasOwn(PARCEL_STYLES, feature.style) ? PARCEL_STYLES[feature.style] : null;
    const solidRail = feature.solid;
    const rail = feature.type === 'guardrail' && !solidRail;
    const fence = feature.type === 'fence' || feature.type === 'balustrade';
    const width = dimension(feature.width, solidRail ? 0.45 : spec.width), height = dimension(feature.height, spec.height);
    const paint = Number.isInteger(feature.color) ? feature.color : style?.color ?? (solidRail ? 0x9a9a94 : spec.color);
    const crossSection = parcelTile ? { taper: style?.taper, caps: true, range: 112 }
      : style?.taper ? { taper: style.taper, caps: true, range: 210 }
      : feature.type === 'waterEdge' ? { taper: 0.36 } : feature.source === 'parcel' ? { range: 245 } : undefined;
    const spacing = dimension(feature.spacing, style?.spacing ?? spec.spacing);
    if (feature.polygon) return extrudeFootprint(feature, height, paint);
    if (!validLine(feature.points)) return false;
    const points = lineSamples(feature, height, resolveGround);
    if (!points || points.length < 2) return false;
    const edges = strokeEdges(points, width / 2);
    if (validLine(feature.deckShoulder) && feature.deckShoulder.length === feature.points.length) {
      // The surveyed bridge edge extends past the fitted travel surface here.
      const supported = feature.points.map(([x, z], i) => {
        const [ix, iz] = feature.deckShoulder[i];
        const length = Math.hypot(x - ix, z - iz);
        const outer = length > 0.05 ? 0.14 / length : 0;
        return [
          { x: ix, y: resolveGround(feature, ix, iz) + 0.055, z: iz },
          { x: x + (x - ix) * outer, y: resolveGround(feature, x, z) + 0.055, z: z + (z - iz) * outer },
        ];
      });
      for (let i = 1; i < supported.length; i++) {
        const a = supported[i - 1], b = supported[i];
        if ([...a, ...b].every(p => Number.isFinite(p.y))) stripe(feature.source, a, b, -0.61, 0, 0xa0a6a6, true);
      }
    }
    let nextPost = 0, alongRun = 0, nextTuft = 0.5;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], size = Math.hypot(b.x - a.x, b.z - a.z);
      const low = rail ? Math.max(0, height - 0.29) : fence && !style?.solid ? height - 0.06 : -0.025;
      stripe(feature.source, edges[i - 1], edges[i], low, height, paint, crossSection);
      if (fence && !style?.solid) {
        stripe(feature.source, edges[i - 1], edges[i], height * 0.42, height * 0.42 + 0.045, paint, crossSection);
      }
      if (feature.collidable && feature.status !== 'inferred') lineCollider(a, b, width, height);
      if (style?.mesh) {
        const target = batch('wireFence', (a.x + b.x) / 2, (a.z + b.z) / 2, feature.source, parcelTile ? 75 : 105);
        face(target, [at(a, 0.10), at(b, 0.10), at(b, height - 0.02), at(a, height - 0.02)], paint);
        target.uv.push(alongRun / 0.095, 0, (alongRun + size) / 0.095, 0,
          (alongRun + size) / 0.095, height / 0.17, alongRun / 0.095, height / 0.17);
      }
      if (style?.taper && !parcelTile) {
        for (; nextTuft < size; nextTuft += 0.95) {
          const t = nextTuft / size;
          instance(feature.source, 'tuft', lerp(a.x, b.x, t), lerp(a.y, b.y, t) + height - 0.065, lerp(a.z, b.z, t),
            width * 0.92, 0.19, 1.05, Math.atan2(b.x - a.x, b.z - a.z), paint, 75);
        }
        nextTuft -= size;
      }
      alongRun += size;
      if (!spacing || solidRail) continue;
      for (; nextPost < size; nextPost += spacing) {
        const t = nextPost / size, thickness = rail ? 0.12 : 0.075;
        instance(feature.source, 'box', lerp(a.x, b.x, t), lerp(a.y, b.y, t) + height / 2, lerp(a.z, b.z, t),
          thickness, height, thickness, Math.atan2(b.x - a.x, b.z - a.z), paint,
          parcelTile ? 60 : feature.source === 'parcel' ? (style?.solid ? 75 : 175) : undefined);
      }
      nextPost -= size;
    }
    if (style?.solid && !parcelTile) for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const size = Math.hypot(b.x - a.x, b.z - a.z);
      const angle = Math.atan2(b.x - a.x, b.z - a.z);
      for (let along = 0.16; along < size - 0.10; along += 0.25) {
        const t = along / size;
        instance(feature.source, 'box', lerp(a.x, b.x, t), lerp(a.y, b.y, t) + height * 0.48, lerp(a.z, b.z, t),
          0.013, height * 0.95, width + 0.009, angle, 0x65594e, 75);
      }
    }
    return true;
  }

  function extrudeFootprint(feature, height, paint, { baseHeight = 0, fixedY, kind = 'solid' } = {}) {
    const rings = [feature.polygon, ...(Array.isArray(feature.holes) ? feature.holes : [])];
    if (rings.some(ring => !Array.isArray(ring) || ring.length < 3 || !ring.every(validPoint))) return false;
    const ground = (x, z) => fixedY ?? resolveGround(feature, x, z, feature.surveyY);
    const grounded = rings.map(ring => ring.map(([x, z]) => ({ x, z, y: ground(x, z) })));
    if (grounded.some(ring => ring.some(p => !Number.isFinite(p.y)))) return false;
    const [outer, ...holes] = grounded;
    const target = batch(kind, outer[0].x, outer[0].z, feature.source);
    const cap = edePolygonGeometry(outer, holes);
    const position = cap.getAttribute('position'), base = target.positions.length / 3;
    color.setHex(paint);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      target.positions.push(x, ground(x, z) + height, z);
      target.colors.push(color.r, color.g, color.b);
    }
    for (const index of cap.index.array) target.indices.push(base + index);
    if (fixedY !== undefined) {
      const bottom = target.positions.length / 3;
      for (let i = 0; i < position.count; i++) {
        target.positions.push(position.getX(i), fixedY + baseHeight, position.getZ(i));
        target.colors.push(color.r, color.g, color.b);
      }
      for (let i = 0; i < cap.index.count; i += 3) {
        target.indices.push(bottom + cap.index.getX(i), bottom + cap.index.getX(i + 2), bottom + cap.index.getX(i + 1));
      }
    }
    cap.dispose();
    for (const ring of grounded) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      face(target, [at(a, baseHeight), at(b, baseHeight), at(b, height), at(a, height)], paint);
    }
    const levels = outer.map(p => p.y);
    if (feature.collidable && feature.status !== 'inferred') {
      colliders.push({ ...edeBounds(outer), minY: Math.min(...levels), maxY: Math.max(...levels) + height,
        polygon: { outer, holes }, kind: 'surveyed-barrier', minYAt: ground, maxYAt: (x, z) => ground(x, z) + height });
    }
    return true;
  }

  function utilityHouse(feature) {
    if (feature.status === 'inferred' || !validPolygon(feature) || !(feature.height > 1 && feature.height < 9)) return false;
    const { polygon, height } = feature;
    const base = Number.isFinite(feature.baseY) ? feature.baseY
      : Math.min(...polygon.map(([x, z]) => resolveGround(feature, x, z))) - 0.05;
    const paint = Number.isInteger(feature.color) ? feature.color : feature.style === 'brick' ? 0x916953 : 0x96988b;
    const roofColor = feature.roofColor ?? 0x535458;
    const pitch = polygon.length === 4 && !feature.holes?.length &&
      feature.roofRise > 0 && feature.roofRise < height - 1 ? feature.roofRise : 0;
    const eave = height - (pitch || 0.11);
    if (!Number.isFinite(base) || !extrudeFootprint({ ...feature, collidable: true }, eave, paint,
      { fixedY: base, kind: 'utilityShell' })) {
      return false;
    }
    if (pitch) {
      const edgeLength = (i) => Math.hypot(polygon[i][0] - polygon[(i + 1) % 4][0],
        polygon[i][1] - polygon[(i + 1) % 4][1]);
      const start = edgeLength(0) + edgeLength(2) >= edgeLength(1) + edgeLength(3) ? 0 : 1;
      const [a, b, c, d] = Array.from({ length: 4 }, (_, i) => {
        const [x, z] = polygon[(i + start) % 4];
        return { x, y: base + eave, z };
      });
      const left = { x: (a.x + d.x) * 0.5, y: base + height, z: (a.z + d.z) * 0.5 };
      const right = { x: (b.x + c.x) * 0.5, y: base + height, z: (b.z + c.z) * 0.5 };
      const tile = batch('utilityShell', polygon[0][0], polygon[0][1], feature.source);
      face(tile, [a, b, right, left], roofColor);
      face(tile, [c, d, left, right], roofColor);
      face(tile, [d, a, left], paint);
      face(tile, [b, c, right], paint);
    } else {
      extrudeFootprint({ ...feature, collidable: false }, height, roofColor,
        { fixedY: base, baseHeight: eave, kind: 'utilityShell' });
    }
    colliders.at(-1).maxY = base + height;
    colliders.at(-1).maxYAt = () => base + height;
    const [edge, fraction] = feature.door ?? [];
    if (Number.isInteger(edge) && polygon[edge] && Number.isFinite(fraction)) {
      const [ax, az] = polygon[edge], [bx, bz] = polygon[(edge + 1) % polygon.length];
      const length = Math.hypot(bx - ax, bz - az);
      if (length > 1) {
        const [dx, dz] = [(bx - ax) / length, (bz - az) / length];
        const doorHeight = Math.min(2.1, height - 0.18), doorWidth = Math.min(1.25, length * 0.58);
        const t = Math.max(doorWidth / length, Math.min(1 - doorWidth / length, fraction));
        const x = lerp(ax, bx, t), z = lerp(az, bz, t), angle = Math.atan2(-dz, dx);
        instance(feature.source, 'box', x, base + doorHeight / 2 + 0.055, z,
          doorWidth, doorHeight, 0.045, angle, 0x626860, 120);
        instance(feature.source, 'box', x, base + doorHeight * 0.78, z,
          doorWidth * 0.70, 0.22, 0.06, angle, 0x424842, 90);
      }
    }
    if (feature.bagId) replacements.bag.add(feature.bagId);
    if (feature.osmId) replacements.osm.add(feature.osmId);
    return true;
  }

  function drainage(feature) {
    const gutter = feature.type === 'gutter', paint = gutter ? 0x78756e : 0x565b59;
    if (feature.polygon) {
      return extrudeFootprint({ ...feature, collidable: false }, 0.074, paint, { baseHeight: 0.067, kind: 'inset' });
    }
    if (!validLine(feature.points)) return false;
    const points = lineSamples(feature, 0, resolveGround);
    if (!points || points.length < 2) return false;
    const edges = strokeEdges(points, dimension(feature.width, gutter ? 0.24 : 0.18) / 2);
    for (let i = 1; i < edges.length; i++) {
      stripe(feature.source, edges[i - 1], edges[i], 0.067, 0.074, paint, { kind: 'inset' });
    }
    return true;
  }

  function canopy(feature) {
    if (!Number.isFinite(feature.topY) || !Array.isArray(feature.supports)) return false;
    const nap = getTerrain()?.napOrigin ?? SCENE_NAP_ORIGIN;
    const fixedY = feature.topY - nap;
    const slab = 0.15;
    const supports = feature.supports.filter(support => validPoint(support?.position) &&
      Number.isFinite(support.baseY) && feature.topY - support.baseY > 2.4);
    if (!supports.length || !extrudeFootprint({ ...feature, collidable: false }, 0, 0x889294,
      { fixedY, baseHeight: -slab })) return false;
    for (const { position: [x, z], baseY, width, depth, angle } of supports) {
      const ground = baseY - nap, height = fixedY - slab - ground;
      instance(feature.source, 'pole', x, ground + height / 2, z, dimension(width, 0.38), height,
        dimension(depth, 0.38), Number.isFinite(angle) ? angle : 0, STEEL);
    }
    return true;
  }

  function gantryTruss(feature, points, { beam, ux, uz, length, halfDepth }) {
    const [start] = points;
    const rise = Math.sqrt(3) * halfDepth;
    const position = (along, height, offset) => ({
      x: start.x + ux * along + uz * offset,
      y: height,
      z: start.z + uz * along - ux * offset
    });
    const lower = (along, side) => position(along, beam, side * halfDepth);
    const upper = along => position(along, beam + rise, 0);
    function member(a, b, diameter, shape = 'pole') {
      axis.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const size = axis.length();
      const rotation = new THREE.Quaternion().setFromUnitVectors(up, axis.divideScalar(size));
      instance(feature.source, shape, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2,
        diameter, size, diameter, rotation, GALVANIZED);
    }

    member(upper(0), upper(length), 0.17, 'round');
    const bays = Math.max(1, Math.round(length / (2 + 2 * halfDepth)));
    const span = length / bays;
    for (const side of [-1, 1]) {
      member(lower(0, side), lower(length, side), 0.17, 'round');
      for (let i = 0; i < bays; i++) {
        const peak = upper((i + 0.5) * span);
        member(lower(i * span, side), peak, 0.08);
        member(peak, lower((i + 1) * span, side), 0.08);
      }
      for (const [along, ground] of [[0, points[0].y], [length, points[1].y]]) {
        const foot = position(along, ground, side * (halfDepth + 0.75));
        const base = resolveGround(feature, foot.x, foot.z, feature.surveyY);
        if (Number.isFinite(base)) foot.y = Math.min(base - 0.08, beam - 0.4);
        const tip = position(along, beam, side * 0.14);
        member(foot, tip, 0.32, 'box');
        signSupports.push({ x: foot.x, z: foot.z, baseY: foot.y, topY: tip.y, topX: tip.x, topZ: tip.z,
          layer: feature.level ?? 0, radius: 0.23, kind: 'gantry' });
        member(lower(along, side), upper(along), 0.10);
      }
    }
    for (let i = 0; i < bays; i++) {
      member(lower(i * span, 1), lower((i + 1) * span, -1), 0.08);
    }
    for (const along of [0, length]) member(lower(along, -1), lower(along, 1), 0.30, 'box');
  }

  function gantry(feature) {
    if (!validLine(feature.points)) return false;
    const original = [feature.points[0], feature.points.at(-1)];
    const halfDepth = feature.half ? 0 : /[BCD]-1$/.test(feature.sourceSubtype) ? 0.8 : 0.5;
    let endpoints = original;
    if (feature.half || signalSupportIds?.has(feature.id)) {
      const [a, b] = original;
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      const offsets = feature.half ? [0] : [-halfDepth - 0.75, halfDepth + 0.75];
      const clear = (x, z) => offsets.every(offset => !overlapsEdeTravelPavement(
        x + dz / length * offset, z - dx / length * offset, feature.level ?? 0, 0.24));
      endpoints = fitEdeSignalSpan(original, feature.half, clear);
      if (!endpoints) return false;
    }
    const points = endpoints.map(([x, z]) => ({ x, z, y: resolveGround(feature, x, z, feature.surveyY) }));
    if (points.some(p => !Number.isFinite(p.y)) || Math.hypot(points[1].x - points[0].x, points[1].z - points[0].z) < 2) return false;
    const top = Math.max(...points.map(p => p.y));
    const beam = Number.isFinite(feature.beamY) ? feature.beamY - (getTerrain()?.napOrigin ?? SCENE_NAP_ORIGIN) : top + 6.1;
    if (beam < top + 3.4) return false;
    const [start, end] = points;
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const mount = { id: feature.id, x: start.x, z: start.z, beam, level: feature.level ?? 0, route: feature.route, length,
      ux: (end.x - start.x) / length, uz: (end.z - start.z) / length, halfDepth,
      adjusted: endpoints.some((point, i) => point !== original[i]) };
    if (feature.half) {
      const height = beam - start.y;
      instance(feature.source, 'box', start.x, start.y + height / 2, start.z, 0.32, height, 0.32, 0, GALVANIZED);
      signSupports.push({ x: start.x, z: start.z, baseY: start.y, topY: beam,
        layer: mount.level, radius: 0.23, kind: 'gantry' });
      const rotation = new THREE.Quaternion().setFromUnitVectors(up, axis.set(mount.ux, 0, mount.uz));
      instance(feature.source, 'round', (start.x + end.x) / 2, beam, (start.z + end.z) / 2,
        0.36, length, 0.36, rotation, GALVANIZED);
    } else {
      gantryTruss(feature, points, mount);
    }
    const lampPoints = mount.adjusted
      ? original.map(([x, z]) => ({ x, z, y: resolveGround(feature, x, z, feature.surveyY) }))
      : points;
    for (const [i, p] of (feature.half ? lampPoints.slice(0, 1) : lampPoints).entries()) {
      let attached = null, nearest = 0.30 ** 2;
      for (const lamp of mappedLamps) {
        const dx = lamp.x - p.x;
        if (Math.abs(dx) > 0.30 || (lamp.layer ?? 0) !== (feature.level ?? 0)) continue;
        const distance = dx * dx + (lamp.z - p.z) ** 2;
        if (distance >= nearest || gantryLampMounts.has(lamp) || Math.abs((lamp.baseY ?? terrainHeightAt(lamp.x, lamp.z)) - p.y) > 0.4) continue;
        attached = lamp;
        nearest = distance;
      }
      if (attached) gantryLampMounts.set(attached, { x: points[i].x, z: points[i].z, top: beam + (halfDepth ? Math.sqrt(3) * halfDepth : 0.18) });
    }
    gantries.push(mount);
    return true;
  }

  function playSurface(feature) {
    const rings = [feature.polygon, ...(feature.holes ?? [])];
    if (feature.level || rings.some(ring => !Array.isArray(ring) || ring.length < 3 || !ring.every(validPoint))) return false;
    const [outer, ...holes] = rings.map(ring => ring.map(([x, z]) => ({ x, z })));
    const parcel = feature.type === 'parcelSurface';
    const cap = drapeEdeSurface(edePolygonGeometry(outer, holes, parcel ? 0.055 : 0.079));
    const target = batch('playSurface', outer[0].x, outer[0].z, feature.source, parcelTile ? 120 : parcel ? 225 : 310);
    const pos = cap.getAttribute('position'), index = cap.index;
    const base = target.positions.length / 3;
    const paint = feature.type === 'parcelSurface' ? PARCEL_SURFACES[feature.surface]
      : Object.hasOwn(PLAY_SURFACES, feature.material) ? PLAY_SURFACES[feature.material] : PLAY_SURFACES.sand;
    color.setHex(paint);
    for (let i = 0; i < pos.count; i++) {
      target.positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      target.colors.push(color.r, color.g, color.b);
    }
    for (let i = 0; i < (index?.count ?? pos.count); i++) target.indices.push(base + (index?.getX(i) ?? i));
    cap.dispose();
    return true;
  }

  function buildProp(feature) {
    if (!validPoint(feature.position)) return false;
    const [x, z] = feature.position;
    const height = dimension(feature.height, 0.85);
    const support = resolveGround(feature, x, z, feature.surveyY ?? feature.topY, feature.surveyY == null ? height : 0);
    if (!Number.isFinite(support)) return false;
    const y = support + (Number.isFinite(feature.baseOffset) ? feature.baseOffset : 0);
    const angle = Number.isFinite(feature.angle) ? feature.angle : 0;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const play = feature.type === 'playEquipment';
    const detailRange = (detail) => play ? (detail ? 92 : 245)
      : feature.type === 'electricalCabinet' ? (detail ? 65 : 145) : feature.source === 'municipal' ? 112 : undefined;
    const part = (sx, sy, sz, dx, dy, dz, paint, shape = 'box', detail = false) => {
      instance(feature.source, shape, x + cos * dx + sin * dz, y + dy, z - sin * dx + cos * dz,
        sx, sy, sz, angle, paint, detailRange(detail));
    };
    const beam = (a, b, width, paint, detail = false, shape = 'pole', depth = width) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      axis.set(cos * dx + sin * dz, dy, -sin * dx + cos * dz);
      const length = axis.length();
      if (length < 0.001) return;
      axis.divideScalar(length);
      const rotation = new THREE.Quaternion();
      if (shape === 'box' && Math.hypot(axis.x, axis.z) > 0.001) {
        across.set(axis.z, 0, -axis.x).normalize();
        normal.crossVectors(across, axis);
        rotation.setFromRotationMatrix(basis.makeBasis(across, axis, normal));
      } else rotation.setFromUnitVectors(up, axis);
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, cz = (a[2] + b[2]) / 2;
      instance(feature.source, shape, x + cos * cx + sin * cz, y + cy, z - sin * cx + cos * cz,
        width, length, depth, rotation, paint, detailRange(detail));
    };
    const body = (width, depth, top, dx = 0, dz = 0, base = 0) => {
      const cx = x + cos * dx + sin * dz, cz = z - sin * dx + cos * dz;
      const hx = width / 2, hz = depth / 2;
      const rx = Math.abs(cos) * hx + Math.abs(sin) * hz, rz = Math.abs(sin) * hx + Math.abs(cos) * hz;
      colliders.push({ minX: cx - rx, maxX: cx + rx, minZ: cz - rz, maxZ: cz + rz,
        minY: y + base, maxY: y + top, obb: { cx, cz, hx, hz, cs: cos, sn: sin }, kind: 'municipal-furniture' });
    };
    switch (feature.type) {
      case 'electricalCabinet': {
        const width = dimension(feature.width, 0.75), depth = dimension(feature.depth, 0.32);
        part(width, height * 0.94, depth, 0, height * 0.47, 0, 0x727c70);
        part(width * 1.06, height * 0.06, depth * 1.08, 0, height * 0.97, 0, 0x49554d);
        part(width * 0.72, 0.045, 0.015, 0, height * 0.73, depth * 0.51, 0x46504a, 'box', true);
        if (feature.collidable) body(width, depth, height);
        break;
      }
      case 'bench': {
        const length = dimension(feature.length, 1.75);
        part(0.51, 0.075, length, 0, 0.45, 0, WOOD);
        part(0.08, 0.32, length, -0.24, 0.71, 0, WOOD);
        for (const end of [-0.38, 0.38]) part(0.36, 0.42, 0.07, 0, 0.21, length * end, STEEL);
        break;
      }
      case 'bikeRack': {
        const length = dimension(feature.length, 0.90);
        const railHeight = dimension(feature.height, 0.66);
        part(0.055, 0.055, length, 0, railHeight, 0, STEEL);
        for (const end of [-0.5, 0.5]) part(0.055, railHeight, 0.055, 0, railHeight / 2, length * end, STEEL, 'pole');
        break;
      }
      case 'bollard': {
        const width = dimension(feature.width, 0.14);
        part(width, height, width, 0, height / 2, 0, STEEL, 'pole');
        part(width * 1.03, 0.045, width * 1.03, 0, height * 0.86, 0, 0xe8e6d9, 'pole');
        if (feature.collidable) colliders.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - width / 2,
          maxZ: z + width / 2, minY: y, maxY: y + height, kind: 'surveyed-barrier' });
        break;
      }
      case 'shelter': {
        const length = dimension(feature.length, 3), width = dimension(feature.width, 1.28), roof = dimension(feature.height, 2.35);
        for (const end of [-0.45, 0.45]) {
          part(0.085, roof, 0.085, -width * 0.44, roof / 2, length * end, STEEL);
          part(0.085, roof, 0.085, width * 0.44, roof / 2, length * end, STEEL);
        }
        part(width, 0.16, length, 0, roof - 0.02, 0, 0x457075);
        part(0.03, roof * 0.72, length * 0.90, -width * 0.44, roof * 0.50, 0, 0x78a9a2, 'glass');
        part(0.32, 0.08, length * 0.63, -width * 0.30, 0.48, 0, WOOD);
        if (feature.stopId) stopIds.add(feature.stopId);
        break;
      }
      case 'playEquipment': return playgroundEquipment(feature, part, beam, body);
      case 'playground': {
        const width = dimension(feature.width, 1.25);
        for (const end of [-0.42, 0.42]) part(0.10, 1.8, 0.10, 0, 0.9, width * end, 0x2d8294);
        part(0.12, 0.12, width, 0, 1.75, 0, 0xe0ad38);
        part(0.41, 0.075, 0.36, 0, 0.68, 0, 0xb85841);
        for (const end of [-0.15, 0.15]) part(0.025, 1.02, 0.025, 0, 1.22, end, GALVANIZED);
        break;
      }
      case 'bin': case 'container': {
        const large = feature.type === 'container';
        if (feature.source === 'municipal') {
          const width = dimension(feature.width, large ? 0.65 : 0.43);
          const depth = dimension(feature.length, large ? 0.65 : 0.38);
          const semi = feature.model === 'semi-underground';
          const greenPost = feature.model === 'greenPost';
          const double = feature.model === 'city-split';
          const round = semi || greenPost;
          const below = feature.model === 'underground';
          const bodyColor = large ? (below ? 0x737e83 : semi ? 0x525c5b : feature.model === 'surface' ? 0x65706c : 0x58635f)
            : round ? 0x405e4c : 0x434b4d;
          if (greenPost) {
            part(width * 0.22, height * 0.44, depth * 0.20, 0, height * 0.22, 0, GALVANIZED, 'pole');
            part(width, height * 0.59, depth, 0, height * 0.59, 0, bodyColor, 'round');
          } else if (below) {
            // Only the access column and the flush deck are visible above ground.
            part(width * 1.55, 0.04, depth * 1.55, 0, 0.008, 0, 0x848b88);
            part(width * 0.95, height * 0.7, depth * 0.91, 0, height * 0.35, 0, bodyColor);
          } else {
            part(width * 0.82, 0.045, depth * 0.83, 0, 0.013, 0, 0x515652);
            part(width, height * 0.89, depth, 0, height * 0.445, 0, bodyColor, round ? 'round' : 'box');
          }
          part(width, height * (below ? 0.3 : 0.11), depth, 0, height * (below ? 0.85 : 0.94), 0,
            large ? 0x3c484c : 0x31393a, round ? 'round' : 'box');
          const openingZ = depth * (round ? 0.48 : 0.505);
          const openingY = height * 0.78;
          if (double) {
            for (const side of [-1, 1]) {
              part(width * 0.29, height * 0.105, 0.03, side * width * 0.24, openingY, openingZ, 0x1b2223);
              part(width * 0.13, 0.045, 0.014, side * width * 0.24, height * 0.63, openingZ, 0xddded9);
            }
            part(0.026, height * 0.66, 0.018, 0, height * 0.40, openingZ, 0x4e5555);
            part(width * 0.94, 0.035, depth * 0.61, 0, height * 0.988, 0, 0x404a4c);
          } else {
            part(width * 0.62, height * 0.105, 0.032, 0, openingY, openingZ, 0x1b2223);
          }
          const streams = feature.streams ?? [];
          for (let i = 0; i < Math.min(streams.length, 4); i++) {
            const stream = streams[i];
            if (Object.hasOwn(WASTE_COLORS, stream)) {
              part(width * 0.18, 0.06, 0.012, width * (i * 0.22 - 0.33), height * 0.62, openingZ, WASTE_COLORS[stream]);
            }
          }
          if (feature.collidable) body(width, depth, height);
          break;
        }
        const width = dimension(feature.width, large ? 1.55 : 0.42);
        const length = dimension(feature.length, large ? 1.25 : 0.37);
        part(width, height * 0.89, length, 0, height * 0.445, 0, large ? 0x466052 : 0x515755);
        part(width * 1.05, height * 0.11, length * 1.05, 0, height * 0.94, 0, 0x363f3d);
        break;
      }
      case 'shrub': case 'groundCover': {
        const shrub = feature.type === 'shrub';
        const variant = (Math.round(x * 10) * 23 ^ Math.round(z * 10) * 29) & 15;
        const w = dimension(feature.width, shrub ? 0.75 : 0.55);
        const h = dimension(feature.height, shrub ? 0.6 : 0.24) * (0.85 + variant / 50);
        part(w, h, w * 0.85, 0, h * 0.39, 0, FOLIAGE[variant & 3], shrub ? 'leaf' : 'tuft');
        break;
      }
      case 'hectometre': {
        const width = dimension(feature.width, 0.37), signHeight = 0.18;
        part(0.038, height, 0.038, 0, height / 2, 0, GALVANIZED, 'pole');
        part(width, signHeight, 0.03, 0, height, 0, 0x275e42);
        const uv = atlas?.cells.get(feature.label);
        if (uv) {
          const world = (u, v) => ({ x: x + cos * u + sin * 0.019, z: z - sin * u + cos * 0.019, y: y + height + v });
          const target = batch('sign', x, z, feature.source);
          face(target, [world(-width / 2, -signHeight / 2), world(width / 2, -signHeight / 2),
            world(width / 2, signHeight / 2), world(-width / 2, signHeight / 2)]);
          const [u0, v0, u1, v1] = uv;
          target.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
        }
        break;
      }
      default: return false;
    }
    return true;
  }

  function placeFeature(feature) {
    const success = feature.type === 'playSurface' || feature.type === 'parcelSurface' ? playSurface(feature)
      : feature.type === 'utilityHouse' ? utilityHouse(feature)
      : Object.hasOwn(BARRIERS, feature.type) ? barrier(feature)
      : feature.type === 'gantry' ? gantry(feature)
        : feature.type === 'directionalSign' ? directionalPanel(feature)
          : feature.type === 'drain' || feature.type === 'gutter' ? drainage(feature)
            : feature.type === 'canopy' ? canopy(feature) : buildProp(feature);
    if (!success) {
      stats.unresolved.push({ id: feature.id, type: feature.type });
      return;
    }
    stats[feature.source]++;
    stats.counts[feature.type] = (stats.counts[feature.type] ?? 0) + 1;
  }

  for (const feature of features) {
    if (feature.type === 'directionalSign') directionalPanels.push(feature);
    else placeFeature(feature);
  }
  for (const feature of directionalPanels) placeFeature(feature);

  for (const target of batches.values()) {
    const { kind, source, range } = target;
    const signFace = kind === 'sign' || kind === 'directionalSign';
    let mesh;
    if (target.instances.length) {
      const geometry = shapes[kind];
      mesh = new THREE.InstancedMesh(geometry, kind === 'glass' ? glass : material, target.instances.length);
      target.instances.forEach(([x, y, z, sx, sy, sz, angle, paint], index) => {
        dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz);
        if (typeof angle === 'number') dummy.rotation.set(0, angle, 0);
        else dummy.quaternion.copy(angle);
        dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
        if (kind !== 'glass') mesh.setColorAt(index, color.setHex(paint));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.spatialTile = true;
      stats.instances += mesh.count;
      stats.triangles += (geometry.index?.count ?? geometry.attributes.position.count) * mesh.count / 3;
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(target.positions, 3));
      geometry.setIndex(target.indices);
      if (signFace || kind === 'wireFence') geometry.setAttribute('uv', new THREE.Float32BufferAttribute(target.uv, 2));
      if (!signFace) geometry.setAttribute('color', new THREE.Float32BufferAttribute(target.colors, 3));
      geometry.computeVertexNormals();
      if (kind === 'wireFence') resources.wire ??= new THREE.MeshStandardNodeMaterial({
        map: fenceMeshTexture(), vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, alphaTest: 0.24,
      });
      mesh = new THREE.Mesh(geometry, kind === 'directionalSign' ? directionalSigns : kind === 'sign' ? signs
        : kind === 'wireFence' ? resources.wire : surface);
      stats.triangles += target.indices.length / 3;
    }
    mesh.name = `${source.toUpperCase()} detail ${kind}`;
    mesh.receiveShadow = !signFace && kind !== 'glass';
    mesh.userData.cullDistance = range ?? (kind === 'utilityShell' ? 0 : kind === 'inset' ? 65 : kind === 'tuft' ? 130
      : kind === 'leaf' ? 190 : source === 'utility' ? 320 : source === 'parcel' ? 220 : source === 'bgt' ? 310 : 700);
    const pipeline = pipelines.get(kind);
    if (pipeline) mesh.userData.sharesPipelineWith = pipeline;
    else pipelines.set(kind, mesh);
    group.add(mesh);
  }
  stats.chunks = group.children.length;
  stats.colliders = colliders.length;
  stats.sharedLampSupports = gantryLampMounts.size;
  group.userData.stopIds = [...stopIds];
  for (const gantry of gantries) gantry.panels = portalPanels.get(gantry.id) ?? [];
  scene.add(group);
  return { group, colliders, stopIds, gantryLampMounts, gantries, signSupports, stats, resources };
}

export function streamParcelTiles(scene, tiles, resources, webgpu) {
  if (!tiles?.length || !resources) return null;
  const group = new THREE.Group();
  group.name = 'EdeParcelTiles';
  scene.add(group);
  const residents = new Map(), active = new Map(), decoded = new Map(), failed = new Set();
  const stats = { tiles: tiles.length, resident: 0, placements: 0, visibleBatches: 0, errors: 0 };
  let nextBuild = 0;
  let nextPlan = 0, lastX = Infinity, lastZ = Infinity, nearest = [], wasLow;
  const distanceSquared = (x, z, [west, north, east, south]) =>
    Math.max(west - x, 0, x - east) ** 2 + Math.max(north - z, 0, z - south) ** 2;
  const tileUrl = id => new URL(`../assets/ede-parcel-tiles/${id}.json.gz?v=20261121-map`, import.meta.url);

  function release(id, tile) {
    for (const { mesh } of tile.meshes) {
      if (mesh.isInstancedMesh) mesh.dispose();
      else mesh.geometry.dispose();
    }
    tile.group.removeFromParent();
    residents.delete(id);
    stats.resident--;
    stats.placements -= tile.placements;
  }

  async function request(tile) {
    const controller = new AbortController();
    active.set(tile.id, controller);
    try {
      const asset = await (await readPacked(tileUrl(tile.id), controller.signal)).json();
      if (controller.signal.aborted) return;
      if (asset.version !== 1 || !Array.isArray(asset.features) || asset.features.length !== tile.count ||
          asset.features.some(row => !validParcelFeature(row) || row.level !== 0 || row.collidable ||
            row.type !== 'parcelSurface' && row.status !== 'inferred')) {
        throw new Error('invalid parcel tile');
      }
      decoded.set(tile.id, asset.features.map(row => ({ ...row, source: 'parcel' })));
    } catch (error) {
      if (controller.signal.aborted) return;
      failed.add(tile.id);
      stats.errors++;
      console.warn(`[parcel detail] ${tile.id}: ${error.message}`);
    } finally {
      if (active.get(tile.id) === controller) active.delete(tile.id);
    }
  }

  return {
    stats,
    update(camera, now) {
      const { x, y, z } = camera;
      const low = y - terrainHeightAt(x, z) < 95;
      const shifted = Math.hypot(x - lastX, z - lastZ);
      if (now >= nextPlan || shifted > 32 || low !== wasLow) {
        const distances = tiles.map(tile => [tile, distanceSquared(x, z, tile.bounds)]);
        nearest = low ? distances.filter(([, distance]) => distance < 150 ** 2)
          .sort((a, b) => a[1] - b[1]).slice(0, 16).map(([tile]) => tile) : [];
        const keep = new Set(distances.filter(([, distance]) => low && distance < 255 ** 2).map(([tile]) => tile.id));
        const wanted = new Set(nearest.map(tile => tile.id));
        for (const [id, entry] of residents) if (!keep.has(id)) release(id, entry);
        for (const [id, controller] of active) if (!wanted.has(id)) { controller.abort(); active.delete(id); }
        for (const id of decoded.keys()) if (!wanted.has(id)) decoded.delete(id);
        for (const id of failed) if (!keep.has(id)) failed.delete(id);
        nextPlan = now + 180;
        lastX = x;
        lastZ = z;
        wasLow = low;
      }

      stats.visibleBatches = 0;
      for (const { meshes } of residents.values()) {
        for (const { mesh, centre, reach } of meshes) {
          mesh.visible = low && camera.distanceToSquared(centre) < reach * reach;
          if (mesh.visible) stats.visibleBatches++;
        }
      }

      if (!low) return;
      for (const tile of nearest) {
        if (active.size >= 3 || decoded.size >= 4) break;
        if (!residents.has(tile.id) && !active.has(tile.id) && !decoded.has(tile.id) && !failed.has(tile.id)) void request(tile);
      }
      if (now < nextBuild) return;
      const tile = nearest.find(item => decoded.has(item.id));
      if (!tile) return;
      const result = buildEdeDetail(group, decoded.get(tile.id), { resources, parcelTile: true });
      decoded.delete(tile.id);
      result.group.updateMatrixWorld(true);
      const meshes = result.group.children.map(mesh => {
        if (mesh.isInstancedMesh) {
          if (webgpu) mesh.instanceMatrix = new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array, 16);
          mesh.computeBoundingSphere();
        } else mesh.geometry.computeBoundingSphere();
        const { center, radius } = mesh.boundingSphere ?? mesh.geometry.boundingSphere;
        const reach = (mesh.userData.cullDistance ?? 180) + radius;
        mesh.visible = camera.distanceToSquared(center) < reach * reach;
        return { mesh, centre: center, reach };
      });
      residents.set(tile.id, { group: result.group, meshes, placements: result.stats.parcel });
      stats.resident++;
      stats.placements += result.stats.parcel;
      stats.errors += result.stats.unresolved.length;
      nextBuild = now + 50;
    },
    dispose() {
      for (const controller of active.values()) controller.abort();
      for (const [id, tile] of residents) release(id, tile);
      decoded.clear();
      group.removeFromParent();
    },
  };
}
