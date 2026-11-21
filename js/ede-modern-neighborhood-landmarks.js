import * as THREE from 'three/webgpu';
import { CivicBatch, civicSigns, facePanel, makeGroup, polygonNormal, wallColliders } from './ede-civic-landmarks.js';
import { getTerrain, terrainHeightAt } from './terrain.js';
import { MHC_FOOTPRINT, PARK_VILLAS } from './ede-modern-neighborhood-survey.js';

const concrete = 0xe1dfd6;
const glazing = [0x344950, 0x435a63, 0x4a6067];
const bronze = 0x403c37;
const wood = [0x9b6e49, 0xa57c55, 0x906440];
const groundAt = (x, z, fallback) => getTerrain() ? terrainHeightAt(x, z) : fallback;
const at = ([x, z], y) => [x, y, z];
const asPoint = ([x, z]) => ({ x, z });
const lerp = (a, b, t) => a + (b - a) * t;
const edgeLength = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const interpolate = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

function horizontal(batch, outline, y, color, underside = false) {
  const points = outline.map(point => at(point, y));
  if ((polygonNormal(points).y < 0) !== underside) points.reverse();
  batch.polygon([points], color);
}

function edges(outline) {
  const clockwiseFromAbove = polygonNormal(outline.map(point => at(point, 0))).y < 0;
  return outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const length = edgeLength(a, b);
    const side = clockwiseFromAbove ? 1 : -1;
    return { a, b, length, normal: { x: (b[1] - a[1]) * side / length, z: (a[0] - b[0]) * side / length } };
  }).filter(edge => edge.length > 0.025);
}

function panel(batch, { a, b, normal }, u, v, bottom, top, color, offset = 0, gloss = 0) {
  if (v <= u || top <= bottom) return;
  facePanel(batch, asPoint(a), asPoint(b), normal, u, v, bottom, top, color, offset, gloss);
}

function rod(batch, from, to, radius, color, sides = 5) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const axis = b.clone().sub(a), length = axis.length();
  if (length < 0.015) return;
  const geometry = new THREE.CylinderGeometry(radius, radius, length, sides, 1, true)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
  const middle = a.lerp(b, 0.5);
  batch.solid(geometry.translate(middle.x, middle.y, middle.z), color);
}

function footprintCollider(ring, ground, top) {
  return {
    minX: Math.min(...ring.map(([x]) => x)), maxX: Math.max(...ring.map(([x]) => x)),
    minZ: Math.min(...ring.map(([, z]) => z)), maxZ: Math.max(...ring.map(([, z]) => z)),
    minY: ground, maxY: top, polygon: { outer: ring.map(asPoint), holes: [] },
  };
}

function solarCell(batch, point, u, v, width, depth, color) {
  const plane = (x0, x1, z0, z1, offset, tint) => {
    const points = [point(x0, z0, offset), point(x0, z1, offset), point(x1, z1, offset), point(x1, z0, offset)];
    if (polygonNormal(points).y < 0) points.reverse();
    batch.quad(...points, tint, 0.78);
  };
  plane(u, u + width, v, v + depth, 0.025, 0x646b6b);
  plane(u + 0.028, u + width - 0.028, v + 0.026, v + depth - 0.026, 0.032, color);
}

function terraceTier(villa) {
  const [ax, az, bx, bz] = villa.setback;
  const distance = ([x, z]) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
  const clipped = [];
  for (const [i, a] of villa.footprint.entries()) {
    const b = villa.footprint[(i + 1) % villa.footprint.length];
    const from = distance(a), to = distance(b);
    if (from <= 0) clipped.push(a);
    if ((from < 0) !== (to < 0)) clipped.push(interpolate(a, b, from / (from - to)));
  }
  return clipped;
}

function deck(batch, outline, y, bottomColor = 0xa57d61, faceColor = concrete, topColor = 0xa8a093) {
  horizontal(batch, outline, y, topColor);
  horizontal(batch, outline, y - 0.39, bottomColor, true);
  for (const edge of edges(outline)) panel(batch, edge, 0, 1, y - 0.39, y, faceColor);
}

