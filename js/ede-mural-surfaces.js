import { CivicBatch, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { EDE_MURAL_WALLS } from './ede-mural-wall-data.js';

function wall(batch, corners, depth, color) {
  const [a, b] = corners;
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const width = Math.hypot(dx, dz);
  const back = corners.map(([x, y, z]) => [x + dz * depth / width, y, z - dx * depth / width]);
  batch.quad(...corners, color);
  batch.quad(...[...back].reverse(), color);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    batch.quad(corners[j], corners[i], back[i], back[j], color);
  }
  const from = { x: (a[0] + back[0][0]) / 2, z: (a[2] + back[0][2]) / 2 };
  const to = { x: (b[0] + back[1][0]) / 2, z: (b[2] + back[1][2]) / 2 };
  return wallColliders(from, to, Math.min(a[1], b[1]), Math.max(corners[2][1], corners[3][1]), depth);
}

export function buildMuralWalls() {
  return Object.entries(EDE_MURAL_WALLS).map(([id, faces]) => {
    const batch = new CivicBatch();
    const cabinet = id === 'leeuwen';
    const colliders = faces.flatMap(face => {
      const depth = cabinet ? 0.67 : face[1][0] < face[0][0] ? 0.95 : 0.24;
      return wall(batch, face, depth, cabinet ? 0x313b43 : 0x86857d);
    });
    if (cabinet) {
      const [a, b, c, d] = faces[0];
      const topA = [d[0], d[1] - 0.045, d[2]], topB = [c[0], c[1] - 0.045, c[2]];
      wall(batch, [topA, topB, [c[0], c[1] + 0.045, c[2]], [d[0], d[1] + 0.045, d[2]]], 0.70, 0x222a2d);
      for (let i = 1; i < 5; i++) {
        const t = i / 5, x = a[0] + (b[0] - a[0]) * t + 0.023, z = a[2] + (b[2] - a[2]) * t;
        batch.quad([x,a[1],z+0.016], [x,a[1],z-0.016], [x,c[1],z-0.016], [x,c[1],z+0.016], 0x252b2e);
      }
    }
    return makeGroup(cabinet ? 'Leeuwen utility cabinet' : 'Hall of Fame walls', batch, colliders);
  });
}
