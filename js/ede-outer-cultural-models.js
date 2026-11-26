import * as THREE from 'three/webgpu';
import { abs, mix, normalGeometry, smoothstep, texture, uv, vertexColor } from 'three/tsl';
import { CivicBatch } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { createSintHubertus } from './ede-sint-hubertus.js';
import { OUTER_CULTURAL_SURVEYS } from './ede-outer-cultural-survey.js';
import { addClockDetails, addRoundClock } from './ede-clock-model.js';
import { terrainHeightAt } from './terrain.js';

const glass = 0x38494e, darkFrame = 0x2f3538, cream = 0xd8ccb4, stone = 0xb9ae96, shutterGreen = 0x2b4534;

function applyMasonryTexture(group, originX, originZ, scaleU = 1.0, scaleV = 0.55) {
  const shell = group.children[0];
  if (!shell?.geometry?.attributes?.position) return;
  const { position, normal } = shell.geometry.attributes;
  const coords = [];
  for (let i = 0; i < position.count; i++) {
    coords.push(
      ((position.getX(i) - originX) * normal.getZ(i) - (position.getZ(i) - originZ) * normal.getX(i)) / scaleU,
      position.getY(i) / scaleV
    );
  }
  shell.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  const { texture: surface } = createFacadeSurfaceTexture();
  const wallMask = smoothstep(0.15, 0.65, abs(normalGeometry.y)).oneMinus();
  shell.material.colorNode = vertexColor().mul(mix(1, texture(surface, uv()).r.mul(0.55).add(0.56), wallMask));
}

function band(wall, y, h, color, offset = 0.035) {
  if (y + h <= wall.low + 0.05 || y >= wall.high - 0.05) return;
  surveyPanel(wall, 0, wall.width, Math.max(wall.low, y), Math.min(wall.high, y + h), color, offset);
}

function dressKrollerMuller(wall) {
  const { width, base, low, high } = wall;
  if (width < 2.0 || high - low < 2.2) return;
  band(wall, base, 0.45, 0x8e897c, 0.028);
  band(wall, high - 0.24, 0.24, 0x73776e, 0.045);
  // Modernist Quist/Van de Velde gallery wings: wide dark-framed courtyard glazing & clerestory strips.
  if (low < base + 1.0 && high > base + 3.4) {
    const bays = Math.max(1, Math.round(width / 4.2));
    for (let i = 0; i < bays; i++) {
      const u0 = width * (i + 0.08) / bays, u1 = width * (i + 0.92) / bays;
      surveyWindow(wall, u0, u1, base + 0.65, Math.min(high - 0.55, base + 3.35),
        { color: glass, frame: darkFrame, columns: Math.max(2, Math.round((u1 - u0) / 1.1)), rows: 2 });
    }
  } else if (high - low > 1.4 && width > 4.0) {
    surveyWindow(wall, 0.4, width - 0.4, low + 0.25, high - 0.3,
      { color: 0x526468, frame: darkFrame, columns: Math.max(2, Math.round(width / 1.6)), rows: 1 });
  }
}