function insetFromCorner([x, z], villa) {
  const distance = Math.min(...villa.terraceCorners.map(point => edgeLength([x, z], point)));
  const [cx, cz] = villa.center, length = Math.hypot(cx - x, cz - z);
  const setBack = Math.min(length * 0.6, 0.18 + Math.max(0, 1 - distance / 8.8) * 2.24);
  return [x + (cx - x) * setBack / length, z + (cz - z) * setBack / length];
}

function apartmentWall(batch, details, outline, villa, bottom, top, level) {
  for (const edge of edges(outline)) {
    const { length, a, b } = edge;
    const nearTerrace = villa.terraceCorners.some(corner => edgeLength(interpolate(a, b, 0.5), corner) < 7.5);
    panel(batch, edge, 0, 1, bottom, top, [0xaaa596, 0xb6ad9b, 0xbab09d][level % 3]);
    if (length < 0.25) continue;
    if (nearTerrace) {
      panel(details, edge, 0, 1, bottom + 0.07, top - 0.085, bronze, 0.032);
      panel(details, edge, 0.015, 0.985, bottom + 0.12, top - 0.14, glazing[level % 3], 0.04, 0.62);
      continue;
    }
    const bays = Math.max(1, Math.round(length / 3.30));
    for (let i = 0; i < bays; i++) {
      const left = (i + 0.10 + (i % 2) * 0.13) / bays, right = (i + 0.81) / bays;
      panel(details, edge, left, right, bottom + 0.08, top - 0.09, bronze, 0.035);
      panel(details, edge, left + 0.018, right - 0.018, bottom + 0.13, top - 0.15,
        glazing[(level + i) % 3], 0.043, 0.67);
      const centre = (left + right) / 2;
      if (length / bays > 1.25) {
        panel(details, edge, centre - 0.027 / length, centre + 0.027 / length, bottom + 0.08, top - 0.09, bronze, 0.052);
      }
      if (length / bays > 2.3 && (i + level) % 3 !== 2) {
        for (let j = 0; j < 3; j++) {
          const p = left + (j * 0.096 + 0.037) / length;
          panel(details, edge, p, p + 0.039 / length, bottom + 0.07, top - 0.06, wood[j], 0.073);
        }
      }
    }
  }
}

function balcony(details, balustrade, outline, villa, bottom, top, upperTier) {
  for (const edge of edges(outline)) {
    const { a, b, length, normal } = edge;
    const recess = edgeLength(a, insetFromCorner(a, villa));
    const glassHeight = 0.96;
    if (upperTier || recess > 0.52 || edgeLength(b, insetFromCorner(b, villa)) > 0.52) {
      const high = bottom + glassHeight;
      const left = interpolate(a, b, 0.012), right = interpolate(a, b, 0.988);
      panel(balustrade, edge, 0, 1, bottom + 0.055, high - 0.022, 0x8fadb4, -0.065);
      const railPoint = ([x, z]) => [x - normal.x * 0.065, high, z - normal.z * 0.065];
      rod(details, railPoint(left), railPoint(right), 0.019, 0x626c70);
      const div = Math.max(1, Math.ceil(length / 1.52));
      for (let i = 0; i < div; i++) {
        const p = railPoint(interpolate(a, b, i / div));
        rod(details, [p[0], bottom + 0.018, p[2]], p, 0.017, 0x787c77);
      }
    }
    if (recess > 0.81 && length > 0.35 && top > bottom) {
      const poles = Math.max(1, Math.floor(length / 0.73));
      for (let i = 0; i < poles; i++) {
        const p = interpolate(a, b, (i + 0.36) / poles);
        const point = [p[0] - normal.x * 0.20, p[1] - normal.z * 0.20];
        rod(details, at(point, bottom + 0.012), at(point, top - 0.008), 0.045, wood[i % wood.length]);
      }
    }
  }
}

function within([x, z], outline) {
  let inside = false;
  for (const [i, [ax, az]] of outline.entries()) {
    const [bx, bz] = outline[(i + 1) % outline.length];
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
  }
  return inside;
}

