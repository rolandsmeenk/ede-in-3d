import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv, vertexColor } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { CivicBatch, civicSigns, makeGroup, polygonNormal, wallColliders } from './ede-civic-landmarks.js';
import { ESTATE_SURVEY } from './ede-estate-survey.js';
import { terrainHeightAt } from './terrain.js';

const ivory = 0xe2daca;
const limestone = 0xb5a993;
const slate = 0x45454a;
const iron = 0x283933;
const glass = 0x465964;
const darkGlass = 0x35414b;
const redDoor = 0x643333;
const brick = 0x704940;
const burntBrick = 0x64433e;
const goldenBrick = 0xb18859;
const paleBrick = 0xebe4d4;
let masonryTexture;

function frontage([x, z], [ex, ez]) {
  const length = Math.hypot(ex - x, ez - z);
  const ux = (ex - x) / length, uz = (ez - z) / length;
  return { x, z, ux, uz, nx: -uz, nz: ux, length };
}

function p(f, u, y, out = 0) {
  return [f.x + f.ux * u + f.nx * out, y, f.z + f.uz * u + f.nz * out];
}

function surface(batch, f, shape, color, out = 0.018) {
  batch.polygon([shape.map(([u, y]) => p(f, u, y, out))], color);
}

function patch(batch, f, a, b, lo, hi, color, out = 0.02, sheen = 0) {
  if (b <= a || hi <= lo) return;
  batch.quad(p(f, a, lo, out), p(f, b, lo, out), p(f, b, hi, out), p(f, a, hi, out), color, sheen);
}

function block(batch, f, a, b, lo, hi, inside, outside, color) {
  if (b <= a || hi <= lo || outside <= inside) return;
  const box = new THREE.BoxGeometry(b - a, hi - lo, outside - inside);
  box.rotateY(-Math.atan2(f.uz, f.ux));
  box.translate(...p(f, (a + b) / 2, (lo + hi) / 2, (inside + outside) / 2));
  batch.solid(box, color);
}

function line(batch, a, b, radius, color, sides = 5) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const direction = B.clone().sub(A);
  if (direction.lengthSq() < 0.000001) return;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  const midpoint = A.clone().addScaledVector(direction, 0.5);
  batch.solid(new THREE.CylinderGeometry(radius, radius, direction.length(), sides)
    .applyQuaternion(q).translate(midpoint.x, midpoint.y, midpoint.z), color);
}

function arched(u, width, low, high, rise) {
  const a = u - width * 0.5, b = u + width * 0.5;
  return [[a, low], [b, low], [b, high - rise],
    ...Array.from({ length: 7 }, (_, i) => {
      const angle = (i + 1) * Math.PI / 8;
      return [u + Math.cos(angle) * width * 0.5, high - rise + Math.sin(angle) * rise];
    }), [a, high - rise]];
}

// Glass sits behind an extruded casing with its own shaded jambs and sill.
function opening(batch, f, u, width, low, high, {
  trim = ivory, glazing = glass, arch = 0, rows = 1, cols = 2, shutter = false, door = false,
} = {}) {
  const frame = arch
    ? arched(u, width, low, high, arch)
    : [[u - width / 2, low], [u + width / 2, low], [u + width / 2, high], [u - width / 2, high]];
  const inner = frame.map(([a, y]) => [
    u + (a - u) * (1 - Math.min(0.27, 0.135 / width)),
    low + 0.066 + (y - low) * (1 - 0.136 / (high - low)),
  ]);
  surface(batch, f, inner, glazing, 0.033);
  for (let i = 0; i < frame.length; i++) {
    const j = (i + 1) % frame.length;
    batch.quad(p(f, ...frame[i], 0.13), p(f, ...frame[j], 0.13),
      p(f, ...inner[j], 0.103), p(f, ...inner[i], 0.103), trim);
    batch.quad(p(f, ...inner[i], 0.103), p(f, ...inner[j], 0.103),
      p(f, ...inner[j], 0.036), p(f, ...inner[i], 0.036), door ? 0x504537 : limestone);
  }
  const a = u - width / 2 + 0.065, b = u + width / 2 - 0.065;
  const rectTop = high - Math.max(arch, 0.075);
  for (let j = 1; j < rows; j++) {
    const y = low + (rectTop - low) * j / rows;
    patch(batch, f, a, b, y - 0.018, y + 0.018, trim, 0.071);
  }
  for (let i = 1; i < cols; i++) {
    const x = a + (b - a) * i / cols;
    patch(batch, f, x - 0.021, x + 0.021, low + 0.055, rectTop, trim, 0.073);
  }
  if (arch) {
    const y = high - arch;
    for (let i = 1; i <= 5; i++) {
      const angle = Math.PI * i / 6;
      line(batch, p(f, u, y, 0.073), p(f, u + width * 0.44 * Math.cos(angle),
        y + Math.max(0.03, arch - 0.085) * Math.sin(angle), 0.073), 0.012, trim);
    }
    patch(batch, f, a, b, y - 0.029, y + 0.029, trim, 0.079);
  }
  if (!door) block(batch, f, u - width / 2 - 0.09, u + width / 2 + 0.09, low - 0.09, low + 0.012, 0.009, 0.19, limestone);
  if (shutter) for (const sign of [-1, 1]) {
    const base = u + sign * (width * 0.5 + 0.19);
    block(batch, f, base - 0.18, base + 0.18, low + 0.04, rectTop - 0.04, 0.041, 0.11, iron);
    for (let y = low + 0.15; y < rectTop - 0.06; y += 0.14) {
      patch(batch, f, base - 0.145, base + 0.145, y, y + 0.018, 0x4b5047, 0.116);
    }
  }
}

