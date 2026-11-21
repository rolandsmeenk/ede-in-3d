import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv } from 'three/tsl';
import { CivicBatch } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { ULU_CAMII_SURVEY } from './ede-ulu-camii-survey.js';

const masonry = ULU_CAMII_SURVEY.wallColor;
const limestone = 0xb7b5a8;
const glass = 0x40535b;
const frames = 0xc7c6b7;
const bronze = 0x8d8467;

let fritTexture, masonryTexture;

function patternedGlass() {
  if (fritTexture) return fritTexture;
  const size = 128, bytes = new Uint8Array(size * size * 4);
  // A repeated geometric approximation of the architect's printed glass and perforated screens.
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const y = (row + 0.5) / (size / 2) - 1;
    const x = (col + 0.5) / (size / 2) - 1;
    const angle = Math.atan2(y, x), radius = Math.hypot(x, y);
    const leaf = Math.abs(radius - (0.63 + 0.23 * Math.sin(angle * 5 + radius * 2.5)));
    const coil = Math.abs(radius - (0.30 + 0.12 * Math.sin(angle * 3 - radius * 6)));
    const links = Math.abs(Math.hypot(1 - Math.abs(x), 1 - Math.abs(y)) - 0.36);
    const cover = THREE.MathUtils.clamp((0.139 - Math.min(leaf, coil, links)) * 32, 0, 1);
    const i = (row * size + col) * 4;
    bytes[i] = 116 + 93 * cover;
    bytes[i + 1] = 122 + 75 * cover;
    bytes[i + 2] = 119 + 50 * cover;
    bytes[i + 3] = 255;
  }
  fritTexture = new THREE.DataTexture(bytes, size, size);
  fritTexture.colorSpace = THREE.SRGBColorSpace;
  fritTexture.wrapS = fritTexture.wrapT = THREE.RepeatWrapping;
  fritTexture.magFilter = THREE.LinearFilter;
  fritTexture.minFilter = THREE.LinearMipmapLinearFilter;
  fritTexture.generateMipmaps = true;
  fritTexture.needsUpdate = true;
  return fritTexture;
}

function finishMasonry(mesh) {
  const { position, normal, color } = mesh.geometry.attributes;
  const coords = [], walls = [], tint = new THREE.Color(masonry);
  for (let i = 0; i < position.count; i++) {
    coords.push((position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 1.02, position.getY(i) / 0.62);
    const match = Math.abs(color.getX(i) - tint.r) + Math.abs(color.getY(i) - tint.g) + Math.abs(color.getZ(i) - tint.b);
    walls.push(Number(Math.abs(normal.getY(i)) < 0.12 && match < 0.00001));
  }
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  mesh.geometry.setAttribute('uluMasonry', new THREE.Float32BufferAttribute(walls, 1));
  masonryTexture ??= createFacadeSurfaceTexture().texture;
  const grain = texture(masonryTexture, uv()).r;
  mesh.material.colorNode = mix(1, grain.mul(0.58).add(0.49), attribute('uluMasonry', 'float'));
}

function screen(panels, a, b, c, d) {
  const u = Math.hypot(a[0] - b[0], a[2] - b[2]) / 0.74, v = (d[1] - a[1]) / 0.74;
  panels.positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  panels.uvs.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v);
}

function wallScreen(wall, panels, u, v, lo, hi) {
  const { point } = wall;
  screen(panels, point(u, lo, 0.052), point(v, lo, 0.052), point(v, hi, 0.052), point(u, hi, 0.052));
  const bays = Math.max(1, Math.round(v - u));
  for (let i = 0; i <= bays; i++) {
    const edge = u + (v - u) * i / bays;
    surveyPanel(wall, edge - 0.028, edge + 0.028, lo, hi, bronze, 0.067);
  }
  for (const y of [lo, hi - 0.055]) surveyPanel(wall, u, v, y, y + 0.055, bronze, 0.067);
}

function row(wall, start, end, count, width, lo, hi) {
  const pitch = (end - start) / count;
  for (let i = 0; i < count; i++) {
    const u = start + (i + 0.5) * pitch;
    surveyWindow(wall, u - width / 2, u + width / 2, lo, hi, { color: glass, frame: frames });
  }
}

