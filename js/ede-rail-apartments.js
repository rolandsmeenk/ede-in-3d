import * as THREE from 'three/webgpu';
import { attribute, mix, texture, vertexColor, uv } from 'three/tsl';
import { sampleRoofColor } from './aerial-colors.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { RAIL_APARTMENT_SURVEYS } from './ede-rail-apartment-surveys.js';

const GLASS = 0x43545c, FRAME = 0x484747, SLAB = 0xb3ad9d;
let brickTexture;

function recess(wall, left, right, bottom, top, { depth, timber, balcony }) {
  if (!surveyOpeningFits(wall, left, right, bottom, top)) return;
  const { point, rings, shell, trim } = wall;
  const ring = inset => [
    point(left, bottom, -inset), point(right, bottom, -inset),
    point(right, top, -inset), point(left, top, -inset),
  ];
  const [a, b, c, d] = ring(0), [e, f, g, h] = ring(depth);
  rings.push([a, b, c, d]);
  const reveal = timber ? 0xb6864f : SLAB;
  shell.quad(a, e, h, d, reveal);
  shell.quad(f, b, c, g, reveal);
  shell.quad(a, b, f, e, SLAB);
  shell.quad(d, h, g, c, reveal);
  surveyPanel({ ...wall, trim: shell }, left, right, bottom, top, GLASS, -depth, 0.76);
  const center = (left + right) / 2;
  surveyPanel(wall, center - 0.039, center + 0.039, bottom, top, FRAME, 0.013 - depth);
  if (!balcony) return;

  const railTop = Math.min(top - 0.15, bottom + 0.98), offset = -0.06;
  if (!timber) {
    surveyPanel(wall, left, right, bottom + 0.12, railTop, 0x839396, offset, 0.54);
  } else {
    const count = Math.ceil((right - left) / 0.21);
    for (let i = 0; i < count; i++) {
      const x = left + (right - left) * (i + 0.5) / count;
      const lean = (i % 3 === 0 ? -1 : 1) * 0.047;
      trim.quad(point(x - 0.012, bottom + 0.10, offset), point(x + 0.012, bottom + 0.10, offset),
        point(x + lean + 0.012, railTop, offset), point(x + lean - 0.012, railTop, offset), SLAB);
    }
  }
  surveyPanel(wall, left, right, railTop - 0.045, railTop, timber ? SLAB : FRAME, offset + 0.012);
}

function withBrick(group, buildings) {
  const mesh = group.children[0];
  const { position, normal, color } = mesh.geometry.attributes;
  const masonry = buildings.map(building => new THREE.Color(building.wallColor));
  const coordinates = [], mask = [];
  for (let i = 0; i < position.count; i++) {
    coordinates.push((position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 1.04,
      position.getY(i) / 0.64);
    mask.push(masonry.some(tone => Math.abs(color.getX(i) - tone.r) + Math.abs(color.getY(i) - tone.g)
      + Math.abs(color.getZ(i) - tone.b) < 0.001) ? 1 : 0);
  }
  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
  mesh.geometry.setAttribute('apartmentBrick', new THREE.Float32BufferAttribute(mask, 1));
  brickTexture ??= createFacadeSurfaceTexture().texture;
  mesh.material.colorNode = vertexColor().mul(mix(1,
    texture(brickTexture, uv()).r.mul(0.68).add(0.43), attribute('apartmentBrick', 'float')));
  return group;
}

function withRoof(building, osmId) {
  const color = [];
  return sampleRoofColor(osmId, color) ? { ...building,
    roofColor: new THREE.Color().fromArray(color).lerp(new THREE.Color(building.roofColor), 0.26).getHex() } : building;
}

function parkvesteWall(wall) {
  const { base, low, high, width, faceIndex, normal } = wall;
  if (width < 1.3) return;
  const count = Math.max(1, Math.round(width / 2.76)), bay = width / count;
  for (let floor = 0; base + floor * 3.08 + 2.6 < high; floor++) {
    const y = base + floor * 3.08 + 0.52;
    if (y < low + 0.09) continue;
    for (let i = 0; i < count; i++) {
      const narrow = count > 3 && i % 3 === 0;
      const left = (i + (narrow ? 0.34 : 0.10)) * bay;
      const right = (i + (narrow ? 0.66 : 0.88)) * bay;
      if ((faceIndex === 0 || faceIndex === 16 || normal.z > 0.45) && !narrow && floor > 0) {
        recess(wall, left, right, y - 0.37, y + 1.95, { depth: 0.78, timber: true, balcony: true });
      } else {
        surveyWindow(wall, left, right, y, y + 1.86,
          { color: GLASS, frame: FRAME, columns: narrow ? 1 : 2 });
      }
    }
  }
  if (faceIndex === 31) {
    surveyLabel(wall, width * 0.33, width * 0.74, base + 2.0, base + 2.39, 'PARKVESTE', 0x76664e, 0xe5e0d6);
  }
}

function enkaWall(wall) {
  const { base, low, high, width, faceIndex, buildingIndex, normal } = wall;
  const gallery = buildingIndex === 0 ? faceIndex === 48 : faceIndex === 58 || faceIndex === 107;
  if (width < 1.5 || high - low < 2.45) return;
  const count = Math.max(1, Math.round(width / (gallery ? 4.1 : 2.85))), bay = width / count;
  const entry = !gallery && high - low > 6.0 && width > 7.5 && (normal.z > 0.5 || normal.x < -0.8);
  for (let floor = 0; low + 2.3 < high && base + floor * 2.94 + 2.3 < high; floor++) {
    const y = base + floor * 2.94 + 0.54;
    if (y < low + 0.10) continue;
    for (let i = 0; i < count; i++) {
      const left = (i + 0.14) * bay, right = (i + 0.86) * bay;
      if (entry && i === Math.floor(count / 2) && floor <= 1) {
        if (floor === 0) recess(wall, left, right, y - 0.22, y + 4.60, { depth: 0.73 });
      } else if (gallery && floor > 0) {
        recess(wall, left, right, y - 0.38, y + 1.73, { depth: 0.84, balcony: true });
        if (i % 3 === 0) surveyPanel(wall, left, left + 0.15, y - 0.38, y + 1.73, 0x5b6151, 0.033);
      } else {
        surveyWindow(wall, left, right, y, y + 1.70, { color: GLASS, frame: FRAME, columns: 2 });
      }
    }
  }
}

export function createParkveste(_footprints, site) {
  const buildings = [withRoof(RAIL_APARTMENT_SURVEYS.parkveste, 'w684424226')];
  return withBrick(createSurveyLandmark(site, buildings, parkvesteWall), buildings);
}

export function createAkulaanApartments(_footprints, site) {
  const buildings = [withRoof(RAIL_APARTMENT_SURVEYS.h2, 'w972654587'), withRoof(RAIL_APARTMENT_SURVEYS.h4, 'w972654586')];
  return withBrick(createSurveyLandmark(site, buildings, enkaWall), buildings);
}
