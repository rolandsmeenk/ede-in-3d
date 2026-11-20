import * as THREE from 'three/webgpu';
import { attribute, mix, step, texture, uv, vertexColor } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { terrainHeightAt } from './terrain.js';
import { CivicBatch, civicSigns, polygonNormal, wallExtent } from './ede-civic-landmarks.js';
import { REEHORST, BUITENZORG, JOHANNUS } from './ede-venue-survey.js';

const glass = 0x30454e, pale = 0xdcd7c7, brass = 0x947039, shutter = 0x23332d;
const brick = 0x9b6255, red = 0x862e2c;
let masonryTexture;

function wallFrame(points) {
  const normal = polygonNormal(points);
  const { a, b, width } = wallExtent(points, normal);
  const low = Math.min(...points.map(p => p[1])), high = Math.max(...points.map(p => p[1]));
  if (!a || width < 0.075 || Math.abs(normal.y) > 0.026) return null;
  const dx = (b.x - a.x) / width, dz = (b.z - a.z) / width;
  const point = (u, y, depth = 0) => [a.x + u * dx + normal.x * depth, y, a.z + u * dz + normal.z * depth];
  const slide = (x, z) => (x - a.x) * dx + (z - a.z) * dz;
  return { a, b, width, low, high, normal, point, slide };
}

function panel(batch, frame, u, v, lo, hi, color, depth = 0.025, sheen = 0) {
  if (v <= u || hi <= lo) return;
  const p = frame.point;
  batch.quad(p(u, lo, depth), p(v, lo, depth), p(v, hi, depth), p(u, hi, depth), color, sheen);
}

function rect(frame, { u, width, lo, hi, arch = 0 }, depth) {
  const x0 = u - width / 2, x1 = u + width / 2, p = frame.point;
  const ring = [p(x0, lo, depth), p(x1, lo, depth)];
  if (arch > 0) for (let i = 0; i <= 8; i++) {
    const angle = i * Math.PI / 8;
    ring.push(p(u + Math.cos(angle) * width / 2, hi - arch + Math.sin(angle) * arch, depth));
  } else ring.push(p(x1, hi, depth), p(x0, hi, depth));
  return ring;
}

function windowSpec(u, width, lo, hi, extras = {}) {
  return { u, width, lo, hi, ...extras };
}

function fitsWall(frame, rings, spec) {
  const bounds = rings[0].map(([x, y, z]) => [frame.slide(x, z), y]);
  // Prefer actual openings on surveyed planar spans. Avoid putting a cut through a stepped roof or wall edge.
  function inside([x, y, z]) {
    const u = frame.slide(x, z);
    let inRing = false;
    for (let j = 0, i = bounds.length - 1; j < bounds.length; i = j++) {
      const [first, low] = bounds[i], [last, high] = bounds[j];
      if ((low > y) !== (high > y) && u < (last - first) * (y - low) / (high - low) + first) inRing = !inRing;
    }
    return inRing;
  }
  return rect(frame, spec, 0).every(inside);
}

