import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv, vertexColor } from 'three/tsl';
import { wallColliders } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { ZUIDERPOORT_SCHOOL } from './ede-zuiderpoort-survey.js';
import { terrainHeightAt } from './terrain.js';

const cream = 0xe1dcd0, slate = 0x454b46, glass = 0x546c70;
const brick = 0x826957, darkBrick = 0x614b40;
let masonry;
const frontage = {
  48: [{ u: 3.15, w: 4.4, columns: 5 }, { u: 10.1, w: 3.85, columns: 4, awning: true }],
  95: [{ u: 3.9, w: 5.55, columns: 6 }, { u: 10.2, w: 1.25, columns: 2 }],
};

function entry(wall) {
  const { width, trim, point } = wall;
  const center = width * 0.54, threshold = wall.base + 0.22, spring = threshold + 2.18;
  for (const [radius, paint, offset] of [[1.13, darkBrick, 0.044], [0.96, cream, 0.069], [0.88, 0x263d37, 0.085]]) {
    const ring = [point(center - radius, threshold, offset), point(center + radius, threshold, offset)];
    for (let i = 0; i <= 18; i++) {
      const a = Math.PI * i / 18;
      ring.push(point(center + Math.cos(a) * radius, spring + Math.sin(a) * radius, offset));
    }
    trim.polygon([ring], paint);
  }
  const fan = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * i / 16;
    fan.push(point(center + Math.cos(a) * 0.79, spring + Math.sin(a) * 0.79, 0.095));
  }
  trim.polygon([fan], glass);
  surveyPanel(wall, center - 0.83, center + 0.83, spring - 0.045, spring + 0.014, cream, 0.108);
  surveyPanel(wall, center - 0.022, center + 0.022, threshold, spring + 0.75, cream, 0.109);
  for (const sign of [-1, 1]) {
    const spoke = [point(center, spring, 0.109), point(center + sign * 0.58, spring + 0.57, 0.109),
      point(center + sign * 0.53, spring + 0.60, 0.109)];
    trim.polygon([sign < 0 ? spoke.reverse() : spoke], cream);
  }
  for (const sign of [-1, 1]) {
    const handle = center + sign * 0.14;
    surveyPanel(wall, handle - 0.022, handle + 0.022, threshold + 0.86, threshold + 1.11, 0x91978c, 0.115);
  }
}

function awning(wall, left, right) {
  const { trim, point } = wall;
  for (let i = 0; i < 20; i++) {
    const a = left + i * (right - left) / 20, b = left + (i + 1) * (right - left) / 20;
    const paint = i % 2 ? 0xe2e0ca : 0x57725f;
    trim.quad(point(a, -2.23, 0.93), point(b, -2.23, 0.93), point(b, -0.85, 0.13), point(a, -0.85, 0.13), paint);
    trim.quad(point(a, -2.36, 0.93), point(b, -2.36, 0.93), point(b, -2.23, 0.93), point(a, -2.23, 0.93), paint);
  }
}

function decorateSchool(wall) {
  const { faceIndex, width, high, low, base } = wall;
  if (faceIndex === 90) {
    entry(wall);
    return;
  }
  if (frontage[faceIndex]) {
    for (const { u, w, columns, awning: hasAwning } of frontage[faceIndex]) {
      const left = u - w / 2, right = u + w / 2;
      if (!surveyWindow(wall, left, right, hasAwning ? -3.06 : -3.75, -1.02,
        { columns, rows: hasAwning ? 2 : 4, frame: cream, color: glass })) continue;
      surveyPanel(wall, left - 0.10, right + 0.10, -3.87, -3.75, slate, 0.09);
      if (hasAwning) awning(wall, left - 0.15, right + 0.15);
    }
    surveyPanel(wall, 0.02, width - 0.02, -0.57, -0.43, cream, 0.093);
    surveyPanel(wall, 0.02, width - 0.02, -0.43, -0.34, slate, 0.098);
  } else if (width > 7.3 && low <= base + 0.05 && high > -0.85 && faceIndex !== 17) {
    const count = Math.max(2, Math.round(width / 3.5));
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) * width / count, half = Math.min(1.36, width / count * 0.39);
      surveyWindow(wall, u - half, u + half, -3.65, -1.10, { columns: 3, rows: 3, frame: cream, color: glass });
    }
  }
  if (low <= base + 0.05 && high > -4.84) {
    surveyPanel(wall, 0.03, width - 0.03, base + 0.07, -4.96, darkBrick, 0.028);
  }
}