function band(batch, f, y, color, start = 0, end = f.length, thickness = 0.075) {
  patch(batch, f, start, end, y, y + thickness, color, 0.028);
}

function archCrown(batch, f, u, width, spring, rise, color) {
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = i * Math.PI / n + 0.01, b = (i + 1) * Math.PI / n - 0.01;
    const q = (angle, extra) => p(f, u + (width * 0.5 + extra) * Math.cos(angle),
      spring + (rise + extra) * Math.sin(angle), 0.051);
    batch.quad(q(a, 0.09), q(b, 0.09), q(b, -0.075), q(a, -0.075), color);
  }
}

function rose(batch, f, u, y, r, frame, glaze) {
  const point = (i, radius, d) => {
    const a = i * 2 * Math.PI / 12;
    return p(f, u + radius * Math.cos(a), y + radius * Math.sin(a), d);
  };
  for (let i = 0; i < 12; i++) {
    batch.triangle(p(f, u, y, 0.035), point(i, r, 0.035), point(i + 1, r, 0.035), glaze, 0.62);
    batch.quad(point(i, r, 0.075), point(i, r + 0.087, 0.075), point(i + 1, r + 0.087, 0.075),
      point(i + 1, r, 0.075), frame);
    if (!(i % 2)) line(batch, p(f, u, y, 0.075), point(i, r, 0.077), 0.021, frame);
  }
}

function footprintCollider(rings, minY, maxY) {
  const [outer, ...holes] = rings.map(ring => ring.map(([x, z]) => ({ x, z })));
  return {
    minX: Math.min(...outer.map(v => v.x)), maxX: Math.max(...outer.map(v => v.x)),
    minZ: Math.min(...outer.map(v => v.z)), maxZ: Math.max(...outer.map(v => v.z)),
    minY, maxY, polygon: { outer, holes },
  };
}

function estateShell(batch, masonry, survey, wall, roof, skip = () => false) {
  const points = survey.points.map(([x, y, z]) => [x,
    Math.abs(y - survey.ground) < 0.034 ? Math.min(y, terrainHeightAt(x, z) - 0.09) : y, z]);
  for (const [roofFace, ...indices] of survey.faces) {
    const rings = indices.map(ring => ring.map(i => points[i]));
    if (skip(rings[0])) continue;
    const start = batch.vertices.length / 3;
    batch.polygon(rings, roofFace ? roof : wall);
    if (!roofFace) for (let i = start; i < batch.vertices.length / 3; i++) masonry[i] = 1;
  }
  return footprintCollider(survey.footprint, Math.min(...points.map(point => point[1])),
    Math.max(...points.map(point => point[1])));
}

function estateGroup(name, batch, masonry, colliders, details) {
  const group = makeGroup(name, batch, colliders);
  const mesh = group.children[0];
  const { position, normal } = mesh.geometry.attributes;
  const coordinates = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    coordinates[i * 2] = (position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 0.99;
    coordinates[i * 2 + 1] = position.getY(i) / 0.64;
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(coordinates, 2));
  mesh.geometry.setAttribute('estateMasonry', new THREE.BufferAttribute(
    Float32Array.from({ length: position.count }, (_, i) => masonry[i] ?? 0), 1));
  masonryTexture ??= createFacadeSurfaceTexture().texture;
  mesh.material.colorNode = vertexColor().mul(mix(1,
    texture(masonryTexture, uv()).r.mul(0.86).add(0.29), attribute('estateMasonry', 'float')));
  const detail = details.mesh();
  detail.userData.nearDetail = true;
  group.add(detail);
  return group;
}

function turret(batch, details) {
  const x = 351.38, z = 3393.13;
  const ring = (y, radius, upperRadius, height, color) =>
    batch.solid(new THREE.CylinderGeometry(upperRadius, radius, height, 8)
      .rotateY(Math.PI / 8).translate(x, y + height / 2, z), color);
  ring(9.14, 1.21, 1.13, 0.47, 0x737a74);
  ring(9.61, 0.83, 0.71, 1.46, 0x8c9082);
  ring(11.07, 0.79, 0.79, 0.15, 0x655e4d);
  ring(11.22, 0.80, 0.66, 0.72, 0x777d70);
  ring(11.94, 0.82, 0.53, 0.51, 0x6b756d);
  ring(12.45, 0.53, 0.095, 1.39, 0x697872);
  ring(13.84, 0.068, 0.012, 0.40, 0xb3ab79);
  for (const [a, b] of [
    [[x - 0.77, z - 0.38], [x - 0.77, z + 0.38]],
    [[x - 0.36, z + 0.77], [x + 0.36, z + 0.77]],
    [[x + 0.77, z + 0.38], [x + 0.77, z - 0.38]],
  ]) {
    const f = frontage(a, b);
    opening(details, f, f.length / 2, 0.39, 9.73, 10.53, { arch: 0.15, trim: 0xb8b3a3, glazing: 0x18252b, cols: 1 });
    rose(details, f, f.length / 2, 11.57, 0.189, 0xa59a6f, 0x3c3c35);
  }
}