function opening(batch, trim, frame, spec) {
  const depth = spec.reveal ?? 0.17;
  const outside = rect(frame, spec, 0), inside = rect(frame, spec, -depth), p = frame.point;
  const material = spec.color ?? glass, edgeColor = spec.frame ?? pale;
  batch.polygon([inside], material);
  for (let i = 0; i < outside.length; i++) {
    const j = (i + 1) % outside.length;
    batch.quad(outside[i], outside[j], inside[j], inside[i], 0x696d65);
  }
  const border = spec.border ?? 0.085, x0 = spec.u - spec.width / 2, x1 = spec.u + spec.width / 2;
  const domed = spec.arch ?? 0;
  const borderAt = domed ? spec.hi - domed : spec.hi;
  const crossing = (spec.hi - spec.lo) * 0.5 + spec.lo;
  panel(trim, frame, x0 - border, x0 + border, spec.lo, borderAt, edgeColor, 0.035);
  panel(trim, frame, x1 - border, x1 + border, spec.lo, borderAt, edgeColor, 0.035);
  panel(trim, frame, x0 - border, x1 + border, spec.lo - border, spec.lo + border, edgeColor, 0.04);
  if (domed > 0) {
    const rim = rect(frame, { ...spec, width: spec.width + 2 * border, lo: spec.lo, hi: spec.hi + border }, 0.04);
    const innerRim = rect(frame, spec, 0.04);
    for (let i = 2; i < rim.length - 1; i++) trim.quad(rim[i], rim[i + 1], innerRim[i + 1], innerRim[i], edgeColor);
  } else panel(trim, frame, x0 - border, x1 + border, spec.hi - border, spec.hi + border, edgeColor, 0.04);
  const cols = spec.cols ?? 2, rows = spec.rows ?? 2;
  for (let i = 1; i < cols; i++) {
    const u = x0 + spec.width * i / cols;
    panel(trim, frame, u - 0.025, u + 0.025, spec.lo, borderAt, edgeColor, -0.03);
  }
  for (let i = 1; i < rows; i++) {
    const y = spec.lo + (borderAt - spec.lo) * i / rows;
    panel(trim, frame, x0, x1, y - 0.025, y + 0.025, edgeColor, -0.03);
  }
  if (spec.shutters) {
    panel(trim, frame, x0 - spec.width * 0.42, x0 - 0.075, spec.lo, borderAt, shutter, 0.055);
    panel(trim, frame, x1 + 0.075, x1 + spec.width * 0.42, spec.lo, borderAt, shutter, 0.055);
  }
  if (spec.transom) panel(trim, frame, x0, x1, crossing + 0.24, crossing + 0.33, edgeColor, 0.035);
}

function label(labels, frame, u, width, lo, hi, text, color, textColor, depth = 0.15) {
  const a = frame.point(u - width / 2, lo, depth), b = frame.point(u + width / 2, lo, depth);
  labels.push({ text, a: { x: b[0], z: b[2] }, b: { x: a[0], z: a[2] }, lo, hi, color, textColor });
}

function siteColliders(outlines, minY, maxY) {
  return outlines.map(ring => {
    const outer = ring.map(([x, z]) => ({ x, z }));
    return {
      minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
      minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
      minY, maxY, polygon: { outer, holes: [] },
    };
  });
}

function textureMasonry(mesh, masonry) {
  const coords = [], { position, normal } = mesh.geometry.attributes;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const nx = normal.getX(i), nz = normal.getZ(i);
    if (masonry[i] === 2) {
      const span = Math.hypot(nx, nz);
      coords.push(span ? (x * nz - z * nx) / span / 1.12 : x / 1.12,
        span ? (x * nx + z * nz) / span / 1.05 : z / 1.05);
    } else coords.push((x * nz - z * nx) / 1.08, y / 0.64);
  }
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  mesh.geometry.setAttribute('venueMasonry', new THREE.Float32BufferAttribute(masonry, 1));
  masonryTexture ??= createFacadeSurfaceTexture().texture;
  const finish = attribute('venueMasonry', 'float');
  const grain = texture(masonryTexture, uv());
  const contrast = mix(grain.r, grain.b, step(1.5, finish));
  mesh.material.colorNode = vertexColor().mul(mix(1, contrast.mul(0.83).add(0.31), finish.min(1)));
}

