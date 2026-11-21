import { surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const cream = 0xd8d4c2;
const glass = 0x465961;

function wallLine(wall, a, b, low, high) {
  const dx = b[0] - a[0], dz = b[1] - a[1], width = Math.hypot(dx, dz);
  const normal = { x: -dz / width, y: 0, z: dx / width };
  return {
    ...wall, a: { x: a[0], z: a[1] }, b: { x: b[0], z: b[1] }, width, low, high, normal,
    rings: [[[a[0], low, a[1]], [b[0], low, b[1]], [b[0], high, b[1]], [a[0], high, a[1]]]],
    point: (u, y, depth = 0) => [a[0] + u * dx / width + depth * normal.x,
      y, a[1] + u * dz / width + depth * normal.z],
  };
}

function roomWindow(wall, from, to, low, high, columns = 2, rows = 3) {
  return surveyWindow(wall, from, to, low, high, { frame: cream, color: glass, columns, rows });
}

function prism(wall, u, v, low, high, inside, outside, color) {
  const { point, trim } = wall;
  const a = point(u, low, outside), b = point(v, low, outside);
  const c = point(v, high, outside), d = point(u, high, outside);
  const e = point(u, low, inside), f = point(v, low, inside);
  const g = point(v, high, inside), h = point(u, high, inside);
  trim.quad(a, b, c, d, color);
  trim.quad(e, h, g, f, color);
  trim.quad(e, a, d, h, color);
  trim.quad(b, f, g, c, color);
  trim.quad(e, f, b, a, color);
  trim.quad(d, c, g, h, color);
}

function sill(wall, from, to, y, color = 0xa6a398) {
  prism(wall, from - 0.06, to + 0.06, y - 0.10, y + 0.025, 0.015, 0.14, color);
}

function cornice(wall, y) {
  prism(wall, -0.025, wall.width + 0.025, y - 0.24, y, 0.01, 0.27, cream);
  prism(wall, -0.04, wall.width + 0.04, y, y + 0.16, 0, 0.46, cream);
  prism(wall, -0.05, wall.width + 0.05, y + 0.16, y + 0.22, 0, 0.49, 0x54514a);
}

function moekeEntry(wall, center) {
  const low = wall.base + 0.23, spring = wall.base + 3.73;
  const radius = 1.18, rise = 0.60;
  const stone = 0xb9ad96;
  for (const side of [-1, 1]) {
    const x = center + side * (radius + 0.19);
    for (let level = 0; level < 6; level++) {
      const y = low + level * (spring - low) / 6;
      prism(wall, x - 0.19 - (level % 2) * 0.11, x + 0.19 + (level % 2) * 0.11,
        y, y + (spring - low) / 6 - 0.016, 0.01, 0.12, stone);
    }
  }
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI / 9 + 0.012, b = (i + 1) * Math.PI / 9 - 0.012;
    const thickness = i === 4 ? 0.51 : 0.38;
    const arc = (theta, r, h) => wall.point(center + r * Math.cos(theta), spring + h * Math.sin(theta), 0.125);
    wall.trim.quad(arc(a, radius, rise), arc(a, radius + thickness, rise + thickness),
      arc(b, radius + thickness, rise + thickness), arc(b, radius, rise), stone);
    wall.trim.triangle(wall.point(center, spring, 0.062), arc(a, radius, rise),
      arc(b, radius, rise), 0x293a3d, 0.55);
  }
  prism(wall, center - radius, center + radius, low, spring, 0.025, 0.074, cream);
  for (const side of [-1, 1]) {
    const x = center + side * 0.56;
    for (let column = 0; column < 3; column++) for (let row = 0; row < 4; row++) {
      const u = x - 0.42 + column * 0.29, y = low + 0.83 + row * 0.50;
      surveyPanel(wall, u, u + 0.237, y, y + 0.435, 0x33464b, 0.086, 0.64);
    }
  }
  for (let step = 0; step < 3; step++) {
    prism(wall, center - 1.32, center + 1.32, low - 0.25, low - 0.16 + step * 0.084,
      0, 0.74 - step * 0.24, 0x827b70);
  }
}

const frontDormers = [[-162.79, -159.64], [-159.64, -156.67], [-156.67, -153.60], [-153.60, -151.12]];
const moekeBrick = 0x864b36;
const moekeBack = { a: [-172.87, 512.38], b: [-153.84, 516.71] };

