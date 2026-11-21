import { CivicBatch, civicSigns, facePanel, makeGroup, polygonNormal, wallColliders, wallExtent } from './ede-civic-landmarks.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

export function surveyPanel(wall, u, v, lo, hi, color, offset = 0.034, sheen = 0) {
  if (!(v > u && hi > lo)) return;
  const { trim, a, b, normal, width } = wall;
  facePanel(trim, a, b, normal, u / width, v / width, lo, hi, color, offset, sheen);
}

function wallContains(wall, u, y) {
  const [x, , z] = wall.point(u, y);
  const crosses = ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay, az] = ring[i], [bx, by, bz] = ring[j];
      if ((ay > y) === (by > y)) continue;
      const fraction = (y - ay) / (by - ay);
      const side = (ax + (bx - ax) * fraction - x) * wall.normal.z
        - (az + (bz - az) * fraction - z) * wall.normal.x;
      if (side > 0) inside = !inside;
    }
    return inside;
  };
  return crosses(wall.rings[0]) && !wall.rings.slice(1).some(crosses);
}

export function surveyOpeningFits(wall, u, v, lo, hi) {
  if (!(v - u > 0.16 && hi - lo > 0.16)) return false;
  for (const x of [u, (u + v) / 2, v]) {
    for (const y of [lo, (lo + hi) / 2, hi]) {
      if (!wallContains(wall, x, y)) return false;
    }
  }
  return true;
}

export function surveyWindow(wall, u, v, lo, hi, {
  color = 0x435963, frame = 0xafa99b, columns = 1, rows = 1,
} = {}) {
  if (!surveyOpeningFits(wall, u, v, lo, hi)) return false;
  const rim = Math.min(0.055, (v - u) / 8, (hi - lo) / 8);
  surveyPanel(wall, u, v, lo, hi, frame, 0.035);
  surveyPanel(wall, u + rim, v - rim, lo + rim, hi - rim, color, 0.044, 0.75);
  for (let i = 1; i < columns; i++) {
    const x = u + (v - u) * i / columns;
    surveyPanel(wall, x - rim / 2, x + rim / 2, lo, hi, frame, 0.051);
  }
  for (let i = 1; i < rows; i++) {
    const y = lo + (hi - lo) * i / rows;
    surveyPanel(wall, u, v, y - rim / 2, y + rim / 2, frame, 0.051);
  }
  return true;
}

export function surveyLabel(wall, u, v, lo, hi, text, color, textColor) {
  const [ax, , az] = wall.point(u, lo, 0.10), [bx, , bz] = wall.point(v, lo, 0.10);
  wall.labels.push({ text, a: { x: bx, z: bz }, b: { x: ax, z: az }, lo, hi, color, textColor });
}

export function createSurveyLandmark(site, buildings, decorate, finish) {
  const shell = new CivicBatch(), trim = new CivicBatch(), colliders = [], platforms = [], labels = [];
  const anchored = getTerrain();
  for (const [buildingIndex, building] of buildings.entries()) {
    const { ground: base, points, faces, wallColor, roofColor, outline } = building;
    const foundation = (x, z) => anchored ? Math.min(base, terrainHeightAt(x, z) - 0.14) : base;
    if (outline?.length) {
      const [outer, ...holes] = outline.map(ring => ring.map(([x, z]) => ({ x, z })));
      colliders.push({
        minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
        minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
        minY: Math.min(...outer.map(({ x, z }) => foundation(x, z))) - 0.08,
        maxY: Math.max(...points.map(p => p[1])), polygon: { outer, holes },
      });
    }
    for (const [faceIndex, [roof, ...indices]] of faces.entries()) {
      const rings = indices.map(ring => ring.map(index => points[index]));
      const ring = rings[0];
      if (roof) {
        shell.polygon(rings, building.roofColors?.[faceIndex] ?? roofColor);
        continue;
      }
      const normal = polygonNormal(ring);
      const { a, b, width } = wallExtent(ring, normal);
      const low = Math.min(...ring.map(p => p[1])), high = Math.max(...ring.map(p => p[1]));
      const nearGround = low <= base + 0.03;
      let color = wallColor;
      if (width > 0.09 && high > low && Math.abs(normal.y) < 0.12) {
        const point = (u, y, offset = 0) => [
          a.x + (b.x - a.x) * (u / width) + normal.x * offset,
          y, a.z + (b.z - a.z) * (u / width) + normal.z * offset,
        ];
        color = decorate?.({
          building, buildingIndex, faceIndex, rings, normal, a, b, width, low, high, base, point, shell, trim, labels,
        }) ?? wallColor;
        if (nearGround && !outline?.length) {
          colliders.push(...wallColliders(a, b, Math.min(foundation(a.x, a.z), foundation(b.x, b.z)), high));
        }
      }
      shell.polygon(nearGround && anchored && Math.abs(normal.y) < 0.12
        ? rings.map(points => points.map(p => p[1] <= base + 0.03 ? [p[0], foundation(p[0], p[2]), p[2]] : p))
        : rings, color);
    }
  }
  const group = makeGroup(site.name, shell, colliders);
  finish?.({ group, trim, labels, colliders, platforms });
  if (platforms.length) group.userData.platforms = platforms;
  if (trim.vertices.length) {
    const detail = trim.mesh();
    detail.userData.nearDetail = true;
    detail.castShadow = false;
    group.add(detail);
  }
  const signs = civicSigns(labels, { wide: true });
  if (signs) {
    signs.userData.nearDetail = true;
    group.add(signs);
  }
  return group;
}
