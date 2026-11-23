const coverageUrl = new URL('../assets/ede-coverage-v1.json', import.meta.url);

async function loadCoverage() {
  let data;
  if (coverageUrl.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    try {
      data = JSON.parse(await readFile(coverageUrl, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  } else {
    const response = await fetch(coverageUrl);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Ede coverage HTTP ${response.status}`);
    data = await response.json();
  }
  if (data.version !== 1 || data.source?.id !== 'GM0228'
      || !['playableBoundary', 'buildingBoundary', 'terrainBoundary'].every(key =>
        Array.isArray(data[key]) && data[key].length && data[key].every(polygon =>
          Array.isArray(polygon) && polygon.length && polygon.every(ring =>
            Array.isArray(ring) && ring.length >= 6 && ring.length % 2 === 0 && ring.every(Number.isFinite))))
      || !['bounds', 'geographicBounds'].every(key =>
        Array.isArray(data[key]) && data[key].length === 4 && data[key].every(Number.isFinite))) {
    throw new Error('Invalid Ede coverage geometry');
  }
  return data;
}

export const edeCoverage = await loadCoverage();

const row = z => Math.floor(z / 128);

export function createCoverageIndex(boundary) {
  const edgeBands = new Map();
  const polygons = boundary.map(polygon => polygon.map(ring => {
    const bands = new Map();
    for (let i = 0, previous = ring.length - 2; i < ring.length; previous = i, i += 2) {
      const edge = [ring[previous], ring[previous + 1], ring[i], ring[i + 1]];
      const first = row(Math.min(edge[1], edge[3]));
      const last = row(Math.max(edge[1], edge[3]));
      for (let band = first; band <= last; band++) {
        if (!bands.has(band)) bands.set(band, []);
        if (!edgeBands.has(band)) edgeBands.set(band, []);
        bands.get(band).push(edge);
        edgeBands.get(band).push(edge);
      }
    }
    return bands;
  }));

  function inRing(x, z, bands) {
    let inside = false;
    for (const [ax, az, bx, bz] of bands.get(row(z)) ?? []) {
      if (x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
          && z >= Math.min(az, bz) && z <= Math.max(az, bz)
          && Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) < 1e-6) return 2;
      if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
    }
    return Number(inside);
  }

  function contains(x, z) {
    return polygons.some(([outer, ...holes]) =>
      inRing(x, z, outer) > 0 && !holes.some(hole => inRing(x, z, hole) === 1));
  }

  function touchesBounds(minX, minZ, maxX, maxZ) {
    for (let band = row(minZ); band <= row(maxZ); band++) {
      for (const [ax, az, bx, bz] of edgeBands.get(band) ?? []) {
        if (Math.max(ax, bx) >= minX && Math.min(ax, bx) <= maxX
            && Math.max(az, bz) >= minZ && Math.min(az, bz) <= maxZ) return true;
      }
    }
    return false;
  }

  return {
    contains,
    overlapsBounds: (minX, minZ, maxX, maxZ) =>
      contains(minX, minZ) || touchesBounds(minX, minZ, maxX, maxZ),
    coversBounds: (minX, minZ, maxX, maxZ) =>
      contains(minX, minZ) && !touchesBounds(minX, minZ, maxX, maxZ),
  };
}
