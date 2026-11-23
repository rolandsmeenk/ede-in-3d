import { polygonContains } from './building-collision.js';

function* matchBagCoverage(geometries, candidates) {
  if (!candidates.length) return [];
  const cell = 24, bins = new Map();
  for (const { attributes: { position }, index } of geometries) {
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      if (i % 768 === 0) yield;
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
      const x = position.getX(a), z = position.getZ(a), bx = position.getX(b), bz = position.getZ(b);
      const cx = position.getX(c), cz = position.getZ(c);
      const ux = bx - x, uz = bz - z, vx = cx - x, vz = cz - z;
      const area = ux * vz - uz * vx;
      if (Math.abs(area) < 0.05) continue;
      const triangle = { x, z, ux, uz, vx, vz, area };
      for (let u = Math.floor(Math.min(x, bx, cx) / cell); u <= Math.floor(Math.max(x, bx, cx) / cell); u++) {
        for (let v = Math.floor(Math.min(z, bz, cz) / cell); v <= Math.floor(Math.max(z, bz, cz) / cell); v++) {
          const key = `${u}/${v}`;
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push(triangle);
        }
      }
    }
  }
  const hit = (x, z) => bins.get(`${Math.floor(x / cell)}/${Math.floor(z / cell)}`)?.some(t => {
    const dx = x - t.x, dz = z - t.z;
    const u = (dx * t.vz - dz * t.vx) / t.area, v = (t.ux * dz - t.uz * dx) / t.area;
    return u >= -0.001 && v >= -0.001 && u + v <= 1.001;
  });
  const matches = [];
  for (const b of candidates) {
    yield;
    const [footprint] = b.footprints;
    const polygon = { outer: footprint.pts, holes: footprint.holes };
    let samples = 0, covered = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const x = b.minX + (b.maxX - b.minX) * (i + 0.5) / 5;
      const z = b.minZ + (b.maxZ - b.minZ) * (j + 0.5) / 5;
      if (!polygonContains(polygon, x, z)) continue;
      samples++;
      if (hit(x, z)) covered++;
    }
    if (samples >= 4 && covered >= 0.84 * samples) matches.push(b.id);
  }
  return matches;
}

export { matchBagCoverage };
