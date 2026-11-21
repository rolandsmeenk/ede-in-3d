import * as THREE from 'three/webgpu';
import { CONCORDIA_SURVEY } from './ede-concordia-survey.js';
import { createConcordiamolen, addConcordiaTowerSilhouette } from './ede-concordiamolen.js';
import { addLandmarkLod, CivicBatch } from './ede-civic-landmarks.js';
import { buildVenue } from './ede-venue-landmarks.js';
import { terrainHeightAt } from './terrain.js';

const CREAM = 0xd4c7aa;
const GREEN = 0x273e39;
const STEEL = 0x576266;
const GLASS = 0x364850;
const TIMBER = 0x303b37;
const SILL = 0x985c45;

// Wall numbers are the original survey face IDs. Horizontal positions are
// fractions of the wall as seen from outside. Vertical positions use scene Y.
const house = {
  0: [
    [0.14, 0.62, -3.31, -2.58, 'iron'], [0.37, 0.65, -3.29, -2.56, 'iron'],
    [0.62, 0.68, -3.27, -2.54, 'iron'], [0.84, 0.90, -3.95, -1.82, 'door'],
  ],
  17: [[0.21, 0.65, -3.33, -2.68, 'iron'], [0.44, 0.65, -3.33, -2.68, 'iron'], [0.73, 0.65, -3.33, -2.68, 'iron']],
  21: [[0.52, 1.15, -3.12, -1.40, 'sash']],
  28: [[0.46, 1.14, -3.15, -1.30, 'sash']],
  31: [[0.46, 2.55, -3.94, -1.13, 'arch'], [0.84, 0.63, -3.26, -2.53, 'iron']],
  32: [[0.28, 0.70, -3.22, -2.51, 'iron'], [0.72, 0.91, -3.93, -1.95, 'door']],
  38: [
    [0.17, 1.20, -3.15, -1.40, 'sash'], [0.38, 1.23, -3.14, -1.39, 'sash'],
    [0.61, 1.24, -3.14, -1.39, 'sash'], [0.82, 1.05, -3.97, -1.41, 'entry'],
  ],
};
const barn = {
  0: [[0.20, 0.62, -3.39, -2.67, 'iron'], [0.46, 0.62, -3.39, -2.67, 'iron'], [0.72, 0.62, -3.39, -2.67, 'iron']],
  1: [
    [0.15, 1.40, -3.91, -1.82, 'arch'], [0.30, 0.55, -2.63, -1.99, 'iron'],
    [0.52, 3.02, -3.94, -0.43, 'arch'], [0.52, 0.85, -0.06, 0.95, 'loft'],
    [0.70, 0.55, -2.59, -1.95, 'iron'], [0.86, 1.08, -3.91, -1.90, 'arch'],
  ],
  2: [[0.22, 0.65, -3.34, -2.72, 'iron'], [0.51, 0.61, -3.34, -2.72, 'iron'], [0.77, 0.62, -3.34, -2.72, 'iron']],
  6: [[0.24, 0.65, -3.20, -2.50, 'iron'], [0.50, 2.56, -3.93, -1.18, 'arch'], [0.78, 0.61, -3.24, -2.55, 'iron']],
};
const millshed = {
  0: [[0.17, 0.81, -2.62, -1.49, 'iron'], [0.44, 1.02, -3.12, -0.81, 'iron'], [0.73, 0.78, -2.64, -1.55, 'iron']],
  2: [[0.18, 0.77, -2.46, -1.43, 'iron'], [0.53, 0.94, -3.12, -0.81, 'door'], [0.77, 0.78, -2.47, -1.46, 'iron']],
  5: [
    [0.20, 0.70, -2.41, -1.36, 'iron'], [0.50, 2.26, -3.13, -0.20, 'arch'],
    [0.50, 0.81, 1.40, 2.28, 'loft'], [0.79, 0.71, -2.42, -1.37, 'iron'],
  ],
};
const millworks = {
  10: [[0.15, 0.71, 0.43, 1.53, 'factory'], [0.23, 0.65, 0.43, 1.53, 'factory'], [0.31, 0.65, 0.43, 1.53, 'factory']],
  31: [[0.40, 0.94, -0.81, 0.42, 'factory']],
  39: [
    [0.12, 1.32, -0.95, 0.57, 'factory'], [0.27, 1.86, -2.19, 0.13, 'millDoor'],
    [0.43, 1.53, -0.94, 0.66, 'factory'], [0.65, 3.15, -0.94, 0.66, 'factory'],
    [0.14, 0.88, 2.32, 3.31, 'factory'], [0.31, 1.60, 2.27, 3.77, 'factory'],
    [0.50, 0.96, 1.35, 3.56, 'factory'], [0.63, 0.70, 2.90, 3.77, 'factory'],
    [0.73, 0.70, 2.90, 3.77, 'factory'], [0.55, 0.68, 5.20, 6.44, 'factory'],
    [0.56, 0.62, -3.23, -2.48, 'factory'], [0.70, 0.80, -3.23, -2.48, 'factory'],
  ],
  41: [[0.51, 15.37, -2.99, 5.72, 'louvres']],
  45: [
    [0.20, 4.78, -3.17, 1.91, 'factory'], [0.44, 2.09, -2.43, 0.54, 'factory'],
    [0.62, 1.04, -2.30, 0.49, 'millDoor'], [0.76, 1.03, -2.34, 0.52, 'factory'],
    [0.88, 1.09, -2.31, 0.53, 'factory'],
    [0.23, 0.82, 3.43, 4.43, 'factory'], [0.43, 0.85, 3.43, 4.43, 'factory'],
    [0.61, 0.80, 3.43, 4.43, 'factory'], [0.81, 0.91, 3.43, 4.43, 'factory'],
  ],
  49: [[0.45, 0.93, -0.66, 0.51, 'factory']],
  53: [[0.30, 0.43, 10.04, 10.67, 'factory'], [0.70, 0.42, 10.08, 10.71, 'factory'], [0.50, 0.88, 13.03, 14.95, 'factory']],
  72: [[0.32, 0.48, 7.65, 8.42, 'factory'], [0.64, 0.47, 7.67, 8.45, 'factory'], [0.41, 0.57, 13.89, 14.44, 'factory']],
  80: [[0.57, 0.75, 13.91, 14.85, 'factory']],
};

