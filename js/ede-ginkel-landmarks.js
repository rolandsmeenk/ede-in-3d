import * as THREE from 'three/webgpu';
import { CivicBatch, civicSigns, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { GINKEL_BUILDING_SURVEYS, VALENBERG_RAMP } from './ede-ginkel-landmark-surveys.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { terrainHeightAt } from './terrain.js';

function beam(batch, p, q, width, color, depth = width) {
  const a = new THREE.Vector3(...p), b = new THREE.Vector3(...q);
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = direction.length();
  if (length < 0.005) return;
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.divideScalar(length));
  const centre = a.add(b).multiplyScalar(0.5);
  batch.solid(new THREE.BoxGeometry(width, length, depth).applyQuaternion(rotation).translate(centre.x, centre.y, centre.z), color);
}

function addGinkelExtension(shell, trim) {
  // The current BAG footprint includes the timber addition. The 3DBAG roof still ends at the old farmhouse.
  const front = [[4043.51, 359.45], [4043.89, 367.07]];
  const back = [[4061.24, 358.55], [4061.49, 363.61], [4052.25, 366.60]];
  const eave = 5.18, ridge = 8.98, timber = 0x806242, seam = 0x4a3a2d;
  const w = Math.hypot(front[1][0] - front[0][0], front[1][1] - front[0][1]);
  const ground = 2.48;
  const point = (span, y, frontOffset = 0) => {
    const t = span / w;
    return [THREE.MathUtils.lerp(front[0][0], front[1][0], t) - frontOffset, y,
      THREE.MathUtils.lerp(front[0][1], front[1][1], t)];
  };
  const loft = point(w / 2, ridge);
  const rearRidge = [4061.39, ridge - 0.03, 362.37];
  const sillA = point(0, eave), sillB = point(w, eave);
  const endA = [back[0][0], eave, back[0][1]];
  const endB = [back[1][0], 7.66, back[1][1]];
  const join = [back[2][0], eave, back[2][1]];
  shell.quad(sillA, loft, rearRidge, endA, 0x76604d);
  shell.polygon([[loft, sillB, join, endB, rearRidge]], 0x705b47);
  const bottom = ([x, z]) => [x, Math.min(ground, terrainHeightAt(x, z) - 0.12), z];
  shell.quad(sillA, endA, bottom(back[0]), bottom(front[0]), timber);
  shell.quad(sillB, bottom(front[1]), bottom(back[2]), join, timber);
  shell.quad(endA, rearRidge, endB, bottom(back[1]), timber);
  shell.triangle(endA, bottom(back[1]), bottom(back[0]), timber);
  // The entrance glass is recessed into the deep timber reveal and divided by slender dark mullions.
  const topAt = span => eave + (ridge - eave) * (1 - Math.abs(2 * span / w - 1));
  for (let i = 0; i < 8; i++) {
    const a = i === 0 ? 0.28 : i * w / 8 + 0.026;
    const b = i === 7 ? w - 0.28 : (i + 1) * w / 8 - 0.026;
    shell.quad(point(a, ground + 0.07), point(b, ground + 0.07),
      point(b, topAt(b) - 0.19), point(a, topAt(a) - 0.19), i % 3 === 0 ? 0x424d47 : 0x394846, 0.92);
    if (i > 0) beam(trim, point(a - 0.026, ground + 0.07, 0.065),
      point(a - 0.026, topAt(a - 0.026) - 0.14, 0.065), 0.062, 0x262923);
  }
  beam(trim, point(0.20, eave - 0.14, 0.08), point(w - 0.20, eave - 0.14, 0.08), 0.09, 0x272723);
  for (const span of [0.14, w - 0.14]) {
    beam(shell, point(span, ground, 0.08), point(span, eave, 0.08), 0.30, timber);
    beam(shell, point(span, eave, 0.08), point(w / 2, ridge, 0.08), 0.30, timber);
    beam(trim, point(span, eave - 0.10, 0.20), point(w / 2, ridge - 0.09, 0.20), 0.06, seam);
  }
  const side = (a, b, sign) => {
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const p = t => [THREE.MathUtils.lerp(a[0], b[0], t), eave, THREE.MathUtils.lerp(a[2], b[2], t) + 0.016 * sign];
    for (let i = 1; i < length / 0.44; i++) {
      const top = p(i * 0.44 / length);
      beam(trim, [top[0], Math.max(ground, terrainHeightAt(top[0], top[2])), top[2]], top, 0.012, 0x614d37);
    }
  };
  side(sillA, endA, -1);
  side(sillB, join, 1);
  // Skylight position fitted to the south-facing timber roof in the operator's January 2025 photograph.
  const roofPoint = (u, v) => {
    const west = sillB.map((n, i) => THREE.MathUtils.lerp(n, loft[i], v));
    const eastEave = [4061.63, eave, 366.19];
    const east = eastEave.map((n, i) => THREE.MathUtils.lerp(n, rearRidge[i], v));
    return west.map((n, i) => THREE.MathUtils.lerp(n, east[i], u) + (i === 1 ? 0.046 : 0));
  };
  trim.quad(roofPoint(0.58, 0.37), roofPoint(0.74, 0.37), roofPoint(0.74, 0.80), roofPoint(0.58, 0.80), 0x4b6872, 0.9);
}

