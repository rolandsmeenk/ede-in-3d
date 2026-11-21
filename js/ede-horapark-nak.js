import * as THREE from 'three/webgpu';
import { normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { CivicBatch, makeGroup, polygonNormal } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { surveyPanel } from './ede-survey-landmark.js';
import { getTerrain, terrainHeightAt } from './terrain.js';
import { EDE_HORAPARK_NAK_SITES, NAK_WALLS, NAK_EAVES, NAK_RIDGES, NAK_COURT_EAVES,
  NAK_COURT_WALLS, NAK_COURT_CENTER, NAK_NORTH_ROOF } from './ede-horapark-nak-survey.js';

// J.I. Risseeuw, 1981–82. Gemeente Ede, Post ’65-erfgoed, pp. 6–7, databank item 135.
// https://www.adviseursincultuurhistorie.nl/wp-content/uploads/2023/03/vanMeijel_Ede_Post65_brochure_lr_schermversie.pdf
// https://www.fundainbusiness.nl/kantoor/ede/object-89668697-horapark-2/
// https://www.smitbedrijfshuisvesting.nl/transacties?page=27
const brick = 0xae8169, trimWood = 0x775642, rim = 0x423d3a, frameColor = 0x623e2a;
const slate = 0x505b68, northSlate = 0x565450, glass = 0x33444a;
const plaza = -1.23, courtyard = -1.37;
const [site] = EDE_HORAPARK_NAK_SITES;
const [footprint] = site.surveyFootprints;

const next = (i, ring) => (i + 1) % ring.length;
const drop = ([x, y, z], thickness) => [x, y - thickness, z];
const box = (batch, center, width, height, depth, color, yaw = 0) => {
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(yaw).translate(...center), color);
};

function roofTriangle(batch, sections, a, b, c, color) {
  const normal = polygonNormal([a, b, c]);
  if (!normal.y) return;
  sections.push([a, b, c]);
  if (normal.y > 0) batch.triangle(a, b, c, color);
  else batch.triangle(a, c, b, color);
}

