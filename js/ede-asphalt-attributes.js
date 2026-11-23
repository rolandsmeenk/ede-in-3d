// Mapped pavement polygons can span multiple streets. Match each draped
// triangle to a road axis so a lane coordinate never interpolates across roads.
export function applyAsphaltLanes(THREE, geometry, segment, layer, nearestEdeRoad, laneBand) {
  if (!segment && layer !== undefined && geometry.index) {
    const expanded = geometry.toNonIndexed();
    geometry.dispose();
    geometry = expanded;
  }
  const positions = geometry.getAttribute('position');
  const data = new Float32Array(positions.count * 4);
  const set = (i, section, band) => {
    const x = positions.getX(i) - section.a.x, z = positions.getZ(i) - section.a.z;
    const across = -section.uz * x + section.ux * z;
    const along = section.ux * x + section.uz * z;
    const offset = i * 4;
    data[offset] = (across - band.origin) / band.width;
    data[offset + 1] = band.width;
    data[offset + 2] = band.count;
    const junctionDistance = Math.min(band.startJunction ? along : Infinity,
      band.endJunction ? section.len - along : Infinity);
    data[offset + 3] = THREE.MathUtils.smoothstep(junctionDistance, 1.0, 6.0);
  };

  if (segment && !segment.pedestrian) {
    const band = laneBand(segment);
    if (band) for (let i = 0; i < positions.count; i++) set(i, segment, band);
  } else if (layer !== undefined) {
    for (let i = 0; i + 2 < positions.count; i += 3) {
      const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
      const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
      const section = nearestEdeRoad(x, z, 13, undefined, layer);
      const band = section && laneBand(section);
      if (!band || section.distance > section.width / 2 + 0.9) continue;
      for (let vertex = i; vertex < i + 3; vertex++) set(vertex, section, band);
    }
  }

  geometry.setAttribute('asphaltLanes', new THREE.BufferAttribute(data, 4));
  return geometry;
}