function addFarmhouseEntrance(trim) {
  // The west gable is split down the ridge by the surveyed wall mesh.
  const centre = [4052.42, 369.69], ground = terrainHeightAt(...centre);
  const point = (u, y, depth = 0) => [centre[0] + 0.048 * u - depth, y, centre[1] + u];
  const half = 1.58, spring = ground + 2.45, archRise = 0.39, ivory = 0xd8cead;
  const top = (x, rise = archRise) => spring + rise * Math.sqrt(Math.max(0, 1 - (x / half) ** 2));
  for (let i = 0; i < 12; i++) {
    const u = -half + 2 * half * i / 12, v = u + 2 * half / 12;
    trim.quad(point(u, ground + 0.04, 0.065), point(v, ground + 0.04, 0.065),
      point(v, top(v), 0.065), point(u, top(u), 0.065), 0x3b4741, 0.8);
    trim.quad(point(u, top(u) - 0.036, 0.10), point(v, top(v) - 0.036, 0.10),
      point(v, top(v) + 0.16, 0.10), point(u, top(u) + 0.16, 0.10), ivory);
  }
  for (const u of [-half, -0.72, 0, 0.72, half]) {
    beam(trim, point(u, ground + 0.04, 0.10), point(u, top(u), 0.10), 0.085, ivory);
  }
  beam(trim, point(-half, ground + 1.98, 0.105), point(half, ground + 1.98, 0.105), 0.115, ivory);
  for (const side of [-1, 1]) {
    const a = point(side * (half + 0.03), ground + 0.04, 0.125);
    const b = point(side * (half + 1.30), ground + 0.07, 0.16);
    const hiA = point(side * (half + 0.03), spring - 0.07, 0.125);
    const hiB = point(side * (half + 1.30), spring + 0.09, 0.16);
    const ring = [b, a, hiA, hiB];
    trim.polygon([side === -1 ? ring : ring.reverse()], 0x272f25);
    for (const dy of [0.55, 1.48]) {
      beam(trim, point(side * (half + 0.15), ground + dy, 0.16),
        point(side * (half + 1.23), ground + dy, 0.18), 0.04, 0x3c4838);
    }
  }
  const gableY = 4.82;
  for (const direction of [-1, 1]) {
    beam(trim, point(direction * 5.80, gableY, 0.11), point(0, 9.73, 0.115), 0.19, ivory);
    // This small antler ornament is visible over the entrance.
    beam(trim, point(direction * 0.06, 8.04, 0.10), point(direction * 0.46, 8.54, 0.13), 0.035, 0x503a28);
    beam(trim, point(direction * 0.46, 8.54, 0.13), point(direction * 0.47, 8.78, 0.14), 0.029, 0x503a28);
    beam(trim, point(direction * 0.31, 8.35, 0.12), point(direction * 0.17, 8.67, 0.14), 0.026, 0x503a28);
  }
  const board = (a, b, lo, hi, color, depth) => trim.quad(point(a, ground + lo, depth),
    point(b, ground + lo, depth), point(b, ground + hi, depth), point(a, ground + hi, depth), color);
  board(3.62, 4.54, 0.88, 2.09, 0xc4beaa, 0.08);
  board(3.67, 4.49, 0.93, 2.04, 0xa19c81, 0.096);
  board(3.71, 4.45, 1.54, 1.98, 0x7f9386, 0.100);
  board(3.71, 4.45, 1.02, 1.28, 0x7f829a, 0.100);
  board(-0.16, 0.16, 3.93, 4.11, 0x36332c, 0.14);
}

