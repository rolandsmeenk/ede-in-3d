const arrows = new Set(['left', 'ahead-left', 'straight', 'ahead-right', 'right']);
const phases = new Set(['red', 'amber', 'green']);
const signalKey = ([x, z]) => `${x}/${z}`;
const point = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

export function indexEdeSignalHardware(asset) {
  if (asset?.version !== 1 || !Array.isArray(asset.heads) || !Array.isArray(asset.supports) ||
      asset.supports.some(s => !Array.isArray(s?.points) || s.points.length !== 2 ||
        !s.points.every(point) || !['gantry', 'cantilever'].includes(s.kind) ||
        !(Number.isFinite(s.beamY) || Number.isFinite(s.height)))) {
    throw new Error('Invalid Ede signal hardware asset');
  }
  const byAnchor = new Map();
  for (const head of asset.heads) {
    const { anchor, point: position, pole, mount, heading, y, height, support, arrow, greenArrow } = head ?? {};
    if (!point(anchor) || !point(position) || (pole != null && !point(pole)) || !Number.isFinite(heading) ||
        !(Number.isFinite(y) || Number.isFinite(height)) || !['roadside', 'overhead'].includes(mount) ||
        (arrow !== undefined && !arrows.has(arrow)) ||
        (greenArrow !== undefined && (!arrows.has(greenArrow?.direction) || !['left', 'right'].includes(greenArrow.side) ||
          !Array.isArray(greenArrow.phases) || !greenArrow.phases.length || greenArrow.phases.some(phase => !phases.has(phase)))) ||
        (mount === 'overhead' && (!Number.isInteger(support) || !asset.supports[support]))) {
      throw new Error('Invalid Ede signal head placement');
    }
    const key = signalKey(anchor);
    if (!byAnchor.has(key)) byAnchor.set(key, []);
    byAnchor.get(key).push(head);
  }
  return { byAnchor, supports: asset.supports };
}

export function fitEdeSignalPole(point, outward, clear, limit) {
  const [x, z] = point, [nx, nz] = outward;
  if (clear(x, z)) return point;
  for (let shift = 0.25; shift <= limit; shift += 0.25) {
    for (const angle of [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2]) {
      const c = Math.cos(angle), s = Math.sin(angle);
      const px = x + shift * (nx * c - nz * s), pz = z + shift * (nz * c + nx * s);
      if (clear(px, pz)) return [px, pz];
    }
  }
  return null;
}

// Keep the beam on its surveyed axis. Only swap a cantilever's ends if its
// recorded foot cannot be used and the other end is already off the road.
export function fitEdeSignalSpan(points, half, clear, limit = 1) {
  const [a, b] = points;
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  if (length < 1.5) return null;
  if (half && !clear(...a) && clear(...b)) return [b, a];
  const extend = (point, direction) => {
    if (clear(...point)) return point;
    for (let d = 0.25; d <= limit; d += 0.25) {
      const next = [point[0] + direction * d * dx / length, point[1] + direction * d * dz / length];
      if (clear(...next)) return next;
    }
    return null;
  };
  const start = extend(a, -1), end = half ? b : extend(b, 1);
  return start && end ? [start, end] : null;
}

// Regeling verkeerslichten §2 point 17 measures the lower edge from the road surface.
export function fitEdeRoadsideSignalY(roadY, halfHeight, observedY) {
  const lowerEdge = observedY - halfHeight - roadY;
  return lowerEdge >= 2.20 && lowerEdge <= 2.40 ? observedY : roadY + 2.30 + halfHeight;
}

export function fitEdeOverheadSignalMount(point, mount, normal, heading, halfWidth, scale, beamRadius, truss, overlapsBeamHeight) {
  const [x, z] = point, [mx, mz] = mount;
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const facing = Math.sign(fx * normal[0] + fz * normal[1]) || 1;
  const nx = normal[0] * facing, nz = normal[1] * facing;
  const rear = 0.05 * scale * (fx * nx + fz * nz) + halfWidth * Math.abs(fz * nx - fx * nz);
  const current = (x - mx) * nx + (z - mz) * nz;
  const offset = overlapsBeamHeight ? Math.max(0, truss + beamRadius + rear + 0.04 - current) : 0;
  return { position: [x + nx * offset, z + nz * offset], mount: [mx + nx * truss, mz + nz * truss] };
}

export async function loadEdeSignalHardware() {
  const response = await fetch(new URL('../assets/ede-signal-hardware.json?v=20261121-hospital-signals', import.meta.url));
  if (!response.ok) throw new Error(`Ede signal hardware returned HTTP ${response.status}`);
  return indexEdeSignalHardware(await response.json());
}
