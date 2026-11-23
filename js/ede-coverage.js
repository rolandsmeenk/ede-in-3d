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

export { createCoverageIndex } from './ede-boundary-index.js';