function natureCentre(_, site) {
  return createSurveyLandmark(site, GINKEL_BUILDING_SURVEYS[site.id], wall => {
    const { width, high, low, base, normal } = wall;
    if (width < 7 || low > base + 0.05 || high - base < 2.5 || Math.abs(normal.z) < 0.75) return;
    for (let u = 1.8; u < width - 1; u += 3.65) {
      surveyWindow(wall, u - 0.51, u + 0.51, base + 1.39, base + 2.32,
        { frame: 0xa8a48a, color: 0x3c4841, columns: 2 });
    }
  }, ({ group, trim }) => {
    const shell = new CivicBatch();
    addGinkelExtension(shell, trim);
    group.add(shell.mesh());
    addFarmhouseEntrance(trim);
  });
}

function foldWall(wall) {
  const { width, low, high, base, normal, buildingIndex, faceIndex } = wall;
  if (low > base + 0.07 || width < 0.9 || high - base < 1.1) return;
  const old = !buildingIndex;
  const plinth = base + (old ? 0.36 : 0.43);
  surveyPanel(wall, 0, width, base + 0.06, plinth, 0x766f60);
  for (let y = plinth + 0.10; y < Math.min(high - 0.19, base + 2.85); y += 0.26) {
    surveyPanel(wall, 0, width, y, y + 0.023, old ? 0x363832 : 0x282a25, 0.027);
  }
  if (width > 12) {
    for (const t of [0.29, 0.65, 0.83]) {
      const u = width * t;
      surveyWindow(wall, u - 0.32, u + 0.32, base + 1.16, base + 1.61,
        { frame: 0x8a8270, color: 0x363733, columns: 2 });
    }
  }
  const end = old ? [6, 15].includes(faceIndex) : [4, 8].includes(faceIndex);
  if (!end || Math.abs(normal.x) < 0.79 || high - base < 2.25) return;
  const size = Math.min(width - 0.30, old ? 2.25 : 2.75);
  const u = (width - size) / 2, v = width - u;
  const top = Math.min(base + 2.50, high - 0.10);
  surveyPanel(wall, u, v, base + 0.10, top, 0x71634f, 0.047);
  surveyPanel(wall, u + 0.08, v - 0.08, base + 0.12, top - 0.10, 0x252720, 0.053);
  surveyPanel(wall, width / 2 - 0.018, width / 2 + 0.018, base + 0.12, top - 0.10, 0x524d40, 0.064);
  for (const x of [u + 0.32, v - 0.32]) {
    for (const y of [base + 0.47, base + 1.83]) {
      surveyPanel(wall, x - 0.18, x + 0.18, y, y + 0.048, 0x161b17, 0.067);
    }
  }
}

function addOldFoldTiles(trim) {
  const patches = [
    [[3322.91, 5.09, 65.68], [3335.82, 5.57, 76.09], [3320.18, 9.21, 68.85], [3335.81, 9.34, 80.89]],
    [[3332.83, 5.18, 83.82], [3316.98, 5.50, 71.04], [3335.81, 9.35, 80.89], [3320.18, 9.21, 68.85]],
  ];
  const color = [0x70584c, 0x756259, 0x83644e, 0x6a645a, 0x675651];
  for (const [lowA, lowB, hiA, hiB] of patches) {
    const roof = (u, v) => lowA.map((p, i) => THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(p, lowB[i], u), THREE.MathUtils.lerp(hiA[i], hiB[i], u), v) + (i === 1 ? 0.045 : 0));
    for (let row = 0; row < 10; row++) for (let tile = 0; tile < 34; tile++) {
      const u = 0.082 + tile * 0.0245, v = 0.04 + row * 0.062;
      const selection = color[(tile * 13 + row * 7 + Math.floor(tile / 5)) % color.length];
      trim.quad(roof(u, v + 0.056), roof(u + 0.022, v + 0.056), roof(u + 0.022, v), roof(u, v), selection);
    }
  }
}

function sheepfolds(_, site) {
  return createSurveyLandmark(site, GINKEL_BUILDING_SURVEYS[site.id], foldWall, ({ trim }) => addOldFoldTiles(trim));
}

