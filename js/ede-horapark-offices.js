// Street-facing details based on the Horapark operator, FPG visitor guide and Bernheze exterior photographs.
import * as THREE from 'three/webgpu';
import { mix, normalWorld, positionWorld, texture, vec2, vertexColor } from 'three/tsl';
import { wallColliders } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { HORAPARK_OFFICE_SURVEYS } from './ede-horapark-office-survey.js';
import { terrainHeightAt } from './terrain.js';

const fascia = 0xd5d4ca;
const steel = 0xadaeaa;
const courtY = -0.94;
let masonry;

function alongWall(wall, batch, u, y, projection, width, height, depth, color) {
  const angle = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(angle)
    .translate(...wall.point(u, y, projection)), color);
}

function post(wall, u, depth, bottom, top, radius, color, colliders) {
  const [x, , z] = wall.point(u, bottom, depth);
  wall.shell.solid(new THREE.CylinderGeometry(radius, radius, top - bottom, 8)
    .translate(x, (bottom + top) / 2, z), color);
  if (colliders) colliders.push({ minX: x - radius, maxX: x + radius, minZ: z - radius,
    maxZ: z + radius, minY: bottom, maxY: top });
}

function canopy(wall, id, u, sill, head, colliders) {
  const business = id !== 'horapark-vpva';
  const width = business ? 4.9 : 10.2;
  const depth = business ? 2.9 : 2.75;
  const centre = business ? u : wall.width / 2;
  const top = head + (business ? 0.17 : 0.33);
  alongWall(wall, wall.shell, centre, top, depth * 0.5 - 0.04, width, 0.17, depth + 0.08, fascia);
  alongWall(wall, wall.shell, centre, top - 0.09, depth - 0.12, width, 0.17, 0.14, 0x868985);
  const offsets = business ? [-0.45, 0.45] : [-0.45, -0.20, 0.20, 0.45];
  for (const t of offsets) post(wall, centre + t * width, depth - 0.30, sill - 0.10, top, 0.075, steel, colliders);
  const sign = business ? 'HORAPARK' : 'VPVA notarissen';
  surveyLabel(wall, Math.max(0.10, centre - 1.65), Math.min(wall.width - 0.10, centre + 1.65),
    top + 0.12, top + 0.53, sign, '#454e53', '#f2f0e8');
  if (business) {
    surveyLabel(wall, u + 1.27, Math.min(wall.width - 0.1, u + 1.62), sill + 1.30, sill + 1.74,
      id.endsWith('41') ? '41' : '43', '#454e53', '#f2f0e8');
  }
  // The visitor guide shows the flagpoles leading visitors to the side entrance of number 43.
  if (id === 'bennekomseweg-43') {
    for (const [i, color] of [0xa24448, 0xeeeae3, 0x547284].entries()) {
      const x = u - 3.2 + i * 2.1;
      const distance = 5.0;
      post(wall, x, distance, sill - 0.08, sill + 5.5, 0.035, fascia);
      wall.trim.quad(wall.point(x, sill + 3.6, distance + 0.005), wall.point(x + 0.57, sill + 3.6, distance + 0.005),
        wall.point(x + 0.57, sill + 5.2, distance + 0.005), wall.point(x, sill + 5.2, distance + 0.005), color);
      wall.trim.quad(wall.point(x + 0.57, sill + 3.6, distance - 0.005), wall.point(x, sill + 3.6, distance - 0.005),
        wall.point(x, sill + 5.2, distance - 0.005), wall.point(x + 0.57, sill + 5.2, distance - 0.005), color);
    }
  }
}

