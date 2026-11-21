import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv } from 'three/tsl';
import { CivicBatch, civicSigns, makeGroup } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';
import { terrainHeightAt } from './terrain.js';

// BAG plan 0228100000084730, split at the AHN6 roof steps. The south wall lies behind the balconies in the aerial.
const sections = [
  { nap: 32.74, floors: 4, brick: 0x655448, ring: [[-92.87, 2036.43], [-124.3, 2034.31],
    [-125.55, 2051.56], [-93.81, 2054.23]], solar: [[-120.2, -100.9, 2043.1, 2048.3], [-118.7, -110.4, 2037.6, 2040.5]] },
  { nap: 35.76, floors: 5, brick: 0x735f53, ring: [[-61.38, 2041.87], [-75.31, 2037.62],
    [-92.87, 2036.43], [-93.81, 2054.23], [-61.67, 2055.50]],
    solar: [[-89.4, -67.1, 2046.2, 2051.8], [-87.9, -78.8, 2039.8, 2043.0]] },
  { nap: 38.77, floors: 6, brick: 0x55453d, ring: [[-39.66, 2048.49], [-61.38, 2041.87],
    [-61.67, 2055.50], [-53.05, 2055.96], [-52.50, 2056.76], [-39.46, 2059.26]],
    solar: [[-57.6, -46.5, 2048.7, 2054.1], [-46.1, -42.4, 2051.0, 2054.1]] },
  { nap: 35.74, floors: 5, brick: 0x625048, ring: [[-39.46, 2059.26], [-52.50, 2056.76], [-53.05, 2055.96],
    [-61.67, 2055.50], [-61.74, 2058.68], [-55.28, 2059.14], [-53.22, 2063.46], [-39.32, 2065.42]] },
  { nap: 32.68, floors: 4, brick: 0x665448, ring: [[-39.32, 2065.42], [-53.22, 2063.46],
    [-51.15, 2067.81], [-39.27, 2069.03]] },
  { nap: 29.76, floors: 3, brick: 0x665448, ring: [[-39.27, 2069.03], [-51.15, 2067.81],
    [-49.12, 2072.08], [-39.22, 2072.10]] },
  { nap: 27.00, floors: 2, brick: 0x665448, ring: [[-39.22, 2072.10], [-49.12, 2072.08], [-47.41, 2075.71]] },
];
const base = 20.57 - SCENE_NAP_ORIGIN;
const deck = 0xb0a79a, roof = 0x8e8781, graphite = 0x3e3936;
let masonryTexture;

function block(batch, point, x0, x1, lo, hi, inner, outer, tint, sheen = 0) {
  const a = point(x0, lo, outer), b = point(x1, lo, outer);
  const c = point(x1, hi, outer), d = point(x0, hi, outer);
  const e = point(x0, lo, inner), f = point(x1, lo, inner);
  const g = point(x1, hi, inner), h = point(x0, hi, inner);
  batch.quad(a, b, c, d, tint, sheen);
  batch.quad(f, e, h, g, tint, sheen);
  batch.quad(e, a, d, h, tint, sheen);
  batch.quad(b, f, g, c, tint, sheen);
  batch.quad(e, f, b, a, tint, sheen);
  batch.quad(d, c, g, h, tint, sheen);
}

function roofPanels(batch, fields, high) {
  for (const [x0, x1, z0, z1] of fields ?? []) {
    const point = (x, z) => [x, high + 0.15, z + (x - x0) * 0.071];
    const xs = Math.ceil((x1 - x0) / 1.95);
    const zs = Math.ceil((z1 - z0) / 1.05);
    for (let col = 0; col < xs; col++) for (let row = 0; row < zs; row++) {
      const x = x0 + (x1 - x0) * col / xs, z = z0 + (z1 - z0) * row / zs;
      const nextX = x0 + (x1 - x0) * (col + 1) / xs - 0.04, nextZ = z0 + (z1 - z0) * (row + 1) / zs - 0.04;
      batch.quad(point(x, z), point(x, nextZ), point(nextX, nextZ), point(nextX, z), 0x42515b, 0.65);
    }
  }
}

function panel(batch, point, u, v, lo, hi, depth, color, sheen = 0) {
  batch.quad(point(u, lo, depth), point(v, lo, depth), point(v, hi, depth), point(u, hi, depth), color, sheen);
}