function moeke(wall) {
  const { faceIndex, width, low, high, base } = wall;
  if (faceIndex === 14) {
    const front = wallLine(wall, [-145.10, 504.87], [-169.81, 499.08], base, 8.09);
    const door = front.width * 0.459;
    const bays = [0.083, 0.190, 0.302, 0.590, 0.704, 0.810, 0.911];
    for (const fraction of bays) {
      const u = front.width * fraction;
      roomWindow(front, u - 0.77, u + 0.77, base + 1.14, base + 4.54);
      roomWindow(front, u - 0.77, u + 0.77, base + 5.82, base + 8.40, 2, 2);
      sill(front, u - 0.77, u + 0.77, base + 1.14, 0xa5a199);
    }
    roomWindow(front, door - 1.30, door + 1.30, base + 5.82, base + 8.40, 3, 2);
    moekeEntry(front, door);
    cornice(front, 8.09);
    surveyLabel(front, door - 2.03, door + 2.03, 7.90, 8.23, 'BAR & KEUKEN', '#d8d4c2', '#33312e');
    for (const [west, east] of frontDormers) {
      const u = (front.a.x - (west + east) / 2) * (front.width / (front.a.x - front.b.x));
      const half = Math.min((east - west) * 0.33, 0.94);
      prism(front, u - half, u + half, 8.24, 9.58, 0.02, 0.14, cream);
      const a = front.point(u - half - 0.1, 9.58, 0.14);
      const b = front.point(u + half + 0.1, 9.58, 0.14);
      const c = front.point(u, 10.20, 0.14);
      front.trim.triangle(a, b, c, cream);
      for (const x of [-0.32, 0.32]) {
        surveyPanel(front, u + x - 0.255, u + x + 0.255, 8.43, 9.49, glass, 0.162, 0.64);
        surveyPanel(front, u + x - 0.255, u + x + 0.255, 8.94, 8.98, cream, 0.17);
      }
    }
    return moekeBrick;
  }
  if (faceIndex === 6) {
    const side = wallLine(wall, [-169.84, 499.20], [-172.85, 512.32], base, 8.19);
    for (const u of [2.05, 5.25, 8.68, 11.75]) {
      roomWindow(side, u - 0.74, u + 0.74, base + 1.20, base + 4.48);
      roomWindow(side, u - 0.72, u + 0.72, base + 5.99, base + 8.38, 2, 2);
    }
    cornice(side, 8.19);
    return moekeBrick;
  }
  if (faceIndex === 0) {
    const rear = wallLine(wall, moekeBack.a, moekeBack.b, base, 8.20);
    for (const u of [2.1, 4.95, 10.62, 13.70, 16.72]) {
      roomWindow(rear, u - 0.76, u + 0.76, base + 0.91, base + 3.43, 2, 2);
      roomWindow(rear, u - 0.74, u + 0.74, base + 5.55, base + 8.28, 2, 2);
    }
    roomWindow(rear, 6.6, 8.37, base + 0.20, base + 3.31, 2, 2);
    roomWindow(rear, 6.6, 8.37, 2.23, 4.57, 2, 2);
    cornice(rear, 8.19);
    return moekeBrick;
  }
  if ([8, 21, 27, 29, 34, 36, 37, 40, 43, 45, 50, 57, 60, 63, 66, 67].includes(faceIndex) && low > 8) {
    return 0x66605a;
  }
  if ([1, 2, 5, 19, 46].includes(faceIndex)) {
    const count = Math.max(1, Math.round(width / 2.8));
    const pitch = (width - 0.50) / count;
    for (let bay = 0; bay < count; bay++) {
      const from = 0.47 + bay * pitch, to = 0.14 + (bay + 1) * pitch;
      roomWindow(wall, from, to, low + 1.02, Math.min(high - 0.45, low + 3.40), 2, 2);
    }
  }
  return moekeBrick;
}

function table(trim, x, z, umbrella) {
  const y = getTerrain() ? terrainHeightAt(x, z) : -1.61;
  const deck = wallLine({ trim }, [x - 0.43, z], [x + 0.43, z], y, y + 3);
  prism(deck, 0, 0.86, y + 0.73, y + 0.80, -0.415, 0.415, 0x967055);
  prism(deck, 0.39, 0.47, y + 0.04, y + 0.73, -0.04, 0.04, 0x383630);
  for (const side of [-1, 1]) {
    const seatZ = z + side * 0.70;
    const chair = wallLine({ trim }, [x - 0.21, seatZ], [x + 0.21, seatZ], y, y + 1);
    prism(chair, 0, 0.42, y + 0.43, y + 0.48, -0.21, 0.21, 0xa04d37);
    prism(chair, 0, 0.42, y + 0.49, y + 0.88, side * 0.219 - 0.028, side * 0.219 + 0.028, 0x9a573d);
    for (const u of [0.035, 0.36]) for (const dz of [-0.17, 0.17]) {
      prism(chair, u, u + 0.026, y + 0.03, y + 0.43, dz - 0.013, dz + 0.013, 0x7c5b43);
    }
  }
  if (umbrella) {
    prism(deck, 0.408, 0.452, y + 0.79, y + 2.86, -0.022, 0.022, 0x4b4339);
    const corners = Array.from({ length: 8 }, (_, i) => {
      const angle = i * Math.PI / 4;
      return [x + 1.45 * Math.cos(angle), y + 2.38, z + 1.45 * Math.sin(angle)];
    });
    for (const [i, a] of corners.entries()) {
      const b = corners[(i + 1) % corners.length], cap = [x, y + 2.86, z];
      trim.triangle(a, cap, b, 0x373530);
      trim.triangle(a, b, cap, 0x373530);
    }
  }
}

