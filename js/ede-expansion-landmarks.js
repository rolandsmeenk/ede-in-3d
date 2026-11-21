import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { nearbyRailHeightAt, RAIL_TOP } from './ede-grade.js';
import { DE_KLOMP_PLATFORMS, EXPANSION_LANDMARK_SURVEYS, GINKEL_SHEEPFOLD_FENCES } from './ede-expansion-landmark-surveys.js';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { terrainHeightAt } from './terrain.js';

function box(batch, x, y, z, width, height, depth, color, heading = 0) {
  batch.solid(new THREE.BoxGeometry(width, height, depth).rotateY(heading).translate(x, y, z), color);
}

function sheepfoldWall(wall) {
  const { base, buildingIndex, high, low, normal, point, trim, width } = wall;
  if (low > base + 0.05 || width < 1.7) return;
  if (width > 11 && buildingIndex === 0) {
    const heading = Math.atan2(normal.x, normal.z);
    for (let i = 1; i <= 3; i++) {
      const [x, y, z] = point(i * width / 4, base + 0.8, 0.12);
      box(trim, x, y, z, 0.35, 1.6, 0.38, 0x745445, heading);
    }
  }
  if (Math.abs(normal.z) > 0.77 && width < 6 && high - base > 1.75) {
    const halfWidth = Math.min(1.16, width * 0.40);
    for (const sign of [-1, 1]) {
      const center = width / 2 + sign * (halfWidth / 2 + 0.025);
      surveyPanel(wall, center - halfWidth / 2, center + halfWidth / 2, base + 0.02,
        Math.min(high - 0.08, base + 2.2), 0x3e372b);
    }
  }
}

function addSheepfoldFences({ trim, colliders }) {
  const posts = new Set();
  const color = 0x62503b;
  for (const { points } of GINKEL_SHEEPFOLD_FENCES) {
    for (let j = 1; j < points.length; j++) {
      const [ax, az] = points[j - 1], [bx, bz] = points[j];
      const dx = bx - ax, dz = bz - az;
      const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 2.6));
      const heading = Math.atan2(-dz, dx);
      const edge = Array.from({ length: count + 1 }, (_, i) => {
        const x = ax + i * dx / count, z = az + i * dz / count;
        const y = terrainHeightAt(x, z);
        const key = `${x.toFixed(2)},${z.toFixed(2)}`;
        if (!posts.has(key)) {
          box(trim, x, y + 0.55, z, 0.13, 1.1, 0.13, color);
          posts.add(key);
        }
        return { x, y, z };
      });
      for (let i = 1; i < edge.length; i++) {
        const a = edge[i - 1], b = edge[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const slope = Math.atan2(b.y - a.y, length);
        for (const height of [0.50, 0.90]) {
          const rail = new THREE.BoxGeometry(length, 0.095, 0.08).rotateZ(slope).rotateY(heading)
            .translate((a.x + b.x) / 2, (a.y + b.y) / 2 + height, (a.z + b.z) / 2);
          trim.solid(rail, color);
        }
        colliders.push(...wallColliders(a, b, Math.min(a.y, b.y) - 0.05, Math.max(a.y, b.y) + 1.1, 0.13));
      }
    }
  }
}

function addDeKlompPlatforms({ group, platforms }) {
  const slabs = new CivicBatch();
  const surface = (x, z) => {
    const railBase = nearbyRailHeightAt(x, z, 7);
    return railBase === undefined ? terrainHeightAt(x, z) + 0.78 : railBase + RAIL_TOP + 0.76;
  };
  for (const { id, points } of DE_KLOMP_PLATFORMS) {
    const clockwise = THREE.ShapeUtils.isClockWise(points.map(([x, z]) => new THREE.Vector2(x, z)));
    const outline = clockwise ? points : [...points].reverse();
    const top = outline.map(([x, z]) => [x, surface(x, z), z]);
    const outer = outline.map(([x, z]) => ({ x, z }));
    slabs.polygon([top], 0xb4ada0);
    for (let i = 0; i < top.length; i++) {
      const a = top[i], b = top[(i + 1) % top.length];
      const bottom = ([x, y, z]) => [x, Math.min(y - 0.23, terrainHeightAt(x, z) - 0.10), z];
      slabs.quad(a, bottom(a), bottom(b), b, 0x9d9689);
    }
    platforms.push({ id, outer, holes: [], height: surface });
  }
  const mesh = slabs.mesh();
  mesh.name = 'De Klomp railway platforms';
  group.add(mesh);
}

const signs = {
  'juffrouw-tok': { text: 'RESTAURANT', face: 'south', field: '#58312c', ink: '#ffe6b1' },
  mossel: { text: 'BOERDERIJ MOSSEL', face: 'west', field: '#344131', ink: '#f1e9d8' },
  'planken-wambuis': { text: 'RESTAURANT', face: 'north', field: '#293929', ink: '#f9e7b9' },
  'veenendaal-de-klomp': { text: 'Veenendaal-De Klomp', face: 'north', field: '#1a4076', ink: '#ffffff' },
};