function castleDetails(batch, details, platforms) {
  const north = frontage([348.34, 3382.92], [348.86, 3388.89]);
  const south = frontage([349.71, 3398.25], [350.23, 3404.15]);
  const centre = frontage([348.38, 3390.95], [348.90, 3396.41]);
  for (const f of [north, south]) {
    for (const u of [f.length * 0.25, f.length * 0.75]) {
      opening(details, f, u, 1.30, -3.46, -0.45, { rows: 3 });
      opening(details, f, u, 1.41, 0.84, 3.98, { rows: 3 });
      opening(details, f, u, 1.02, -5.27, -4.56, { shutter: true });
    }
    block(batch, f, 0, f.length, 4.97, 5.28, 0, 0.23, limestone);
    band(details, f, -4.44, 0x77645d, 0, f.length, 0.09);
  }
  for (const f of [
    frontage([349.2, 3388.84], [349.38, 3390.81]),
    frontage([349.82, 3396.36], [350.0, 3398.21]),
  ]) {
    opening(details, f, f.length / 2, 0.75, -3.32, -0.49, { rows: 3, cols: 1 });
    opening(details, f, f.length / 2, 0.74, 0.98, 3.95, { rows: 3, cols: 1 });
  }
  const mid = centre.length / 2;
  opening(details, centre, mid, 1.60, -3.85, -0.66, { arch: 0.49, door: true, glazing: 0x433b34, trim: 0xd5c3a4 });
  opening(details, centre, mid, 1.48, -0.28, 2.23, { arch: 0.45, door: true, trim: 0xdad3c4 });
  for (const side of [-1, 1]) {
    opening(details, centre, mid + side * 1.82, 0.71, 0.01, 2.24, { rows: 2, cols: 1 });
    block(details, centre, mid + side * 0.98 - 0.08, mid + side * 0.98 + 0.08, -3.82, -0.80, 0.025, 0.25, limestone);
    opening(details, centre, mid + side * 1.75, 0.58, -2.95, -1.79, { cols: 1, glazing: darkGlass });
  }
  for (const offset of [-1.55, 0, 1.55]) {
    opening(details, centre, mid + offset, 0.70, 3.19, 4.36, { rows: 2, cols: 1 });
  }
  block(batch, centre, mid - 1.28, mid + 1.28, -0.57, -0.30, 0, 0.96, limestone);
  for (let i = 0; i < 11; i++) {
    const u = mid - 1.22 + i * 0.244;
    line(details, p(centre, u, -0.30, 0.89), p(centre, u, 0.58, 0.89), 0.025, iron);
    if (i < 10) line(details, p(centre, u, 0.58, 0.89), p(centre, u + 0.244, 0.58, 0.89), 0.032, iron);
  }
  block(batch, centre, 0, centre.length, 5.28, 5.64, 0.012, 0.27, ivory);
  surface(batch, centre, [[0.12, 5.57], [centre.length - 0.12, 5.57], [mid, 7.90]], 0xd1c7af, 0.075);
  for (const side of [-1, 1]) {
    line(details, p(centre, mid, 7.94, 0.22),
      p(centre, mid + side * (mid - 0.01), 5.69, 0.22), 0.095, limestone);
  }
  // The heraldic composition follows the photographed crown, shield and supporters.
  surface(details, centre, [[mid - 0.48, 6.8], [mid - 0.43, 6.23], [mid, 5.97],
    [mid + 0.43, 6.23], [mid + 0.48, 6.8]], 0x2c383d, 0.17);
  band(details, centre, 6.73, 0xc4a36b, mid - 0.50, mid + 0.50, 0.10);
  for (const side of [-1, 1]) {
    const heraldX = mid + side * 0.69;
    surface(details, centre, [[heraldX - side * 0.22, 6.54], [heraldX + side * 0.16, 6.87],
      [heraldX + side * 0.53, 6.62], [heraldX + side * 0.25, 6.45],
      [heraldX + side * 0.41, 6.08], [heraldX + side * 0.07, 6.12]], 0x414543, 0.2);
  }
  for (let i = 0; i < 7; i++) {
    const u = mid - 2.25 + i * 0.75;
    rose(details, centre, u, 5.46, 0.065, 0xb6a78d, 0xd1c4aa);
  }

  const steps = 8, nose = 2.58, threshold = -3.84;
  for (let i = 0; i < steps; i++) {
    const out = nose * (steps - i) / steps;
    const y = threshold - (steps - i - 1) * 0.184;
    block(batch, centre, mid - 1.23 - (steps - i) * 0.038, mid + 1.23 + (steps - i) * 0.038,
      y - 0.29, y, 0, out, i % 3 === 0 ? 0xb9b0a1 : 0xb2a998);
  }
  const corner = (u, d) => {
    const [x, , z] = p(centre, u, 0, d);
    return { x, z };
  };
  platforms.push({ id: 'hoekelum-entry', holes: [],
    outer: [corner(mid - 1.28, 0), corner(mid + 1.28, 0),
      corner(mid + 1.53, nose), corner(mid - 1.53, nose)],
    height(x, z) {
      const out = (x - centre.x) * centre.nx + (z - centre.z) * centre.nz;
      return threshold - Math.min(steps - 1, Math.floor(Math.max(0, out - 0.0001) / nose * steps)) * 0.184;
    },
  });

  for (const a of [
    [[363.99, 3381.61], [348.34, 3382.92]],
    [[350.23, 3404.15], [365.87, 3402.79]],
    [[365.88, 3397.47], [365.01, 3386.61]],
  ]) {
    const f = frontage(...a);
    for (const ratio of [0.22, 0.5, 0.78]) {
      opening(details, f, f.length * ratio, 1.12, -3.55, -0.53, { rows: 3 });
      opening(details, f, f.length * ratio, 1.12, 0.72, 3.85, { rows: 3 });
    }
  }
  turret(batch, details);
}