function parkVilla(site) {
  const shell = new CivicBatch(), trim = new CivicBatch(), rails = new CivicBatch(), colliders = [];
  for (const villa of PARK_VILLAS) {
    const { footprint, upper, roof, base } = villa;
    const shoulder = terraceTier(villa);
    const rings = [footprint, footprint, footprint, footprint, shoulder, upper];
    const floors = [24.44, 27.59, 30.76, 33.91, 37.08, roof - 0.16];
    const core = footprint.map(point => insetFromCorner(point, villa));
    for (const edge of edges(core)) {
      const [x, z] = edge.a, [xx, zz] = edge.b;
      const grade = Math.min(base, groundAt(x, z, base) - 0.12, groundAt(xx, zz, base) - 0.12);
      panel(shell, edge, 0, 1, grade, floors[0] - 0.39, 0x827469);
    }
    for (let i = 0; i < floors.length; i++) {
      const current = floors[i];
      deck(shell, rings[i], current, 0xa57d61, concrete, i === floors.length - 1 ? 0x6e6b65 : 0xb2a990);
      if (i === floors.length - 1) continue;
      const next = floors[i + 1];
      const shape = i === 4 ? upper : rings[i + 1];
      apartmentWall(shell, trim, shape.map(point => insetFromCorner(point, villa)), villa, current, next - 0.39, i);
      const lowerTerrace = i === 3 || i === 4;
      balcony(trim, rails, rings[i], villa, current, lowerTerrace ? current : next - 0.39, lowerTerrace);
    }
    const [cx, cz] = villa.center;
    const collector = (u, v, offset) => [cx + u * 0.99 - v * 0.145, roof - 0.005 + offset + 0.13 + v * 0.022,
      cz + u * 0.145 + v * 0.99];
    for (let v = -10; v < 10; v += 1.18) {
      for (let u = -6; u < 7; u += 1.7) {
        const corners = [[u, v], [u + 1.62, v], [u, v + 1.1], [u + 1.62, v + 1.1]];
        if (corners.every(([s, d]) => {
          const [x, , z] = collector(s, d, 0);
          return within([x, z], upper);
        })) solarCell(trim, collector, u, v, 1.62, 1.1, 0x394851);
      }
    }
    colliders.push(footprintCollider(core, base - 0.30, roof));
  }
  const group = makeGroup(site.name, shell, colliders);
  const details = trim.mesh();
  details.castShadow = false;
  group.add(details);
  const glass = rails.mesh();
  glass.material.transparent = true;
  glass.material.opacity = 0.32;
  glass.material.depthWrite = false;
  glass.material.side = THREE.DoubleSide;
  glass.castShadow = false;
  group.add(glass);
  return group;
}

const [[clubX, clubZ], clubLengthEnd] = MHC_FOOTPRINT;
const [alongX, alongZ] = [(clubLengthEnd[0] - clubX) / edgeLength(MHC_FOOTPRINT[0], clubLengthEnd),
  (clubLengthEnd[1] - clubZ) / edgeLength(MHC_FOOTPRINT[0], clubLengthEnd)];
const clubPoint = (u, v, y) => [clubX + alongX * u - alongZ * v, y, clubZ + alongZ * u + alongX * v];
const inPlan = (u, v) => [clubX + alongX * u - alongZ * v, clubZ + alongZ * u + alongX * v];
const clubOutline = (u0, u1, v0, v1) => [inPlan(u0, v0), inPlan(u1, v0), inPlan(u1, v1), inPlan(u0, v1)];
const clubGround = 3.78, clubDeck = 6.24;
const eaveStart = 8.19, pitchEave = 9.18, ridge = 11.53, ridgeDepth = 6.8;
const cream = 0xd6d3c3, larch = 0xa27851, underRoof = 0x8f6a48;
const slab = 0xaaa59a, chalk = 0xd9d8ca, zinc = 0x9daba8;
const tile = 0x424649, tileSeam = 0x383d40;
const frontRoof = d => lerp(eaveStart, ridge, d / ridgeDepth);
const backRoof = d => lerp(ridge, pitchEave, (d - ridgeDepth) / (13.0 - ridgeDepth));

function upright(batch, outline, bottom, top, tint) {
  for (const edge of edges(outline)) panel(batch, edge, 0, 1, bottom, top, tint);
}