function sill(batch, point, u, v, lo, edge, tint) {
  panel(batch, point, u, v, lo - 0.035, lo, edge, tint);
  batch.quad(point(u, lo), point(u, lo, edge), point(v, lo, edge), point(v, lo), tint);
}

function balcony(shell, detail, point, u, v, lo) {
  const edge = 1.16;
  block(shell, point, u, v, lo - 0.20, lo, 0, edge, deck);
  panel(shell, point, u, v, lo + 0.12, lo + 0.99, edge, 0x80949a, 0.43);
  panel(shell, (x, y, d) => point(u + v - x, y, d), u, v, lo + 0.12, lo + 0.99,
    edge - 0.018, 0x80949a, 0.43);
  panel(detail, point, u, v, lo + 0.98, lo + 1.035, edge + 0.012, 0xc4bfaf);
  for (const x of [u + 0.05, (u + v) / 2, v - 0.09]) {
    panel(detail, point, x, x + 0.042, lo + 0.03, lo + 0.98, edge + 0.01, 0xc4bfaf);
  }
}

function facade(shell, detail, labels, a, b, section, groundA, groundB, rail) {
  const [ax, az] = a, [bx, bz] = b;
  const length = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / length, tz = (bz - az) / length;
  const nx = -tz, nz = tx;
  const point = (u, y, d = 0) => [ax + tx * u + nx * d, y, az + tz * u + nz * d];
  const high = section.nap - SCENE_NAP_ORIGIN;
  const wall = [[point(0, groundA), point(length, groundB), point(length, high), point(0, high)]];
  const bayCount = Math.max(1, Math.round(length / (rail ? 3.04 : 2.90)));
  const bay = length / bayCount;
  const broadEnd = section.floors === 6 && nx > 0.80;
  const entrance = nz < -0.55 && length >= 9;
  const groundDoor = entrance || broadEnd ? Math.floor(bayCount / 2) : -1;
  const labelPier = broadEnd && length > 9 ? 1 : 0;
  for (let level = 0; level < section.floors; level++) {
    const floor = base + 3.0 * level;
    for (let column = 0; column < bayCount; column++) {
      const entranceBay = level === 0 && column === groundDoor;
      if (length < 1.35 || (labelPier && column === 0 && level > 1)) continue;
      const projecting = level > 0 && level < section.floors - 1 && bay > 2.3 &&
        (broadEnd ? column > 0 : nz > 0.40 ? column % 2 === 0 : nz < -0.35 && column % 4 === 1);
      const width = Math.min(bay - 0.52, entranceBay ? 2.34 : projecting ? 2.1 : column % 4 === 3 ? 0.99 : 1.52);
      if (width < 0.60) continue;
      const l = (column + 0.5) * bay - width / 2, r = l + width;
      const bottom = floor + (entranceBay ? 0.24 : projecting ? 0.20 : level === 0 ? 0.62 : 0.53);
      const top = Math.min(high - 0.34, floor + 2.69);
      if (top - bottom < 0.84) continue;
      wall.push([point(l, bottom), point(l, top), point(r, top), point(r, bottom)]);
      const depth = entranceBay ? -0.48 : projecting ? -0.26 : -0.19;
      shell.quad(point(l, bottom), point(l, bottom, depth), point(l, top, depth), point(l, top), 0x71625b);
      shell.quad(point(r, bottom, depth), point(r, bottom), point(r, top), point(r, top, depth), 0x71625b);
      shell.quad(point(l, bottom), point(r, bottom), point(r, bottom, depth), point(l, bottom, depth), 0x877b73);
      shell.quad(point(l, top, depth), point(r, top, depth), point(r, top), point(l, top), 0x574e49);
      shell.quad(point(l, bottom, depth), point(r, bottom, depth), point(r, top, depth), point(l, top, depth), graphite);
      const frame = 0.078;
      const glass = column % 3 === 0 ? 0x4d646d : 0x51636e;
      for (const [left, right] of width > 1.42 ? [[l + frame, (l + r) / 2 - frame / 2], [(l + r) / 2 + frame / 2, r - frame]] : [[l + frame, r - frame]]) {
        shell.quad(point(left, bottom + frame, depth + 0.012), point(right, bottom + frame, depth + 0.012),
          point(right, top - frame, depth + 0.012), point(left, top - frame, depth + 0.012), glass, 0.79);
      }
      sill(detail, point, l - 0.075, r + 0.075, bottom, 0.09, 0xa69e94);
      if (projecting) balcony(shell, detail, point, l - 0.06, r + 0.06, floor + 0.05);
      if (entranceBay) {
        const band = broadEnd ? 0.25 : 0.13;
        block(shell, point, l - band, l, bottom - 0.085, top + band, 0, 0.11, 0xdad4c6);
        block(shell, point, r, r + band, bottom - 0.085, top + band, 0, 0.11, 0xdad4c6);
        block(shell, point, l, r, top, top + band, 0, 0.11, 0xdad4c6);
      }
    }
  }
  shell.polygon(wall, section.brick);
  if (labelPier) {
    const [x1, , z1] = point(0.68, base, 0.035), [x2, , z2] = point(1.50, base, 0.035);
    labels.push({ text: 'OP DE KOP', a: { x: x2, z: z2 }, b: { x: x1, z: z1 }, color: '#55453d',
      lo: base + 5.7, hi: high - 0.75, vertical: true });
  }
}