function belgen(_, site) {
  const { x, z } = site;
  const y = terrainHeightAt(x, z);
  const stone = new CivicBatch(), colliders = [];
  // Two stacked stones with broad splits; the interpretive plaque faces the public path.
  const levels = [
    [0, [[-0.48, -0.25], [0.30, -0.28], [0.45, 0.13], [0.22, 0.31], [-0.36, 0.26]]],
    [0.84, [[-0.39, -0.22], [0.27, -0.23], [0.33, 0.10], [0.13, 0.24], [-0.30, 0.22]]],
    [0.90, [[-0.31, -0.22], [0.23, -0.23], [0.27, 0.10], [0.11, 0.23], [-0.27, 0.14]]],
    [1.78, [[-0.35, -0.26], [0.24, -0.27], [0.29, 0.10], [0.14, 0.24], [-0.28, 0.11]]],
    [1.94, [[-0.26, -0.20], [0.21, -0.21], [0.25, 0.05], [0.09, 0.18], [-0.23, 0.06]]],
  ];
  const rings = levels.map(([height, corners]) => corners.map(([u, v]) => [x + u, y + height, z + v]));
  const colors = [0x7e7865, 0xa49b80, 0x909175, 0x8f826e, 0x6d6d5f];
  for (let r = 1; r < rings.length; r++) {
    for (let i = 0; i < rings[r].length; i++) {
      const j = (i + 1) % rings[r].length;
      stone.quad(rings[r - 1][j], rings[r - 1][i], rings[r][i], rings[r][j], colors[(i + (r === 2 ? 3 : 0)) % colors.length]);
    }
  }
  stone.polygon([[...rings.at(-1)].reverse()], 0xa49a83);
  const outer = rings[0].map(([x, , z]) => ({ x, z }));
  colliders.push({ minX: x - 0.48, maxX: x + 0.45, minZ: z - 0.28, maxZ: z + 0.31, minY: y, maxY: y + 1.94,
    polygon: { outer, holes: [] } });
  // The two exposed low remnants immediately west of the boulder are visible in PDOK 2025 imagery.
  for (const [rx, rz, w, d, h] of [[3494.22, 627.94, 1.07, 1.30, 0.27], [3496.46, 628.70, 1.13, 1.17, 0.24]]) {
    const level = terrainHeightAt(rx, rz) + h / 2 - 0.04;
    stone.solid(new THREE.BoxGeometry(w, h, d).rotateY(-0.23).translate(rx, level, rz), 0x918a79);
  }
  const group = makeGroup(site.name, stone, colliders);
  const plateZ = z - 0.263, a = { x: x - 0.238, z: plateZ }, b = { x: x + 0.187, z: plateZ - 0.007 };
  const words = ['BELGISCH', 'VLUCHTELINGENKAMP', 'EDE', '1914–1918'];
  const plaque = civicSigns(words.map((text, i) => ({ a, b, lo: y + 1.49 - i * 0.074, hi: y + 1.564 - i * 0.074,
    text, color: '#695e49', textColor: '#e7dbb8' })), { wide: true });
  if (plaque) {
    plaque.userData.nearDetail = 40;
    group.add(plaque);
  }
  return group;
}

function rampCorner(nodes, i, side, half) {
  const p = nodes[i];
  const before = nodes[i - 1] ?? p;
  const after = nodes[i + 1] ?? p;
  const normal = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    return length > 0 ? [-dz / length, dx / length] : null;
  };
  const n0 = normal(before, p) ?? normal(p, after);
  const n1 = normal(p, after) ?? n0;
  const angle = 1 + n0[0] * n1[0] + n0[1] * n1[1];
  const miter = side * half / Math.max(0.82, angle);
  return { x: p.x + (n0[0] + n1[0]) * miter, z: p.z + (n0[1] + n1[1]) * miter };
}

function addValenbergApproach(deck, start) {
  // Follow w1172706146 from the cycleway and w187417323 to the ramp.
  const way = [[4523.2, -2741.1], [4526.69, -2743.88], [4536.66, -2751.52], [4541.58, -2754.78], [start.x, start.z]];
  let previous;
  for (let i = 1; i < way.length; i++) {
    const [ax, az] = way[i - 1], [bx, bz] = way[i];
    const dx = bx - ax, dz = bz - az;
    const length = Math.hypot(dx, dz), steps = Math.ceil(length);
    for (let j = 0; j <= steps; j++) {
      const x = ax + dx * j / steps, z = az + dz * j / steps;
      const edge = [-1, 1].map(side => {
        const a = x - side * dz / length, b = z + side * dx / length;
        return [a, terrainHeightAt(a, b) + 0.026, b];
      });
      if (previous) deck.quad(previous[1], edge[1], edge[0], previous[0], 0x87795f);
      previous = edge;
    }
  }
}

