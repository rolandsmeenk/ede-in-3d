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
  const boundary = [];
  for (const ring of [outer, ...holes]) {
    let distance = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const x = ring[j], z = ring[j + 1];
      const dx = ring[i] - x, dz = ring[i + 1] - z, length = Math.hypot(dx, dz);
      if (length < 1e-5) continue;
      boundary.push({ x, z, ux: dx / length, uz: dz / length, length, distance });
      distance += length;
    }
  }
  const faces = [], uv = [];
  for (const edge of edges.values()) {
    if (!edge) continue;
    const [a, b] = edge;
    const x = (a[0] + b[0]) / 2, z = (a[2] + b[2]) / 2;
    const segment = boundary.find(({ x: sx, z: sz, ux, uz, length }) => {
      const dx = x - sx, dz = z - sz;
      const along = dx * ux + dz * uz;
      return along >= -0.001 && along <= length + 0.001 && Math.abs(dx * uz - dz * ux) < 0.001;
    });
    if (!segment) continue;
    const baseA = [a[0], baseHeightAt(a[0], a[2]), a[2]];
    const baseB = [b[0], baseHeightAt(b[0], b[2]), b[2]];
    const heightA = a[1] - baseA[1], heightB = b[1] - baseB[1];
    if (heightA > 0.001 || heightB > 0.001) {
      // Extend into the draped ground at edges without adjoining pavement.
      baseA[1] -= 0.09;
      baseB[1] -= 0.09;
      const along = ([px, , pz]) => segment.distance + (px - segment.x) * segment.ux + (pz - segment.z) * segment.uz;
      const uA = along(a), uB = along(b);
      faces.push(...a, ...baseA, ...b, ...b, ...baseA, ...baseB);
      uv.push(uA, heightA, uA, -0.09, uB, heightB, uB, heightB, uA, -0.09, uB, -0.09);
    }
  }
  return faces.length ? makeSurfaceGeometry(THREE, faces, undefined, uv) : null;
}

export function curbBoxGeometry(THREE, length, height, width, subdivisions = 1) {
  const geometry = new THREE.BoxGeometry(length, height, width, subdivisions);
  const { position, normal, uv } = geometry.attributes;
  for (let i = 0; i < uv.count; i++) {
    const along = Math.abs(normal.getX(i)) > 0.5 ? position.getZ(i) + width / 2 : position.getX(i) + length / 2;
    uv.setXY(i, along, position.getY(i) + height / 2);
  }
  return geometry;
}
