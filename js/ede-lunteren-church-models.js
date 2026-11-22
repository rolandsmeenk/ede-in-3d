import * as THREE from 'three/webgpu';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';
import { terrainHeightAt } from './terrain.js';

const DARK = [0x37444b, 0x4c5b60, 0x3d4e53, 0x536363];
const IVORY = 0xd9d6ca;
const GREEN_COPPER = 0x5d7768;

function threshold(wall) {
  return Math.max(wall.bottom + 0.05, terrainHeightAt(wall.x, wall.z) + SCENE_NAP_ORIGIN + 0.06);
}

function box(batch, tools, wall, u, nap, depth, width, height, length, tint) {
  const [x, y, z] = tools.point(wall, u, nap, depth);
  batch.solid(new THREE.BoxGeometry(width, height, length)
    .rotateY(Math.atan2(-wall.uz, wall.ux)).translate(x, y, z), tint);
}

function glazedArch(batch, tools, wall, u, width, lo, hi, trim = IVORY) {
  tools.arch(batch, wall, u, width + 0.12, lo - 0.07, hi + 0.11, trim, 0.04);
  tools.arch(batch, wall, u, width, lo, hi, DARK[1], 0.06);
  tools.rect(batch, wall, u, 0.04, lo, hi - 0.035, trim, 0.085);
  for (let nap = lo + 0.82; nap < hi - width * 0.48; nap += 0.82) {
    tools.rect(batch, wall, u, width, nap, nap + 0.04, trim, 0.085);
  }
}

function bethelFacade(batch, walls, t) {
  // The entrance and twin belfry louvers face east toward De Haverkamp.
  const tower = walls.get(126);
  const lo = threshold(tower);
  glazedArch(batch, t, tower, 0, 3.10, lo + 2.67, lo + 5.32);
  t.door(batch, tower, 0, 2.99, lo, lo + 2.67, { wood: 0xa67849, stone: 0x805a47, rounded: false });
  t.steps(batch, tower, 0, 3.37, lo, 2);
  t.arch(batch, tower, 0, 2.23, 21.62, 26.18, 0x795644, 0.033);
  t.arch(batch, tower, 0, 1.94, 21.62, 25.91, 0x975f4d, 0.055);
  t.rect(batch, tower, 0, tower.width + 0.08, 21.51, 21.66, 0xb9a791, 0.13);
  for (const index of [60, 71, 93, 126]) {
    const wall = walls.get(index);
    for (const u of [-0.66, 0.66]) {
      t.arch(batch, wall, u, 0.51, 32.20, 34.09, 0x282724, 0.061);
      for (let nap = 32.40; nap < 33.8; nap += 0.18) {
        t.rect(batch, wall, u, 0.47, nap, nap + 0.034, 0x50483d, 0.083);
      }
    }
    t.rect(batch, wall, 0, wall.width + 0.13, 34.60, 34.74, 0xbeb8a7, 0.13);
  }
  for (const index of [34, 36, 37, 67, 80, 95, 104, 120, 136, 142]) {
    const wall = walls.get(index);
    const bottom = threshold(wall) + 0.55;
    for (const u of [-wall.width * 0.22, wall.width * 0.22]) {
      glazedArch(batch, t, wall, u, 0.95, bottom, Math.min(17.77, wall.cap - 0.36));
    }
  }
  const clock = { ...tower, x: -4096.90, z: -3926.24, roofClock: [36.05, 0.83] };
  t.churchClock(batch, clock, 0, 36.05, 0.49);
}

function maranathaTower(batch, walls, t) {
  const frame = { ...walls.get(45), x: -3849.45, z: -4363.9 };
  const brick = 0x816352;
  for (const u of [-1.07, 1.07]) {
    box(batch, t, frame, u, 26.30, 0, 0.77, 5.16, 1.32, brick);
  }
  box(batch, t, frame, 0, 28.88, 0, 3.01, 0.52, 1.48, 0xb9aa87);
  box(batch, t, frame, 0, 24.08, 0, 2.94, 0.72, 1.40, brick);
  for (const [nap, radius] of [[27.86, 0.32], [26.28, 0.25]]) {
    box(batch, t, frame, 0, nap + 0.40, 0, 1.51, 0.11, 0.12, 0x393532);
    t.spindle(batch, frame.x, frame.z, 12, [
      [radius, nap - 0.17], [radius * 0.95, nap - 0.07],
      [radius * 0.57, nap + 0.19], [radius * 0.32, nap + 0.35],
    ], 0x524739, 0);
  }
}