export function buildVenue(name, survey, style, facade, entry) {
  const batch = new CivicBatch(), trim = new CivicBatch(), group = new THREE.Group(), colliders = [];
  const labels = [], masonry = [];
  const ground = Math.min(...survey.vertices.map(p => p[1]));
  const roof = Math.max(...survey.vertices.map(p => p[1]));
  const addFace = (rings, color, amount) => {
    const first = batch.vertices.length / 3;
    batch.polygon(rings, color);
    for (let i = first; i < batch.vertices.length / 3; i++) masonry[i] = amount;
  };
  const view = (index) => {
    const [type, ...rings] = survey.faces[index];
    const points = rings.map(ring => ring.map(i => survey.vertices[i]));
    return [type, points, wallFrame(points[0])];
  };
  const drawn = new Set();
  for (let index = 0; index < survey.faces.length; index++) {
    const [type, rings, frame] = view(index);
    if (type === 1) {
      addFace(rings, style.roof(rings[0]), style.roofFinish?.(index) ?? 0);
      continue;
    }
    const color = style.wall(rings[0], frame);
    if (drawn.has(index)) continue;
    const custom = frame && facade?.(index, frame, labels, trim) || {};
    if (custom.link) {
      for (const link of custom.link) drawn.add(link);
    }
    const target = custom.rings ?? rings;
    const targetFrame = custom.frame ?? frame;
    const requested = (custom.windows ?? []).filter(spec => fitsWall(targetFrame, target, spec));
    addFace([...target, ...requested.map(spec => rect(targetFrame, spec, 0))], custom.wallColor ?? color, style.masonry);
    for (const win of requested) opening(batch, trim, targetFrame, win);
  }
  // The full surveyed footprint prevents entering the closed exterior. Keep the
  // decorative stairs, gates, and portals out of the surrounding routes.
  colliders.push(...siteColliders(survey.outline, ground - 0.25, roof));
  group.name = name;
  group.userData.colliders = colliders;
  const main = batch.mesh();
  if (style.masonry) textureMasonry(main, Float32Array.from({ length: main.geometry.attributes.position.count }, (_, i) => masonry[i] ?? 0));
  group.add(main);
  entry?.(group, trim, labels, view, colliders);
  if (trim.vertices.length) {
    const detail = trim.mesh();
    detail.userData.nearDetail = true;
    detail.castShadow = false;
    group.add(detail);
  }
  if (labels.length) {
    const sign = civicSigns(labels, { wide: true });
    if (sign) {
      sign.userData.nearDetail = true;
      group.add(sign);
    }
  }
  return group;
}

function steppedApron(group, batch, frame, width, inner, outer, highest, tread, count, color) {
  const p = frame.point, u = (frame.width - width) / 2, v = u + width;
  const levels = [];
  for (let i = 0; i < count; i++) {
    const depth = outer - (outer - inner) * i / count, next = outer - (outer - inner) * (i + 1) / count;
    const h = highest - (count - 1 - i) * tread;
    batch.quad(p(u, h, next), p(u, h, depth), p(v, h, depth), p(v, h, next), color);
    panel(batch, frame, u, v, h - tread - 0.06, h, 0x706961, depth);
    levels.push({ outer: [p(u, h, next), p(v, h, next), p(v, h, depth), p(u, h, depth)].map(([x, , z]) => ({ x, z })), holes: [], height: () => h });
  }
  group.userData.platforms ??= [];
  group.userData.platforms.push(...levels.map((step, i) => ({ id: `${group.name}-entry-${i}`, ...step })));
}