const openings = {
  sash: { frame: CREAM, shutters: true, cols: 2, rows: 2 },
  iron: { frame: STEEL, arch: 0.16, cols: 2, rows: 2, border: 0.047 },
  arch: { frame: GREEN, arch: 0.43, cols: 2, rows: 1, border: 0.10, color: 0x394b48 },
  loft: { frame: TIMBER, cols: 1, rows: 1, color: GREEN },
  door: { frame: GREEN, cols: 1, rows: 1, color: TIMBER },
  entry: { frame: CREAM, cols: 1, rows: 1, color: GREEN, transom: true },
  factory: { frame: STEEL, cols: 3, rows: 3, border: 0.063, color: GLASS },
  millDoor: { frame: STEEL, cols: 2, rows: 1, color: 0x38444a, transom: true },
  louvres: { frame: STEEL, cols: 9, rows: 2, border: 0.11, reveal: 0.24, color: 0x3d5256 },
};

const surfaces = {
  house: { wall: 0x88604d, roof: 0xa15c40, openings: house },
  barn: { wall: 0x8e5f4d, roof: 0x995b43, openings: barn },
  millshed: { wall: 0x8b6755, roof: 0x575452, openings: millshed },
  millworks: { wall: 0x9c826c, roof: 0x474749, openings: millworks },
};

