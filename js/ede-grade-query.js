const STEP_HEIGHT = 1.7;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const modeGroup = mode => mode === 'person' ? 'foot'
  : ['cyclist', 'cargobike', 'bicycle', 'cycleway'].includes(mode) ? 'bike'
    : ['car', 'van', 'bus'].includes(mode) ? 'motor' : mode;

const boundsOf = (points) => ({
  minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
  minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z))
});
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

export function nearestEdeSpan(spans, x, z, terrainHeightAt, { mode, kind, referenceY, reach = 0.3, heading, wayId } = {}) {
  let picked = null, best = Infinity;
  const useMode = modeGroup(mode);
  for (const span of spans) {
    const { profile } = span;
    if (wayId && wayId !== profile.wayId) continue;
    if (useMode && !profile.modes.includes(useMode)) continue;
    if (kind && profile.site?.kind !== kind) continue;
    const raw = (x - span.x) * span.dx + (z - span.z) * span.dz;
    const along = clamp(raw, 0, span.length);
    const lateral = -(x - span.x) * span.dz + (z - span.z) * span.dx;
    const distance = Math.hypot(raw - along, lateral);
    if (distance > (profile.half ?? 0) + reach) continue;
    const localSurface = profile.site?.kind === 'surface';
    if (localSurface && (raw < -0.001 || raw > span.length + 0.001 || Math.abs(lateral) >= profile.half)) continue;
    let y = span.y + (span.endY - span.y) * along / span.length;
    if (localSurface) {
      const weight = clamp((profile.half - Math.abs(lateral)) / profile.shoulder, 0, 1);
      y = terrainHeightAt(x, z) + y * weight;
    }
    const delta = Number.isFinite(referenceY) ? Math.abs(referenceY - y) : 0;
    if (delta > STEP_HEIGHT) continue;
    const alignment = Number.isFinite(heading) ? Math.abs(Math.sin(heading) * span.dx + Math.cos(heading) * span.dz) : 1;
    const score = distance + 2 * delta + (1 - alignment) * 5;
    if (score >= best) continue;
    best = score;
    picked = { span, y, along, lateral, distance, delta };
  }
  return picked;
}

function clip(poly, nx, nz, c, direction) {
  const result = [];
  if (!poly.length) return result;
  let a = poly.at(-1), da = (nx * a.x + nz * a.z - c) * direction;
  for (const b of poly) {
    const db = (nx * b.x + nz * b.z - c) * direction;
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        y: a.y + (b.y - a.y) * t });
    }
    if (db >= 0) result.push(b);
    a = b;
    da = db;
  }
  return result;
}

export function clipEdeGround(polygon, candidates) {
  let remaining = [polygon];
  const bounds = boundsOf(polygon);
  for (const cut of candidates) {
    if (!overlaps(bounds, cut)) continue;
    const outside = [];
    for (const element of remaining) {
      let inside = element;
      for (const [nx, nz, c] of cut.planes) inside = clip(inside, nx, nz, c, 1);
      if (inside.length < 3) {
        outside.push(element);
        continue;
      }
      let fragment = element;
      for (const [nx, nz, c] of cut.planes) {
        const side = clip(fragment, nx, nz, c, -1);
        if (side.length >= 3) outside.push(side);
        fragment = clip(fragment, nx, nz, c, 1);
      }
    }
    remaining = outside;
    if (!remaining.length) break;
  }
  return remaining;
}