function moekeTerrace({ trim }) {
  for (const [x, z, umbrella] of [[-175.2, 515.5, true], [-172.2, 517.3, false], [-168.6, 518.1, true],
    [-165.0, 520.0, false], [-161.6, 522.1, true], [-158.0, 522.2, false]]) {
    table(trim, x, z, umbrella);
  }

  const rear = wallLine({ trim }, moekeBack.a, moekeBack.b, -1.61, 8.20);
  const steel = 0x383838, landing = 2.22;
  prism(rear, 6.34, 8.52, landing - 0.16, landing, 0.04, 1.28, steel);
  for (let step = 0; step < 21; step++) {
    const u = 8.5 + step * 0.245, y = landing - step * 0.18;
    prism(rear, u, u + 0.24, y - 0.065, y, 0.18, 1.25, steel);
    if (step % 4 === 0) prism(rear, u, u + 0.042, y, y + 0.94, 1.18, 1.24, steel);
  }
  for (const u of [6.41, 8.50]) prism(rear, u, u + 0.050, landing, landing + 0.94, 1.18, 1.24, steel);
  prism(rear, 6.41, 8.56, landing + 0.9, landing + 0.955, 1.18, 1.24, steel);
  const p = rear.point;
  const rail = [p(8.49, landing + 0.9, 1.23), p(13.64, landing - 2.70, 1.23),
    p(13.64, landing - 2.64, 1.23), p(8.49, landing + 0.96, 1.23)];
  trim.quad(...rail, steel);
  trim.quad(...rail.slice().reverse(), steel);
}

function formerPrintingWorks(wall) {
  const { faceIndex, width, base, high } = wall;
  const limestone = 0xc7c2ad;
  if (faceIndex === 3) {
    const mid = width / 2;
    for (const [left, right] of [[0.76, 3.43], [width - 3.36, width - 0.76]]) {
      roomWindow(wall, left, right, base + 0.70, base + 2.96, 3, 2);
      roomWindow(wall, left + 0.08, right - 0.08, base + 4.29, base + 6.15, 3, 1);
      sill(wall, left, right, base + 0.70, 0xa5998c);
      prism(wall, left - 0.07, right + 0.07, base + 6.18, base + 6.34, 0.02, 0.23, cream);
    }
    roomWindow(wall, mid - 0.55, mid + 0.55, base + 0.16, base + 2.69, 1, 3);
    surveyPanel(wall, mid - 0.83, mid + 0.83, base + 4.34, base + 6.14, 0x51453f, 0.022);
    roomWindow(wall, mid - 0.69, mid + 0.41, base + 4.42, base + 5.93, 2, 2);
    prism(wall, mid - 1.37, mid + 1.23, base + 3.94, base + 4.39, 0, 0.33, 0x775849);
    prism(wall, mid - 1.35, mid + 1.23, base + 6.31, base + 6.48, 0, 0.50, cream);
    prism(wall, mid - 1.35, mid + 1.23, base + 6.48, high + 0.54, 0, 0.27, 0x806356);
    prism(wall, 0.07, width - 0.07, base + 3.13, base + 3.29, 0.01, 0.20, 0xc8c3b2);
    return 0x79594c;
  }
  if (faceIndex === 30) {
    roomWindow(wall, 2.06, 3.07, base + 0.91, base + 2.97, 2, 2);
    roomWindow(wall, 0.75, 1.73, base + 4.04, base + 6.09, 2, 3);
    sill(wall, 0.75, 1.73, base + 4.04);
    roomWindow(wall, 0.39, 1.69, base + 0.13, base + 2.69, 1, 2);
    for (const u of [0.26, 1.66]) prism(wall, u, u + 0.18, base + 0.13, base + 2.71, 0.016, 0.17, limestone);
    prism(wall, 0.24, 1.85, base + 2.69, base + 2.83, 0.02, 0.21, limestone);
    wall.trim.triangle(wall.point(0.24, base + 2.83, 0.20), wall.point(1.85, base + 2.83, 0.20),
      wall.point(1.05, base + 3.18, 0.20), limestone);
  }
  if ([29, 34, 36, 38, 68].includes(faceIndex)) {
    roomWindow(wall, 0.13, width - 0.14, base + 4.04, Math.min(base + 6.12, high - 0.18), width < 0.8 ? 1 : 2, 3);
    roomWindow(wall, 0.17, width - 0.17, base + 0.85, base + 2.95, width > 2.5 ? 3 : 2, 2);
    if (width > 0.85) sill(wall, 0.15, width - 0.15, base + 4.04, 0x736255);
  }
  if ([24, 46, 61, 81].includes(faceIndex)) {
    const slots = Math.max(2, Math.round(width / 2.08));
    const pitch = (width - 0.54) / slots;
    for (let i = 0; i < slots; i++) {
      roomWindow(wall, 0.35 + i * pitch, 0.19 + (i + 1) * pitch, base + 0.49, base + 2.87, 2, 2);
    }
    prism(wall, 0, width, base + 3.28, base + 3.40, 0.01, 0.19, cream);
    return 0x886c59;
  }
  if (faceIndex === 32) {
    roomWindow(wall, 0.68, 2.18, base + 0.85, base + 2.98);
    roomWindow(wall, 3.12, 5.67, base + 4.29, base + 6.19, 4, 1);
    prism(wall, 3.01, 5.83, base + 6.20, base + 6.35, 0.01, 0.24, cream);
    return 0x795d4e;
  }
  if ([12, 13, 33].includes(faceIndex)) {
    const slots = faceIndex === 33 ? 6 : 3, pitch = width / slots;
    for (let i = 0; i < slots; i++) {
      const from = pitch * i + 0.29, to = pitch * (i + 1) - 0.30;
      roomWindow(wall, from, to, base + 0.75, Math.min(base + 3.04, high - 0.16), 2, 2);
      if (faceIndex !== 33) roomWindow(wall, from, to, base + 4.02, base + 5.62, 2, 2);
    }
  }
  return 0x8e7667;
}