function clubOpening(trim, edge, u, v, bottom, top, panes = 1) {
  panel(trim, edge, u, v, bottom, top, chalk, 0.042);
  const border = 0.065 / edge.length;
  for (let i = 0; i < panes; i++) {
    const a = lerp(u, v, i / panes), b = lerp(u, v, (i + 1) / panes);
    panel(trim, edge, a + border, b - border, bottom + 0.065, top - 0.065, glazing[i % 3], 0.053, 0.7);
    if (top - bottom > 2.0) {
      panel(trim, edge, a + border, b - border, top - 0.56, top - 0.51, chalk, 0.059);
    }
  }
}

function roundLight(trim, edge, fraction, y, radius) {
  const [x, z] = interpolate(edge.a, edge.b, fraction);
  const n = edge.normal;
  const disk = (r, offset, tint, glossy = 0) => {
    const points = Array.from({ length: 20 }, (_, i) => {
      const angle = i * Math.PI * 2 / 20, q = r * Math.cos(angle);
      return [x + n.z * q + n.x * offset, y + r * Math.sin(angle), z - n.x * q + n.z * offset];
    });
    const normal = polygonNormal(points);
    if (normal.x * n.x + normal.z * n.z < 0) points.reverse();
    const center = [x + n.x * offset, y, z + n.z * offset];
    for (let i = 0; i < points.length; i++) trim.triangle(center, points[i], points[(i + 1) % points.length], tint, glossy);
  };
  disk(radius, 0.051, chalk);
  disk(radius - 0.057, 0.065, 0x414b4c, 0.70);
}

function clubWalls(batch, trim, outline, labels) {
  const [north, east, south, west] = edges(outline);
  const [u0, u1] = [1.23, 35.80];
  const [d0, d1] = [0.55, 9.63];
  const front = frontRoof(d0) - 0.16, back = backRoof(d1) - 0.16;
  panel(batch, north, 0, 1, clubGround - 0.28, front, cream);
  panel(batch, south, 0, 1, clubGround - 0.28, clubDeck, 0x8e8b80);
  panel(batch, south, 0, 1, clubDeck, back, cream);
  for (const [i, wall] of [west, east].entries()) {
    const u = i === 0 ? u0 : u1;
    panel(batch, wall, 0, 1, clubGround - 0.28, clubDeck, slab);
    const point = (v, y) => clubPoint(u, v, y);
    const gable = [point(d0, clubDeck), point(d1, clubDeck),
      point(d1, back), point(ridgeDepth, ridge - 0.16), point(d0, front)];
    if (polygonNormal(gable).x * wall.normal.x + polygonNormal(gable).z * wall.normal.z < 0) gable.reverse();
    batch.polygon([gable], cream);
    for (let d = d0 + 0.11; d < d1 - 0.1; d += 0.30) {
      const t = i === 0 ? (d1 - d) / (d1 - d0) : (d - d0) / (d1 - d0);
      const y = (d < ridgeDepth ? frontRoof(d) : backRoof(d)) - 0.185;
      panel(trim, wall, t, t + 0.045 / wall.length, clubDeck + 0.02, y, chalk, 0.023);
    }
    if (i === 0) {
      clubOpening(trim, west, 0.13, 0.76, clubDeck + 0.025, 9.09, 5);
      for (let d = 2.8; d < 9.25; d += 0.64) {
        const y = (d < ridgeDepth ? frontRoof(d) : backRoof(d)) - 0.22;
        if (y < 9.20) continue;
        const a = clubPoint(u - 0.045, d - 0.25, 9.13);
        const b = clubPoint(u - 0.045, d + 0.25, 9.13);
        const c = clubPoint(u - 0.045, d + 0.25, Math.min(y, backRoof(d + 0.25) - 0.22));
        const e = clubPoint(u - 0.045, d - 0.25, Math.min(y, frontRoof(d - 0.25) - 0.22));
        const face = [a, b, c, e];
        if (polygonNormal(face).x > 0) face.reverse();
        trim.quad(...face, glazing[Math.floor(d) % 3], 0.60);
      }
      roundLight(trim, west, 0.89, 7.91, 0.32);
    }
  }
  for (const [wall, lo, hi] of [[north, clubGround, front], [south, clubDeck, back]]) {
    for (let u = 0.2; u < wall.length - 0.16; u += 0.32) {
      panel(trim, wall, u / wall.length, (u + 0.049) / wall.length, lo + 0.035, hi - 0.035, chalk, 0.024);
    }
  }
  clubOpening(trim, north, 0.407, 0.514, 3.93, 6.41, 4);
  labels.push({ text: 'MHC EDE', a: asPoint(inPlan(15.6, 0.474)), b: asPoint(inPlan(18.5, 0.474)),
    lo: 6.60, hi: 6.89, color: '#d6d3c3', textColor: '#333e3e' });
  for (let i = 0; i < 6; i++) {
    const left = 0.17 + i * 0.101;
    clubOpening(trim, south, left, left + 0.087, clubDeck + 0.035, 8.65, 2);
  }
  for (const t of [0.072, 0.125, 0.832, 0.920]) roundLight(trim, south, t, 7.87, 0.32);
}

