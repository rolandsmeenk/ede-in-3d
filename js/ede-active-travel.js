import { BICYCLE, FOOT, MOTOR } from './road-access.js';

const CELL = 64;

function indexTracks(tracks) {
  const cells = new Map();
  for (const t of tracks) {
    const bx = t.ax + t.ux * t.len, bz = t.az + t.uz * t.len;
    for (let x = Math.floor(Math.min(t.ax, bx) / CELL); x <= Math.floor(Math.max(t.ax, bx) / CELL); x++) {
      for (let z = Math.floor(Math.min(t.az, bz) / CELL); z <= Math.floor(Math.max(t.az, bz) / CELL); z++) {
        const key = x * 100000 + z;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(t);
      }
    }
  }
  return (x, z, radius, out) => {
    out.length = 0;
    const seen = new Set();
    for (let ix = Math.floor((x - radius) / CELL); ix <= Math.floor((x + radius) / CELL); ix++) {
      for (let iz = Math.floor((z - radius) / CELL); iz <= Math.floor((z + radius) / CELL); iz++) {
        for (const t of cells.get(ix * 100000 + iz) || []) {
          if (seen.has(t)) continue;
          seen.add(t);
          const along = Math.max(0, Math.min(t.len, (x - t.ax) * t.ux + (z - t.az) * t.uz));
          if ((t.ax + along * t.ux - x) ** 2 + (t.az + along * t.uz - z) ** 2 < radius ** 2) out.push(t);
        }
      }
    }
  };
}

export function buildEdeActiveTravel(data, grade) {
  if (!data?.activeGraph) return null;
  const { nodes, links } = data.activeGraph;
  const profiles = new Set(), separateFootways = new Map();
  for (const site of grade?.sites || []) {
    for (const profile of site.profiles) {
      for (const id of profile.wayIds || []) {
        profiles.add(id);
        if (profile.modes.length === 1 && profile.modes[0] === 'foot') separateFootways.set(id, profile.points);
      }
    }
  }
  // Separate mapped grade profiles can refine a sidewalk collapsed into one OSM axis.
  function footPoint(x, z, points) {
    let closest = [x, z], distance = 6;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i], dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      if (d >= distance) continue;
      closest = [ax + t * dx, az + t * dz];
      distance = d;
    }
    return closest;
  }
  const build = (mode) => {
    const tracks = [], ports = new Map();
    const addPort = (node, port) => {
      if (!ports.has(node)) ports.set(node, []);
      ports.get(node).push(port);
    };
    for (const [a, b, , , , , inner, roadIndex, footOffsets] of links) {
      const road = data.roads[roadIndex], [forward, reverse] = road.modes;
      if (grade && road.tunnel && road.tunnelType !== 'building_passage' && !profiles.has(road.id)) continue;
      const footProfile = mode === FOOT && separateFootways.get(road.id);
      if (!footProfile && !((forward | reverse) & mode)) continue;
      const offsets = mode === FOOT && !footProfile ? footOffsets : [0];
      const points = [nodes[a * 2], nodes[a * 2 + 1], ...inner, nodes[b * 2], nodes[b * 2 + 1]];
      for (const offset of offsets) {
        const shape = [];
        for (let i = 0; i < points.length; i += 2) {
          const x = points[i], z = points[i + 1];
          const dx = (points[i + 2] ?? x) - (points[i - 2] ?? x);
          const dz = (points[i + 3] ?? z) - (points[i - 1] ?? z);
          const len = Math.hypot(dx, dz) || 1;
          shape.push(footProfile ? footPoint(x, z, footProfile) : [x - dz * offset / len, z + dx * offset / len]);
        }
        const segments = [];
        for (let i = 1; i < shape.length; i++) {
          const [ax, az] = shape[i - 1], [bx, bz] = shape[i];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.2) continue;
          segments.push({ ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len, node: null, side: 0, line: 0,
            wayId: road.id, layer: road.layer, structure: road.bridge || road.tunnel, mapped: true,
            sidewalk: offset !== 0, exclusive: !((forward | reverse) & MOTOR),
            width: offset === 0 && !road.bridge && !road.tunnel && ['cycle', 'foot', 'shared'].includes(road.bgt?.kind)
              ? road.bgt.width ?? road.width : road.width,
            allowed: [!!footProfile || !!(forward & mode), !!footProfile || !!(reverse & mode)], links: [[], []] });
        }
        for (const [i, t] of segments.entries()) {
          const prev = segments[i - 1], next = segments[i + 1];
          if (prev && t.allowed[1]) t.links[0].push([{ track: prev, dir: -1 }]);
          if (next && t.allowed[0]) t.links[1].push([{ track: next, dir: 1 }]);
          tracks.push(t);
        }
        if (segments.length) {
          addPort(a, { track: segments[0], end: 0 });
          addPort(b, { track: segments.at(-1), end: 1 });
        }
      }
    }
    for (const list of ports.values()) {
      for (const { track: a, end: ea } of list) {
        if (!a.allowed[1 - ea]) continue;
        for (const { track: b, end: eb } of list) {
          if (a === b || !b.allowed[eb]) continue;
          const ax = a.ax + a.ux * a.len * ea, az = a.az + a.uz * a.len * ea;
          const bx = b.ax + b.ux * b.len * eb, bz = b.az + b.uz * b.len * eb;
          const gap = Math.hypot(bx - ax, bz - az);
          if (gap > (mode === FOOT ? 5 : 0.25) || gap > 0.25 && a.layer !== b.layer) continue;
          const legs = [];
          if (gap > 0.05) legs.push({ track: { ...a, ax, az, ux: (bx - ax) / gap, uz: (bz - az) / gap,
            len: gap, links: [[], []] }, dir: 1 });
          legs.push({ track: b, dir: eb ? -1 : 1 });
          a.links[ea].push(legs);
        }
      }
    }
    return indexTracks(tracks);
  };
  return { bikes: build(BICYCLE), foot: build(FOOT) };
}
