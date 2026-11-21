import * as THREE from 'three/webgpu';
import { mix, normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { CivicBatch, polygonNormal, wallColliders } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { EDE_VELDHUIZEN_LANDMARKS, VELDHUIZEN_SURVEYS } from './ede-veldhuizen-survey.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

export { EDE_VELDHUIZEN_LANDMARKS };

const cream = 0xc8bda4, coping = 0xd1cdc0, paving = 0x939088;
const timber = 0x343737, displayGlass = 0x4c5e60;
const concrete = 0xd5d5ca, aggregate = 0xaaa591, brownBrick = 0x70594d;
const groundAt = (x, z, fallback) => getTerrain() ? terrainHeightAt(x, z) : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const rail = 0x544b43;

let masonryTexture;
function surfaceFinish(group, roofTiles = false) {
  masonryTexture ??= createFacadeSurfaceTexture().texture;
  const across = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
  const bricks = texture(masonryTexture, vec2(across.div(1.10), positionWorld.y.div(0.70))).r;
  const angle = normalWorld.y.abs();
  const mortar = mix(0.83, 1.06, bricks);
  let tone = mix(1, mortar, angle.lessThan(0.14).toFloat());
  if (roofTiles) {
    const axis = positionWorld.x.mul(0.924).sub(positionWorld.z.mul(0.383));
    const courses = texture(masonryTexture, vec2(axis.div(0.86), positionWorld.y.div(0.68))).r;
    tone = mix(tone, mix(0.78, 1.12, courses), angle.greaterThan(0.52).and(angle.lessThan(0.92)).toFloat());
  }
  group.children[0].material.colorNode = vertexColor().mul(tone);
}

function rectangularBeam(batch, a, b, depth, height, color) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  batch.solid(new THREE.BoxGeometry(Math.hypot(dx, dz), height, depth)
    .rotateY(-Math.atan2(dz, dx))
    .translate((a[0] + b[0]) / 2, a[2] - height / 2, (a[1] + b[1]) / 2), color);
}

const shopStreet = [
  [-1920.7, 346.9], [-1906.6, 381.8], [-1893.0, 418.9], [-1882.7, 426.2],
  [-1871.7, 461.1], [-1881.6, 487.6], [-1873.4, 502.3],
];
const shopSigns = [
  ['SAFARI', -1911, 345.5, '#393d30', '#eee5ce'],
  ['Jumbo', -1895, 374.5, '#e3b523', '#282423'],
  ['Kruidvat', -1899.1, 395.0, '#bc3029', '#f3efdd'],
  ['Marhaba', -1891.2, 432.0, '#ded9ca', '#922b25'],
  ['Zeeman', -1883.0, 445.0, '#edd440', '#1c3e85'],
  ['Lidl', -1869.8, 484.9, '#27579a', '#f2d92a'],
];

function facesShoppingStreet(wall) {
  const [x, , z] = wall.point(wall.width / 2, 0);
  for (let i = 1; i < shopStreet.length; i++) {
    const [ax, az] = shopStreet[i - 1], [bx, bz] = shopStreet[i];
    const dx = bx - ax, dz = bz - az;
    const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const u = ax + dx * t - x, v = az + dz * t - z;
    const distance = Math.hypot(u, v);
    if (distance < 13 && wall.normal.x * u + wall.normal.z * v > distance * 0.56) return true;
  }
  return false;
}