function drawRoofs(roof, trim) {
  const sections = [];
  function plane(points, color = slate) {
    for (let i = 1; i < points.length - 1; i++) {
      roofTriangle(roof, sections, points[0], points[i], points[i + 1], color);
    }
  }
  function eave(a, b, inside) {
    const underA = drop(a, 0.19), underB = drop(b, 0.19);
    trim.quad(a, b, underB, underA, rim);
    trim.quad(b, a, underA, underB, rim);
    trim.triangle(underA, underB, drop(inside, 0.19), trimWood);
    trim.triangle(underB, underA, drop(inside, 0.19), trimWood);
  }

  // The upper tips of the inward roof planes rise above the outer slopes as shallow clerestories.
  const raisedRidge = NAK_RIDGES.map(([x, y, z], i) => [x, y + [0.62, 0.71, 0.66, 0.14, 0.12, 0, 0, 0.12, 0.32, 0.62][i], z]);
  for (const [i, a] of NAK_EAVES.entries()) {
    const j = next(i, NAK_EAVES), b = NAK_EAVES[j], r = NAK_RIDGES[i], s = NAK_RIDGES[j];
    const upperR = raisedRidge[i], upperS = raisedRidge[j];
    plane([b, a, r, s], i === 5 ? 0x5d6873 : slate);
    plane([upperR, NAK_COURT_EAVES[i], NAK_COURT_EAVES[j], upperS], i < 3 || i === 9 ? 0x56616c : slate);
    if (upperR[1] > r[1] || upperS[1] > s[1]) {
      trim.quad(r, s, upperS, upperR, 0x475257, 0.42);
      trim.quad(s, r, upperR, upperS, 0x475257, 0.42);
      const length = Math.hypot(s[0] - r[0], s[2] - r[2]);
      const count = Math.ceil(length / 1.85);
      for (let k = 0; k <= count; k++) {
        const t = k / count;
        const height = (upperR[1] - r[1]) * (1 - t) + (upperS[1] - s[1]) * t;
        if (height > 0.10) box(trim, [r[0] + (s[0] - r[0]) * t,
          r[1] + (s[1] - r[1]) * t + height / 2, r[2] + (s[2] - r[2]) * t], 0.066, height, 0.066, trimWood);
      }
    }
    eave(b, a, r);
    eave(NAK_COURT_EAVES[i], NAK_COURT_EAVES[j], upperR);
  }

  const n = NAK_NORTH_ROOF;
  for (const indices of [[0, 1, 2, 9, 8, 7, 10], [6, 11, 7, 8, 9, 4, 5], [10, 7, 11], [2, 3, 4, 9]]) {
    plane(indices.map(i => n[i]), northSlate);
  }
  const northEdge = [0, 1, 2, 3, 4, 5, 6, 11, 10];
  for (const [i, index] of northEdge.entries()) eave(n[index], n[northEdge[next(i, northEdge)]], n[index < 2 || index > 5 ? 7 : 9]);

  // Two low hipped rooms at the wooded end of the long wing, split by a recessed corner.
  for (const [outline, ridge] of [
    [[31, 30, 29, 28, 27, 32], [423.07, 3.56, 2832.66]],
    [[22, 27, 26, 25, 24, 23], [423.33, 3.51, 2846.61]],
  ]) {
    const edge = outline.map(i => {
      const [x, z] = NAK_WALLS[i];
      return [x + (x - ridge[0]) * 0.07, 1.82, z + (z - ridge[2]) * 0.06];
    });
    for (const [i, a] of edge.entries()) {
      const b = edge[next(i, edge)];
      plane([a, b, ridge], northSlate);
      eave(a, b, ridge);
    }
  }

  plane([[386.40, 1.68, 2849.91], [414.10, 1.68, 2848.90],
    [415.09, 1.69, 2853.89], [385.54, 1.76, 2854.56]], 0x686763);

  for (const [x, z, size] of [[381.4, 2846.2, 0.82], [383.3, 2846.1, 0.82], [385.4, 2846.0, 0.82],
    [390.6, 2848.7, 0.76], [395.0, 2848.5, 0.76], [400.0, 2848.32, 0.76],
    [391.2, 2855.3, 0.80], [395.2, 2855.1, 0.80], [403.1, 2854.84, 0.80]]) {
    const ridge = roofHeight(sections, x, z, 2.8);
    const pitch = roofHeight(sections, x, z + 0.2, ridge) - roofHeight(sections, x, z - 0.2, ridge);
    const window = new THREE.BoxGeometry(size, 0.12, size * 0.85).rotateX(-Math.atan2(pitch, 0.4));
    trim.solid(window.translate(x, ridge + 0.10, z), 0xb0adb1);
    const pane = new THREE.BoxGeometry(size - 0.12, 0.10, size * 0.85 - 0.12).rotateX(-Math.atan2(pitch, 0.4));
    trim.solid(pane.translate(x, ridge + 0.14, z), glass);
  }
  const dormerX = 406.1, dormerZ = 2845.87;
  const dormerRoof = roofHeight(sections, dormerX, dormerZ - 1.10, 4.30) + 0.21;
  const dormerBase = roofHeight(sections, dormerX, dormerZ + 1.20, 2.70) - 0.17;
  box(trim, [dormerX, (dormerBase + dormerRoof) / 2, dormerZ], 3.43, dormerRoof - dormerBase, 2.60, 0x46484c, 0.04);
  box(trim, [dormerX, dormerRoof, dormerZ], 3.57, 0.13, 2.73, 0x79776f, 0.04);
  for (const dx of [-0.80, 0.80]) {
    box(trim, [dormerX + dx, dormerRoof - 0.42, dormerZ + 1.315], 1.12, 0.42, 0.064, glass, 0.04);
  }
  for (const [x, z, h, w] of [[414.31, 2885.76, 1.82, 0.86], [415.31, 2855.86, 1.27, 0.69],
    [388.47, 2844.18, 1.24, 0.78], [390.05, 2844.10, 1.30, 0.78]]) {
    const bottom = roofHeight(sections, x, z, 3.9) - 0.38;
    box(trim, [x, bottom + h / 2, z], w, h, w * 0.72, brick);
    box(trim, [x, bottom + h, z], w + 0.10, 0.09, w * 0.72 + 0.10, 0x9a8c7a);
    box(trim, [x, bottom + h + 0.11, z], w * 0.52, 0.18, w * 0.4, rim);
  }
  return sections;
}

function roofHeight(sections, x, z, fallback) {
  let top = -Infinity;
  for (const [a, b, c] of sections) {
    const determinant = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(determinant) < 1e-5) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / determinant;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / determinant;
    if (u >= -1e-5 && v >= -1e-5 && u + v <= 1.00001) top = Math.max(top, a[1] * u + b[1] * v + c[1] * (1 - u - v));
  }
  return Number.isFinite(top) ? top : fallback;
}

