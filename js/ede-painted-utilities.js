import { CivicBatch, makeGroup } from './ede-civic-landmarks.js';

export const POLLENSTEIN_TRANSFORMER = {
  osmId: 'w271549671', bagId: '0228100000070096',
  footprint: [[-1716.5, 189.1], [-1715.2, 192.2], [-1710.3, 190.2], [-1711.6, 187.1]],
};

// Cabinet fronts follow the photos, PDOK aerial and the mapped edges of traffic surfaces.
const cabinets = [
  { name: 'Edese vos cabinet', front: [[-1929.60, 573.50], [-1933.83, 572.27]],
    depth: 0.44, base: -8.56, bodyTop: -7.28, color: 0x364636 },
  { name: 'Roodborstje cabinet', front: [[-1951.37, 588.17], [-1949.92, 587.56]],
    depth: 0.47, base: -8.62, bodyTop: -7.19, color: 0x6a4935 },
  { name: 'Roos cabinet', front: [[-1942.46, 606.73], [-1943.91, 607.35]],
    depth: 0.46, base: -8.39, bodyTop: -6.97, color: 0x424c3f },
];

function cabinetFootprint([a, b], depth) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const scale = depth / Math.hypot(dx, dz);
  const back = ([x, z]) => [x + dz * scale, z - dx * scale];
  return [a, b, back(b), back(a)];
}

function enclosure(name, footprint, base, bodyTop, roof, color) {
  const batch = new CivicBatch();
  const cap = 0x383b3a;
  const at = ([x, z], y) => [x, y, z];
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    batch.quad(at(a, base), at(b, base), at(b, bodyTop), at(a, bodyTop), color);
    batch.quad(at(a, bodyTop), at(b, bodyTop), at(b, roof), at(a, roof), cap);
  }
  batch.quad(...footprint.map(p => at(p, roof)), cap);
  const outer = footprint.map(([x, z]) => ({ x, z }));
  return makeGroup(name, batch, [{
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: base, maxY: roof, polygon: { outer, holes: [] },
  }]);
}

export function buildPaintedUtilities() {
  return [
    enclosure('Pollenstein 108B transformer', POLLENSTEIN_TRANSFORMER.footprint, -8.26, -5.58, -5.36, 0x8b867b),
    ...cabinets.map(({ name, front, depth, base, bodyTop, color }) =>
      enclosure(name, cabinetFootprint(front, depth), base, bodyTop, bodyTop + 0.065, color)),
  ];
}