export function createReehorst() {
  return buildVenue('De ReeHorst', REEHORST, {
    wall: (points, frame) => !(frame?.high > 8) && Math.max(...points.map(p => p[0])) > -19
      ? 0xe1ddd1 : frame?.high > 16 ? 0x8e8b87 : 0xa0958b,
    roof: points => Math.max(...points.map(p => p[0])) > -16 ? 0xb8b5ab : 0x626360,
    masonry: 0,
  }, (index, frame, labels, trim) => {
    const windows = [];
    if ([17, 33, 55].includes(index)) {
      for (let u = 0.85; u < frame.width - 0.9; u += 2.08) {
        windows.push(windowSpec(u, 1.60, -1.53, 0.91, { frame: 0xe1ddd1, rows: 1, cols: 1 }));
        if (index === 33) windows.push(windowSpec(u, 0.88, 2.18, 3.02, { frame: 0xdfd9ce, rows: 1, cols: 1 }));
      }
      panel(trim, frame, 0, frame.width, 1.09, 1.25, 0xc4c0b5, 0.09);
    }
    if ([144, 226, 322, 334].includes(index)) {
      for (let u = 0.84; u < frame.width - 0.7; u += 1.54)
        windows.push(windowSpec(u, 0.86, 4.81, 6.08, { frame: 0xddddd1, rows: 1, cols: 1 }));
    }
    if ([129, 280].includes(index)) {
      for (let u = 1.45; u < frame.width - 0.8; u += 2.65) for (const lo of [2.1, 4.62, 7.14, 9.66, 12.18, 14.70]) {
        windows.push(windowSpec(u, 1.22, lo, lo + 1.31, { cols: 1, rows: 1, frame: 0x565650 }));
      }
      if (index === 280) label(labels, frame, frame.width / 2, 6.7, 17.02, 17.94, 'HOTEL', '#8e8b87', '#e5bf73');
    }
    return { windows };
  }, (group, trim, labels) => {
    const entryFrame = wallFrame([[-3.61,-4,2417.3],[-4.34,-4,2403.6],[-4.34,4,2403.6],[-3.61,4,2417.3]]);
    const p = entryFrame.point, w = entryFrame.width, mid = w / 2;
    const floor = -1.64, soffit = 1.54, canopyTop = 1.87;
    const columns = [0.32, 2.20, 4.15, 6.15, 8.1, 10.05, 12, w - 0.25];
    // The surveyed entry bows at the revolving door. Place its glazing in front of
    // the curved wall at the exact center of the Bennekomseweg canopy.
    for (let i = 1; i < columns.length; i++) {
      const first = columns[i - 1], last = columns[i];
      panel(trim, entryFrame, first + 0.04, last - 0.04, floor, soffit, 0x4c646f, 0.74, 0.92);
      panel(trim, entryFrame, first - 0.047, first + 0.047, floor, soffit, 0xe9e6db, 0.76);
    }
    const [x, , z] = p(mid, floor, 2.08);
    trim.solid(new THREE.CylinderGeometry(1.48, 1.48, 2.68, 16, 1, true).translate(x, floor + 1.36, z), 0x536b71);
    for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      trim.solid(new THREE.BoxGeometry(0.070, 2.73, 0.070)
        .translate(x + Math.cos(a) * 1.48, floor + 1.36, z + Math.sin(a) * 1.48), 0x534741);
    }
    trim.solid(new THREE.CylinderGeometry(1.51, 1.51, 0.18, 16).translate(x, soffit - 0.50, z), 0x4b3834);
    trim.quad(p(0, canopyTop, 0.52), p(0, canopyTop, 4.18), p(w, canopyTop, 4.18), p(w, canopyTop, 0.52), pale);
    trim.quad(p(0, soffit, 0.52), p(w, soffit, 0.52), p(w, soffit, 4.18), p(0, soffit, 4.18), 0xbbb6a9);
    panel(trim, entryFrame, 0, w, soffit, canopyTop + 0.03, 0xcac6b8, 4.18);
    label(labels, entryFrame, mid, w * 0.87, canopyTop + 0.09, canopyTop + 0.78, 'DE REEHORST', '#d9d5c8', '#b33e34', 4.29);
    // AHN's public forecourt is about 0.45 m below the surveyed door landing.
    steppedApron(group, trim, entryFrame, w - 0.10, 0.46, 5.34, floor, 0.13, 4, 0x827873);
    const sign = wallFrame([[8.0,-2.12,2404.7],[7.8,-2.12,2402.4],[7.8,1.4,2402.4],[8.0,1.4,2404.7]]);
    panel(trim, sign, 0, sign.width, -2.04, 1.02, 0x242828, 0.083);
    label(labels, sign, sign.width * 0.5, sign.width - 0.24, 0.19, 0.85, 'ReeHorst', '#8b202b', '#f2e3ce', 0.099);
    label(labels, sign, sign.width * 0.5, sign.width - 0.24, -0.55, 0.095, 'RH HOTEL', '#333333', '#f4eee7', 0.099);
    label(labels, sign, sign.width * 0.5, sign.width - 0.24, -1.29, -0.65, 'ATELIER', '#76384e', '#f4eee7', 0.099);
    label(labels, sign, sign.width * 0.5, sign.width - 0.24, -2.01, -1.39, 'ZENZATA', '#3e3c33', '#ded380', 0.099);
  });
}