function glassOpening(wall, sash, color = glass) {
  const { trim, point } = wall;
  const center = sash.reduce(([u, y], [a, b]) => [u + a / sash.length, y + b / sash.length], [0, 0]);
  const inner = sash.map(([u, y]) => [
    u + Math.sign(center[0] - u) * 0.054, y + Math.sign(center[1] - y) * 0.054,
  ]);
  const face = [sash.map(([u, y]) => point(u, y, 0.033)), inner.map(([u, y]) => point(u, y, 0.033))];
  trim.polygon(face, frameColor);
  const pane = inner.map(([u, y]) => point(u, y, 0.045));
  for (let i = 1; i < pane.length - 1; i++) trim.triangle(pane[0], pane[i], pane[i + 1], color, 0.82);
}

function fitWindow(wall, left, right, sill, wantedHead, panes, color) {
  const high = u => Math.min(wantedHead, wall.ceiling(u) - 0.23);
  const headL = high(left), headR = high(right);
  if (Math.min(headL, headR) - sill < 0.30) return;
  glassOpening(wall, [[left, sill], [right, sill], [right, headR], [left, headL]], color);
  for (let k = 1; k < panes; k++) {
    const u = left + (right - left) * k / panes;
    surveyPanel(wall, u - 0.026, u + 0.026, sill, high(u), frameColor, 0.055);
  }
  surveyPanel(wall, left - 0.03, right + 0.03, sill - 0.070, sill, 0x86604b, 0.057);
}

function doorAwning(wall, left, right, y) {
  const { trim, point: p } = wall;
  const corners = [p(left, y - 0.1, 0.74), p(right, y - 0.1, 0.74),
    p(right - 0.27, y + 0.22, 0.04), p(left + 0.27, y + 0.22, 0.04)];
  trim.quad(...corners, trimWood);
  trim.quad(...corners.toReversed(), trimWood);
  trim.quad(corners[0], drop(corners[0], 0.12), drop(corners[1], 0.12), corners[1], rim);
}

function decorate(wall, index, inner) {
  const { width, ceiling, point, trim } = wall;
  if (width < 0.75) return;
  if (inner) {
    const count = Math.max(1, Math.round(width / 1.85));
    for (let k = 0; k < count; k++) {
      fitWindow(wall, k * width / count + 0.09, (k + 1) * width / count - 0.09,
        courtyard + 0.16, 1.35, 1, k % 3 ? 0x476063 : 0x566867);
    }
    return;
  }

  const doorway = index === 12 || index === 4;
  if (doorway) {
    const middle = width / 2, half = index === 12 ? 1.67 : 1.06;
    fitWindow(wall, middle - half, middle + half, plaza + 0.06, plaza + 2.60, 3);
    surveyPanel(wall, middle - half + 0.08, middle + half - 0.08, plaza + 1.91, plaza + 1.99, frameColor, 0.052);
    doorAwning(wall, middle - half - 0.30, middle + half + 0.30, plaza + 2.72);
    for (let i = 0; i < 5; i++) {
      const depth = (i + 1) * 0.37;
      const left = middle - half - 0.30 - depth * 0.14, right = width - left;
      const top = plaza - i * 0.13;
      const a = point(left, top, depth - 0.37), b = point(right, top, depth - 0.37);
      const c = point(right, top, depth), d = point(left, top, depth);
      trim.quad(a, b, c, d, 0x9f8b72);
      trim.quad(d, c, b, a, 0x9f8b72);
      trim.quad(d, c, drop(c, 0.13), drop(d, 0.13), 0x887660);
      trim.quad(c, d, drop(d, 0.13), drop(c, 0.13), 0x887660);
    }
  } else if ([10, 11, 13, 14].includes(index)) {
    const count = index === 10 || index === 14 ? 4 : 2;
    for (let k = 0; k < count; k++) {
      const mid = width * (k + 0.5) / count, bottom = plaza + 0.32, top = plaza + 2.05;
      const w = Math.min(0.19, width / count * 0.24);
      glassOpening(wall, [[mid - w, bottom], [mid + w, bottom],
        [mid + w, top - 0.18], [mid, top], [mid - w, top - 0.18]], 0x3e352f);
    }
  } else if (width > 1.75) {
    const count = Math.max(1, Math.round(width / (index === 7 || index === 16 ? 2.45 : 2.7)));
    const bay = width / count;
    for (let k = 0; k < count; k++) {
      const left = k * bay + 0.26, right = (k + 1) * bay - 0.26;
      if (k % 4 === 2) {
        fitWindow(wall, left, right, plaza + 0.93, 1.73, 2, 0x465556);
      } else {
        fitWindow(wall, left, right, plaza + 0.91, 1.70, 2);
      }
    }
  }
  if ([10, 11, 12, 13, 14, 15].includes(index)) {
    const count = index === 12 ? 4 : width > 9 ? 4 : 2;
    for (let k = 0; k < count; k++) {
      fitWindow(wall, width * k / count + 0.14, width * (k + 1) / count - 0.14, 3.22, 6.65, 1, 0x374b54);
    }
  }
  if (!doorway && width > 5 && ceiling(width / 2) > 1.50) {
    surveyPanel(wall, 0.06, width - 0.06, plaza + 0.75, plaza + 0.83, 0x90604e, 0.031);
  }
}

