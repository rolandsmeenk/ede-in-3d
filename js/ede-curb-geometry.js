import { makeSurfaceGeometry } from './ede-surface-geometry.js';

export function curbTopGeometry(THREE, top) {
  const positions = [];
  for (let i = 0; i < top.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = top.slice(i, i + 9);
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) >= 0) {
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    } else positions.push(ax, ay, az, cx, cy, cz, bx, by, bz);
  }
  return makeSurfaceGeometry(THREE, positions);
}

export function curbFaceGeometry(THREE, geometry, outer, holes, baseHeightAt) {
  const edges = new Map(), { position } = geometry.attributes;
  const point = i => [position.getX(i), position.getY(i), position.getZ(i)];
  const key = ([x, , z]) => Math.round(x * 1000) + ':' + Math.round(z * 1000);
  for (let i = 0; i < position.count; i += 3) {
    const corners = [point(i), point(i + 1), point(i + 2)];
    for (let j = 0; j < 3; j++) {
      const a = corners[j], b = corners[(j + 1) % 3];
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? ka + '/' + kb : kb + '/' + ka;
      if (edges.has(id)) edges.set(id, null);
      else edges.set(id, [a, b]);
    }
  }
  const faces = [];
  for (const edge of edges.values()) {
    if (!edge) continue;
    const [a, b] = edge;
    const x = (a[0] + b[0]) / 2, z = (a[2] + b[2]) / 2;
    if (![outer, ...holes].some(ring => {
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const dx = ring[i] - ring[j], dz = ring[i + 1] - ring[j + 1], length = Math.hypot(dx, dz);
        if (length < 1e-5) continue;
        const t = ((x - ring[j]) * dx + (z - ring[j + 1]) * dz) / length;
        const d = ((x - ring[j]) * dz - (z - ring[j + 1]) * dx) / length;
        if (t >= -0.001 && t <= length + 0.001 && Math.abs(d) < 0.001) return true;
      }
      return false;
    })) continue;
    const baseA = [a[0], baseHeightAt(a[0], a[2]), a[2]];
    const baseB = [b[0], baseHeightAt(b[0], b[2]), b[2]];
    if (a[1] - baseA[1] > 0.001 || b[1] - baseB[1] > 0.001) {
      // Extend into the draped ground at edges without adjoining pavement.
      baseA[1] -= 0.09;
      baseB[1] -= 0.09;
      faces.push(...a, ...baseA, ...b, ...b, ...baseA, ...baseB);
    }
  }
  return faces.length ? makeSurfaceGeometry(THREE, faces) : null;
}