function entranceCourt(building, { group, trim, platforms, colliders }) {
  // This open courtyard is the roof of the lower level. Its walkable surface is above the building footprint.
  colliders[0].maxY = courtY - 0.05;
  const [, ...rings] = building.faces[91];
  const [outer, ...holes] = rings.map(ring => ring.map(i => {
    const [x, , z] = building.points[i];
    return { x, z };
  }));
  platforms.push({ id: 'horapark-4-courtyard', outer, holes, height: () => courtY });

  const a = { x: 325.9, z: 2891.30 }, b = { x: 333.5, z: 2891.73 };
  const nx = -0.0564, nz = 0.9984;
  const at = (p, y, d) => [p.x + nx * d, y, p.z + nz * d];
  const tread = 0.36, steps = 8, run = steps * tread;
  const [x, , z] = at({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, 0, run);
  const floor = terrainHeightAt(x, z);
  const stairOutline = [at(a, 0, 0), at(b, 0, 0), at(b, 0, run), at(a, 0, run)]
    .map(([x, , z]) => ({ x, z }));
  group.userData.treeClearance = [{
    minX: Math.min(...stairOutline.map(p => p.x)), maxX: Math.max(...stairOutline.map(p => p.x)),
    minZ: Math.min(...stairOutline.map(p => p.z)), maxZ: Math.max(...stairOutline.map(p => p.z)),
    minY: floor - 1, maxY: courtY + 1, polygon: { outer: stairOutline, holes: [] },
  }];
  for (let i = 0; i < steps; i++) {
    const d = i * tread, end = d + tread;
    const y = courtY + (floor - courtY) * i / steps;
    const down = courtY + (floor - courtY) * (i + 1) / steps;
    const top = [at(a, y, d), at(b, y, d), at(b, y, end), at(a, y, end)];
    trim.quad(top[3], top[2], top[1], top[0], 0xa6a399);
    trim.quad(top[3], at(a, down, end), at(b, down, end), top[2], 0x858279);
    platforms.push({
      id: 'horapark-4-entry-step-' + i, outer: top.map(([x, , z]) => ({ x, z })), holes: [], height: () => y,
    });
  }
}

function glassBlocks(wall, left, width, lo, hi) {
  surveyPanel(wall, left, left + width, lo, hi, 0xc0beb0, 0.024);
  for (let u = left + 0.08; u + 0.13 < left + width; u += 0.195) {
    for (let y = lo + 0.08; y + 0.13 < hi; y += 0.195) {
      const tint = Math.floor(u * 1000 + y * 313) & 1 ? 0x84918d : 0xa9af9f;
      surveyPanel(wall, u, u + 0.14, y, y + 0.14, tint, 0.032, 0.55);
    }
  }
}

function createHoraparkOffice(site) {
  const building = HORAPARK_OFFICE_SURVEYS[site.id];
  const vpva = site.id === 'horapark-vpva';
  const nearColliders = [];
  return createSurveyLandmark(site, [building], wall => {
    const { faceIndex, low, high } = wall;
    if (vpva && low <= courtY + 0.06 && high > courtY + 0.6) {
      nearColliders.push(...wallColliders(wall.a, wall.b, Math.max(low, courtY - 0.04), high));
    }
    const facade = building.facades[faceIndex];
    if (facade) {
      const [brick, frame, glass, openings] = facade;
      for (const [u, y, width, height, panes, door] of openings) {
        const lo = Math.max(low + 0.012, low + y), hi = lo + height;
        if (surveyWindow(wall, u, u + width, lo, hi, { frame, color: glass, columns: panes }) && door) {
          canopy(wall, site.id, u + width / 2, lo, hi, nearColliders);
        }
      }
      if (vpva && faceIndex === 70) {
        glassBlocks(wall, 0.18, 1.72, low + 2.91, low + 9.79);
      }
      if (vpva && faceIndex === 87) {
        const u = wall.width - 2.7;
        alongWall(wall, wall.trim, u, 1.06, 0.16, 1.09, 2.90, 0.23, 0xa8b0b0);
        surveyLabel(wall, u - 0.43, u + 0.43, 4.25, 5.37, '4', '#a19073', '#f3f1e9');
      }
      return brick;
    }
  }, details => {
    if (vpva) entranceCourt(building, details);
    details.colliders.push(...nearColliders);
    masonry ??= createFacadeSurfaceTexture().texture;
    const across = positionWorld.x.mul(normalWorld.z).sub(positionWorld.z.mul(normalWorld.x));
    const course = texture(masonry, vec2(across.div(0.95), positionWorld.y.div(0.52))).r;
    const tone = mix(1, mix(0.83, 1.04, course), normalWorld.y.abs().lessThan(0.12).toFloat());
    details.group.children[0].material.colorNode = vertexColor().mul(tone);
  });
}

export const HORAPARK_OFFICE_FACTORIES = Object.fromEntries(Object.keys(HORAPARK_OFFICE_SURVEYS)
  .map(id => [id, (_, site) => createHoraparkOffice(site)]));