function drawWalls(masonry, trim, sections, ring, ground, inner = false) {
  for (const [i, [ax, az]] of ring.entries()) {
    const [bx, bz] = ring[next(i, ring)];
    const width = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / width, dz = (bz - az) / width;
    const a = { x: ax, z: az }, b = { x: bx, z: bz }, normal = { x: -dz, z: dx };
    const point = (u, y, offset = 0) => [ax + dx * u - dz * offset, y, az + dz * u + dx * offset];
    const ceiling = u => roofHeight(sections, ax + dx * u, az + dz * u, inner ? 2.18 : 1.95) - 0.05;
    const widthSteps = Math.max(1, Math.ceil(width / 1.25));
    const span = Array.from({ length: widthSteps + 1 }, (_, k) => width * k / widthSteps);
    const top = span.map(u => point(u, ceiling(u))).reverse();
    const floor = span.map(u => {
      const [x, , z] = point(u, 0);
      return point(u, inner ? courtyard - 0.16 : Math.min(plaza - 0.12, ground(x, z) - 0.17));
    });
    masonry.polygon([[...floor, ...top]], inner ? 0xa7826c : brick);
    decorate({ trim, a, b, normal, width, point, ceiling }, i, inner);
  }
}

function drawCourt(trim) {
  const paving = NAK_COURT_WALLS.map(([x, z]) => [x, courtyard, z]).reverse();
  trim.polygon([paving], 0xa69879);
  const [cx, cz] = NAK_COURT_CENTER;
  const circle = (r, y, i) => [cx + r * Math.cos(i * Math.PI / 18), y, cz + r * Math.sin(i * Math.PI / 18)];
  trim.polygon([Array.from({ length: 36 }, (_, i) => circle(5.39, courtyard + 0.026, 35 - i))], 0x928c61);
  for (let i = 2; i < 35; i++) {
    const a = circle(5.55, courtyard + 0.36, i), b = circle(5.55, courtyard + 0.36, i + 1);
    const c = circle(5.35, courtyard + 0.36, i + 1), d = circle(5.35, courtyard + 0.36, i);
    trim.quad(b, a, d, c, 0x878076);
    trim.quad(a, b, drop(b, 0.36), drop(a, 0.36), 0x696158);
    trim.quad(d, drop(d, 0.36), drop(c, 0.36), c, 0x73695e);
  }
}

let surface;
function buildNak(landmark) {
  const roof = new CivicBatch(), masonry = new CivicBatch(), trim = new CivicBatch();
  const ground = getTerrain() ? terrainHeightAt : () => -2.08;
  const sections = drawRoofs(roof, trim);
  drawWalls(masonry, trim, sections, NAK_WALLS, ground);
  drawWalls(masonry, trim, sections, NAK_COURT_WALLS, ground, true);
  drawCourt(trim);

  const outer = footprint.outer;
  const group = makeGroup(landmark.name, masonry, [{
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: Math.min(...outer.map(p => ground(p.x, p.z))) - 0.25,
    maxY: 8.19, polygon: footprint,
  }]);
  surface ??= createFacadeSurfaceTexture().texture;
  const across = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
  const mortar = texture(surface, vec2(across.div(0.88), positionWorld.y.div(0.60))).r;
  group.children[0].name = 'Polygonal brick walls';
  group.children[0].material.colorNode = vertexColor().mul(mortar.mul(0.94).add(0.16));
  const shell = roof.mesh(), detail = trim.mesh();
  shell.name = 'Folded slate roofs';
  const course = texture(surface, vec2(positionWorld.x.div(0.78), positionWorld.z.div(0.99))).g;
  shell.material.colorNode = vertexColor().mul(course.mul(0.53).add(0.56));
  detail.name = 'Oak frames, angled entries and courtyard';
  group.add(shell, detail);
  return group;
}

export { EDE_HORAPARK_NAK_SITES };

export const HORAPARK_NAK_FACTORIES = {
  'horapark-nak': (_footprints, landmark = site) => buildNak(landmark),
};