function ledge(batch, frame, u0, u1, bottom, top, inset, reach, color) {
  const p = frame.point;
  batch.quad(p(u0, bottom, reach), p(u1, bottom, reach), p(u1, top, reach), p(u0, top, reach), color);
  batch.quad(p(u0, top, reach), p(u1, top, reach), p(u1, top, inset), p(u0, top, inset), color);
  batch.quad(p(u0, bottom, inset), p(u1, bottom, inset), p(u1, bottom, reach), p(u0, bottom, reach), color);
  batch.quad(p(u0, bottom, inset), p(u0, bottom, reach), p(u0, top, reach), p(u0, top, inset), color);
  batch.quad(p(u1, bottom, reach), p(u1, bottom, inset), p(u1, top, inset), p(u1, top, reach), color);
}

function entranceDetails(key, face, frame, trim, windows) {
  const w = frame.width;
  if (key === 'millworks') {
    if ([10, 39, 41, 45, 53, 72, 80].includes(face)) {
      ledge(trim, frame, 0, w, frame.high - 0.11, frame.high + 0.075, -0.08, 0.22, CREAM);
    }
    if (face === 41) {
      // Horizontal metal brise-soleil on the courtyard glazing.
      for (let y = -0.36; y < 5.62; y += 0.48) {
        ledge(trim, frame, w * 0.51 - 7.69, w * 0.51 + 7.69, y, y + 0.063, 0.02, 0.37, STEEL);
      }
    }
    if (face === 45) ledge(trim, frame, 0.63, w * 0.64, 1.87, 2.09, -0.03, 1.02, CREAM);
    if (face === 39) {
      const left = w * 0.075, right = w * 0.53, deck = -2.12;
      ledge(trim, frame, left, right, deck - 0.16, deck, -0.02, 0.97, 0x536064);
      ledge(trim, frame, left, right, deck + 0.92, deck + 0.97, 0.92, 0.97, STEEL);
      for (let u = left; u <= right; u += 1.13) {
        ledge(trim, frame, u, u + 0.05, deck, deck + 0.96, 0.92, 0.97, STEEL);
      }
      for (let i = 0; i < 6; i++) {
        const depth = 1.22 + i * 0.24, y = deck - (i + 1) * 0.17;
        ledge(trim, frame, right - 0.96, right - 0.03, y - 0.06, y, depth - 0.26, depth, STEEL);
      }
    }
  } else if (key === 'house' && face === 38) {
    ledge(trim, frame, 0, w, 0.84, 1.06, -0.04, 0.23, CREAM);
    ledge(trim, frame, 0, w, -4.03, -3.73, -0.015, 0.055, 0xaba48d);
    for (const side of [-1, 1]) {
      const u = w * 0.82 + side * 0.64;
      ledge(trim, frame, u - 0.07, u + 0.07, -3.96, -1.34, -0.005, 0.11, CREAM);
    }
  }
  for (const { kind, u, width, lo } of windows) {
    if (kind !== 'factory' && kind !== 'sash') continue;
    ledge(trim, frame, u - width / 2 - 0.06, u + width / 2 + 0.06, lo - 0.065, lo, -0.035, 0.10,
      kind === 'sash' ? CREAM : SILL);
  }
}


