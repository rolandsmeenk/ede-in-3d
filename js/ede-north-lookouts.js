import * as THREE from 'three/webgpu';
import { CivicBatch, along, makeGroup, polygonNormal, wallColliders } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';

const galvanized = 0x707d7d;
const wornOak = 0x8a7965;
const boards = [0x908578, 0x817669, 0x9a9085, 0x8c8072, 0x756d62];
const at = ({ x, z }, y) => [x, y, z];
const groundAt = ({ x, z }) => terrainHeightAt(x, z);
const shift = ({ x, z }, dx, dz) => ({ x: x + dx, z: z + dz });

function beam(batch, a, b, width, color, depth = width) {
  const axis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const length = axis.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.divideScalar(length));
  batch.solid(new THREE.BoxGeometry(width, length, depth).applyQuaternion(rotation)
    .translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), color);
}

function crossSection(a, b, center, width) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const scale = width / (2 * Math.hypot(dx, dz));
  return [shift(center, -dz * scale, dx * scale), shift(center, dz * scale, -dx * scale)];
}

function lookout(site) {
  const batch = new CivicBatch(), colliders = [], platforms = [];

  function slab(outer, y, depth, color) {
    const face = outer.map(p => at(p, y));
    if (polygonNormal(face).y < 0) face.reverse();
    batch.polygon([face], color);
    batch.polygon([face.map(([x, , z]) => [x, y - depth, z]).reverse()], color);
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      batch.quad(b, a, [a[0], y - depth, a[2]], [b[0], y - depth, b[2]], color);
    }
  }

  function rail(a, b, ay, by, color, { height = 1.04, spacing = 0.14, width = 0.035 } = {}) {
    beam(batch, at(a, ay + height), at(b, by + height), width + 0.025, color);
    const count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing);
    const angle = -Math.atan2(b.z - a.z, b.x - a.x);
    for (let i = 0; i <= count; i++) {
      const t = i / count, p = along(a, b, t), y = THREE.MathUtils.lerp(ay, by, t);
      batch.solid(new THREE.BoxGeometry(width, height, 0.045).rotateY(angle).translate(p.x, y + height / 2, p.z), color);
    }
    colliders.push(...wallColliders(a, b, Math.min(ay, by) - 0.05, Math.max(ay, by) + height, 0.085));
  }

  function landing(id, outer, y, color, depth = 0.14) {
    slab(outer, y, depth, color);
    platforms.push({ id: site.id + '-' + id, outer, holes: [], height: () => y });
  }

  function stairs(id, a, b, start, end, width, count, tread, frame, guard) {
    const from = crossSection(a, b, a, width), to = crossSection(a, b, b, width);
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const outer = [from[0], from[1], to[1], to[0]];
    // A continuous walking surface follows the tread nosings through both height transitions.
    platforms.push({ id: site.id + '-' + id, outer, holes: [], height(x, z) {
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSquared, 0, 1);
      return THREE.MathUtils.lerp(start, end, t);
    } });
    for (let i = 0; i < count; i++) {
      const u = i / count, v = (i + 1) / count;
      const p = from.map((a, j) => along(a, to[j], u)), q = from.map((a, j) => along(a, to[j], v));
      slab([p[0], p[1], q[1], q[0]], THREE.MathUtils.lerp(start, end, v), 0.064, tread);
    }
    for (const side of [0, 1]) {
      beam(batch, at(from[side], start - 0.06), at(to[side], end - 0.06), 0.13, frame, 0.19);
      rail(from[side], to[side], start, end, frame, guard);
    }
    return { from, to };
  }

  function done() {
    const group = makeGroup(site.name, batch, colliders);
    group.userData.platforms = platforms;
    const points = platforms.flatMap(({ outer }) => outer);
    group.userData.treeClearance = [{
      minX: Math.min(...points.map(p => p.x)) - 0.75, maxX: Math.max(...points.map(p => p.x)) + 0.75,
      minZ: Math.min(...points.map(p => p.z)) - 0.75, maxZ: Math.max(...points.map(p => p.z)) + 0.75,
      minY: Math.min(...points.map(groundAt)) - 0.3,
      maxY: Math.max(...points.map(groundAt)) + site.height + 1.8,
    }];
    return group;
  }

  return { batch, colliders, stairs, rail, landing, done };
}

