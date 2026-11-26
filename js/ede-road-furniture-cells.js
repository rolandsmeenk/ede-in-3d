export const ROAD_FURNITURE_CELL = 500;
export const ROAD_FURNITURE_PAD = 32;

export function roadFurnitureCellKey(x, z) {
  return `${Math.floor(x / ROAD_FURNITURE_CELL)}/${Math.floor(z / ROAD_FURNITURE_CELL)}`;
}

export function roadFurnitureCellBounds(ix, iz, minY, maxY) {
  const size = ROAD_FURNITURE_CELL, pad = ROAD_FURNITURE_PAD;
  return [ix * size - pad, minY - pad, iz * size - pad,
    (ix + 1) * size + pad, maxY + pad, (iz + 1) * size + pad];
}

export function roadFurnitureCellVisible([minX, minY, minZ, maxX, maxY, maxZ], { x, y, z }, reach) {
  const dx = Math.max(0, minX - x, x - maxX);
  const dy = Math.max(0, minY - y, y - maxY);
  const dz = Math.max(0, minZ - z, z - maxZ);
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

export function advanceRoadFurnitureFade(alpha, visible, dt) {
  const step = Math.max(0, dt) / 0.25;
  return visible ? Math.min(1, alpha + step) : Math.max(0, alpha - step);
}

export function indexRoadFurniture(asset) {
  const { version, cellSize, rdOrigin, cells } = asset;
  if (version !== 1 || cellSize !== ROAD_FURNITURE_CELL || rdOrigin?.length !== 2 ||
      !rdOrigin.every(Number.isFinite) || !cells || Array.isArray(cells) || typeof cells !== 'object') {
    throw new Error('Invalid Ede road furniture index');
  }
  const ids = new Set();
  return new Map(Object.entries(cells).map(([key, features]) => {
    const [ix, iz] = key.split('/').map(Number);
    if (!Number.isInteger(ix) || !Number.isInteger(iz) || key !== `${ix}/${iz}` || !Array.isArray(features)) {
      throw new Error(`Invalid road furniture cell ${key}`);
    }
    const records = features.map(feature => {
      const { id, type, rdX, rdY, sceneCorrection } = feature;
      if (typeof id !== 'string' || !id || ids.has(id) || !['hecto', 'rvv', 'exit'].includes(type) ||
          sceneCorrection?.length !== 2 || ![rdX, rdY, ...sceneCorrection].every(Number.isFinite)) {
        throw new Error(`Invalid road furniture record in ${key}`);
      }
      // RD translation stays in doubles. The baked grid correction aligns it to the scene's true-north axes.
      const x = rdX - rdOrigin[0] + sceneCorrection[0];
      const z = rdOrigin[1] - rdY + sceneCorrection[1];
      if (roadFurnitureCellKey(x, z) !== key) throw new Error(`Road furniture ${id} belongs to a different cell`);
      ids.add(id);
      return { ...feature, x, z };
    });
    return [key, { ix, iz, records, spawnAlpha: 0 }];
  }));
}
