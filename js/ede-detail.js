import * as THREE from 'three/webgpu';
import { edeBounds, edePolygonGeometry } from './ede-geometry.js';
import { gradeProfileAt, gradeWayAt } from './ede-grade.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const CELL = 180;
const ROAD_REACH = 14;
const NAP_FALLBACK = 22.54;
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

const infrastructure = new Set(['balustrade', 'guardrail', 'gutter', 'drain',
  'canopy', 'landing', 'steps', 'bin', 'container']);

async function readPacked(url) {
  const response = await fetch(url);
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

export async function loadEdeDetail({ bgt = true, motorway = true, directional = motorway, bgtStage = 'all' } = {}) {
  const files = { bgt: 'ede-bgt-detail', '1gis': 'ede-1gis-detail', nbd: 'ede-nbd-signs' };
  const requests = [bgt && 'bgt', motorway && '1gis', directional && 'nbd'].filter(Boolean);
  const assetUrl = (source, extension) => new URL(`../assets/${files[source]}.${extension}`, import.meta.url);
  let nbdTexture;
  const land = bgt && bgtStage === 'all' ? loadLandCover() : null;
  const assets = await Promise.all(requests.map(async source => {
    try {
      const asset = await (await readPacked(assetUrl(source, 'json.gz'))).json();
      if (asset.version !== 1 || !Array.isArray(asset.features)) throw new Error('invalid asset format');
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
  const features = assets.flat();
  return { features: features.filter(f => f.type !== 'marking'), markings: features.filter(f => f.type === 'marking'),
    nbdTexture, landCover: await land };
}

function groundAt(feature, x, z, surveyY, height = 0) {
  const coarse = terrainHeightAt(x, z);
  const kind = feature.level > 0 ? 'bridge' : feature.level < 0 ? 'underpass' : null;
  const explicit = feature.profileId && gradeProfileAt(x, z, undefined, undefined, undefined, feature.profileId, ROAD_REACH);
  if (explicit && explicit.id === feature.profileId && (!kind || explicit.kind === kind)) return explicit.y;
  // A ground-level motorway object can be beside a raised road and keep its own surface.
  const matched = (kind || feature.source === 'bgt') && feature.wayId && gradeWayAt(feature.wayId, x, z, ROAD_REACH);
  if (matched && (!kind || matched.span.profile.site?.kind === kind)) return matched.y;
  if (Number.isFinite(surveyY)) return surveyY - (getTerrain()?.napOrigin ?? NAP_FALLBACK) - height;
  if (feature.source !== 'bgt') return kind ? undefined : coarse;
  const local = gradeProfileAt(x, z, 'foot', undefined, coarse);
  if (local && (local.kind === 'platform' && !(feature.level < 0) || local.kind === 'surface' && !kind)) return local.y;
  return kind ? undefined : coarse;
}

const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const validLine = points => Array.isArray(points) && points.length >= 2 && points.every(validPoint);
const dimension = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const facePattern = [0, 1, 2, 0, 2, 3];

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

export function buildEdeDetail(scene, features = [], { deckProfiles, mappedLamps = [], nbdTexture } = {}) {
  const group = new THREE.Group();
  group.name = 'EdeImportedDetail';
  const batches = new Map(), stopIds = new Set(), gantryLampMounts = new Map(), colliders = [];
  const gantries = [], portalPanels = new Map();
  const stats = { bgt: 0, '1gis': 0, nbd: 0, counts: {}, unresolved: [], instances: 0, chunks: 0, triangles: 0, colliders: 0, sharedLampSupports: 0 };
  group.userData.stats = stats;
  group.userData.stopIds = [];
  scene.add(group);
  if (!features.length) return { group, colliders, stopIds, gantryLampMounts, gantries, stats };
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.83 });
  const surface = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, vertexColors: true, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x78a9a2, roughness: 0.32, transparent: true, opacity: 0.42, depthWrite: false });
  const atlas = buildMarkerAtlas([...new Set(features.filter(f => f.type === 'hectometre' && typeof f.label === 'string' && f.label.length).map(f => f.label))]);
  const signs = atlas && new THREE.MeshBasicNodeMaterial({ map: atlas.texture });
  const directionalSigns = nbdTexture && new THREE.MeshBasicNodeMaterial({ map: nbdTexture });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const leaf = new THREE.IcosahedronGeometry(0.5, 1);
  const leafPosition = leaf.getAttribute('position');
  for (let i = 0; i < leafPosition.count; i++) {
    const x = leafPosition.getX(i), y = leafPosition.getY(i), z = leafPosition.getZ(i);
    const ripple = 1 + 0.11 * Math.sin(x * 16 + y * 25) * Math.cos(z * 21);
    leafPosition.setXYZ(i, x * ripple, y * ripple, z * ripple);
  }
  const shapes = { box, glass: box, pole: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    leaf, tuft: new THREE.IcosahedronGeometry(0.5) };
  const color = new THREE.Color(), dummy = new THREE.Object3D();
  const pipelines = new Map();

  function resolveGround(feature, x, z, surveyY, height) {
    const deck = feature.surfaceId && deckProfiles?.get(feature.surfaceId);
    return deck?.(x, z) ?? groundAt(feature, x, z, surveyY, height);
  }

  function batch(kind, x, z, source) {
    const cell = kind === 'inset' ? 90 : CELL;
    const key = `${kind}/${source}/${Math.floor(x / cell)}/${Math.floor(z / cell)}`;
    if (!batches.has(key)) batches.set(key, { kind, source, instances: [], positions: [], indices: [], colors: [], uv: [] });
    return batches.get(key);
  }

  function instance(source, kind, x, y, z, sx, sy, sz, angle, paint) {
    batch(kind, x, z, source).instances.push([x, y, z, sx, sy, sz, angle, paint]);
  }

  function quad(target, points, paint) {
    const base = target.positions.length / 3;
    for (const p of points) target.positions.push(p.x, p.y, p.z);
    for (const index of facePattern) target.indices.push(base + index);
    if (paint !== undefined) {
      color.setHex(paint);
      for (let i = 0; i < 4; i++) target.colors.push(color.r, color.g, color.b);
    }
  }

  function directionalPanel(feature) {
    if (!directionalSigns || !validPoint(feature.position) || !Number.isFinite(feature.centerY) ||
        !Number.isFinite(feature.angle) || !feature.uv || feature.uv.length !== 4 || !feature.uv.every(Number.isFinite) ||
        !(feature.width > 0 && feature.height > 0)) return false;
    const [x, z] = feature.position;
    const { angle, width, height } = feature;
    const y = feature.centerY - (getTerrain()?.napOrigin ?? NAP_FALLBACK);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    if (feature.support) {
      const base = resolveGround(feature, x, z, feature.surveyY);
      const poleHeight = y - base - height * 0.25;
      if (!(poleHeight > 0.5)) return false;
      for (const offset of width > 2.5 ? [-width * 0.31, width * 0.31] : [0]) {
        instance(feature.source, 'pole', x + cos * offset, base + poleHeight / 2, z - sin * offset,
          0.12, poleHeight, 0.12, angle, GALVANIZED);
      }
    }
    const backing = 0.095;
    instance(feature.source, 'box', x, y, z, width, height, backing, angle, STEEL);
    const corner = (u, v) => ({ x: x + cos * u + sin * 0.05, z: z - sin * u + cos * 0.05, y: y + v });
    const tile = batch('directionalSign', x, z, feature.source);
    quad(tile, [corner(-width / 2, -height / 2), corner(width / 2, -height / 2),
      corner(width / 2, height / 2), corner(-width / 2, height / 2)]);
    const [u0, v0, u1, v1] = feature.uv;
    tile.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    if (feature.mountId) {
      if (!portalPanels.has(feature.mountId)) portalPanels.set(feature.mountId, []);
      portalPanels.get(feature.mountId).push({ x, y, z, angle, width, height });
    }
    if (validPoint(feature.bracket)) {
      const [bx, bz] = feature.bracket;
      const joint = { x: bx, y: Number.isFinite(feature.bracketY) ? y + feature.bracketY - feature.centerY : y, z: bz };
      const back = { x: x - sin * backing / 2, y, z: z - cos * backing / 2 };
      if (Math.hypot(back.x - bx, back.z - bz) > 0.1) {
        const [a, b] = strokeEdges([back, joint], 0.07);
        stripe(feature.source, a, b, -0.06, 0.06, GALVANIZED, true);
      }
    }
    return true;
  }

  const at = (p, offset) => ({ ...p, y: p.y + offset });

  function stripe(source, a, b, low, high, paint, { caps = false, taper = 0, kind = 'solid' } = {}) {
    const target = batch(kind, (a[0].x + b[0].x) / 2, (a[0].z + b[0].z) / 2, source);
    const [al, ar] = a, [bl, br] = b;
    const crown = (p, other) => ({ x: lerp(p.x, other.x, taper), y: p.y + high, z: lerp(p.z, other.z, taper) });
    const l0 = at(al, low), r0 = at(ar, low), l1 = crown(al, ar), r1 = crown(ar, al);
    const m0 = at(bl, low), n0 = at(br, low), m1 = crown(bl, br), n1 = crown(br, bl);
    quad(target, [l1, m1, n1, r1], paint);
    quad(target, [l0, m0, m1, l1], paint);
    quad(target, [r0, r1, n1, n0], paint);
    if (caps) {
      quad(target, [l0, l1, r1, r0], paint);
      quad(target, [m0, n0, n1, m1], paint);
      quad(target, [l0, r0, n0, m0], paint);
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
    const solidRail = feature.solid;
    const rail = feature.type === 'guardrail' && !solidRail;
    const fence = feature.type === 'fence' || feature.type === 'balustrade';
    const width = dimension(feature.width, solidRail ? 0.45 : spec.width), height = dimension(feature.height, spec.height);
    const paint = solidRail ? 0x9a9a94 : spec.color;
    const crossSection = feature.type === 'waterEdge' ? { taper: 0.36 } : undefined;
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
    let nextPost = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], size = Math.hypot(b.x - a.x, b.z - a.z);
      stripe(feature.source, edges[i - 1], edges[i], rail ? Math.max(0, height - 0.29) : fence ? height - 0.06 : -0.025, height, paint, crossSection);
      if (fence) stripe(feature.source, edges[i - 1], edges[i], height * 0.42, height * 0.42 + 0.045, paint);
      if (feature.collidable) lineCollider(a, b, width, height);
      if (!spec.spacing || solidRail) continue;
      for (; nextPost < size; nextPost += spec.spacing) {
        const t = nextPost / size, thickness = rail ? 0.12 : 0.075;
        instance(feature.source, 'box', lerp(a.x, b.x, t), lerp(a.y, b.y, t) + height / 2, lerp(a.z, b.z, t),
          thickness, height, thickness, Math.atan2(b.x - a.x, b.z - a.z), paint);
      }
      nextPost -= size;
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
      quad(target, [at(a, baseHeight), at(b, baseHeight), at(b, height), at(a, height)], paint);
    }
    const levels = outer.map(p => p.y);
    if (feature.collidable) {
      colliders.push({ ...edeBounds(outer), minY: Math.min(...levels), maxY: Math.max(...levels) + height,
        polygon: { outer, holes }, kind: 'surveyed-barrier', minYAt: ground, maxYAt: (x, z) => ground(x, z) + height });
    }
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
    const nap = getTerrain()?.napOrigin ?? NAP_FALLBACK;
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

  function gantry(feature) {
    if (!validLine(feature.points)) return false;
    const endpoints = [feature.points[0], feature.points.at(-1)];
    const points = endpoints.map(([x, z]) => ({ x, z, y: resolveGround(feature, x, z, feature.surveyY) }));
    if (points.some(p => !Number.isFinite(p.y)) || Math.hypot(points[1].x - points[0].x, points[1].z - points[0].z) < 2) return false;
    const top = Math.max(...points.map(p => p.y));
    const beam = Number.isFinite(feature.beamY) ? feature.beamY - (getTerrain()?.napOrigin ?? NAP_FALLBACK) : top + 6.1;
    if (beam < top + 3.4) return false;
    for (const p of feature.half ? points.slice(0, 1) : points) {
      const height = beam - p.y;
      instance(feature.source, 'box', p.x, p.y + height / 2, p.z, 0.32, height, 0.32, 0, GALVANIZED);
      let attached = null, nearest = 0.30 ** 2;
      for (const lamp of mappedLamps) {
        const dx = lamp.x - p.x;
        if (Math.abs(dx) > 0.30 || (lamp.layer ?? 0) !== (feature.level ?? 0)) continue;
        const distance = dx * dx + (lamp.z - p.z) ** 2;
        if (distance >= nearest || gantryLampMounts.has(lamp) || Math.abs((lamp.baseY ?? terrainHeightAt(lamp.x, lamp.z)) - p.y) > 0.4) continue;
        attached = lamp;
        nearest = distance;
      }
      if (attached) gantryLampMounts.set(attached, { x: p.x, z: p.z, top: beam + 0.18 });
    }
    const [start, end] = points;
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    gantries.push({ id: feature.id, x: start.x, z: start.z, beam, level: feature.level ?? 0, length,
      ux: (end.x - start.x) / length, uz: (end.z - start.z) / length });
    const [a, b] = strokeEdges(points.map(p => ({ ...p, y: beam })), 0.20);
    stripe(feature.source, a, b, -0.18, 0.18, GALVANIZED, { caps: true });
    return true;
  }

  function buildProp(feature) {
    if (!validPoint(feature.position)) return false;
    const [x, z] = feature.position;
    const height = dimension(feature.height, 0.85);
    const y = resolveGround(feature, x, z, feature.surveyY ?? feature.topY, feature.surveyY == null ? height : 0);
    if (!Number.isFinite(y)) return false;
    const angle = Number.isFinite(feature.angle) ? feature.angle : 0;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const part = (sx, sy, sz, dx, dy, dz, paint, shape = 'box') => {
      instance(feature.source, shape, x + cos * dx + sin * dz, y + dy, z - sin * dx + cos * dz,
        sx, sy, sz, angle, paint);
    };
    switch (feature.type) {
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
          quad(target, [world(-width / 2, -signHeight / 2), world(width / 2, -signHeight / 2),
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

  for (const feature of features) {
    const success = Object.hasOwn(BARRIERS, feature.type) ? barrier(feature)
      : feature.type === 'gantry' ? gantry(feature)
        : feature.type === 'directionalSign' ? directionalPanel(feature)
          : feature.type === 'drain' || feature.type === 'gutter' ? drainage(feature)
            : feature.type === 'canopy' ? canopy(feature) : buildProp(feature);
    if (!success) {
      stats.unresolved.push({ id: feature.id, type: feature.type });
      continue;
    }
    stats[feature.source]++;
    stats.counts[feature.type] = (stats.counts[feature.type] ?? 0) + 1;
  }

  for (const target of batches.values()) {
    const { kind, source } = target;
    const signFace = kind === 'sign' || kind === 'directionalSign';
    let mesh;
    if (target.instances.length) {
      const geometry = shapes[kind];
      mesh = new THREE.InstancedMesh(geometry, kind === 'glass' ? glass : material, target.instances.length);
      target.instances.forEach(([x, y, z, sx, sy, sz, angle, paint], index) => {
        dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.y = angle;
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
      if (signFace) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(target.uv, 2));
      else geometry.setAttribute('color', new THREE.Float32BufferAttribute(target.colors, 3));
      geometry.computeVertexNormals();
      mesh = new THREE.Mesh(geometry, kind === 'directionalSign' ? directionalSigns : kind === 'sign' ? signs : surface);
      stats.triangles += target.indices.length / 3;
    }
    mesh.name = `${source.toUpperCase()} detail ${kind}`;
    mesh.receiveShadow = !signFace && kind !== 'glass';
    mesh.userData.cullDistance = kind === 'inset' ? 65 : kind === 'tuft' ? 130
      : kind === 'leaf' ? 190 : source === 'bgt' ? 310 : 700;
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
  return { group, colliders, stopIds, gantryLampMounts, gantries, stats };
}