function valenberg(_, site) {
  const deck = new CivicBatch(), detail = new CivicBatch(), colliders = [], platforms = [];
  const wood = 0x918470, metal = 0x898f86;
  const nodes = VALENBERG_RAMP.map(([x, z]) => ({ x, z }));
  const start = nodes[0];
  addValenbergApproach(deck, start);
  const startY = terrainHeightAt(start.x, start.z) + 0.06;
  let distance = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (i) distance += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].z - nodes[i - 1].z);
    nodes[i].distance = distance;
  }
  const last = nodes.at(-1);
  const summit = Math.max(startY + 2.5, terrainHeightAt(last.x, last.z) + 0.48);
  const sections = nodes.map((node, i) => ({
    ...node,
    y: THREE.MathUtils.lerp(startY, summit, node.distance / distance),
    edges: [-1, 1].map(side => rampCorner(nodes, i, side, 0.68)),
  }));
  const point = (p, y) => [p.x, y, p.z];
  const shift = (p, q, t) => ({ x: THREE.MathUtils.lerp(p.x, q.x, t), z: THREE.MathUtils.lerp(p.z, q.z, t) });
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i];
    const length = b.distance - a.distance;
    const outer = [a.edges[0], b.edges[0], b.edges[1], a.edges[1]];
    const corners = [point(outer[0], a.y), point(outer[1], b.y), point(outer[2], b.y), point(outer[3], a.y)];
    deck.quad(...corners.reverse(), wood);
    const height = (x, z) => THREE.MathUtils.lerp(a.y, b.y,
      THREE.MathUtils.clamp(((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (length * length), 0, 1));
    platforms.push({ id: `valenberg-ramp-${i}`, outer, holes: [], height });
    const rowCount = Math.max(1, Math.ceil(length / 0.25));
    for (let row = 1; row < rowCount; row++) {
      const t = row / rowCount, rowY = THREE.MathUtils.lerp(a.y, b.y, t) + 0.012;
      beam(detail, point(shift(a.edges[0], b.edges[0], t), rowY), point(shift(a.edges[1], b.edges[1], t), rowY),
        0.013, 0x716a59);
    }
    for (const side of [0, 1]) {
      const p = a.edges[side], q = b.edges[side];
      const sideWall = [point(p, a.y), point(q, b.y), point(q, b.y - 0.19), point(p, a.y - 0.19)];
      deck.quad(...(side ? sideWall.reverse() : sideWall), 0x625e53);
      for (const rise of [0.32, 0.48, 0.65, 0.81, 1.00]) {
        const batch = rise === 1 ? deck : detail;
        beam(batch, point(p, a.y + rise), point(q, b.y + rise), rise === 1 ? 0.044 : 0.012, metal);
      }
      for (let at = 0; at < length; at += length / Math.max(1, Math.ceil(length / 1.10))) {
        const post = shift(p, q, at / length), y = THREE.MathUtils.lerp(a.y, b.y, at / length);
        beam(deck, point(post, y - 0.16), point(post, y + 1), 0.041, metal);
      }
      colliders.push(...wallColliders(p, q, Math.min(a.y, b.y) - 0.06, Math.max(a.y, b.y) + 1, 0.09));
    }
    if (i % 3 === 1) {
      const base = terrainHeightAt(a.x, a.z);
      beam(deck, point(a, base - 0.08), point(a, a.y - 0.08), 0.13, metal);
    }
  }
  // The walking surface ends in the small viewing landing inside the upper turn.
  const top = sections.at(-1), prev = sections.at(-2);
  const dx = top.x - prev.x, dz = top.z - prev.z, length = Math.hypot(dx, dz);
  const topTail = { x: top.x + dx / length * 1.20, z: top.z + dz / length * 1.20 };
  const tail = top.edges.map(edge => ({ x: edge.x + dx / length * 1.2, z: edge.z + dz / length * 1.2 }));
  const outer = [top.edges[0], tail[0], tail[1], top.edges[1]];
  const y = top.y;
  deck.quad(...outer.map(p => point(p, y)).reverse(), wood);
  platforms.push({ id: 'valenberg-deck', outer, holes: [], height: () => y });
  for (const [a, b] of [[top.edges[0], tail[0]], [tail[0], tail[1]], [tail[1], top.edges[1]]]) {
    beam(deck, point(a, y + 1), point(b, y + 1), 0.045, metal);
    beam(deck, point(a, y - 0.18), point(a, y + 1), 0.045, metal);
    beam(detail, point(a, y + 0.51), point(b, y + 0.51), 0.014, metal);
    colliders.push(...wallColliders(a, b, y - 0.06, y + 1, 0.09));
  }
  beam(deck, point(topTail, terrainHeightAt(topTail.x, topTail.z) - 0.12), point(topTail, y - 0.10), 0.26, metal);

  const group = makeGroup(site.name, deck, colliders);
  const close = detail.mesh();
  close.castShadow = false;
  close.userData.nearDetail = 55;
  group.add(close);
  group.userData.platforms = platforms;
  return group;
}

export const GINKEL_LANDMARK_FACTORIES = {
  'natuurcentrum-de-ginkel': natureCentre,
  'schaapskooi-de-kreel': sheepfolds,
  belgenmonument: belgen,
  valenberg,
};