function coachDetails(batch, details) {
  const f = frontage([318.92, 3354.55], [319.63, 3365.89]);
  for (const ratio of [0.31, 0.69]) opening(details, f, f.length * ratio, 2.61, -5.15, -2.25,
    { arch: 0.33, rows: 3, cols: 4, trim: 0x586257 });
  for (const ratio of [0.23, 0.50, 0.77]) opening(details, f, f.length * ratio, 1.10, -1.55, 0.30,
    { rows: 3, cols: 2, trim: 0x627068 });
  block(batch, f, 0, f.length, 0.53, 0.71, 0.01, 0.19, slate);
  const left = frontage([321.0, 3338.23], [321.61, 3349.07]);
  const right = frontage([320.93, 3365.86], [321.26, 3371.22]);
  opening(details, left, 2.6, 1.23, -5.22, -2.56, { door: true, glazing: 0x413e36, trim: 0x46574d });
  for (const [face, at] of [[left, 6.45], [right, 3.35]]) opening(details, face, at, 1.28, -4.44, -2.46,
    { rows: 3, trim: 0x5a6c60 });
}

function bridge(bank, details, colliders, platforms) {
  const f = frontage([339.65, 3427.42], [340.08, 3418.10]);
  const half = 1.55, length = f.length, approach = 3.6;
  // AHN DTM observes both approaches. The concealed crown and arch are fitted to the photograph.
  const deck = u => -5.29 - 0.04 * u / length + 0.31 * Math.sin(Math.PI * u / length);
  const spring = -6.82, archHalf = 2.26;
  const underside = u => {
    const arch = (u - length / 2) / archHalf;
    return Math.abs(arch) <= 1.0001 ? spring + 1.46 * Math.sqrt(Math.max(0, 1 - arch * arch)) : -7.52;
  };
  const archStart = length / 2 - archHalf, archEnd = length / 2 + archHalf;
  const sections = [0, archStart - 0.006, ...Array.from({ length: 13 }, (_, i) => archStart + 2 * archHalf * i / 12),
    archEnd + 0.006, length];
  const rails = 0xe2ded2, cap = 0xae9b86;
  const point = (u, d) => {
    const [x, , z] = p(f, u, 0, d);
    return { x, z };
  };
  const top = (u, d) => p(f, u, deck(u), d);
  function height(u, d) {
    if (u >= 0 && u <= length) return deck(u);
    const end = u < 0 ? 0 : length;
    const [x, , z] = p(f, u, 0, d);
    // Both approaches meet the mapped sidewalk at the existing curb height.
    const grade = terrainHeightAt(x, z) + 0.22;
    const t = Math.min(1, Math.abs(u - end) / approach);
    return THREE.MathUtils.lerp(deck(end), grade, t * t * (3 - 2 * t));
  }
  for (const end of [0, length]) {
    const start = end === 0 ? -approach : length;
    for (let i = 0; i < 12; i++) {
      const a = start + i * approach / 12, b = start + (i + 1) * approach / 12;
      const ramp = (u, d) => p(f, u, height(u, d), d);
      const shoulder = (u, side) => {
        const distance = Math.abs(u - end) / approach;
        const d = side * (half + 0.70 * Math.sqrt(distance));
        const [x, , z] = p(f, u, 0, d);
        return [x, terrainHeightAt(x, z) + 0.032, z];
      };
      bank.quad(ramp(a, -half), ramp(a, half), ramp(b, half), ramp(b, -half), 0xb8a588);
      bank.quad(shoulder(a, -1), ramp(a, -half), ramp(b, -half), shoulder(b, -1), 0xb1a085);
      bank.quad(ramp(a, half), shoulder(a, 1), shoulder(b, 1), ramp(b, half), 0xb1a085);
    }
  }
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i];
    bank.quad(top(a, -half), top(a, half), top(b, half), top(b, -half), 0xa39985);
    bank.quad(p(f, a, underside(a), -half), p(f, b, underside(b), -half),
      p(f, b, underside(b), half), p(f, a, underside(a), half), 0x5b4940);
    for (const side of [-1, 1]) {
      const d = side * half;
      const [first, last] = side > 0 ? [a, b] : [b, a];
      const face = (u, hi, out = d) => p(f, u, hi, out);
      bank.quad(face(first, underside(first)), face(last, underside(last)), top(last, d), top(first, d), brick);
      bank.quad(face(first, deck(first) - 0.15, d + side * 0.035),
        face(last, deck(last) - 0.15, d + side * 0.035),
        face(last, deck(last) + 0.028, d + side * 0.035),
        face(first, deck(first) + 0.028, d + side * 0.035), cap);
      if (a >= archStart && b <= archEnd) {
        details.quad(face(first, underside(first) + 0.035, d + side * 0.013),
          face(last, underside(last) + 0.035, d + side * 0.013),
          face(last, underside(last) + 0.23, d + side * 0.013),
          face(first, underside(first) + 0.23, d + side * 0.013), burntBrick);
      }
    }
  }
  const uprights = [0.33, 2.19, length / 2, length - 2.19, length - 0.33];
  for (const side of [-1, 1]) {
    const d = side * (half - 0.09);
    for (let i = 0; i < uprights.length; i++) {
      const u = uprights[i], base = deck(u);
      block(bank, f, u - 0.10, u + 0.10, base, base + 0.96, d - 0.09, d + 0.09, rails);
      block(details, f, u - 0.13, u + 0.13, base + 0.94, base + 1.04, d - 0.12, d + 0.12, ivory);
      if (!i) continue;
      const last = uprights[i - 1];
      for (const y of [0.32, 0.79]) line(bank, p(f, last, deck(last) + y, d), p(f, u, base + y, d), 0.026, rails);
      for (let j = 0; j < 4; j++) {
        const a = last + (u - last) * j / 4, b = last + (u - last) * (j + 1) / 4;
        const mid = (a + b) / 2;
        line(details, p(f, a, deck(a) + 0.32, d), p(f, b, deck(b) + 0.78, d), 0.014, rails);
        line(details, p(f, b, deck(b) + 0.32, d), p(f, a, deck(a) + 0.78, d), 0.014, rails);
        line(details, p(f, mid, deck(mid) + 0.35, d), p(f, mid, deck(mid) + 0.75, d), 0.012, rails);
      }
    }
    colliders.push(...wallColliders(point(0.2, d), point(length - 0.2, d), -5.35, -4.03, 0.17));
  }
  // Surveyed shoreline vertices cap the short masonry returns at the two bridgeheads.
  const returns = [
    [point(1.2, -half), { x: 337.92, z: 3426.11 }, { x: 336.30, z: 3428.26 }],
    [point(length - 0.9, half), { x: 343.09, z: 3417.36 }, { x: 345.68, z: 3419.28 }],
  ];
  for (const edge of returns) {
    for (let i = 1; i < edge.length; i++) {
      const { x, z } = edge[i - 1], { x: ex, z: ez } = edge[i];
      const wall = frontage([x, z], [ex, ez]);
      const y = Math.min(-5.25, terrainHeightAt((x + ex) / 2, (z + ez) / 2) + 0.08);
      block(bank, wall, 0, wall.length, y - 1.04, y, -0.16, 0.16, brick);
      block(bank, wall, 0, wall.length, y - 0.04, y + 0.06, -0.18, 0.18, cap);
    }
  }
  platforms.push({ id: 'hoekelum-moat-bridge', holes: [],
    outer: [point(-approach, -half), point(length + approach, -half),
      point(length + approach, half), point(-approach, half)],
    height(x, z) {
      const dx = x - f.x, dz = z - f.z;
      return height(dx * f.ux + dz * f.uz, dx * f.nx + dz * f.nz);
    },
  });
}