function bellFacade(wall, displayed) {
  const { buildingIndex, width, low, high, point, trim } = wall;
  const [x, , z] = point(width / 2, 0);
  if (buildingIndex >= 6) {
    if (wall.normal.x > 0.9 && width > 1.5) {
      surveyPanel(wall, 0.10, width - 0.10, low + 0.22, high - 0.28, 0x6b716a);
      for (let y = low + 0.37; y < high - 0.28; y += 0.24) {
        surveyPanel(wall, 0.12, width - 0.12, y, y + 0.026, 0x5b615c, 0.047);
      }
    }
    return 0xbab29f;
  }
  if (width < 0.67) return;
  const grade = groundAt(x, z, -8.35);
  if (width > 1.8 && low < grade + 0.55) {
    const bottom = Math.max(low + 0.12, grade + 0.14), top = Math.min(-5.51, high - 0.24);
    const retail = facesShoppingStreet(wall);
    const count = Math.max(1, Math.round(width / (retail ? 4.6 : 5.5))), pitch = width / count;
    for (let i = 0; i < count; i++) {
      const l = i * pitch + 0.16, r = (i + 1) * pitch - 0.16;
      if (top - bottom < 1.58) continue;
      if (retail) {
        const paint = [displayGlass, 0x45565b, 0x5e685f][(i + buildingIndex) % 3];
        if (!surveyWindow(wall, l, r, bottom, top, { frame: timber, color: paint, columns: 3 })) continue;
        surveyPanel(wall, l, r, bottom + 0.47, bottom + 0.61, 0x44483f, 0.053);
        surveyPanel(wall, l, r, top - 0.15, top + 0.07, timber, 0.075);
        if (surveyOpeningFits(wall, l, r, top + 0.22, top + 0.65)) {
          for (const [name, sx, sz, bg, fg] of shopSigns) {
            const [wx, , wz] = point((l + r) / 2, 0);
            if (displayed.has(name) || Math.hypot(wx - sx, wz - sz) > 4.8) continue;
            surveyLabel(wall, l + 0.10, r - 0.10, top + 0.22, top + 0.67, name, bg, fg);
            displayed.add(name);
            break;
          }
        }
      } else if (surveyOpeningFits(wall, l + 0.32, r - 0.32, bottom, top)) {
        surveyPanel(wall, l + 0.32, r - 0.32, bottom, top, 0x62665e);
        surveyPanel(wall, l + 0.32, r - 0.32, top - 0.09, top, 0xa39e8b, 0.054);
      }
    }
  }
  if (low > -5.16 && high > -2.8) {
    const count = Math.max(1, Math.round(width / 3.35));
    for (let i = 0; i < count; i++) {
      const u = width * (i + 0.5) / count, half = Math.min(1.15, width / count * 0.39);
      const sill = low < -4.0 ? -3.95 : low + 0.21;
      const head = Math.min(high - 0.22, sill + 1.75);
      if (head - sill < 0.59) continue;
      if (width > 4 && surveyOpeningFits(wall, u - half - 0.08, u + half + 0.08, sill - 0.13, head + 0.14)) {
        surveyPanel(wall, u - half - 0.08, u + half + 0.08, sill - 0.13, head + 0.14, timber, 0.018);
      }
      surveyWindow(wall, u - half, u + half, sill, head,
        { frame: 0xa9aaa0, color: 0x47595b, columns: half > 0.72 ? 3 : 1 });
    }
  }
  // The pale projecting edge and regular concrete corbels appear above the shop fronts.
  if (low < -7 && high > -4.56 && width > 2.8 && facesShoppingStreet(wall)) {
    if (surveyOpeningFits(wall, 0.07, width - 0.07, -4.79, -4.64)) {
      const [ax, , az] = point(0.07, 0, 0.11), [bx, , bz] = point(width - 0.07, 0, 0.11);
      rectangularBeam(trim, [ax, az, -4.62], [bx, bz, -4.62], 0.26, 0.14, coping);
    }
    for (let u = 1.6; u < width - 0.45; u += 3.4) {
      if (!surveyOpeningFits(wall, u - 0.12, u + 0.12, -5.26, -4.66)) continue;
      const [bx, , bz] = point(u, 0, 0.16);
      trim.solid(new THREE.BoxGeometry(0.26, 0.62, 0.26).translate(bx, -4.96, bz), coping);
    }
  }
  if (low > -2.6 && width > 1.0 && width < 4.4 && high - low < 2.1) return timber;
}

const deckFaces = [
  [423, 454, 461, 462, 465, 469, 472, 474, 479],
  [289, 299, 301, 307], [271, 286, 288, 289, 304], [], [], [71],
];