function maranathaFacade(batch, walls, t) {
  // The low southeast entrance faces the Hertenlaan forecourt beneath the recessed nave.
  const front = walls.get(12);
  const lo = threshold(front);
  const top = Math.min(lo + 3.00, front.cap - 0.56);
  t.rect(batch, front, 0, 12.6, lo - 0.06, top + 0.53, 0x9a624d, 0.18);
  for (const u of [-4.22, 4.22]) {
    t.windowBand(batch, front, u, 3.47, lo + 0.08, top,
      { columns: 3, rows: 1, tint: DARK, trim: 0xcab283, border: 0xd7c29b, depth: 0.20 });
  }
  const wood = 0xc7a879, mullion = 0xe2c69d;
  t.rect(batch, front, 0, 4.42, lo + 0.08, top, mullion, 0.20);
  for (const [center, slope] of [[-1.54, 1], [1.54, -1]]) {
    t.panel(batch, front, [
      [center + slope * 0.58, top - 1.26], [center + 0.58, top], [center - 0.58, top],
    ], DARK[0], 0.23);
  }
  for (const u of [-1.18, 0, 1.18]) {
    t.rect(batch, front, u, 0.038, lo + 0.14, top - 0.05, wood, 0.255);
  }
  for (const index of [5, 34, 45]) {
    const wall = walls.get(index);
    const bottom = threshold(wall);
    for (const ratio of [-0.28, 0, 0.28]) {
      t.windowBand(batch, wall, wall.width * ratio, Math.min(2.6, wall.width * 0.20), bottom + 1.65, bottom + 2.60,
        { columns: 2, rows: 1, tint: DARK });
    }
  }
}

function oranjeFacade(batch, walls, t) {
  // The hall and glazed vestibule are west of the tower on the Oranjestraat side.
  for (const [index, width, u] of [[0, 9.2, 3.15], [4, 3.74, 0]]) {
    const wall = walls.get(index);
    const lo = threshold(wall);
    t.windowBand(batch, wall, u, width, lo + 0.08, wall.cap - 0.35, {
      columns: Math.round(width / 0.84), rows: 1, tint: DARK, border: IVORY, trim: IVORY,
    });
    t.rect(batch, wall, u, width + 0.26, wall.cap - 0.37, wall.cap - 0.06, IVORY, 0.13);
  }
  const tower = walls.get(13);
  const lo = threshold(tower);
  t.door(batch, tower, 0, 1.37, lo, lo + 2.72, { wood: 0x383832, stone: 0x655a4e });
  t.steps(batch, tower, 0, 1.94, lo, 3);
  for (const nap of [20.85, 24.26]) {
    t.windowBand(batch, tower, 0, 0.64, nap, nap + 1.10, { columns: 1, rows: 1, tint: DARK, border: IVORY });
  }
  t.rect(batch, tower, 0, 1.78, 29.62, 32.54, 0x252724, 0.044);
  t.rect(batch, tower, 0, 0.15, 29.65, 32.55, 0x675e50, 0.076);
  const chancel = walls.get(20);
  glazedArch(batch, t, chancel, 0.28, 1.16, 19.30, 23.26, 0xaaa39a);
  const bronze = 0x726655;
  t.bar(batch, chancel, [-1.35, 20.11], [-1.35, 22.26], 0.09, bronze, 0.07);
  t.bar(batch, chancel, [-1.82, 20.55], [-0.91, 21.47], 0.09, bronze, 0.07);
  t.bar(batch, chancel, [-1.82, 21.47], [-0.91, 20.55], 0.09, bronze, 0.07);
  t.bar(batch, chancel, [-1.35, 22.26], [-1.05, 22.21], 0.09, bronze, 0.07);
  t.bar(batch, chancel, [-1.05, 22.21], [-1.02, 21.90], 0.09, bronze, 0.07);
  t.bar(batch, chancel, [-1.02, 21.90], [-1.35, 21.81], 0.09, bronze, 0.07);
  for (const index of [21, 36, 66]) {
    const wall = walls.get(index);
    const bays = index === 66 ? [-0.32, 0, 0.33] : [-0.15, 0.15];
    for (const u of bays) glazedArch(batch, t, wall, wall.width * u, 0.87, 18.45, 21.45, 0xb0a596);
  }
}

function witteBelfry(batch, walls, t) {
  const gable = { ...walls.get(4), x: -2969.14, z: -4071.32 };
  for (const u of [-0.38, 0.38]) for (const d of [-0.29, 0.29]) {
    box(batch, t, gable, u, 22.62, d, 0.10, 1.10, 0.11, IVORY);
  }
  const peak = 23.60, eaves = 23.10;
  for (const side of [-1, 1]) {
    const a = t.point(gable, 0, peak, -0.52), b = t.point(gable, 0, peak, 0.52);
    const c = t.point(gable, side * 0.61, eaves, 0.52), d = t.point(gable, side * 0.61, eaves, -0.52);
    batch.polygon([side > 0 ? [d, c, b, a] : [a, b, c, d]], 0x4b4f51);
  }
  for (const side of [-1, 1]) {
    const depth = side * 0.43;
    batch.triangle(t.point(gable, -side * 0.55, eaves, depth), t.point(gable, 0, peak - 0.055, depth),
      t.point(gable, side * 0.55, eaves, depth), IVORY);
  }
}