export function createBuitenzorg() {
  return buildVenue('Buitenzorg', BUITENZORG, {
    wall: points => Math.max(...points.map(p => p[0])) > -291 ? 0xf0e6d8 : 0xf2ebdc,
    roof: points => Math.max(...points.map(p => p[1])) > 4 ? 0x514d46 : 0x615c55,
    masonry: 0,
  }, (index, frame, labels, trim) => {
    const windows = [], middle = frame.width / 2;
    if ([23, 38, 63, 86].includes(index)) {
      windows.push(windowSpec(middle, Math.min(frame.width - 0.22, 1.16), -2.40, -0.02,
        { arch: 0.24, shutters: true, frame: brass, transom: true }));
      windows.push(windowSpec(middle, Math.min(frame.width - 0.22, 1.02), 1.21, 3.54, { rows: 3, frame: brass }));
    }
    if (index === 59) {
      windows.push(windowSpec(middle, 1.08, -2.48, 0.22, { arch: 0.24, cols: 1, frame: brass, transom: true }));
      windows.push(windowSpec(middle, 0.93, 1.78, 3.62, { rows: 3, frame: brass }));
      label(labels, frame, middle, 2.77, 0.61, 1.13, 'BUITENZORG', '#f5ecda', '#222922');
      panel(trim, frame, 0.04, frame.width - 0.04, 3.85, 4.28, 0x7a5b3d, 0.12);
      const p = frame.point;
      trim.triangle(p(0.11,4.25,0.12), p(frame.width - 0.11,4.25,0.12), p(middle,4.82,0.12), 0xb38d5e);
    }
    if ([13, 114].includes(index))
      windows.push(windowSpec(middle, 1.27, 1.91, 3.46, { rows: 2, frame: brass }));
    if (index === 80) {
      for (let u = 1.88; u < frame.width - 1; u += 3.16)
        windows.push(windowSpec(u, 1.97, -2.37, -0.04, { frame: brass, cols: 3, rows: 2 }));
    }
    if ([59, 63, 86, 114].includes(index)) panel(trim, frame, 0.025, frame.width - 0.025, 0.57, 0.64, 0xd6c5a9, 0.035);
    return { windows };
  }, (group, trim, labels, view, colliders) => {
    const [,,entry] = view(59);
    steppedApron(group, trim, entry, 2.64, 0.0, 1.19, -2.41, 0.115, 2, 0x92887b);
    const gate = wallFrame([[-297.2,-3,-326.9],[-303.9,-3,-328.0],[-303.9,3,-328.0],[-297.2,3,-326.9]]);
    const mid = gate.width / 2, g = gate.point;
    for (const u of [0.47, gate.width - 0.47]) {
      const [x, , z] = g(u, 0);
      const ground = terrainHeightAt(x, z) - 0.04;
      trim.solid(new THREE.BoxGeometry(0.53, 2.18 - ground, 0.55).translate(x, (2.18 + ground) / 2, z), 0xd4cbb9);
      trim.solid(new THREE.BoxGeometry(0.64, 0.19, 0.66).translate(x, 2.20, z), 0xc4bcae);
      trim.solid(new THREE.BoxGeometry(0.72, 0.22, 0.72).translate(x, ground + 0.11, z), 0x786c62);
      colliders.push({ minX: x - 0.26, maxX: x + 0.26, minZ: z - 0.27, maxZ: z + 0.27, minY: ground, maxY: 2.3 });
    }
    for (let i = 0; i < 16; i++) {
      const u = 0.68 + (gate.width - 1.36) * i / 16, v = 0.68 + (gate.width - 1.36) * (i + 1) / 16;
      const at = t => 3.15 - Math.pow((t - mid) / mid, 2) * 2.76;
      trim.quad(g(u, at(u) - 0.47, 0.028), g(v, at(v) - 0.47, 0.028), g(v, at(v), 0.028), g(u, at(u), 0.028), 0xe0d5bd);
    }
    label(labels, gate, mid, 4.22, 2.71, 3.08, 'RESTAURANT BUITENZORG', '#e0d5bd', '#332d23', 0.095);
  });
}