function verge(batch, f, u, peak, eave, width, color) {
  for (const side of [-1, 1]) {
    line(batch, p(f, u, peak, 0.12), p(f, u + side * width / 2, eave, 0.12), 0.093, color);
  }
}

function gasGable(details, f, u, peak, eave, width, color) {
  const rise = (peak - eave) * 0.32;
  surface(details, f, [[u - width * 0.16, peak - rise], [u + width * 0.16, peak - rise], [u, peak]],
    color, 0.115);
  for (let i = -5; i <= 5; i++) {
    const x = u + width * i / 34;
    patch(details, f, x, x + 0.025, peak - rise, peak - Math.abs(i) * rise / 5.4, 0x59644e, 0.124);
  }
  const finial = 0x50574a;
  line(details, p(f, u, peak - 0.16, 0.18), p(f, u, peak + 0.63, 0.18), 0.033, finial);
  for (const side of [-1, 1]) {
    line(details, p(f, u, peak + 0.07, 0.18), p(f, u + side * 0.23, peak + 0.23, 0.18), 0.028, finial);
    line(details, p(f, u + side * 0.23, peak + 0.23, 0.18), p(f, u + side * 0.11, peak + 0.41, 0.18), 0.025, finial);
  }
}

function gasWorks(batch, details) {
  const green = 0x3d483f;
  const west = frontage([-446.14, 666.49], [-448.66, 682.93]);
  const peak = 10.18;
  verge(batch, west, peak, 8.83, 4.96, 12.8, green);
  gasGable(details, west, peak, 8.83, 4.96, 12.8, 0x596753);
  band(details, west, 1.70, 0xab7957, 3.55, west.length, 0.09);
  for (const [u, width, spring, rise] of [[5.92, 3.77, 3.06, 1.60], [10.18, 3.64, 5.09, 2.22], [14.32, 3.43, 3.48, 1.59]]) {
    archCrown(details, west, u, width, spring, rise, 0x987050);
    for (const side of [-1, 1]) {
      const x = u + side * width / 2;
      block(details, west, x - 0.08, x + 0.08, 1.79, spring, 0.03, 0.14, 0x855f4b);
    }
  }
  for (const u of [5.44, 14.18]) {
    opening(details, west, u, 1.29, 1.83, 4.16, { arch: 0.32, rows: 3, trim: 0xc8ab7a });
    archCrown(details, west, u, 1.51, 3.82, 0.39, goldenBrick);
  }
  opening(details, west, 5.60, 1.32, -0.15, 1.38, { arch: 0.22, rows: 2, trim: 0xa48762, glazing: darkGlass });
  for (const [u, width, height] of [[10.34, 1.47, 1.32], [14.11, 2.20, 1.59]]) {
    opening(details, west, u, width, -1.48, height, { arch: 0.32, trim: 0x92704e, glazing: redDoor, door: true, cols: 1 });
    archCrown(details, west, u, width + 0.14, height - 0.29, 0.38, goldenBrick);
  }
  rose(details, west, peak, 5.96, 0.59, goldenBrick, 0x384139);
  const tower = frontage([-438.81, 669.73], [-439.07, 671.26]);
  band(details, tower, 3.84, 0x948363, 0.05, tower.length - 0.05, 0.13);
  band(details, tower, 6.16, 0x948363, 0.05, tower.length - 0.05, 0.12);
  opening(details, tower, 0.78, 1.16, -1.45, 1.42, { door: true, glazing: redDoor, trim: 0xb08961 });
  const towerGable = frontage([-438.46, 667.65], [-439.35, 671.85]);
  for (const x of [0.99, 2.91]) archCrown(details, towerGable, x, 1.39, 5.82, 0.65, 0x8a674c);
  verge(batch, towerGable, 2.04, 8.66, 7.23, 4.08, green);
  const small = frontage([-433.12, 653.11], [-434.63, 662.51]);
  opening(details, small, small.length * 0.5, 2.20, -1.45, 1.87, { arch: 0.38, rows: 2, cols: 3, trim: 0xa39167, glazing: redDoor });
  rose(details, small, small.length * 0.5, 4.73, 0.42, goldenBrick, 0x383b35);
  verge(batch, small, small.length * 0.5, 7.26, 3.88, small.length, green);
  gasGable(details, small, small.length * 0.5, 7.26, 3.88, small.length, 0x596753);

  const east = frontage([-422.32, 686.55], [-417.52, 655.56]);
  const wings = [
    { u: 5.83, width: 11.64, peak: 8.94, eave: 5.38 },
    { u: 26.46, width: 9.95, peak: 7.26, eave: 3.89 },
  ];
  for (const wing of wings) {
    verge(batch, east, wing.u, wing.peak, wing.eave, wing.width, green);
    gasGable(details, east, wing.u, wing.peak, wing.eave, wing.width, 0x53634e);
    rose(details, east, wing.u, wing.eave + 1.38, 0.38, 0x9c7652, darkGlass);
    band(details, east, 1.29, 0x916549, wing.u - wing.width * 0.5, wing.u + wing.width * 0.5, 0.10);
    for (const u of [wing.u - wing.width * 0.23, wing.u, wing.u + wing.width * 0.23]) {
      opening(details, east, u, 1.49, -0.91, 1.84, { arch: 0.36, rows: 3, cols: 2, trim: 0xb29569 });
      archCrown(details, east, u, 1.72, 1.47, 0.47, goldenBrick);
    }
    for (const u of [wing.u - 2.10, wing.u + 2.10]) {
      opening(details, east, u, 1.11, 2.60, wing.eave - 0.2, { arch: 0.23, rows: 3, cols: 2, trim: 0xb29373 });
    }
  }
  for (const u of [13.12, 15.49, 17.86, 20.23]) {
    opening(details, east, u, 1.24, -0.63, 2.11, { arch: 0.31, rows: 3, cols: 2, trim: 0xac805d });
  }
  for (const f of [
    frontage([-448.66, 682.93], [-435.85, 684.94]),
    frontage([-435.72, 684.43], [-422.32, 686.55]),
    frontage([-417.52, 655.56], [-433.12, 653.11]),
  ]) {
    for (const frac of [0.16, 0.38, 0.62, 0.84]) {
      opening(details, f, f.length * frac, 1.30, -0.22, 2.49, { arch: 0.28, rows: 3, trim: 0xb19774 });
    }
  }
  return [
    ['GEMEENTE', 5.55], ['GASFABRIEK', 5.13], ['1904', 4.73],
  ].map(([text, y]) => {
    const [ax, , az] = p(east, 4.34, y, 0.18), [bx, , bz] = p(east, 7.42, y, 0.18);
    return { a: { x: bx, z: bz }, b: { x: ax, z: az }, lo: y - 0.56, hi: y + 0.56,
      text, color: 'transparent', textColor: '#d7c3a4' };
  }).concat({
    text: 'HERBERGIER', vertical: true, lo: 2.23, hi: 5.36, color: 'transparent',
    a: { x: -439.03, z: 669.80 }, b: { x: -439.09, z: 670.17 },
  });
}