function surveyedDeck(building, index, platforms) {
  for (const face of deckFaces[index] ?? []) {
    const [, ...indices] = building.faces[face];
    const rings = indices.map(ring => ring.map(i => building.points[i]));
    const n = polygonNormal(rings[0]);
    const [x0, y0, z0] = rings[0][0];
    const [outer, ...holes] = rings.map(ring => ring.map(([x, , z]) => ({ x, z })));
    platforms.push({
      id: `bellestein-deck-${index}-${face}`, outer, holes,
      height: (x, z) => y0 - (n.x * (x - x0) + n.z * (z - z0)) / n.y,
    });
  }
}

function accessSpan(batch, trim, colliders, platforms, id, start, end, width, rise, { steps = false, openStart = 0 } = {}) {
  const dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz);
  const nx = -dz / length, nz = dx / length, half = width / 2;
  const corner = (t, v, y) => [lerp(start[0], end[0], t) + nx * v, y, lerp(start[1], end[1], t) + nz * v];
  const a = start[2], b = end[2], sections = steps ? Math.ceil(Math.abs(b - a) / 0.16) : 1;
  const stepY = i => lerp(a, b, i / sections);
  for (let i = 0; i < sections; i++) {
    const u = i / sections, v = (i + 1) / sections;
    const y0 = steps ? stepY(i + 1) : stepY(i), y1 = stepY(i + 1);
    const corners = [corner(u, -half, y0), corner(u, half, y0), corner(v, half, y1), corner(v, -half, y1)];
    batch.quad(...corners, steps && i % 2 ? 0x8f8d83 : paving);
    batch.quad(corner(u, half, stepY(i) - 0.30), corner(u, half, y0), corner(u, -half, y0),
      corner(u, -half, stepY(i) - 0.30), coping);
    batch.quad(corner(v, -half, y1 - 0.30), corner(v, half, y1 - 0.30),
      corner(u, half, stepY(i) - 0.30), corner(u, -half, stepY(i) - 0.30), coping);
  }
  for (const direction of [-1, 1]) {
    const inner = half * direction, edge = (half + 0.25) * direction;
    const from = direction > 0 ? openStart / length : 0, fromY = lerp(a, b, from);
    const panel = v => [corner(from, v, fromY - 0.30), corner(1, v, b - 0.30),
      corner(1, v, b + rise), corner(from, v, fromY + rise)];
    const masonry = panel(edge), side = panel(inner);
    batch.quad(...(direction > 0 ? masonry : masonry.reverse()), cream);
    batch.quad(...(direction > 0 ? side.reverse() : side), cream);
    batch.quad(corner(from, Math.min(edge, inner), fromY + rise), corner(from, Math.max(edge, inner), fromY + rise),
      corner(1, Math.max(edge, inner), b + rise), corner(1, Math.min(edge, inner), b + rise), coping);
    const spans = Math.ceil(length * (1 - from) / 2.5);
    for (let i = 0; i < spans; i++) {
      const u = lerp(from, 1, i / spans), v = lerp(from, 1, (i + 1) / spans);
      const bounds = [corner(u, edge, 0), corner(v, edge, 0)].map(([x, , z]) => ({ x, z }));
      colliders.push(...wallColliders(...bounds, lerp(a, b, u) - 0.22, lerp(a, b, v) + rise, 0.24));
    }
  }
  const outer = [corner(0, -half, 0), corner(0, half, 0), corner(1, half, 0), corner(1, -half, 0)]
    .map(([x, , z]) => ({ x, z }));
  platforms.push({
    id, outer, holes: [],
    height(x, z) {
      const t = THREE.MathUtils.clamp(((x - start[0]) * dx + (z - start[1]) * dz) / (length * length), 0, 1);
      return steps ? stepY(Math.min(sections, Math.floor(t * sections) + 1)) : lerp(a, b, t);
    },
  });
  if (steps) {
    for (const side of [-1, 1]) {
      const p = new THREE.Vector3(...corner(0, side * (half - 0.035), a + 0.78));
      const q = new THREE.Vector3(...corner(1, side * (half - 0.035), b + 0.78));
      const axis = q.clone().sub(p), h = axis.length();
      const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
      const transform = new THREE.Matrix4().compose(p.lerp(q, 0.5), rotation, new THREE.Vector3(1, 1, 1));
      trim.solid(new THREE.CylinderGeometry(0.035, 0.035, h, 6).applyMatrix4(transform), rail);
    }
  }
}