function witteFacade(batch, walls, t) {
  const front = { ...walls.get(4), x: -2968.64, z: -4071.96, width: 8.70 };
  for (const index of [0, 1, 2, 3, 4, 5]) {
    const wall = walls.get(index);
    for (let nap = wall.bottom + 0.23; nap < wall.top - 0.025; nap += 0.22) {
      const edges = wall.outline.flatMap(([u, y], i) => {
        const [v, top] = wall.outline[(i + 1) % wall.outline.length];
        if ((y > nap) === (top > nap)) return [];
        return [u + (v - u) * (nap - y) / (top - y)];
      });
      const left = Math.min(...edges), right = Math.max(...edges);
      t.rect(batch, wall, (left + right) / 2, right - left - 0.025, nap, nap + 0.018, 0xc3c4bd, 0.023);
    }
  }
  const lo = threshold(front);
  t.rect(batch, front, 0, 2.74, lo, lo + 2.57, IVORY, 0.055);
  t.rect(batch, front, 0, 2.07, lo + 0.03, lo + 2.16, 0xc6c5b8, 0.091);
  for (const u of [-0.52, 0.52]) {
    t.arch(batch, front, u, 0.39, lo + 0.82, lo + 1.94, DARK[1], 0.113);
  }
  t.rect(batch, front, 0, 0.063, lo + 0.02, lo + 2.15, 0x737870, 0.12);
  const clock = { ...front, x: -2969.14, z: -4071.32 };
  t.churchClock(batch, { ...clock, x: clock.x + front.nx * 0.39, z: clock.z + front.nz * 0.39 }, 0, 22.64, 0.35);
  for (const index of [0, 2]) {
    const wall = walls.get(index);
    for (const ratio of [-0.36, -0.18, 0, 0.18, 0.36]) {
      glazedArch(batch, t, wall, wall.width * ratio, 0.78, wall.bottom + 0.83, wall.bottom + 2.47);
    }
  }
}

function molukseFacade(batch, walls, t) {
  const front = walls.get(7);
  const lo = threshold(front);
  const oxide = 0x793f39;
  t.rect(batch, front, 0, 2.32, lo - 0.03, lo + 2.47, oxide, 0.07);
  t.rect(batch, front, 0, 2.11, lo + 0.04, lo + 2.36, 0x352c2a, 0.106);
  t.rect(batch, front, 0, 0.048, lo + 0.08, lo + 2.35, 0x8a5747, 0.13);
  t.windowBand(batch, front, 0, 2.26, lo + 2.49, lo + 6.18,
    { columns: 4, rows: 7, tint: DARK, border: oxide, trim: oxide });
  t.steps(batch, front, 0, 2.77, lo, 3);
  for (const u of [-1.77, 1.77]) {
    t.rect(batch, front, u, 0.91, lo + 0.08, lo + 5.63, 0xa66e58, 0.064);
    t.rect(batch, front, u, 0.73, lo + 1.43, lo + 4.37, 0xc5b091, 0.083);
    for (const [d, y] of [[-0.19, 1.78], [0, 2.23], [0.17, 2.70]]) {
      t.bar(batch, front, [u + d - 0.13, lo + y], [u + d + 0.04, lo + y + 0.63], 0.08, 0xa99674, 0.10);
    }
  }
  for (const index of [5, 11, 23, 39]) {
    const wall = walls.get(index);
    const count = index === 39 ? 3 : 5;
    const span = wall.width / (count + 2);
    const bottom = wall.bottom + (index === 23 || index === 39 ? 0.25 : 1.15);
    for (let i = 0; i < count; i++) {
      t.windowBand(batch, wall, (i - (count - 1) / 2) * span, Math.min(0.78, span * 0.78),
        bottom, Math.min(wall.cap - 0.20, bottom + 1.42),
        { columns: 1, rows: 2, tint: DARK, trim: oxide, border: oxide });
    }
  }
}

export const LUNTEREN_CHURCH_STYLES = {
  'bethelkerk-lunteren': {
    wall: 0x815745, roof: 0x40474d,
    facade: bethelFacade,
    silhouette: (batch, walls, t) => t.cross(batch, -4099.10, -3925.39, 39.05, 0.91, 0x646758),
  },
  'maranathakerk-lunteren': {
    wall: 0x826550, roof: 0x51534f, shellTop: 23.80,
    facade: maranathaFacade, silhouette: maranathaTower,
  },
  'oranjestraat-kerk-lunteren': {
    wall: 0x89766a, roof: 0x41464b,
    roofTints: { 75: GREEN_COPPER, 76: GREEN_COPPER, 77: GREEN_COPPER, 79: GREEN_COPPER },
    facade: oranjeFacade,
  },
  'witte-kerkje-lunteren': {
    wall: 0xe2e2d9, roof: 0x545655, masonry: false,
    facade: witteFacade, silhouette: witteBelfry,
  },
  'molukse-kerk-lunteren': {
    wall: 0xba9579, roof: 0x64645c,
    facade: molukseFacade,
  },
};