function gasPurifier(batch, details) {
  const west = frontage([-432.19, 623.65], [-433.98, 635.64]);
  const u = west.length * 0.495;
  const crown = [[u - 2.37, 2.15], [u + 2.37, 2.15], [u + 2.37, 5.31], [u, 6.92], [u - 2.37, 5.31]];
  surface(details, west, crown, darkGlass, 0.025);
  crown.forEach(([a, y], i) => {
    const [b, h] = crown[(i + 1) % crown.length];
    line(details, p(west, a, y, 0.085), p(west, b, h, 0.085), 0.085, 0xe0d9cd);
  });
  for (let i = -3; i <= 3; i++) {
    const a = u + 0.57 * i;
    patch(details, west, a - 0.035, a + 0.035, 2.15, 6.87 - Math.abs(i) * 0.391, 0xa7a69d, 0.065);
  }
  for (const y of [3.12, 4.12, 5.19]) patch(details, west, u - 2.37, u + 2.37, y, y + 0.052, 0xa7a69d, 0.065);
  verge(batch, west, u, 7.23, 3.28, west.length, ivory);
  opening(details, west, u, 1.52, -1.38, 1.43, { door: true, cols: 2, rows: 2, trim: 0x9c9481, glazing: 0x4a5558 });
  for (const a of [2.56, 9.49]) {
    opening(details, west, a, 1.34, -0.18, 1.50, { rows: 2, glazing: glass, trim: ivory });
  }
  for (const [a, b] of [
    [[-417.35, 625.45], [-431.7, 623.28]],
    [[-431.18, 636.49], [-419.29, 638.29]],
  ]) {
    const f = frontage(a, b);
    band(details, f, 0.86, 0xb99067, 0, f.length, 0.09);
    for (let i = 0; i < 4; i++) {
      const x = f.length * (i + 0.50) / 4;
      opening(details, f, x, 1.02, 0.20, 2.15, { rows: 3, trim: 0xa39478 });
    }
  }
}

function gasKeeper(details) {
  for (const [a, b, bays] of [
    [[-423.2, 736.2], [-419.88, 736.57], 2],
    [[-418.97, 741.15], [-410.85, 742.0], 3],
    [[-410.7, 740.56], [-406.54, 741.08], 2],
    [[-422.32, 727.69], [-423.2, 736.2], 3],
    [[-406.54, 741.08], [-406.03, 736.12], 2],
  ]) {
    const f = frontage(a, b);
    band(details, f, -1.16, 0x8d5447, 0, f.length, 0.14);
    band(details, f, 0.56, 0x9a5e48, 0, f.length, 0.13);
    for (let i = 0; i < bays; i++) {
      const u = f.length * (i + 0.5) / bays;
      const door = i === 1 && bays === 3 && f.ux > 0.5;
      opening(details, f, u, door ? 1.11 : 0.91, door ? -1.67 : -0.74, 0.83, {
        arch: 0.13, trim: 0xc3a16e, glazing: door ? 0x35423c : glass, door, shutter: !door, rows: 3, cols: 2,
      });
      archCrown(details, f, u, 1.14, 0.75, 0.27, 0xb58960);
    }
  }
}