function facade(wall, panels) {
  const { faceIndex, width, low, high } = wall;
  if (width < 1) return;
  if (faceIndex === 11) {
    wallScreen(wall, panels, 0.15, width - 0.15, 0.49, high - 0.13);
    surveyPanel(wall, 0.07, width - 0.07, low + 0.10, -3.38, limestone, 0.020);
    for (const [a, b] of [
      [0.05, 0.08], [0.21, 0.24], [0.28, 0.31], [0.36, 0.40], [0.45, 0.48],
      [0.52, 0.63], [0.68, 0.77], [0.83, 0.86], [0.91, 0.95],
    ]) surveyWindow(wall, width * a, width * b, low + 0.25, -3.54,
      { color: glass, frame: frames, columns: b - a > 0.06 ? 2 : 1 });
    surveyPanel(wall, 0.02, width - 0.02, -3.46, -3.37, 0x625e54, 0.073);
    return;
  }
  if (faceIndex === 17 || faceIndex === 24) {
    for (const fraction of [0.18, 0.48, 0.73]) {
      const u = fraction * width;
      wallScreen(wall, panels, u, u + 1.72, -1.85, high - 0.22);
      surveyWindow(wall, u + 1.77, u + 2.38, -1.85, high - 0.23, { frame: bronze, color: glass, rows: 3 });
    }
    return;
  }
  if (faceIndex === 0) {
    surveyPanel(wall, 2.6, 33.8, low + 0.12, high - 1.02, limestone, 0.020);
    row(wall, 2.4, 11.5, 5, 0.95, low + 0.18, high - 1.11);
    surveyWindow(wall, 11.86, 14.39, low + 0.18, high - 1.11, { frame: frames, color: glass, columns: 2 });
    wallScreen(wall, panels, 22.8, 30.0, low + 0.18, high - 1.11);
    surveyWindow(wall, 30.68, 33.56, low + 0.18, high - 1.11, { frame: frames, color: glass, columns: 2 });
    return;
  }
  if (faceIndex === 2 || faceIndex === 15 || faceIndex === 19 || faceIndex === 23) {
    const edge = Math.min(width * 0.27, 1.8);
    surveyPanel(wall, 0.34, width - 0.34, low + 0.10, high - 0.45, limestone, 0.02);
    row(wall, edge, width - edge, Math.max(2, Math.round(width / 2.10)), 1.0, low + 0.18, high - 0.51);
    return;
  }
  if (faceIndex === 3 || faceIndex === 8 || faceIndex === 9 || faceIndex === 12) {
    const length = Math.min(width - 1.0, faceIndex === 3 ? 10.5 : width - 1.0);
    const center = width / 2;
    surveyPanel(wall, center - length / 2, center + length / 2, low + 0.14, high - 1.03, limestone, 0.020);
    row(wall, center - length / 2, center + length / 2, Math.max(2, Math.round(length / 1.94)), 0.89,
      low + 0.22, high - 1.08);
  }
}

function rod(batch, a, b, radius, color) {
  const p = new THREE.Vector3(...a), q = new THREE.Vector3(...b);
  const axis = q.clone().sub(p);
  const length = axis.length();
  if (length < 0.0001) return;
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  const matrix = new THREE.Matrix4().compose(p.lerp(q, 0.5), rotation, new THREE.Vector3(1, 1, 1));
  batch.solid(new THREE.CylinderGeometry(radius, radius, length, 4, 1, true).applyMatrix4(matrix), color);
}

function dome(batch) {
  // The 2026 orthophoto locates and measures the dome rim. LoD 2.2 bounds the crown at y=9.21.
  const x = -1064.0, z = 1789.15, base = 4.81, radius = 5.38, rise = 4.4;
  const sphere = (radius * radius + rise * rise) / (2 * rise);
  const maxAngle = Math.asin(radius / sphere), pieces = 24, bands = 6;
  const glazing = [0x6f8e99, 0x6c8997, 0x76939c, 0x718993];
  const ring = (index, piece, offset = 0) => {
    const vertical = maxAngle * index / bands, azimuth = 2 * Math.PI * piece / pieces;
    const r = sphere * Math.sin(vertical);
    return [x + r * Math.cos(azimuth), base + rise - sphere * (1 - Math.cos(vertical)) + offset, z + r * Math.sin(azimuth)];
  };
  for (let j = 0; j < bands; j++) for (let i = 0; i < pieces; i++) {
    const a = ring(j, i), b = ring(j, i + 1), c = ring(j + 1, i + 1), d = ring(j + 1, i);
    const tint = glazing[(j * 3 + i) % glazing.length];
    if (j === 0) batch.triangle(a, c, d, tint, 0.90);
    else batch.quad(a, b, c, d, tint, 0.90);
    rod(batch, ring(j, i, 0.022), ring(j + 1, i, 0.022), 0.041, 0x7a7765);
    rod(batch, ring(j + 1, i, 0.028), ring(j + 1, i + 1, 0.028), j === bands - 1 ? 0.090 : 0.031, 0x817a64);
    if (j === bands - 1) batch.quad(d, c, [c[0], 4.63, c[2]], [d[0], 4.63, d[2]], 0x817965);
  }
}

