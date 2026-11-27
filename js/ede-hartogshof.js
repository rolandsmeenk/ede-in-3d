import { attribute, mix, normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { CivicBatch, facePanel, faceWindow, makeGroup, wallColliders, addLandmarkLod } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { HARTOGSHOF_COS, HARTOGSHOF_FOOTPRINTS, HARTOGSHOF_SIN, HARTOGSHOF_WINGS, hartogshofPoint } from './ede-hartogshof-survey.js';
import { terrainHeightAt } from './terrain.js';

const STOREY = 3.04;
const GROUND_FLOOR = 0.30;
const COURT_DECK = 2.68;
const GLAZING = [0x495a60, 0x53636a, 0x566663, 0x4d6065];
const FRAME = 0x484844;
const PAVING = 0xa59783;
const PLANTING = 0x7e864d;
const GRAVEL = 0xa49f8c;
let masonryTexture;

const at = (u, v, y) => {
  const { x, z } = hartogshofPoint(u, v);
  return [x, y, z];
};
const grade = (u, v) => {
  const { x, z } = hartogshofPoint(u, v);
  return terrainHeightAt(x, z);
};
const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
const worldRing = ring => ring.map(([u, v]) => hartogshofPoint(u, v));

function horizontal(batch, ring, y, color) {
  batch.polygon([[...ring].reverse().map(([u, v]) => at(u, v, y))], color);
}

function solid(batch, ring, low, high, color) {
  horizontal(batch, ring, high, color);
  for (let i = 0; i < ring.length; i++) {
    const [u, v] = ring[i], [x, z] = ring[(i + 1) % ring.length];
    batch.quad(at(u, v, low), at(u, v, high), at(x, z, high), at(x, z, low), color);
  }
}

function envelope(polygon, minY, maxY) {
  const { outer } = polygon;
  return { minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY, maxY, polygon };
}

function wallBatch(shell, trim, a, b, width, normal, from, top, y0, levels, style, brick, court) {
  const panel = (lo, hi, low, high, color, depth = 0, sheen = 0) =>
    facePanel(shell, a, b, normal, lo / width, hi / width, low, high, color, depth, sheen);
  const point = (u, y, depth = 0) => [
    a.x + (b.x - a.x) * u / width + normal.x * depth, y,
    a.z + (b.z - a.z) * u / width + normal.z * depth,
  ];
  shell.quad(point(0, from[0]), point(0, y0), point(width, y0), point(width, from[1]), brick);
  panel(0, width, y0 + levels * STOREY, top, brick);
  if (width < 1.7) {
    panel(0, width, y0, y0 + levels * STOREY, brick);
    return;
  }
  const count = Math.max(1, Math.round(width / (style === 'villas' ? 4.65 : style === 'penthouse' ? 2.7 : 3.72)));
  const bay = width / count;
  for (let row = 0; row < levels; row++) {
    const bottom = y0 + row * STOREY, ceiling = bottom + STOREY;
    for (let i = 0; i < count; i++) {
      const lo = bay * i, hi = lo + bay;
      const loggia = row > 0 && (style === 'gallery' || style === 'station' && i % 3 === 0 ||
        style === 'corner' && (i === 0 || i === count - 1) || style === 'park' && i % 4 === 2);
      const entrance = row === 0 && (style === 'station' || style === 'park') && count >= 3 && i === Math.floor(count / 2);
      const inset = loggia ? 0.82 : entrance ? 0.54 : 0;
      const margin = Math.max(0.16, Math.min(bay * 0.15, loggia ? 0.42 : 0.56));
      const s = lo + margin, e = hi - margin;
      const sill = bottom + (entrance ? 0.04 : loggia ? 0.19 : row === 0 && style === 'villas' ? 0.25 : court && row === 0 ? 0.35 : 0.64);
      const head = ceiling - (loggia || entrance ? 0.22 : 0.31);
      if (inset) {
        panel(lo, hi, bottom, sill, brick);
        panel(lo, hi, head, ceiling, brick);
        panel(lo, s, sill, head, brick);
        panel(e, hi, sill, head, brick);
        shell.quad(point(s, sill), point(s, sill, -inset), point(e, sill, -inset), point(e, sill), 0x8d8679);
        shell.quad(point(e, head), point(e, head, -inset), point(s, head, -inset), point(s, head), 0x6c6255);
        shell.quad(point(s, head), point(s, head, -inset), point(s, sill, -inset), point(s, sill), 0x7e705f);
        shell.quad(point(e, sill), point(e, sill, -inset), point(e, head, -inset), point(e, head), 0x706455);
      } else {
        panel(lo, hi, bottom, ceiling, brick);
      }
      const glazingPlane = inset ? -inset : 0.024;
      faceWindow(shell, a, b, normal, s / width, e / width, sill, head, {
        color: GLAZING[(i + row * 3) % GLAZING.length], frame: FRAME,
        columns: 2, border: [0.055, 0.055], mullions: [0.058, 0], sheen: 0.78,
      }, glazingPlane + 0.015);
      if (loggia) {
        panel(s, e, sill + 0.12, sill + 0.92, 0x6f7c76, -0.06, 0.53);
        panel(s, e, sill + 0.91, sill + 0.96, FRAME, -0.05);
      }
    }
  }
  if (style === 'penthouse') {
    for (let t = 0.22; t + 0.08 < width; t += 0.48) {
      facePanel(trim, a, b, normal, t / width, (t + 0.08) / width, y0, top - 0.07, 0x6e604f, 0.025);
    }
  }
}

function wing(shell, trim, silhouette, part, outline, base, levels, style, green = false) {
  const top = base + levels * STOREY + 0.29;
  const roof = green ? 0x818453 : GRAVEL;
  horizontal(shell, outline, top, roof);
  horizontal(silhouette, outline, top, roof);
  const xs = outline.map(p => p[0]), zs = outline.map(p => p[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  for (let i = 0; i < outline.length; i++) {
    const uv = outline[i], end = outline[(i + 1) % outline.length];
    const a = hartogshofPoint(...uv), b = hartogshofPoint(...end);
    const width = Math.hypot(b.x - a.x, b.z - a.z);
    const normal = { x: (b.z - a.z) / width, z: (a.x - b.x) / width };
    const [u, v] = uv, [p, q] = end;
    const interior = (u + p) / 2 > 14.9 && (u + p) / 2 < 87 && (v + q) / 2 > 13.5 && (v + q) / 2 < 61.3;
    const lower = style === 'penthouse' ? [base - 0.29, base - 0.29] :
      [Math.min(base, grade(u, v) - 0.20), Math.min(base, grade(p, q) - 0.20)];
    wallBatch(shell, trim, a, b, width, normal, lower, top, base, levels, style, part.wall, interior);
    silhouette.quad(at(u, v, lower[0]), at(u, v, top), at(p, q, top), at(p, q, lower[1]), part.wall);
    if (width >= 1.7) for (let row = 0; row < levels; row++) {
      const floor = base + row * STOREY;
      facePanel(silhouette, a, b, normal, 0.05, 0.95, floor + 0.7, floor + 2.6, GLAZING[row % GLAZING.length]);
    }
    facePanel(shell, a, b, normal, 0, 1, top - 0.07, top + 0.07, 0x665f53, 0.012);
  }
  if (style === 'penthouse' || style === 'station') {
    solid(trim, rect(centerX - 1.7, centerZ - 0.75, centerX + 1.7, centerZ + 0.75), top, top + 0.58, 0x938d78);
  }
  if (part.solar) {
    for (let u = Math.min(...xs) + 1.6; u + 2.0 < Math.max(...xs) - 0.3; u += 2.5) {
      for (let v = Math.min(...zs) + 1.7; v + 1.1 < Math.max(...zs) - 0.4; v += 2.0) {
        horizontal(trim, rect(u, v, u + 1.96, v + 1.06), top + 0.09, 0x424b55);
      }
    }
  }
  return top + 0.07;
}

function court(shell, trim, silhouette, colliders, platforms) {
  const deck = [[14.95, 14.8], [87.0, 14.8], [87.0, 25.25], [25.1, 25.25], [25.1, 61.25], [14.95, 61.25]];
  const garden = worldRing(deck);
  solid(shell, deck, COURT_DECK - 0.38, COURT_DECK, PAVING);
  solid(silhouette, deck, COURT_DECK - 0.38, COURT_DECK, PAVING);
  platforms.push({ id: 'hartogshof-garden', outer: garden, holes: [], height: () => COURT_DECK });
  horizontal(shell, rect(25.7, 15.65, 85.5, 23.55), COURT_DECK + 0.035, PLANTING);
  for (let u = 34; u <= 82; u += 12) {
    horizontal(trim, rect(u, 17.3, u + 2.4, 21.8), COURT_DECK + 0.062, PAVING);
  }
  for (let v = 17.5; v < 59; v += 7.2) {
    horizontal(shell, rect(16.2, v, 22.0, v + 5.85), COURT_DECK + 0.035, PLANTING);
  }
  // The lawn sits on a deck above the visible parking bays. Keep the centre and the east entrance open.
  for (const [[u0, v0], [u1, v1]] of [[[25.1, 25.25], [87.0, 25.25]], [[25.1, 61.25], [25.1, 25.25]]]) {
    const dx = u1 - u0, dz = v1 - v0, length = Math.hypot(dx, dz), n = Math.floor(length / 3.3);
    const a = hartogshofPoint(u0, v0), b = hartogshofPoint(u1, v1);
    const edge = { x: (b.z - a.z) / length, z: (a.x - b.x) / length };
    facePanel(shell, a, b, edge, 0, 1, COURT_DECK - 0.04, COURT_DECK + 0.96, 0x93826c, 0.035);
    for (let i = 1; i < n; i++) {
      const u = u0 + dx * i / n, v = v0 + dz * i / n;
      solid(shell, rect(u - 0.16, v - 0.16, u + 0.16, v + 0.16), grade(u, v) - 0.12, COURT_DECK - 0.38, 0x989188);
    }
    colliders.push(...wallColliders(a, b, COURT_DECK, COURT_DECK + 0.96, 0.13));
  }

  const start = 0.8, end = 15.2, entrance = -2.8, left = 28.3, right = 32.55;
  const base = Math.max(grade(left, start), grade(right, start)) + 0.03;
  const rampLeft = grade(left, entrance) + 0.03, rampRight = grade(right, entrance) + 0.03;
  shell.quad(at(left, entrance, rampLeft), at(left, start, base), at(right, start, base),
    at(right, entrance, rampRight), PAVING);
  const climbs = Math.max(1, Math.ceil((COURT_DECK - base) / 0.17));
  const footstep = (end - start) / climbs;
  const rise = (COURT_DECK - base) / climbs;
  for (let i = 0; i < climbs; i++) {
    const v = start + i * footstep;
    const y = base + (i + 1) * rise;
    solid(shell, rect(left, v, right, v + footstep), y - rise - 0.09, y, i % 2 ? PAVING : 0xada092);
  }
  const stairOrigin = hartogshofPoint(0, 0);
  platforms.push({
    id: 'hartogshof-steps', outer: worldRing(rect(left, entrance, right, end)), holes: [],
    height(x, z) {
      const dx = x - stairOrigin.x, dz = z - stairOrigin.z;
      const v = -dx * HARTOGSHOF_SIN + dz * HARTOGSHOF_COS;
      if (v < start) {
        // Match the diagonal of the ramp quad so the support surface meets both sidewalk edges.
        const u = dx * HARTOGSHOF_COS + dz * HARTOGSHOF_SIN;
        const s = (u - left) / (right - left), t = (v - entrance) / (start - entrance);
        return t >= s ? rampLeft * (1 - t) + base * t : rampLeft * (1 - s) + rampRight * (s - t) + base * t;
      }
      return base + Math.min(climbs, Math.max(1, Math.floor((v - start) / footstep) + 1)) * rise;
    },
  });

  const parkingSurface = (batch, shape, color, lift) =>
    batch.polygon([[...shape].reverse().map(([u, v]) => at(u, v, grade(u, v) + lift))], color);
  for (let u = 25.15; u < 87; u += 4.5) {
    for (let v = 25.3; v < 61.2; v += 4.5) {
      const shape = rect(u, v, Math.min(87, u + 4.5), Math.min(61.2, v + 4.5));
      const color = v > 33 && v < 49 ? 0x999a94 : 0x898980;
      parkingSurface(shell, shape, color, 0.105);
    }
  }
  for (const [v0, v1] of [[26.7, 31.35], [39.25, 44.1], [55.8, 60.25]]) {
    for (let i = 0; i <= 20; i++) {
      const u = 29.1 + i * 2.56;
      parkingSurface(trim, rect(u, v0, u + 0.075, v1), 0xc3beb4, 0.16);
    }
  }
}

export function createHartogshof(footprints = HARTOGSHOF_FOOTPRINTS) {
  const shell = new CivicBatch(), trim = new CivicBatch(), silhouette = new CivicBatch();
  const colliders = [], platforms = [];
  for (const [i, part] of HARTOGSHOF_WINGS.entries()) {
    const top = wing(shell, trim, silhouette, part, part.outline, GROUND_FLOOR, part.levels, part.style, part.green);
    let high = top;
    if (part.setback) {
      const base = GROUND_FLOOR + part.levels * STOREY + 0.29;
      high = wing(shell, trim, silhouette, { wall: part.wall }, part.setback, base, 1, 'penthouse');
    }
    const polygon = footprints[i];
    colliders.push(envelope(polygon, Math.min(GROUND_FLOOR, ...polygon.outer.map(p => terrainHeightAt(p.x, p.z))) - 0.22, top));
    if (part.setback) colliders.push(envelope({ outer: worldRing(part.setback), holes: [] }, top - 0.07, high));
  }
  court(shell, trim, silhouette, colliders, platforms);
  const group = makeGroup('’t Hartogshof', shell, colliders);
  group.userData.platforms = platforms;

  masonryTexture ??= createFacadeSurfaceTexture().texture;
  const alongWall = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
  const brick = texture(masonryTexture, vec2(alongWall.div(1.04), positionWorld.y.div(0.64))).r;
  const masonry = normalWorld.y.abs().lessThan(0.25).and(attribute('civicGloss', 'float').lessThan(0.1));
  const material = group.children[0].material;
  const tint = material.colorNode;
  material.colorNode = (tint ? tint.mul(tint) : vertexColor()).mul(mix(1, brick.mul(0.22).add(0.80), masonry.toFloat()));

  const details = trim.mesh();
  details.castShadow = false;
  details.userData.nearDetail = 160;
  group.add(details);
  return addLandmarkLod(group, silhouette, 225);
}