const seatArc = [
  [-846.48, 1938.77], [-842.49, 1939.09], [-839.60, 1940.40], [-837.42, 1943.01],
  [-836.13, 1946.11], [-836.14, 1949.12], [-837.45, 1951.91], [-839.45, 1954.11], [-842.05, 1956.00],
];

function finishSchool({ group, trim, colliders }) {
  const shell = group.children[0], { position, normal } = shell.geometry.attributes;
  const coordinates = [], surface = [];
  for (let i = 0; i < position.count; i++) {
    coordinates.push((position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 1.08,
      position.getY(i) / 0.64);
    surface.push(Math.abs(normal.getY(i)) < 0.12 ? 1 : 0);
  }
  shell.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
  shell.geometry.setAttribute('schoolMasonry', new THREE.Float32BufferAttribute(surface, 1));
  masonry ??= createFacadeSurfaceTexture().texture;
  shell.material.colorNode = vertexColor().mul(mix(1, texture(masonry, uv()).r.mul(0.80).add(0.33),
    attribute('schoolMasonry', 'float')));

  const [pillarX, pillarZ] = seatArc[4], pillarY = terrainHeightAt(pillarX, pillarZ);
  const seatStone = 0xa09b8a, pillarStone = 0x706f65;
  for (let i = 1; i < seatArc.length; i++) {
    const [ax, az] = seatArc[i - 1], [bx, bz] = seatArc[i];
    const x = (ax + bx) / 2, z = (az + bz) / 2;
    const y = terrainHeightAt(x, z);
    const length = Math.hypot(bx - ax, bz - az), angle = Math.atan2(bz - az, bx - ax);
    const overhangX = -(bz - az) / length * 0.28, overhangZ = (bx - ax) / length * 0.28;
    const band = (depth, width, height, cx, cy, cz, color) =>
      trim.solid(new THREE.BoxGeometry(depth, height, width).rotateY(-angle).translate(cx, cy, cz), color);
    band(length - 0.035, 0.32, 0.85, x, y + 0.33, z, brick);
    band(length - 0.065, 0.37, 0.12, x, y + 0.79, z, darkBrick);
    band(length - 0.09, 0.47, 0.49, x + overhangX, y + 0.15, z + overhangZ, darkBrick);
    band(length - 0.09, 0.53, 0.075, x + overhangX, y + 0.405, z + overhangZ, seatStone);
    colliders.push(...wallColliders({ x: ax, z: az }, { x: bx, z: bz }, y - 0.15, y + 0.84, 0.56));
  }
  trim.solid(new THREE.BoxGeometry(0.72, 1.52, 0.78).translate(pillarX, pillarY + 0.69, pillarZ), brick);
  trim.solid(new THREE.BoxGeometry(0.80, 0.16, 0.87).translate(pillarX, pillarY + 1.51, pillarZ), pillarStone);
  trim.solid(new THREE.CylinderGeometry(0.32, 0.36, 0.22, 10).translate(pillarX, pillarY + 1.69, pillarZ), pillarStone);
  trim.solid(new THREE.BoxGeometry(0.024, 0.24, 0.49).translate(pillarX - 0.37, pillarY + 1.03, pillarZ), pillarStone);
  trim.solid(new THREE.BoxGeometry(0.024, 0.44, 0.45).translate(pillarX - 0.37, pillarY + 0.59, pillarZ), 0xbdab7a);
}

export function createZuiderpoort(_footprints, site) {
  return createSurveyLandmark(site, [ZUIDERPOORT_SCHOOL], decorateSchool, finishSchool);
}