function globe(trim, x, z, y) {
  trim.solid(new THREE.CylinderGeometry(0.036, 0.050, 2.65, 6).translate(x, y + 1.325, z), 0x858780);
  trim.solid(new THREE.IcosahedronGeometry(0.19, 1).translate(x, y + 2.68, z), 0xf2eee1);
}

function bellestein(_footprints, site) {
  const displayed = new Set();
  const surveys = VELDHUIZEN_SURVEYS.bellestein.map((building, i) => {
    const roofColors = {};
    for (const [index, [roof, outer]] of building.faces.entries()) {
      if (!roof) continue;
      const points = outer.map(p => building.points[p]), n = polygonNormal(points);
      if (n.y > 0.925) {
        roofColors[index] = deckFaces[i]?.includes(index) ? paving : i >= 6 ? 0x555651 : 0x77736c;
      }
    }
    return { ...building, roofColors };
  });
  const group = createSurveyLandmark(site, surveys, wall => bellFacade(wall, displayed),
    ({ group, platforms, colliders, trim }) => {
      const shell = new CivicBatch();
      // Lofted crossings follow the photographed parapets over the ground-level shop street.
      for (const [id, start, end, width, openStart] of [
        ['north-link', [-1910.42, 390.20, -4.49], [-1895.30, 383.92, -4.47], 2.75],
        ['court-link', [-1901.21, 416.95, -4.50], [-1889.50, 412.79, -4.48], 2.85],
        ['south-link', [-1885.40, 470.10, -4.49], [-1869.55, 476.09, -4.47], 3.00, 1.65],
      ]) accessSpan(shell, trim, colliders, platforms, `bellestein-${id}`, start, end, width, 0.88, { openStart });
      const ramp = [-1894.65, 499.02, groundAt(-1894.65, 499.02, -7.91) + 0.028];
      accessSpan(shell, trim, colliders, platforms, 'bellestein-west-ramp', ramp,
        [-1897.85, 483.71, -4.43], 2.10, 0.68);
      const stairs = [-1891.23, 427.62, groundAt(-1891.23, 427.62, -8.22) + 0.032];
      accessSpan(shell, trim, colliders, platforms, 'bellestein-court-stairs', stairs,
        [-1885.90, 434.30, -4.49], 2.05, 0.88, { steps: true });
      // The bridge thresholds hug the terraces. Their adjacent supermarket roofs remain separate.
      for (const [id, corners] of [
        ['north-east-landing', [[-1896.48, 382.78], [-1893.67, 381.62], [-1892.69, 383.99],
          [-1895.53, 385.08]]],
        ['court-stair-landing', [[-1886.97, 434.11], [-1885.82, 433.64], [-1885.52, 434.32],
          [-1885.68, 435.32], [-1886.19, 435.27], [-1886.86, 434.60]]],
        ['court-west-landing', [[-1902.53, 415.57], [-1901.37, 415.48], [-1900.04, 416.56],
          [-1900.76, 417.13], [-1901.72, 417.38]]],
        ['south-west-landing', [[-1888.34, 476.83], [-1885.43, 478.00], [-1883.42, 470.71],
          [-1887.08, 468.92]]],
        ['south-east-landing', [[-1873.88, 473.52], [-1867.96, 474.80], [-1868.13, 477.83],
          [-1871.30, 478.23], [-1872.26, 476.29]]],
      ]) {
        const top = corners.map(([x, z]) => [x, -4.455, z]);
        shell.polygon([polygonNormal(top).y > 0 ? top : top.reverse()], paving);
        platforms.push({ id: `bellestein-${id}`, outer: corners.map(([x, z]) => ({ x, z })), holes: [],
          height: () => -4.455 });
      }
      // The ramp occupies the slim tail of the west BAG outline. Remove only that tail from its ground collision.
      const west = colliders[0];
      west.polygon.outer = [
        ...west.polygon.outer.slice(0, 17),
        { x: -1899.63, z: 482.31 }, { x: -1895.96, z: 484.92 },
        ...west.polygon.outer.slice(25),
      ];
      for (let i = 0; i < 6; i++) {
        colliders[i].maxY = -4.73;
        surveyedDeck(surveys[i], i, platforms);
        // Receding dwellings are solid above the shop roof. Thin parapets keep the bridge thresholds clear.
        const building = surveys[i];
        for (const [kind, outer] of building.faces) {
          if (kind) continue;
          const points = outer.map(p => building.points[p]), n = polygonNormal(points);
          const low = Math.min(...points.map(p => p[1])), high = Math.max(...points.map(p => p[1]));
          if (Math.abs(n.y) > 0.08 || low < -4.69 || low > -3.95 || high < -1.7) continue;
          const sorted = [...points].sort((a, b) => (a[0] - b[0]) * n.z - (a[2] - b[2]) * n.x);
          const [a, b] = [sorted[0], sorted.at(-1)].map(([x, , z]) => ({ x, z }));
          colliders.push(...wallColliders(a, b, low, high, 0.17));
        }
      }
      for (const [x, z, y] of [
        [-1910.7, 389.2, -4.46], [-1905.5, 404, -4.45], [-1895.5, 418.6, -4.50],
        [-1888.8, 435.8, -4.48], [-1883.1, 456.5, -4.49], [-1877.1, 472.7, -4.47],
        [-1870.8, 420.0, -4.44], [-1860.3, 424.3, -4.46],
      ]) globe(trim, x, z, y);
      group.add(shell.mesh());
    });
  surfaceFinish(group, true);
  return group;
}