function deBult(_, site) {
  const { batch, colliders, stairs, rail, landing, done } = lookout(site);
  const { approach, height } = site;
  // Approach and the 28-step turn follow OSM ways 989856076 and 989856077.
  const entrance = shift(site, 1.62, 3.58), bend = shift(site, 3.47, -1.9), end = shift(site, -2.08, 0.12);
  const inlet = along(bend, entrance, 0.32), outlet = along(bend, end, 0.32);
  const start = groundAt(entrance) + 0.035, middle = start + 2.5, top = start + 5;
  const width = 1.58, tread = 0x465251;
  const first = stairs('lower-stair', entrance, inlet, start, middle, width, 14, tread, galvanized);
  const second = stairs('upper-stair', outlet, along(end, bend, 0.23), middle, top, width, 14, tread, galvanized);
  const [ao, ai] = first.to, [bo, bi] = second.from;
  const outside = shift(bend, 0.83, -0.85);
  landing('turn', [ai, ao, outside, bo, bi], middle, tread);
  rail(ao, outside, middle, middle, galvanized);
  rail(outside, bo, middle, middle, galvanized);
  rail(bi, ai, middle, middle, galvanized);

  const [a, b] = second.to, [c, d] = crossSection(outlet, end, end, width);
  landing('deck', [a, b, d, c], top, tread);
  rail(a, c, top, top, galvanized);
  rail(c, d, top, top, galvanized);
  rail(d, b, top, top, galvanized);

  // The offset timber screens sit on small concrete feet, leaving both stair entries open.
  const clad = (a, b, y) => {
    const count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.16);
    const angle = -Math.atan2(b.z - a.z, b.x - a.x);
    const width = Math.hypot(b.x - a.x, b.z - a.z) / count;
    for (let i = 0; i < count; i++) {
      const p = along(a, b, (i + 0.5) / count), low = groundAt(p) + 0.26;
      batch.solid(new THREE.BoxGeometry(width - 0.007, y - low, 0.16).rotateY(angle)
        .translate(p.x, (y + low) / 2, p.z), boards[(i * 7 + Math.floor(i / 3)) % boards.length]);
    }
    for (const t of [0.12, 0.5, 0.88]) {
      const p = along(a, b, t), low = groundAt(p);
      batch.solid(new THREE.BoxGeometry(0.43, 0.46, 0.41).rotateY(angle)
        .translate(p.x, low + 0.07, p.z), 0x868883);
    }
    colliders.push(...wallColliders(a, b, Math.min(groundAt(a), groundAt(b)), y, 0.16));
  };
  const [left, right] = first.from;
  const inward = crossSection(entrance, inlet, inlet, width + 0.39)[1];
  clad(shift(right, (right.x - left.x) * 0.12, (right.z - left.z) * 0.12), inward, start + height);
  const northEnd = crossSection(outlet, end, end, width + 0.39)[0];
  const northStart = crossSection(outlet, end, outlet, width + 0.39)[0];
  clad(northEnd, northStart, start + height + 0.06);

  // The first tread meets the short mapped spur above the main hill path.
  const pad = along(entrance, approach, 0.08);
  const [p, q] = crossSection(entrance, inlet, pad, width);
  landing('threshold', [p, q, right, left], start, 0x909287, 0.075);
  return done();
}

function celticFields(_, site) {
  const { batch, colliders, stairs, rail, landing, done } = lookout(site);
  // The Panoramax street photograph and the PDOK orthophoto show the stair beside the broad timber deck.
  const plan = (x, z) => shift(site, 0.951 * x - 0.309 * z, 0.309 * x + 0.951 * z);
  const entry = plan(-2.96, 1.62), turn = plan(0.05, 1.62);
  const start = groundAt(entry) + 0.035, top = start + 2.09;
  const stair = stairs('stair', entry, turn, start, top, 1.5, 11, wornOak, 0x786954,
    { height: 0.90, spacing: 1.55, width: 0.1 });

  const [q, p] = stair.to;
  const a = plan(-2.65, 0.87), b = plan(-2.65, -1.58), c = plan(1.56, -1.58);
  const d = plan(1.56, 0.87), e = plan(1.56, 2.37);
  landing('deck', [a, b, c, d, p], top, wornOak, 0.18);
  landing('turn', [p, q, e, d], top, wornOak, 0.18);
  const fence = { height: 1.10, width: 0.118, spacing: 0.15 };
  for (const [from, to] of [[a, b], [b, c], [c, d], [d, e], [e, q], [p, a]]) {
    rail(from, to, top, top, wornOak, fence);
  }

  for (const [i, p] of [b, c, a, d, e, plan(-0.83, -1.56), plan(-0.83, 0.80)].entries()) {
    const base = groundAt(p) - 0.16, size = 0.13 + i % 3 * 0.012;
    batch.solid(new THREE.CylinderGeometry(size * 0.95, size, top - base, 9)
      .translate(p.x, (top + base) / 2, p.z), boards[i % boards.length]);
    colliders.push(...wallColliders(shift(p, -size, 0), shift(p, size, 0), base, top - 0.16, size * 2));
  }
  for (const [from, to] of [[a, d], [b, c], [b, a], [c, d]]) {
    const near = along(from, to, 0.22), far = along(from, to, 0.78);
    beam(batch, at(from, top - 0.23), at(to, top - 0.23), 0.18, 0x5f523e);
    beam(batch, at(from, top - 0.94), at(near, top - 0.23), 0.13, wornOak);
    beam(batch, at(far, top - 0.23), at(to, top - 0.94), 0.13, wornOak);
  }
  return done();
}

export const EDE_NORTH_LOOKOUT_FACTORIES = {
  'uitkijktoren-de-bult': deBult,
  'uitkijktoren-celtic-fields': celticFields,
};
