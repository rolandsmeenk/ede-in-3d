export function nearestRoadInCells(roadIndex, x, z, reach, wayId, layer) {
  let best = null, bestD = reach * reach;
  for (let gx = Math.floor((x - reach) / 64); gx <= Math.floor((x + reach) / 64); gx++) {
    for (let gz = Math.floor((z - reach) / 64); gz <= Math.floor((z + reach) / 64); gz++) {
      for (const s of roadIndex.get(`${gx}/${gz}`) || []) {
        if ((wayId != null && s.road.id !== wayId) || (layer != null && (s.road.layer ?? 0) !== layer)) continue;
        const t = Math.max(0, Math.min(s.len, (x - s.a.x) * s.ux + (z - s.a.z) * s.uz));
        const px = s.a.x + s.ux * t, pz = s.a.z + s.uz * t;
        const d2 = (px - x) ** 2 + (pz - z) ** 2;
        if (d2 < bestD) { bestD = d2; best = { ...s, x: px, z: pz, distance: Math.sqrt(d2) }; }
      }
    }
  }
  return best;
}