function laathofFacade(wall) {
  const { building, width, normal, high, low, base } = wall;
  const plinth = low < base + 0.15 && high < -7.08;
  if (width < 1.3) return plinth ? brownBrick : concrete;
  if (high < -6.9 && high - low > 2.2) {
    if (normal.z < -0.79) {
      const center = width / 2;
      surveyWindow(wall, center - 0.45, center + 0.45, low + 0.24, Math.min(high - 0.28, low + 2.25),
        { frame: 0xbdb8ae, color: 0x495352, rows: 2 });
    }
    return brownBrick;
  }
  if (width > 1.7 && Math.abs(normal.z) > 0.70) {
    const count = Math.max(1, Math.round(width / 4.45)), pitch = width / count;
    for (let y = -10.04; y < 3.0; y += 2.90) {
      const lo = Math.max(y, low + 0.15), hi = Math.min(y + 2.1, high - 0.22);
      if (hi - lo < 1.13) continue;
      for (let n = 0; n < count; n++) {
        const u = pitch * n + 0.30, v = pitch * (n + 1) - 0.50;
        const tint = [0x56605c, 0x666e66, 0x525c5c][(n + Math.round(y) + 12) % 3];
        if (!surveyWindow(wall, u, v, lo, hi, { frame: 0xc7c7bc, color: tint, columns: 3 })) continue;
        if (normal.z > 0.70) surveyPanel(wall, u + 0.18, u + 0.63, lo + 0.11, hi - 0.10, 0x919489, 0.047, 0.28);
      }
    }
  }
  return high > 4.3 && building.outline[0].length > 5 ? 0xaaa89e : concrete;
}

const axis = [0.9241, -0.3822], park = [0.3822, 0.9241];
const project = ([x, , z], direction) => x * direction[0] + z * direction[1];
const terracePoint = (u, v, y) => [axis[0] * u + park[0] * v, axis[1] * u + park[1] * v, y];

function terraceSide(trim, u, front, y) {
  for (const sign of [-1, 1]) {
    const a = terracePoint(u + sign * 0.084, front + 0.18, y);
    const b = terracePoint(u + sign * 0.084, front + 0.18, y + 0.52);
    const c = terracePoint(u + sign * 0.084, front - 0.52, y + 0.99);
    const d = terracePoint(u + sign * 0.084, front - 1.16, y + 0.99);
    const e = terracePoint(u + sign * 0.084, front - 1.16, y);
    const position = ([x, z, y]) => [x, y, z];
    const ring = [a, b, c, d, e].map(position);
    trim.polygon([sign > 0 ? ring : ring.reverse()], concrete);
  }
  rectangularBeam(trim, terracePoint(u - 0.096, front + 0.18, y + 0.52),
    terracePoint(u + 0.096, front + 0.18, y + 0.52), 0.035, 0.51, concrete);
}