function finishKrollerMuller({ group }) {
  applyMasonryTexture(group, 9990, -5521, 1.1, 0.55);
  // Curated Beeldentuin accents beside the approach: minimalist Rietveld pavilion & Needle Tower spire.
  const garden = new CivicBatch();
  const rx = 9936, rz = -5515, ry = terrainHeightAt(rx, rz);
  // Open concrete-block & dark-steel Rietveld pavilion frame.
  garden.solid(new THREE.BoxGeometry(8.5, 0.28, 6.2).translate(rx, ry + 0.14, rz), 0xa8a499);
  garden.solid(new THREE.BoxGeometry(8.8, 0.22, 6.5).translate(rx, ry + 3.55, rz), 0x3b3e40);
  for (const [dx, dz] of [[-4.0, -2.8], [4.0, -2.8], [-4.0, 2.8], [4.0, 2.8]]) {
    garden.solid(new THREE.BoxGeometry(0.16, 3.35, 0.16).translate(rx + dx, ry + 1.82, rz + dz), 0x2f3335);
  }
  garden.solid(new THREE.BoxGeometry(3.2, 2.75, 0.24).translate(rx - 1.5, ry + 1.65, rz - 1.2), 0x8d8980);
  garden.solid(new THREE.BoxGeometry(0.24, 2.75, 2.6).translate(rx + 2.2, ry + 1.65, rz + 0.6), 0x8d8980);

  // Kenneth Snelson-inspired silver Needle Tower tensegrity spire near the plaza.
  const nx = 9952, nz = -5506, ny = terrainHeightAt(nx, nz);
  garden.solid(new THREE.CylinderGeometry(1.1, 1.3, 0.35, 12).translate(nx, ny + 0.17, nz), 0x8a877d);
  for (let tier = 0; tier < 5; tier++) {
    const r0 = 1.05 - tier * 0.17, r1 = Math.max(0.12, r0 - 0.17);
    const y0 = ny + 0.35 + tier * 2.1, y1 = y0 + 2.3;
    for (let k = 0; k < 3; k++) {
      const a0 = tier * 0.55 + k * (Math.PI * 2 / 3);
      const a1 = a0 + 0.72;
      const p0 = new THREE.Vector3(nx + Math.cos(a0) * r0, y0, nz + Math.sin(a0) * r0);
      const p1 = new THREE.Vector3(nx + Math.cos(a1) * r1, y1, nz + Math.sin(a1) * r1);
      const dir = p1.clone().sub(p0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      const m = new THREE.Matrix4().compose(p0.add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
      garden.solid(new THREE.CylinderGeometry(0.055, 0.065, dir.length(), 6).applyMatrix4(m), 0xd2d6d8);
    }
  }
  const mesh = garden.mesh();
  mesh.name = 'Kröller-Müller Beeldentuin accents';
  group.add(mesh);
}

function dressChurch(wall, clocks) {
  const { width, base, low, high } = wall;
  if (width < 1.8 || high - low < 2.2) return;
  band(wall, base, 0.65, 0x776858, 0.03);
  const tallTower = high - base > 13.5 && width >= 3.2 && width <= 7.5;
  if (tallTower) {
    // Upper belfry louver openings + live clock dial on tower faces.
    const louverTop = Math.min(high - 0.8, base + 15.2);
    const louverLow = Math.max(low + 0.6, louverTop - 2.6);
    if (louverTop - louverLow > 1.0) {
      surveyPanel(wall, width * 0.34, width * 0.66, louverLow, louverTop, 0x332d28, 0.05);
    }
    if (clocks && clocks.length < 4 && high - base > 14.5) {
      const cy = Math.min(high - 2.4, base + 12.2);
      if (cy > low + 1.2) {
        clocks.push(addRoundClock(wall.trim, (u, v, d) => wall.point(width / 2 + u, cy + v, 0.055 + d), 0.78, 0x25282b, 0xd8c383, 0x8f7a48));
      }
    }
    return;
  }
  if (low < base + 1.2 && high > base + 4.0) {
    const count = Math.max(1, Math.round(width / 3.4));
    for (let i = 0; i < count; i++) {
      const center = width * (i + 0.5) / count;
      if (surveyWindow(wall, center - 0.55, center + 0.55, base + 1.65, Math.min(high - 0.65, base + 4.85),
        { color: 0x394548, frame: stone, columns: 2, rows: 4 })) {
        surveyPanel(wall, center - 0.62, center + 0.62, base + 1.54, base + 1.65, stone, 0.075);
      }
    }
  }
}

function dressKijkLuister(wall, labeled) {
  const { width, base, low, high } = wall;
  if (width < 2.2 || low > base + 1.0 || high - low < 2.4) return;
  band(wall, base, 0.48, 0x6f5345, 0.025);
  band(wall, high - 0.16, 0.16, cream, 0.04);
  const count = Math.max(1, Math.round(width / 2.6));
  for (let i = 0; i < count; i++) {
    const u = width * (i + 0.5) / count;
    if (surveyWindow(wall, u - 0.52, u + 0.52, base + 0.95, Math.min(high - 0.45, base + 2.55),
      { color: glass, frame: cream, columns: 2, rows: 3 })) {
      surveyPanel(wall, u - 0.78, u - 0.54, base + 0.95, Math.min(high - 0.45, base + 2.55), shutterGreen, 0.045);
      surveyPanel(wall, u + 0.54, u + 0.78, base + 0.95, Math.min(high - 0.45, base + 2.55), shutterGreen, 0.045);
    }
  }
  if (!labeled.done && width > 8.0 && high > base + 3.4) {
    labeled.done = true;
    surveyLabel(wall, width / 2 - 2.9, width / 2 + 2.9, base + 2.75, base + 3.35, 'KIJK & LUISTERMUSEUM', '#3d3129', '#f4ebd7');
  }
}

function dressParkPaviljoen(wall) {
  const { width, base, low, high } = wall;
  if (width < 2.4 || high - low < 2.4) return;
  // Contemporary timber pavilion with panoramic forest glass and dark steel mullions.
  band(wall, base, 0.35, 0x5c574f, 0.03);
  if (low < base + 1.0 && high > base + 3.6) {
    const bays = Math.max(1, Math.round(width / 3.8));
    for (let i = 0; i < bays; i++) {
      const u0 = width * (i + 0.08) / bays, u1 = width * (i + 0.92) / bays;
      surveyWindow(wall, u0, u1, base + 0.45, Math.min(high - 0.55, base + 3.85),
        { color: 0x324246, frame: darkFrame, columns: Math.max(2, Math.round((u1 - u0) / 1.0)), rows: 2 });
    }
  }
}

function dressBarracks(wall, title, labeled) {
  const { width, base, low, high } = wall;
  if (width < 2.2 || low > base + 1.0 || high - low < 2.8) return;
  band(wall, base, 0.62, 0x6e4d44, 0.028);
  band(wall, base + 0.62, 0.12, stone, 0.048);
  band(wall, high - 0.18, 0.18, cream, 0.05);
  const count = Math.max(1, Math.round(width / 2.75));
  const upperRow = high > base + 6.4;
  for (let i = 0; i < count; i++) {
    const u = width * (i + 0.5) / count;
    const rows = upperRow ? [[1.05, 3.05], [4.55, 6.45]] : [[1.05, 3.05]];
    for (const [sill, top] of rows) {
      if (top >= high - 0.25) continue;
      if (surveyWindow(wall, u - 0.58, u + 0.58, base + sill, base + top,
        { color: glass, frame: cream, columns: 2, rows: 3 })) {
        surveyPanel(wall, u - 0.64, u + 0.64, base + sill - 0.09, base + sill, stone, 0.078);
      }
    }
  }
  if (!labeled.done && width > 14.0 && high > base + 4.3) {
    labeled.done = true;
    const u = width / 2;
    surveyLabel(wall, u - 4.4, u + 4.4, base + 3.55, base + 4.20, title, '#7a584b', '#f2e8d4');
  }
}

export const EDE_OUTER_CULTURAL_FACTORIES = {
  'kroller-muller-museum': (_, site) => createSurveyLandmark(
    site, OUTER_CULTURAL_SURVEYS[site.id], dressKrollerMuller, finishKrollerMuller
  ),
  'jachthuis-sint-hubertus': createSintHubertus,
  'alexanderkerk-bennekom': (_, site) => {
    const clocks = [];
    return createSurveyLandmark(site, OUTER_CULTURAL_SURVEYS[site.id], wall => dressChurch(wall, clocks), ({ group }) => {
      applyMasonryTexture(group, site.x, site.z, 0.95, 0.52);
      if (clocks.length) addClockDetails(group, clocks);
    });
  },
  'kijk-luistermuseum': (_, site) => {
    const labeled = { done: false };
    return createSurveyLandmark(site, OUTER_CULTURAL_SURVEYS[site.id], wall => dressKijkLuister(wall, labeled), ({ group }) => {
      applyMasonryTexture(group, site.x, site.z, 0.92, 0.50);
    });
  },
  'hervormde-kerk-harskamp': (_, site) => createSurveyLandmark(
    site, OUTER_CULTURAL_SURVEYS[site.id], wall => dressChurch(wall, null), ({ group }) => {
      applyMasonryTexture(group, site.x, site.z, 0.95, 0.52);
    }
  ),
  'park-paviljoen': (_, site) => createSurveyLandmark(
    site, OUTER_CULTURAL_SURVEYS[site.id], dressParkPaviljoen, ({ group }) => {
      applyMasonryTexture(group, site.x, site.z, 1.35, 0.42);
    }
  ),
  'arthur-koolkazerne': (_, site) => {
    const labeled = { done: false };
    return createSurveyLandmark(site, OUTER_CULTURAL_SURVEYS[site.id], wall => dressBarracks(wall, 'ARTHUR KOOLKAZERNE', labeled), ({ group }) => {
      applyMasonryTexture(group, site.x, site.z, 0.92, 0.50);
    });
  },
  'elias-beeckmankazerne': (_, site) => {
    const labeled = { done: false };
    return createSurveyLandmark(site, OUTER_CULTURAL_SURVEYS[site.id], wall => dressBarracks(wall, 'ELIAS BEECKMANKAZERNE', labeled), ({ group }) => {
      applyMasonryTexture(group, site.x, site.z, 0.92, 0.50);
    });
  },
};