function formerMulo(wall) {
  const { faceIndex, width, base, high } = wall;
  const stone = 0xbfbcb0;
  if (faceIndex === 3) {
    const pitch = (width - 0.49) / 13;
    for (let i = 0; i < 13; i++) {
      const left = 0.25 + i * pitch, right = left + pitch;
      roomWindow(wall, left + 0.10, right - 0.10, base + 0.65, base + 3.62, 2, 2);
      roomWindow(wall, left + 0.10, right - 0.10, base + 4.54, base + 7.62, 2, 2);
      prism(wall, left - 0.047, left + 0.047, base + 0.39, base + 7.69, 0.02, 0.11, stone);
      const u = (left + right) / 2, y = base + 4.09, radius = 0.145;
      wall.trim.quad(wall.point(u - radius, y, 0.085), wall.point(u, y - radius, 0.085),
        wall.point(u + radius, y, 0.085), wall.point(u, y + radius, 0.085), 0x7d6e60);
      const inner = radius * 0.57;
      wall.trim.quad(wall.point(u - inner, y, 0.091), wall.point(u, y - inner, 0.091),
        wall.point(u + inner, y, 0.091), wall.point(u, y + inner, 0.091), 0xd4c7aa);
    }
    const last = width - 0.24;
    prism(wall, last - 0.055, last + 0.055, base + 0.39, base + 7.69, 0.02, 0.11, stone);
    for (const y of [base + 0.49, base + 3.68, base + 4.44, base + 7.72]) {
      prism(wall, 0.17, width - 0.16, y, y + 0.085, 0.024, 0.12, stone);
    }
    return 0x8b6a55;
  }
  if ([2, 14, 26, 43, 52, 65].includes(faceIndex)) {
    const count = Math.max(2, Math.round(width / 2.56)), pitch = (width - 0.40) / count;
    for (let i = 0; i < count; i++) {
      const from = 0.45 + i * pitch, to = 0.04 + (i + 1) * pitch;
      roomWindow(wall, from, to, base + 1.05, base + 3.40, 2, 2);
      roomWindow(wall, from, to, base + 4.24, Math.min(high - 0.32, base + 6.94), 2, 2);
    }
  }
  if ([53, 55, 72].includes(faceIndex) && width > 2.15) {
    roomWindow(wall, width / 2 - 0.60, width / 2 + 0.60, base + 4.14, base + 6.60, 2, 3);
  }
  return 0x886752;
}

export const STATIONSWEG_CORNERS = {
  '0228100000051877': { decorate: moeke, finish: moekeTerrace },
  '0228100000002293': formerPrintingWorks,
  '0228100000043543': formerMulo,
};