export function createHoekelum() {
  const batch = new CivicBatch(), details = new CivicBatch();
  const masonry = [], platforms = [];
  const colliders = [
    estateShell(batch, masonry, ESTATE_SURVEY.castle, brick, slate, points => points.every(([x, y, z]) =>
      y >= 9.75 && x >= 350.42 && x <= 352.65 && z >= 3391.90 && z <= 3394.56)),
    estateShell(batch, masonry, ESTATE_SURVEY.coach, paleBrick, slate),
  ];
  castleDetails(batch, details, platforms);
  coachDetails(batch, details);
  bridge(batch, details, colliders, platforms);
  const group = estateGroup('Kasteel Hoekelum and coach house', batch, masonry, colliders, details);
  group.userData.platforms = platforms;
  return group;
}

export function createTheehuisHoekelum(footprints, site) {
  const batch = new CivicBatch(), detail = new CivicBatch(), masonry = [], colliders = [];
  const ochre = 0xc4a358, plaster = 0xe2dbc3, green = 0x284334, zinc = 0x65645e;
  const plan = footprints.map(({ outer }) => outer.map(({ x, z }) => [x, z]));
  const roofFace = (points, color) => batch.polygon([polygonNormal(points).y < 0 ? points.slice().reverse() : points], color);

  const [house, shed] = plan;
  const rear = frontage(house[0], house[1]), width = rear.length, half = width / 2;
  const join = 11.8, front = 16.15;
  const ground = terrainHeightAt(site.x, site.z);
  const floor = ground + 0.15;
  const eave = floor + 2.81, ridge = floor + 5.42;
  const at = (u, d, y) => p(rear, u, y, -d);
  function walls(ring, base, top, decorate) {
    ring.forEach((a, i) => {
      const f = frontage(a, ring[(i + 1) % ring.length]);
      const wall = decorate(f, i);
      const start = batch.vertices.length / 3;
      const bottom = Math.min(base, terrainHeightAt(...a) - 0.12, terrainHeightAt(...ring[(i + 1) % ring.length]) - 0.12);
      patch(batch, f, 0, f.length, bottom, top, wall, 0);
      if (wall !== plaster) for (let j = start; j < batch.vertices.length / 3; j++) masonry[j] = 1;
    });
  }

  walls(house, floor, eave, (f, i) => {
    const mid = f.length / 2;
    if (i >= 2 && i <= 6) {
      block(detail, f, 0, f.length, floor - 0.08, floor + 0.21, -0.02, 0.045, 0x303632);
      if (i === 4) opening(detail, f, mid, 1.18, floor + 0.09, floor + 2.31,
        { trim: ivory, glazing: green, cols: 2, rows: 2, door: true });
      if (i === 3 || i === 5) opening(detail, f, mid, 1.20, floor + 0.71, floor + 2.28,
        { trim: ivory, glazing: darkGlass, cols: 2, rows: 3, shutter: true });
      if (i === 2 || i === 6) surface(detail, f, arched(mid, 0.69, floor + 1.68, floor + 2.04, 0.34), darkGlass);
      return plaster;
    }
    if (i === 7) {
      opening(detail, f, 2.18, 0.92, floor + 0.03, floor + 2.22,
        { trim: ivory, glazing: green, cols: 1, rows: 2, door: true });
      for (const u of [5.47, 8.92]) opening(detail, f, u, 1.12, floor + 0.75, floor + 2.23,
        { trim: ivory, cols: 2, rows: 3, shutter: true });
    }
    if (i === 0 || i === 1) opening(detail, f, mid, 1.10, floor + 0.76, floor + 2.25,
      { trim: ivory, cols: 2, rows: 3, shutter: true });
    return brick;
  });
  surface(batch, rear, [[0, eave], [width, eave], [half, ridge]], brick, 0);
  roofFace([at(-0.26, -0.22, eave), at(half, -0.22, ridge), at(half, join, ridge), at(-0.26, join, eave)], slate);
  roofFace([at(half, -0.22, ridge), at(width + 0.26, -0.22, eave), at(width + 0.26, join, eave), at(half, join, ridge)], slate);

  // The thatch curves from the tiled ridge over the three-sided veranda.
  const rim = [[-0.26, join], [-0.26, 13.43], [1.48, 15.62], [2.65, front],
    [width - 2.65, front], [width - 1.48, 15.62], [width + 0.26, 13.43], [width + 0.26, join]];
  const thatch = [0x7f6b50, 0x877356, 0x837054, 0x8b7557, 0x837054, 0x877356, 0x7f6b50];
  const roofPoint = (i, t) => {
    const [u, d] = rim[i], atSeam = i === 0 || i === rim.length - 1;
    return at(THREE.MathUtils.lerp(u, half, t), THREE.MathUtils.lerp(d, join, t),
      eave + (ridge - eave) * (atSeam ? t : t ** 1.62));
  };
  for (let i = 1; i < rim.length; i++) {
    for (let band = 0; band < 7; band++) {
      const a = band / 7, b = (band + 1) / 7;
      roofFace([roofPoint(i - 1, a), roofPoint(i, a), roofPoint(i, b), roofPoint(i - 1, b)], thatch[i - 1]);
    }
    const a = at(...rim[i - 1], eave), b = at(...rim[i], eave);
    const edge = frontage([b[0], b[2]], [a[0], a[2]]);
    block(batch, edge, 0, edge.length, eave - 0.15, eave + 0.02, -0.09, 0.02, 0x594632);
    const panels = Math.max(1, Math.round(edge.length / 0.33));
    for (let panel = 0; panel < panels; panel++) {
      const w = edge.length / panels, u = (panel + 0.5) * w;
      surface(detail, edge, [[u - w / 2, eave - 0.13], [u, eave - 0.27],
        [u + w / 2, eave - 0.13]], panel % 2 ? 0xb6323c : ivory, 0.026);
    }
  }
  const [capX, , capZ] = at(half, join + 0.04, ridge);
  for (let i = 0; i < 16; i++) {
    const capPoint = (j, y) => [capX + 0.48 * Math.sin(j * Math.PI / 8), y, capZ + 0.48 * Math.cos(j * Math.PI / 8)];
    batch.quad(capPoint(i, ridge - 0.06), capPoint(i + 1, ridge - 0.06),
      capPoint(i + 1, ridge + 0.59), capPoint(i, ridge + 0.59), Math.floor(i / 2) % 2 ? 0xb22c38 : ivory);
  }
  batch.solid(new THREE.CylinderGeometry(0.52, 0.52, 0.10, 16).translate(capX, ridge + 0.62, capZ), zinc);

  const terrace = rim.map(([u, d]) => at(u, d + 0.13, floor));
  roofFace(terrace, 0x8f8570);
  for (let i = 0; i < terrace.length; i++) {
    const a = terrace[i], b = terrace[(i + 1) % terrace.length];
    const edge = frontage([a[0], a[2]], [b[0], b[2]]);
    block(batch, edge, 0, edge.length, floor - 0.22, floor, -0.06, 0.08, 0x82734f);
  }
  for (const [u, d] of [[0.25, 13.02], [1.82, 15.38], [width - 1.82, 15.38], [width - 0.25, 13.02]]) {
    const [x, , z] = at(u, d, floor);
    batch.solid(new THREE.BoxGeometry(0.40, 0.17, 0.40).translate(x, floor + 0.085, z), 0x474942);
    batch.solid(new THREE.CylinderGeometry(0.111, 0.148, eave - floor - 0.26, 10)
      .translate(x, (eave + floor) / 2 + 0.04, z), ochre);
    batch.solid(new THREE.BoxGeometry(0.32, 0.14, 0.32).translate(x, eave - 0.14, z), ivory);
    colliders.push({ minX: x - 0.20, maxX: x + 0.20, minZ: z - 0.20, maxZ: z + 0.20, minY: floor, maxY: eave });
  }
  colliders.push(footprintCollider([house], ground - 0.24, ridge + 0.67));

  const shedGround = terrainHeightAt(shed[0][0], shed[0][1]), shedEave = shedGround + 2.56, shedRidge = shedGround + 4.57;
  const gable = frontage(shed[2], shed[3]), back = frontage(shed[0], shed[1]);
  walls(shed, shedGround + 0.04, shedEave, (f, i) => {
    if (i === 2) {
      opening(detail, f, f.length / 2, 1.03, shedGround + 0.07, shedGround + 2.14,
        { trim: ivory, glazing: green, cols: 1, rows: 1, door: true });
      rose(detail, f, f.length / 2, shedGround + 3.64, 0.21, ivory, darkGlass);
    }
    return burntBrick;
  });
  for (const f of [gable, back]) {
    surface(batch, f, [[0, shedEave], [f.length, shedEave], [f.length / 2, shedRidge]], burntBrick, 0);
    for (const u of [0, f.length]) line(detail, p(f, u, shedEave, 0.04), p(f, f.length / 2, shedRidge, 0.04), 0.039, ivory);
  }
  const ga = p(gable, gable.length / 2, shedRidge, 0.11), ba = p(back, back.length / 2, shedRidge, 0.11);
  roofFace([p(gable, -0.08, shedEave, 0.11), ga, ba, p(back, back.length + 0.08, shedEave, 0.11)], slate);
  roofFace([ga, p(gable, gable.length + 0.08, shedEave, 0.11), p(back, -0.08, shedEave, 0.11), ba], slate);
  colliders.push(footprintCollider([shed], shedGround - 0.22, shedRidge));
  const group = estateGroup(site.name, batch, masonry, colliders, detail);
  group.children[1].castShadow = false;
  group.children[1].userData.nearDetail = 95;
  group.userData.platforms = [{
    id: 'theehuis-hoekelum-veranda', outer: terrace.map(([x, , z]) => ({ x, z })), holes: [], height: () => floor,
  }];
  return group;
}

export function createGasfabriek() {
  const batch = new CivicBatch(), details = new CivicBatch();
  const masonry = [];
  const colliders = [
    estateShell(batch, masonry, ESTATE_SURVEY.works, 0x88665c, 0x575258),
    estateShell(batch, masonry, ESTATE_SURVEY.purifier, 0x987861, 0x575259),
    estateShell(batch, masonry, ESTATE_SURVEY.wkeeper, paleBrick, 0x595256),
  ];
  const lettering = gasWorks(batch, details);
  gasPurifier(batch, details);
  gasKeeper(details);
  const group = estateGroup('De Gasfabriek, Zuiverhuis and gasmaster’s house', batch, masonry, colliders, details);
  const sign = civicSigns(lettering);
  if (sign) {
    const map = sign.material.map;
    sign.material.dispose();
    sign.material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.35, side: THREE.DoubleSide });
    sign.userData.nearDetail = true;
    group.add(sign);
  }
  return group;
}