function minaret(batch, panels, colliders) {
  const x = -1087.5, z = 1808.1, half = 0.94, tilt = 0.073;
  const brickTop = 6.80, screenTop = 12.70, tip = ULU_CAMII_SURVEY.ground + 25;
  const points = [[half, half], [half, -half], [-half, -half], [-half, half]];
  const ring = points.map(([u, v]) => [x + u * Math.cos(tilt) - v * Math.sin(tilt), z + u * Math.sin(tilt) + v * Math.cos(tilt)]);
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    batch.quad([ax, -2.60, az], [bx, -2.60, bz], [bx, brickTop, bz], [ax, brickTop, az], masonry);
    screen(panels, [ax, brickTop, az], [bx, brickTop, bz], [bx, screenTop, bz], [ax, screenTop, az]);
    rod(batch, [ax, brickTop - 0.035, az], [bx, brickTop - 0.035, bz], 0.044, bronze);
    rod(batch, [ax, screenTop, az], [bx, screenTop, bz], 0.049, bronze);
    rod(batch, [ax, brickTop, az], [ax, screenTop, az], 0.034, bronze);
    rod(batch, [ax, screenTop, az], [x, tip - 0.57, z], 0.039, bronze);
  }
  rod(batch, [x, tip - 0.70, z], [x, tip, z], 0.030, bronze);
  batch.polygon([ring.map(([x, z]) => [x, screenTop, z])], 0x746e57);
  const outer = ring.map(([x, z]) => ({ x, z }));
  colliders.push({
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: -2.60, maxY: screenTop, polygon: { outer, holes: [] },
  });
}

function solarRows(batch) {
  const rows = [
    [-1080.2, 1775.1, 6.9], [-1079.0, 1775.9, 6.9],
    [-1085.63, 1779.4, 5.1], [-1084.63, 1780.2, 5.1], [-1083.63, 1781.0, 5.1], [-1082.53, 1781.8, 5.1],
    [-1070.9, 1779.35, 7], [-1069.3, 1780.45, 7],
    [-1075.0, 1786.5, 6], [-1073.8, 1787.5, 6], [-1072.6, 1788.5, 6],
  ];
  for (const [x, z, length] of rows) {
    const count = Math.round(length / 1.09);
    const p = (u, v) => [x + 0.58 * u + 0.81 * v, 4.90 + 0.18 * v, z - 0.81 * u + 0.58 * v];
    for (let i = 0; i < count; i++) {
      const a = i * length / count - length / 2, b = (i + 0.97) * length / count - length / 2;
      batch.quad(p(a, 0.56), p(b, 0.56), p(b, -0.56), p(a, -0.56), i % 2 ? 0x38474f : 0x414b52, 0.57);
    }
  }
}

export function createUluCamii(_footprints, site) {
  const panels = { positions: [], uvs: [] };
  const model = createSurveyLandmark(site, [ULU_CAMII_SURVEY], wall => facade(wall, panels), ({ group, colliders }) => {
    const skyline = new CivicBatch();
    dome(skyline);
    minaret(skyline, panels, colliders);
    solarRows(skyline);
    const roof = skyline.mesh();
    roof.name = 'Ulu Camii dome and minaret';
    finishMasonry(roof);
    group.add(roof);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(panels.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(panels.uvs, 2));
    geometry.computeVertexNormals();
    const screens = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ map: patternedGlass(), roughness: 0.53, metalness: 0.1 }));
    screens.name = 'Ulu Camii patterned glazing';
    screens.receiveShadow = true;
    group.add(screens);
  });
  finishMasonry(model.children[0]);
  return model;
}