function decorateTerraces(trim, building) {
  const tiers = [-7.52, -4.64, -1.83, 1.07];
  if (Math.max(...building.points.map(p => p[1])) < 1.8) return;
  const outline = building.outline[0].map(([x, z]) => [x, 0, z]);
  const front0 = Math.max(...outline.map(p => project(p, park)));
  const frontCorners = outline.filter(p => project(p, park) > front0 - 0.62);
  const u0 = Math.min(...frontCorners.map(p => project(p, axis)));
  const u1 = Math.max(...frontCorners.map(p => project(p, axis)));
  const bays = Math.round((u1 - u0) / 4.55), pitch = (u1 - u0) / bays;
  if (!bays || pitch < 3.1 || pitch > 5.65) return;
  for (const [tier, y] of tiers.entries()) {
    const loose = building.faces.filter(([kind, outer]) => {
      if (!kind) return false;
      const points = outer.map(i => building.points[i]);
      const lo = Math.min(...points.map(p => p[1])), hi = Math.max(...points.map(p => p[1]));
      return lo >= y - 0.51 && hi <= y + 0.48 && polygonNormal(points).y > 0.93;
    }).flatMap(([, outer]) => outer.map(i => building.points[i]));
    if (!loose.length) continue;
    const front = Math.max(...loose.map(p => project(p, park)));
    if (Math.abs(front - front0 + 2.05 * tier) > 2.0) continue;
    const top = Math.min(y + 0.14, Math.max(...loose.filter(p => project(p, park) > front - 0.25).map(p => p[1])));
    for (let i = 0; i < bays; i++) {
      const a = u0 + i * pitch, b = a + pitch, half = a + pitch * 0.56;
      rectangularBeam(trim, terracePoint(a + 0.02, front + 0.09, top + 0.14),
        terracePoint(b - 0.02, front + 0.09, top + 0.14), 0.22, 0.35, concrete);
      terraceSide(trim, a + 0.13, front, top + 0.09);
      const pa = terracePoint(a + 0.33, front - 0.048, top + 0.78);
      const pb = terracePoint(half - 0.13, front - 0.048, top + 0.78);
      rectangularBeam(trim, pa, pb, 0.44, 0.53, aggregate);
      for (const h of [0.23, 0.34, 0.81]) {
        rectangularBeam(trim, terracePoint(a + 0.19, front + 0.073, top + h),
          terracePoint(b - 0.03, front + 0.073, top + h), 0.040, 0.042, rail);
      }
      for (let u = half; u < b - 0.11; u += 0.14) {
        rectangularBeam(trim, terracePoint(u, front + 0.073, top + 0.79),
          terracePoint(u + 0.022, front + 0.073, top + 0.79), 0.024, 0.49, rail);
      }
      for (let u = a + 0.54; u < half - 0.15; u += 0.41) {
        const seed = Math.abs(Math.sin(u * 41.39 + tier * 843.1));
        const [x, z, y] = terracePoint(u, front - 0.16, top + 0.83 + seed * 0.08);
        trim.solid(new THREE.IcosahedronGeometry(0.20 + seed * 0.14, 0).scale(1.36, 0.66, 0.89)
          .translate(x, y, z), seed > 0.55 ? 0x626a42 : 0x465237);
      }
    }
  }
}

function laathof(_footprints, site) {
  const buildings = VELDHUIZEN_SURVEYS.laathof.map(b => {
    const roofColors = {};
    for (const [i, [roof, outer]] of b.faces.entries()) {
      if (!roof) continue;
      const points = outer.map(p => b.points[p]);
      const top = Math.max(...points.map(p => p[1]));
      roofColors[i] = top < 2.0 && top > -7.9 && polygonNormal(points).y > 0.9 ? 0xa9a89e : 0x77786f;
    }
    return { ...b, roofColors };
  });
  const group = createSurveyLandmark(site, buildings, laathofFacade,
    ({ trim }) => buildings.forEach(building => decorateTerraces(trim, building)));
  surfaceFinish(group);
  return group;
}

export const VELDHUIZEN_LANDMARK_FACTORIES = { bellestein, laathof };