function useMasonry(mesh) {
  const palettes = [...new Set(sections.map(section => section.brick))].map(color => new THREE.Color(color));
  const { position, normal, color } = mesh.geometry.attributes;
  const uvCoord = new Float32Array(position.count * 2), masonry = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    uvCoord[i * 2] = (position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 1.04;
    uvCoord[i * 2 + 1] = position.getY(i) / 0.64;
    masonry[i] = Number(Math.abs(normal.getY(i)) < 0.12 && palettes.some(({ r, g, b }) =>
      Math.abs(color.getX(i) - r) + Math.abs(color.getY(i) - g) + Math.abs(color.getZ(i) - b) < 1e-5));
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvCoord, 2));
  mesh.geometry.setAttribute('railMasonry', new THREE.BufferAttribute(masonry, 1));
  masonryTexture ??= createFacadeSurfaceTexture().texture;
  mesh.material.colorNode = mix(1, texture(masonryTexture, uv()).r.mul(0.45).add(0.54), attribute('railMasonry', 'float'));
}

export function createKopParkweg(_footprints, site) {
  const shell = new CivicBatch(), detail = new CivicBatch(), labels = [], colliders = [];
  const edgeKey = (a, b) => [a.join(','), b.join(',')].sort().join('/');
  const edgeSections = new Map();
  for (const section of sections) {
    const { ring } = section;
    ring.forEach((a, i) => {
      const key = edgeKey(a, ring[(i + 1) % ring.length]);
      if (!edgeSections.has(key)) edgeSections.set(key, []);
      edgeSections.get(key).push(section);
    });
  }
  for (const section of sections) {
    const { ring } = section;
    const high = section.nap - SCENE_NAP_ORIGIN;
    const ground = ring.map(([x, z]) => Math.min(base - 0.14, terrainHeightAt(x, z) - 0.11));
    const outer = ring.map(([x, z]) => ({ x, z }));
    colliders.push({ minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
      minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
      minY: Math.min(...ground), maxY: high, polygon: { outer, holes: [] } });
    shell.polygon([ring.map(([x, z]) => [x, high, z])], roof);
    roofPanels(detail, section.solar, high);
    ring.forEach((a, i) => {
      const j = (i + 1) % ring.length, b = ring[j];
      const key = edgeKey(a, b);
      const adjacent = edgeSections.get(key).find(other => other !== section);
      if (adjacent) {
        if (section.nap <= adjacent.nap) return;
        const low = adjacent.nap - SCENE_NAP_ORIGIN;
        shell.quad([a[0], low, a[1]], [b[0], low, b[1]], [b[0], high, b[1]], [a[0], high, a[1]], section.brick);
        return;
      }
      const rail = b[0] < a[0] && (a[1] + b[1]) / 2 < 2049;
      facade(shell, detail, labels, a, b, section, ground[i], ground[j], rail);
    });
  }
  const group = makeGroup(site.name, shell, colliders);
  useMasonry(group.children[0]);
  const trim = detail.mesh();
  trim.userData.nearDetail = 145;
  trim.castShadow = false;
  group.add(trim);
  const signs = civicSigns(labels);
  if (signs) {
    signs.userData.nearDetail = 95;
    group.add(signs);
  }
  return group;
}