function createSignedBuilding(site) {
  const { text, face, field, ink } = signs[site.id];
  let signed = false;
  return createSurveyLandmark(site, EXPANSION_LANDMARK_SURVEYS[site.id], wall => {
    const { base, high, low, normal, width } = wall;
    if (low > base + 0.05 || high < base + 2.4 || width < 3) return;
    const bays = Math.max(1, Math.round(width / 3.5));
    for (let i = 0; i < bays; i++) {
      const middle = (i + 0.5) * width / bays;
      surveyWindow(wall, middle - 0.62, middle + 0.62, base + 0.8, base + 2.05,
        { color: 0x354b4d, frame: 0xb4aca0, columns: 2 });
    }
    const frontage = face === 'north' ? -normal.z : face === 'south' ? normal.z : -normal.x;
    if (signed || frontage < 0.65 || width < 4.25) return;
    const center = width / 2;
    const halfWidth = Math.min(width * 0.44, text.length * 0.135);
    const top = Math.min(base + 3.25, high - 0.10);
    if (top - 0.48 > base + 2.05) {
      surveyLabel(wall, center - halfWidth, center + halfWidth, top - 0.48, top, text, field, ink);
      signed = true;
    }
  }, site.id === 'veenendaal-de-klomp' ? addDeKlompPlatforms : undefined);
}

function createDoesburgermolen(footprints, site) {
  const { x, z } = site;
  const y = terrainHeightAt(x, z);
  const heading = -1.46;
  const mill = new CivicBatch();
  // The closed post mill has a thatched skirt under a timber buck. The 22.7 m
  // sail span is recorded by the Nederlandse Molendatabase (mill 00856).
  const skirt = new THREE.CylinderGeometry(1.9, 3.15, 3.9, 12).translate(0, 1.95, 0);
  mill.solid(skirt, 0x65533a);
  box(mill, 0, 7.05, 0.15, 4.55, 6.7, 5.65, 0x352c24);
  const roof = new THREE.CylinderGeometry(0, 1, 1.6, 4)
    .rotateY(Math.PI / 4).scale(3.65, 1, 4.45).translate(0, 11.20, 0.1);
  mill.solid(roof, 0x544639);
  for (let i = -5; i <= 5; i++) {
    box(mill, 0.39 * i, 7.05, 2.986, 0.05, 6.55, 0.035, 0x4a3e31);
  }
  box(mill, 0, 7.78, 2.99, 1.08, 1.3, 0.10, 0xddd4b8);
  box(mill, 0, 7.78, 3.06, 0.82, 1.04, 0.07, 0x363c37);
  for (let i = 0; i < 13; i++) {
    box(mill, 0, 0.22 + i * 0.27, -7.2 + i * 0.33, 1.15, 0.13, 0.30, 0x564739);
  }
  const group = new THREE.Group();
  const structure = mill.mesh();
  structure.rotation.y = heading;
  structure.position.set(x, y, z);
  group.add(structure);

  const lattices = new CivicBatch();
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const strut = (across, radial, width, length, depth, color) => {
      lattices.solid(new THREE.BoxGeometry(width, length, depth).rotateZ(angle)
        .translate(across * c - radial * s, across * s + radial * c, 0), color);
    };
    strut(0, 5.675, 0.16, 11.35, 0.16, 0x48382a);
    strut(1.13, 6.55, 0.07, 9.6, 0.08, 0x574333);
    for (let i = 0; i < 19; i++) strut(0.56, 1.9 + i * 0.51, 1.15, 0.045, 0.06, 0x655441);
  }
  const runner = lattices.mesh();
  runner.rotation.z = 0.34;
  const rotor = new THREE.Group();
  rotor.position.set(x + 3.13 * Math.sin(heading), y + 11.65, z + 3.13 * Math.cos(heading));
  rotor.rotation.y = heading;
  rotor.add(runner);
  group.add(rotor);
  const { outer, holes } = footprints[0];
  group.userData.colliders = [{
    minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
    minY: y, maxY: y + 12.2, polygon: { outer, holes },
  }];
  return group;
}

function createAirborneMonument() {
  // Nationaal Comité 4 en 5 mei records a concrete column topped by a copper eagle.
  const monument = new CivicBatch();
  box(monument, 0, 0.12, 0, 1.1, 0.24, 0.98, 0x9b9c91);
  box(monument, 0, 1.44, 0, 0.30, 2.64, 0.30, 0xb9b8a9);
  box(monument, 0, 1.25, 0.154, 0.23, 0.39, 0.02, 0x594b39);
  const bronze = 0x6e563d;
  box(monument, 0, 2.80, 0, 0.14, 0.28, 0.15, bronze);
  for (const side of [-1, 1]) {
    const point = (x, y, z) => [x * side, y, z];
    const tips = [point(0.03, 2.89, 0.03), point(0.62, 3.04, -0.06),
      point(0.47, 2.85, -0.13), point(0.05, 2.79, -0.10)];
    monument.quad(...tips, bronze);
    monument.quad(...tips.slice().reverse(), bronze);
  }
  return makeGroup('Airborne Monument Ginkelse Heide', monument, null);
}

export const EXPANSION_LANDMARK_FACTORIES = {
  'schaapskooi-ginkelse-heide': (_, site) => createSurveyLandmark(site, EXPANSION_LANDMARK_SURVEYS[site.id], sheepfoldWall, addSheepfoldFences),
  'juffrouw-tok': (_, site) => createSignedBuilding(site),
  doesburgermolen: createDoesburgermolen,
  mossel: (_, site) => createSignedBuilding(site),
  'planken-wambuis': (_, site) => createSignedBuilding(site),
  'veenendaal-de-klomp': (_, site) => createSignedBuilding(site),
  'airborne-monument-ginkel': createAirborneMonument,
};
