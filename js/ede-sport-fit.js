import { polygonContains } from './building-collision.js';

const EPSILON = 1e-7;

function pointsFromRing(ring) {
  if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 || !ring.every(Number.isFinite)) return [];
  const points = [];
  for (let i = 0; i < ring.length; i += 2) points.push({ x: ring[i], z: ring[i + 1] });
  return points;
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const turn = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  function half(chain) {
    const edge = [];
    for (const p of chain) {
      while (edge.length >= 2 && turn(edge.at(-2), edge.at(-1), p) <= EPSILON) edge.pop();
      edge.push(p);
    }
    return edge.slice(0, -1);
  }
  return [...half(sorted), ...half(sorted.reverse())];
}

function extent(points, ux, uz) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const { x, z } of points) {
    const u = x * ux + z * uz, v = -x * uz + z * ux;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  return { minU, maxU, minV, maxV, length: maxU - minU, width: maxV - minV };
}

function frame(ux, uz, u, v, length, width, homeU) {
  return {
    x: u * ux - v * uz, z: u * uz + v * ux, ux, uz, vx: -uz, vz: ux,
    length, width, homeFrom: 1, ...(homeU === undefined ? {} : { homeU }),
  };
}

function rectangularFrame(hull) {
  let best, bestArea = Infinity, bestAngle = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance < EPSILON) continue;
    let ux = (b.x - a.x) / distance, uz = (b.z - a.z) / distance;
    let box = extent(hull, ux, uz);
    if (box.width > box.length + EPSILON) {
      [ux, uz] = [-uz, ux];
      box = extent(hull, ux, uz);
    }
    if (ux < -EPSILON || (Math.abs(ux) <= EPSILON && uz < 0)) {
      [ux, uz] = [-ux, -uz];
      box = extent(hull, ux, uz);
    }
    const area = box.length * box.width, angle = Math.atan2(uz, ux);
    if (area > bestArea + EPSILON || (Math.abs(area - bestArea) <= EPSILON && angle >= bestAngle)) continue;
    bestArea = area;
    bestAngle = angle;
    best = frame(ux, uz, (box.minU + box.maxU) / 2, (box.minV + box.maxV) / 2,
      box.length - 0.16, box.width - 0.16);
  }
  return best && best.width >= 1.5 ? best : null;
}

function linePoint(a, dx, dz, t) {
  return [a[0] + t * dx, a[1] + t * dz];
}

// Segment cuts at every ring edge preserve the gaps in multipart-looking and holed pitches.
export function clipSportLine(a, b, polygon) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  if (Math.hypot(dx, dz) < EPSILON) return [];
  const cuts = [0, 1];
  for (const ring of [polygon.outer, ...polygon.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const start = ring[i], end = ring[(i + 1) % ring.length];
      const ex = end.x - start.x, ez = end.z - start.z;
      const cross = dx * ez - dz * ex;
      if (Math.abs(cross) < EPSILON) continue;
      const qx = start.x - a[0], qz = start.z - a[1];
      const t = (qx * ez - qz * ex) / cross, s = (qx * dz - qz * dx) / cross;
      if (t > 0 && t < 1 && s >= 0 && s <= 1) cuts.push(t);
    }
  }
  cuts.sort((t, s) => t - s);
  const pieces = [];
  let start;
  for (let i = 1; i < cuts.length; i++) {
    const from = cuts[i - 1], to = cuts[i];
    if (to - from < EPSILON) continue;
    const mid = (from + to) / 2;
    if (polygonContains(polygon, a[0] + mid * dx, a[1] + mid * dz)) {
      start ??= from;
    } else if (start !== undefined) {
      pieces.push([linePoint(a, dx, dz, start), linePoint(a, dx, dz, from)]);
      start = undefined;
    }
  }
  if (start !== undefined) pieces.push([linePoint(a, dx, dz, start), b]);
  return pieces;
}

function validPoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function diamondFrame(polygon, hull, survey) {
  if (validPoint(survey?.home) && validPoint(survey.toward)) {
    const [x, z] = survey.home;
    const dx = survey.toward[0] - x, dz = survey.toward[1] - z;
    const distance = Math.hypot(dx, dz);
    if (distance >= 1 && polygonContains(polygon, x, z)) {
      return rawDiamondFrame(hull, x, z, dx / distance, dz / distance);
    }
  }

  // The foul sides are usually the two longest near-perpendicular edges around a short, rounded backstop.
  const sides = hull.map((a, i) => {
    const b = hull[(i + 1) % hull.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    return { a, b, length, x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  });
  const perimeter = sides.reduce((total, side) => total + side.length, 0);
  let best, score = 0;
  for (let i = 0; i < sides.length; i++) {
    const a = sides[i];
    let gap = 0;
    for (let offset = 1; offset < sides.length && gap < perimeter * 0.16; offset++) {
      const b = sides[(i + offset) % sides.length];
      const rightAngleError = Math.abs(a.x * b.x + a.z * b.z);
      const span = Math.min(a.length, b.length);
      const candidate = span * (1 - rightAngleError) - gap * 0.55;
      if (rightAngleError < 0.35 && candidate > score) {
        score = candidate;
        best = { a, b, span };
      }
      gap += b.length;
    }
  }
  if (!best) return null;

  const { a, b, span } = best;
  const cross = a.x * b.z - a.z * b.x;
  const t = ((b.a.x - a.b.x) * b.z - (b.a.z - a.b.z) * b.x) / cross;
  const corner = [a.b.x + a.x * t, a.b.z + a.z * t];
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
  const intervals = clipSportLine(linePoint(corner, ux, uz, -perimeter), linePoint(corner, ux, uz, perimeter), polygon);
  if (!intervals.length) return null;
  const [entry, exit] = intervals.reduce((longest, piece) => {
    const distance = ([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]);
    return !longest || distance(piece) > distance(longest) ? piece : longest;
  }, null);
  const depth = Math.hypot(exit[0] - entry[0], exit[1] - entry[1]);
  const setback = Math.min(Math.max(3, 0.15 * span), 18, depth * 0.24);
  const [x, z] = linePoint(entry, ux, uz, setback);
  return rawDiamondFrame(hull, x, z, ux, uz);
}

function rawDiamondFrame(hull, x, z, ux, uz) {
  const bounds = extent(hull, ux, uz);
  const u = (bounds.minU + bounds.maxU) / 2;
  const v = -x * uz + z * ux;
  const width = 2 * Math.max(bounds.maxV - v, v - bounds.minV);
  return frame(ux, uz, u, v, bounds.length, width, x * ux + z * uz - u);
}

export function fitSportField(record) {
  const outer = pointsFromRing(record.ring), hull = convexHull(outer);
  if (hull.length < 3) return null;
  const isDiamond = record.diamond || record.sports?.some(sport => ['baseball', 'softball', 'beeball'].includes(sport));
  if (isDiamond) {
    const polygon = { outer, holes: (record.holes ?? []).map(pointsFromRing) };
    const oriented = diamondFrame(polygon, hull, record.diamond);
    if (oriented) return oriented;
  }
  return rectangularFrame(hull);
}