function clubRoof(batch, trim) {
  const u0 = -0.14, u1 = 36.9, middle = 17.14, half = 2.86;
  const peak = 10.68, join = (peak - eaveStart) / (ridge - eaveStart) * ridgeDepth;
  const d0 = 0, d1 = 13.0;
  const left = middle - half, right = middle + half;
  const p = clubPoint;
  const roofPlane = (ring, color) => {
    if (polygonNormal(ring).y < 0) ring.reverse();
    batch.polygon([ring], color);
    const underside = ring.map(([x, y, z]) => [x, y - 0.165, z]).reverse();
    batch.polygon([underside], underRoof);
  };
  roofPlane([p(u0, d0, eaveStart), p(left, d0, eaveStart), p(middle, join, peak),
    p(right, d0, eaveStart), p(u1, d0, eaveStart),
    p(u1, ridgeDepth, ridge), p(u0, ridgeDepth, ridge)], tile);
  roofPlane([p(u0, ridgeDepth, ridge), p(u1, ridgeDepth, ridge), p(u1, d1, pitchEave),
    p(u0, d1, pitchEave)], 0x434849);
  const porchDepth = -0.74;
  for (const s of [-1, 1]) {
    roofPlane([p(middle + half * s, 0, eaveStart), p(middle, join, peak), p(middle, porchDepth, peak),
      p(middle + half * s, porchDepth, eaveStart)], tile);
  }
  const fascia = [p(u0, d0, eaveStart), p(left, d0, eaveStart), p(left, porchDepth, eaveStart),
    p(middle, porchDepth, peak), p(right, porchDepth, eaveStart), p(right, d0, eaveStart),
    p(u1, d0, eaveStart), p(u1, ridgeDepth, ridge), p(u1, d1, pitchEave), p(u0, d1, pitchEave),
    p(u0, ridgeDepth, ridge)];
  // The eave and gable boards follow one perimeter across the porch and both roof pitches.
  for (const [i, a] of fascia.entries()) {
    const b = fascia[(i + 1) % fascia.length];
    const topA = [a[0], a[1] + 0.023, a[2]], topB = [b[0], b[1] + 0.023, b[2]];
    const lowA = [a[0], a[1] - 0.225, a[2]], lowB = [b[0], b[1] - 0.225, b[2]];
    batch.quad(lowB, lowA, topA, topB, chalk);
  }
  const gable = [p(left + 0.12, 0.56, frontRoof(0.56) - 0.16), p(right - 0.12, 0.56, frontRoof(0.56) - 0.16),
    p(middle, 0.56, peak - 0.17)];
  if (polygonNormal(gable).z > 0) gable.reverse();
  batch.polygon([gable], larch);
  const gableEdge = { a: inPlan(left + 0.14, 0.556), b: inPlan(right - 0.14, 0.556), normal: { x: alongZ, z: -alongX } };
  roundLight(trim, gableEdge, 0.5, 9.08, 0.39);
  for (let d = 0.34; d < ridgeDepth - 0.08; d += 0.36) {
    const span = Math.max(0, half * (1 - d / join));
    const render = (a, b) => {
      const face = [p(a, d, frontRoof(d) + 0.008), p(a, d + 0.022, frontRoof(d + 0.022) + 0.008),
        p(b, d + 0.022, frontRoof(d + 0.022) + 0.008), p(b, d, frontRoof(d) + 0.008)];
      trim.quad(...face, tileSeam);
    };
    if (span > 0) {
      render(u0 + 0.08, middle - span - 0.015);
      render(middle + span + 0.015, u1 - 0.08);
    } else {
      render(u0 + 0.08, u1 - 0.08);
    }
  }
  const collector = (u, v, offset) => p(u, v, backRoof(v) + offset);
  for (let v = 8.01; v < 12.55; v += 1.52) {
    for (let u = 1.15; u < 35.25; u += 1.53) {
      if (u > 27.0 && u < 30.0 && v > 9.0 && v < 11.0) continue;
      solarCell(trim, collector, u, v, 1.46, 1.43, 0x344352);
    }
  }
  const skylight = (u, v, offset) => p(u, v, frontRoof(v) + offset);
  for (const u of [9.2, 20.8, 24.7, 29.0]) solarCell(trim, skylight, u, 3.54, 0.94, 1.22, 0x61737b);
  const [x, z] = inPlan(28.2, 10.5);
  batch.solid(new THREE.CylinderGeometry(0.19, 0.21, 0.88, 8).translate(x, backRoof(10.5) + 0.31, z), 0x666765);
  batch.solid(new THREE.CylinderGeometry(0.29, 0.29, 0.075, 8).translate(x, backRoof(10.5) + 0.76, z), 0x898b84);
}

