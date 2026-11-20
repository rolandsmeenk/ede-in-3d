// Runtime Oude Kerk frame. Horizontal transforms leave the caller's vertical datum alone.
export const SCENE_NAP_ORIGIN = 22.54;

export function projectLonLatInto(affine, lon, lat, target) {
  const dl = lon - affine.lon0, dp = lat - affine.lat0;
  const { x, z } = affine;
  target.x = x[0] + x[1] * dl + x[2] * dp;
  target.z = z[0] + z[1] * dl + z[2] * dp;
  return target;
}

export function unprojectScene(affine, x, z) {
  const [x0, xLon, xLat] = affine.x;
  const [z0, zLon, zLat] = affine.z;
  const determinant = xLon * zLat - xLat * zLon;
  if (!determinant) throw new Error('The Oude Kerk affine is singular');
  const dx = x - x0, dz = z - z0;
  return {
    lon: affine.lon0 + (dx * zLat - dz * xLat) / determinant,
    lat: affine.lat0 + (dz * xLon - dx * zLon) / determinant,
  };
}