function circularTrim(trim, frame, center, y, radius, color) {
  const p = frame.point;
  for (let i = 0; i < 28; i++) {
    const a = i * Math.PI / 14, b = (i + 1) * Math.PI / 14;
    const at = (theta, r) => p(center + r * Math.cos(theta), y + r * Math.sin(theta), 0.052);
    trim.quad(at(a, radius + 0.037), at(b, radius + 0.037), at(b, radius - 0.037), at(a, radius - 0.037), color);
  }
}

export function createJohannus() {
  return buildVenue('Johannus Orgelbouw', JOHANNUS, {
    wall: (points, frame) => frame?.high > -4 && frame.low > -6 ? 0xd1c8b7 : brick,
    roof: points => Math.max(...points.map(p => p[1])) > -2.6 ? 0x777e70 : 0x665c55,
    masonry: 0.84,
  }, (index, frame, labels, trim) => {
    const windows = [];
    if ([35, 39].includes(index)) {
      const step = frame.width / 5.5;
      for (let i = 0; i < 5; i++) {
        const u = frame.width * 0.04 + step * (i + 0.50);
        const tall = i === (index === 35 ? 3 : 1);
        if (tall) windows.push(windowSpec(u, step * 0.60, -12.09, -5.09, { rows: 6, cols: 3 }));
        else {
          windows.push(windowSpec(u, step * 0.64, -12.09, -8.75, { rows: 3, cols: 3 }));
          windows.push(windowSpec(u, step * 0.64, -7.39, -5.27, { rows: 1, cols: 3 }));
        }
      }
      panel(trim, frame, 0, frame.width, -4.50, -4.20, pale, 0.11);
      panel(trim, frame, 0, frame.width, -7.47, -7.39, pale, 0.06);
    }
    if ([8, 23, 9, 12].includes(index)) {
      const bays = index === 8 || index === 23 ? 1 : Math.max(1, Math.round(frame.width / 4.3));
      for (let i = 0; i < bays; i++) {
        windows.push(windowSpec(frame.width * (i + 0.5) / bays, Math.min(frame.width / bays - 0.4, 2.84),
          -12.09, -5.13, { rows: 5, cols: 3 }));
      }
      panel(trim, frame, 0, frame.width, -4.51, -4.23, pale, 0.11);
    }
    if (index === 18) {
      const ring = [[-3060.88,-12.43,2065.26],[-3065.28,-12.43,2069.58],[-3065.28,-1.33,2069.58],[-3063.13,-0.00,2067.47],[-3060.88,-1.39,2065.26]];
      const front = wallFrame(ring), w = front.width, mid = w / 2;
      const p = front.point;
      panel(trim, front, 0.015, w - 0.015, -3.24, -1.63, pale, 0.052);
      trim.triangle(p(0,-1.61,0.053),p(w,-1.54,0.053),p(mid,-0.06,0.053),pale);
      for (const u of [0.27, 0.69, w - 0.69, w - 0.27]) {
        const [x, , z] = p(u,-12.39,0.34);
        trim.solid(new THREE.CylinderGeometry(0.105, 0.12, 8.66, 10).translate(x, -8.06, z), red);
      }
      circularTrim(trim, front, mid, -6.74, 0.96, pale);
      panel(trim, front, 0.02, w - 0.02, -9.63, -9.37, pale, 0.155);
      label(labels, front, mid, w - 1.48, -2.94, -2.19, 'JOHANNUS', '#ddd7c8', '#44342c', 0.155);
      return { frame: front, rings: [ring], link: [21], wallColor: 0xa17b68,
        windows: [windowSpec(mid, w - 1.63, -9.44, -3.34, { rows: 6, cols: 5 }),
          windowSpec(mid, w - 1.63, -12.34, -9.73, { rows: 2, cols: 4, frame: pale })] };
    }
    return { windows };
  });
}