function terracePatch(batch, platforms, id, u0, u1, v0, v1, y, tint, apronHeight) {
  const perimeter = clubOutline(u0, u1, v0, v1);
  horizontal(batch, perimeter, y, tint);
  if (apronHeight !== undefined) {
    const front = edges(perimeter)[2];
    panel(batch, front, 0, 1, apronHeight, y, slab);
  }
  platforms.push({ id, outer: perimeter.map(asPoint), holes: [], height: () => y });
}

function clubTerrace(batch, trim, platforms, colliders) {
  terracePatch(batch, platforms, 'mhc-ede-veranda', -3.9, 39.3, 9.63, 13.02, clubDeck, 0x99806b, 5.83);
  terracePatch(batch, platforms, 'mhc-ede-west-terrace', -3.9, 1.23, 1.10, 9.63, clubDeck, 0xa69683);
  terracePatch(batch, platforms, 'mhc-ede-east-terrace', 35.8, 39.3, 0.76, 9.63, clubDeck, 0xa69683);
  for (const [name, u, v0, v1] of [['west', -3.9, 1.1, 13.02], ['east', 39.3, 0.76, 13.02]]) {
    const terraceEdge = [clubPoint(u, v0, clubDeck), clubPoint(u, v1, clubDeck)];
    const grade = Math.min(clubDeck - 0.44,
      ...terraceEdge.map(([x, , z]) => groundAt(x, z, 4.8)));
    const a = { x: terraceEdge[0][0], z: terraceEdge[0][2] }, b = { x: terraceEdge[1][0], z: terraceEdge[1][2] };
    facePanel(batch, a, b, { x: (name === 'west' ? -1 : 1) * alongX, z: (name === 'west' ? -1 : 1) * alongZ },
      0, 1, grade, clubDeck, slab);
    const base = clubPoint(u + (name === 'west' ? 0.13 : -0.13), v0 + 0.12, clubDeck);
    const top = clubPoint(u + (name === 'west' ? 0.13 : -0.13), v1 - 0.12, clubDeck);
    rod(trim, [base[0], clubDeck + 0.87, base[2]], [top[0], clubDeck + 0.87, top[2]], 0.031, zinc);
    for (let d = v0 + 0.15; d < v1; d += 1.8) {
      const p = clubPoint(u, d, clubDeck);
      rod(trim, p, [p[0], clubDeck + 0.87, p[2]], 0.024, zinc);
    }
    colliders.push(...wallColliders(a, b, clubDeck + 0.04, clubDeck + 0.87, 0.14));
  }
  for (let u = 1.3; u < 37.0; u += 4.83) {
    const bottom = clubPoint(u, 12.53, clubDeck);
    rod(batch, bottom, clubPoint(u - 0.66, 12.52, 9.20), 0.064, zinc, 6);
    rod(batch, bottom, clubPoint(u + 0.66, 12.52, 9.20), 0.064, zinc, 6);
    rod(trim, clubPoint(u, 9.63, backRoof(9.63) - 0.17), clubPoint(u, 12.83, backRoof(12.83) - 0.17),
      0.052, larch, 4);
  }
  for (let v = 9.83; v < 12.96; v += 0.17) {
    const seam = [inPlan(-3.89, v), inPlan(39.29, v), inPlan(39.29, v + 0.012), inPlan(-3.89, v + 0.012)];
    horizontal(trim, seam, clubDeck + 0.006, 0x806a56);
  }

  // Broad spectator treads stop at the two narrow flights.
  const ledges = [5.83, 5.43, 5.02, 4.61];
  for (const [row, y] of ledges.entries()) {
    const d0 = 13.02 + row * 0.83, d1 = d0 + 0.83, lower = ledges[row + 1] ?? 4.29;
    for (const [index, left, right] of [[0, -7.0, -1.94], [1, 0.59, 36.5], [2, 38.85, 43.18]]) {
      terracePatch(batch, platforms, `mhc-ede-spectators-${index}-${row}`, left, right, d0, d1, y,
        row % 2 ? 0xa39e91 : 0xb6b0a2, lower);
    }
  }
  for (const [name, left, right] of [['west', -1.94, 0.59], ['east', 36.50, 38.85]]) {
    const start = 13.02, end = 16.34, span = 10;
    const [ax, , az] = clubPoint((left + right) / 2, end, 0);
    const base = Math.min(4.72, groundAt(ax, az, 4.44));
    for (let step = 0; step < span; step++) {
      const near = lerp(start, end, step / span), far = lerp(start, end, (step + 1) / span);
      terracePatch(batch, platforms, `mhc-ede-${name}-step-${step}`, left, right, near, far,
        lerp(clubDeck, base, step / span), 0xb3ada0, lerp(clubDeck, base, (step + 1) / span));
    }
    for (const u of [left + 0.13, right - 0.13]) {
      const railingStart = clubPoint(u, start + 0.12, clubDeck + 0.91);
      const railingEnd = clubPoint(u, end - 0.12, base + 0.91);
      rod(trim, railingStart, railingEnd, 0.027, zinc);
      for (const offset of [0.05, 0.48, 0.94]) {
        const height = lerp(clubDeck, base, offset);
        const p = clubPoint(u, lerp(start + 0.12, end - 0.12, offset), height);
        rod(trim, p, [p[0], height + 0.91, p[2]], 0.023, zinc);
      }
    }
  }
  for (const v of [2.45, 5.7, 8.75]) {
    const [x, , z] = clubPoint(-1.05, v, 0);
    trim.solid(new THREE.CylinderGeometry(0.075, 0.16, 0.73, 6).translate(x, clubDeck + 0.365, z), bronze);
    trim.solid(new THREE.CylinderGeometry(0.67, 0.67, 0.053, 12).translate(x, clubDeck + 0.75, z), 0x9b8165);
    for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
      const a = x + Math.cos(angle) * 0.92, b = z + Math.sin(angle) * 0.92;
      trim.solid(new THREE.CylinderGeometry(0.11, 0.14, 0.43, 6).translate(a, clubDeck + 0.215, b), bronze);
      trim.solid(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 8).translate(a, clubDeck + 0.46, b), 0x9b8165);
    }
  }
}

function hockeyClub(site) {
  const batch = new CivicBatch(), trim = new CivicBatch(), labels = [], platforms = [];
  const building = clubOutline(1.23, 35.80, 0.55, 9.63);
  const colliders = [footprintCollider(building, clubGround - 0.30, ridge)];
  clubWalls(batch, trim, building, labels);
  clubRoof(batch, trim);
  clubTerrace(batch, trim, platforms, colliders);
  const group = makeGroup(site.name, batch, colliders);
  group.userData.platforms = platforms;
  const detail = trim.mesh();
  detail.castShadow = false;
  group.add(detail);
  const signs = civicSigns(labels, { wide: true });
  if (signs) group.add(signs);
  return group;
}

export const MODERN_NEIGHBORHOOD_FACTORIES = {
  'de-verbinding': (_footprints, site) => parkVilla(site),
  'mhc-ede': (_footprints, site) => hockeyClub(site),
};
