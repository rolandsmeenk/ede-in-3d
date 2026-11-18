const CELL_SIZE = 128;
const cellKey = (x, z) => x * 100000 + z;

// Length of a unit-direction segment inside the simulation disk.
export function localSegmentLength(x, z, radius, ax, az, dx, dz, length) {
  const ox = x - ax, oz = z - az;
  const along = ox * dx + oz * dz;
  const perpendicular = ox * dz - oz * dx;
  const reach = radius * radius - perpendicular * perpendicular;
  if (reach <= 0) return 0;
  const half = Math.sqrt(reach);
  return Math.max(0, Math.min(length, along + half) - Math.max(0, along - half));
}

export function indexLocalRoads(edges, signals) {
  const index = new Map();
  function add(value, minX, minZ, maxX, maxZ) {
    for (let x = Math.floor(minX / CELL_SIZE); x <= Math.floor(maxX / CELL_SIZE); x++) {
      for (let z = Math.floor(minZ / CELL_SIZE); z <= Math.floor(maxZ / CELL_SIZE); z++) {
        const key = cellKey(x, z);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(value);
      }
    }
  }
  for (const edge of edges) {
    const bx = edge.sx + edge.dx * edge.len, bz = edge.sz + edge.dz * edge.len;
    add(edge, Math.min(edge.sx, bx), Math.min(edge.sz, bz), Math.max(edge.sx, bx), Math.max(edge.sz, bz));
  }
  for (const node of signals) add(node, node.x, node.z, node.x, node.z);
  const seen = new Set();
  return (x, z, radius, outEdges, outSignals) => {
    outEdges.length = outSignals.length = 0;
    seen.clear();
    for (let i = Math.floor((x - radius) / CELL_SIZE); i <= Math.floor((x + radius) / CELL_SIZE); i++) {
      for (let j = Math.floor((z - radius) / CELL_SIZE); j <= Math.floor((z + radius) / CELL_SIZE); j++) {
        for (const value of index.get(cellKey(i, j)) || []) {
          if (seen.has(value)) continue;
          seen.add(value);
          if (value.lanes) {
            if (localSegmentLength(x, z, radius, value.sx, value.sz, value.dx, value.dz, value.len)) outEdges.push(value);
          } else if ((value.x - x) ** 2 + (value.z - z) ** 2 < radius ** 2) outSignals.push(value);
        }
      }
    }
  };
}

export function pickByArea(entries, random = Math.random) {
  if (!entries.length) return undefined;
  const sample = random() * entries.at(-1).end;
  let low = 0, high = entries.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sample < entries[mid].end) high = mid;
    else low = mid + 1;
  }
  return entries[low].segment;
}