function houseRoof(group, trim, _signs, view) {
  const surface = group.children[0];
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  function heightAt(x, z) {
    ray.ray.origin.set(x, 20, z);
    return ray.intersectObject(surface, false)[0]?.point.y;
  }

  // Both street-facing dormers have pale timber surrounds and short hipped-roof returns.
  for (const [face, fraction, depth] of [[38, 0.56, -1.4], [28, 0.46, -1.18]]) {
    const [, , frame] = view(CONCORDIA_SURVEY.house.faceIds.indexOf(face));
    const p = frame.point, u = frame.width * fraction;
    const [x, , z] = p(u, 0, depth);
    const y = heightAt(x, z);
    if (y === undefined) continue;
    const left = u - 0.56, right = u + 0.56, base = y - 0.34, top = y + 0.78;
    const back = depth - 1.20;
    ledge(trim, frame, left, right, base, top, back, depth, CREAM);
    ledge(trim, frame, u - 0.35, u + 0.35, y + 0.08, y + 0.66, depth, depth + 0.025, GLASS);
    ledge(trim, frame, u - 0.022, u + 0.022, y + 0.08, y + 0.66, depth + 0.025, depth + 0.045, CREAM);
    const a = p(left - 0.10, top, depth + 0.10), b = p(right + 0.10, top, depth + 0.10);
    const c = p(u, top + 0.37, depth + 0.10), d = p(u, top + 0.37, back);
    trim.triangle(a, b, c, CREAM);
    trim.quad(b, p(right + 0.10, top, back), d, c, 0x705043);
    trim.quad(c, d, p(left - 0.10, top, back), a, 0x705043);
  }

  for (const [x, z] of [[-377.6, -75.0], [-375.0, -75.8]]) {
    const y = heightAt(x, z);
    if (y === undefined) continue;
    trim.solid(new THREE.BoxGeometry(0.64, 1.55, 0.49).rotateY(0.33).translate(x, y + 0.36, z), 0x865e4d);
    trim.solid(new THREE.BoxGeometry(0.70, 0.095, 0.55).rotateY(0.33).translate(x, y + 1.17, z), 0x6e6257);
  }
}

export function createConcordiaComplex([towerFootprint], site) {
  const group = new THREE.Group();
  const { tower, shaft } = createConcordiamolen();
  tower.position.set(site.x, terrainHeightAt(site.x, site.z), site.z);
  tower.rotation.y = site.heading;
  tower.updateMatrix();
  const silhouette = new CivicBatch();
  addConcordiaTowerSilhouette(silhouette, tower.matrix);
  // The wind-driven cap and sails stay on their own hierarchy at both distances.
  group.add(tower);
  shaft.position.copy(tower.position);
  shaft.quaternion.copy(tower.quaternion);
  group.add(shaft);
  const staticParts = [shaft];
  const colliders = [{
    minX: Math.min(...towerFootprint.outer.map(p => p.x)), maxX: Math.max(...towerFootprint.outer.map(p => p.x)),
    minZ: Math.min(...towerFootprint.outer.map(p => p.z)), maxZ: Math.max(...towerFootprint.outer.map(p => p.z)),
    minY: tower.position.y, maxY: tower.position.y + 26.72, polygon: towerFootprint,
  }];
  for (const [key, survey] of Object.entries(CONCORDIA_SURVEY)) {
    const appearance = surfaces[key];
    const industrial = key === 'millworks';
    for (const [roof, ...rings] of survey.faces) {
      const points = rings.map(ring => ring.map(index => survey.vertices[index]));
      const color = roof ? appearance.roof :
        industrial && points[0].every(point => point[1] > 7) ? 0x988d7c : appearance.wall;
      silhouette.polygon(points, color);
    }
    const model = buildVenue(survey.name, survey, {
      masonry: 1,
      wall: (_, frame) => industrial && frame?.low > 7 ? 0x988d7c : appearance.wall,
      roof: () => appearance.roof,
      roofFinish: () => industrial ? 0 : 2,
    }, (index, frame, _signs, trim) => {
      const face = survey.faceIds[index];
      const windows = (appearance.openings[face] ?? []).map(([centre, width, lo, hi, kind]) => ({
        ...openings[kind], kind, u: centre * frame.width, width, lo, hi,
      }));
      entranceDetails(key, face, frame, trim, windows);
      return { windows };
    }, key === 'house' ? houseRoof : undefined);
    group.add(model);
    staticParts.push(model);
    colliders.push(...model.userData.colliders);
  }
  group.userData.colliders = colliders;
  return addLandmarkLod(group, silhouette, 175, staticParts);
}
