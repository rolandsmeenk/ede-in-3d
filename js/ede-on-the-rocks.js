import * as THREE from 'three/webgpu';
import { atan, attribute, color, float, fract, hash, instanceIndex, mix, mx_noise_float,
  positionGeometry, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addLandmarkLod, CivicBatch } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';
import { transparentEffectMRT } from './tsl-materials.js';

// Basin: PDOK BGT G0228.1e02e42caa534882a6e4541259ff2447, checked against OSM n821108126.
// Cork: measured from the PDOK 2023 and 2024 HR orthophotos.
const BASIN = { x: -104.9533, z: 258.9767, radius: 2.36 };
const CORK = { x: -104.92, z: 263.67, radius: 0.59 };
const TURN = 2 * Math.PI;
const PAVEMENT_LIFT = 0.083;

function stone(dark, light, roughness) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness });
  const fine = mx_noise_float(positionGeometry.mul(104)).mul(0.60);
  const coarse = mx_noise_float(positionGeometry.mul(23)).mul(0.40);
  material.colorNode = mix(color(dark), color(light), smoothstep(-0.4, 0.4, fine.add(coarse)));
  return material;
}

function lathe(profile) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 64);
}

function addMesh(group, name, geometry, material, shadow = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addBasin(group) {
  const granite = stone('#212929', '#374040', 0.32);
  const joint = fract(atan(positionGeometry.x, positionGeometry.z).mul(12 / TURN)).sub(0.5).abs();
  granite.colorNode = granite.colorNode.mul(smoothstep(0, 0.012, joint).mul(0.34).add(0.66));
  const grooves = [
    [2.211, 0.066], [2.209, 0.084], [2.218, 0.096],
    [2.218, 0.107], [2.216, 0.121], [2.225, 0.133],
    [2.226, 0.146], [2.224, 0.159], [2.232, 0.173],
  ];
  addMesh(group, 'Polished granite basin', lathe([
    [2.21, -0.09], [2.21, 0.058], ...grooves, [2.247, 0.27], [2.281, 0.367],
    [2.34, 0.416], [BASIN.radius, 0.436], [BASIN.radius, 0.459], [2.337, 0.475],
    [2.127, 0.475], [2.102, 0.456], [2.087, 0.379], [2.087, 0.126], [0, 0.126],
  ]), granite);
  const water = new THREE.MeshStandardMaterial({ color: '#1d3937', roughness: 0.24, metalness: 0.18 });
  addMesh(group, 'Dark water between the glass', new THREE.CircleGeometry(2.085, 64)
    .rotateX(-Math.PI / 2).translate(0, 0.19, 0), water, false);
}

function glassGeometry(width, height, depth, seed) {
  const positions = [], colors = [], rings = [];
  const sides = 7;
  for (const [row, [radius, level]] of [[0.63, -0.45], [1, -0.10], [0.86, 0.23], [0.55, 0.44]].entries()) {
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const azimuth = TURN * (i + 0.11 * Math.sin(seed * 3 + i * 17)) / sides;
      const r = radius * (0.90 + 0.16 * Math.sin(seed * 11 + i * 9 + row * 4));
      ring.push([Math.cos(azimuth) * r * width / 2, (level + 0.07 * Math.sin(i * 5 + row * 9 + seed)) * height,
        Math.sin(azimuth) * r * depth / 2]);
    }
    rings.push(ring);
  }

  const tinted = new THREE.Color(seed % 3 === 0 ? '#1d655e' : '#367c75');
  const frosted = new THREE.Color(seed % 4 === 0 ? '#d1e4dd' : '#acccc4');
  const faceColor = new THREE.Color();
  function face(a, b, c, row, index) {
    const frost = Math.min(0.96, row * 0.13 + 0.53 * (0.5 + 0.5 * Math.sin(seed * 9 + index * 7)));
    faceColor.copy(tinted).lerp(frosted, frost);
    for (const point of [a, b, c]) {
      positions.push(...point);
      colors.push(faceColor.r, faceColor.g, faceColor.b);
    }
  }

  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    for (let row = 0; row < rings.length - 1; row++) {
      const base = rings[row], top = rings[row + 1];
      face(base[i], top[i], base[next], row, i * 2);
      face(base[next], top[i], top[next], row, i * 2 + 1);
    }
    face([0, height * 0.43, 0], rings[3][next], rings[3][i], 3, i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('glassTint', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function addGlass(group) {
  const material = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.36, clearcoat: 0.46,
    clearcoatRoughness: 0.36, transparent: true, depthWrite: true });
  const coarse = mx_noise_float(positionGeometry.mul(12));
  const chips = mx_noise_float(positionGeometry.mul(63));
  const frosting = smoothstep(0.03, 0.42, coarse.mul(0.75).add(chips.mul(0.32)));
  material.colorNode = mix(attribute('glassTint', 'vec3'), color('#d4e8df'), frosting.mul(0.45));
  material.opacityNode = frosting.mul(0.12).add(0.78);
  material.mrtNode = transparentEffectMRT;

  // The large pieces form a loose second tier over narrower outer fragments.
  const tiers = [[15, 1.53, 0.49, 0.92, 0.78], [8, 0.95, 0.79, 1.08, 0.92], [2, 0.37, 0.97, 1.04, 0.98]];
  const blocks = [];
  const rotation = new THREE.Euler();
  const transform = new THREE.Matrix4();
  let index = 0;
  for (const [number, radius, y, width, height] of tiers) {
    for (let i = 0; i < number; i++) {
      index++;
      const azimuth = TURN * i / number + Math.sin(index * 4) * 0.13 + y;
      const size = 0.83 + 0.30 * (0.5 + 0.5 * Math.cos(index * 8));
      const distance = radius + 0.13 * Math.sin(index * 6);
      const x = distance * Math.cos(azimuth), z = distance * Math.sin(azimuth);
      rotation.set(0.23 * Math.cos(index * 3), index * 1.63, 0.27 * Math.sin(index * 3));
      transform.makeRotationFromEuler(rotation).setPosition(x, y + 0.10 * Math.sin(index * 7), z);
      const geometry = glassGeometry(width * size, height * size, width * size * 0.87, index);
      blocks.push({ x, geometry: geometry.applyMatrix4(transform) });
    }
  }
  // Draw the rear blocks first from the west approach so the glass layers retain some depth.
  const geometries = blocks.sort((a, b) => b.x - a.x).map(block => block.geometry);
  addMesh(group, 'Frosted cast glass', mergeGeometries(geometries), material, false);
  geometries.forEach(geometry => geometry.dispose());
}

function relief(points, thickness) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true,
    bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 1 }).rotateX(-Math.PI / 2);
}

function addCork(group) {
  const concrete = stone('#777164', '#bcb6a6', 0.91);
  const top = stone('#aaa492', '#d2cabb', 0.83);
  const bronze = stone('#354346', '#565850', 0.58);
  const raised = stone('#515a57', '#747971', 0.53);
  addMesh(group, 'Concrete cork', lathe([
    [0.54, -0.09], [0.554, 0], [0.576, 0.43], [CORK.radius, 0.484],
  ]), concrete);
  addMesh(group, 'Smooth cork rim', lathe([[CORK.radius, 0.484], [0.577, 0.493], [0.47, 0.493], [0.467, 0.48]]), top);
  addMesh(group, 'Bronze medallion', new THREE.CylinderGeometry(0.469, 0.469, 0.021, 64).translate(0, 0.481, 0), bronze);
  const border = new THREE.TorusGeometry(0.451, 0.0035, 5, 64).rotateX(-Math.PI / 2).translate(0, 0.492, 0);
  addMesh(group, 'Bronze medallion rim', border, raised, false);

  const bear = [[-0.298, 0.125], [-0.259, 0.117], [-0.231, 0.147], [-0.199, 0.15], [-0.183, 0.179],
    [-0.159, 0.164], [-0.151, 0.147], [-0.082, 0.134], [0.003, 0.132], [0.078, 0.149],
    [0.171, 0.148], [0.242, 0.126], [0.29, 0.077], [0.256, 0.035], [0.174, 0.013],
    [0.161, -0.062], [0.116, -0.062], [0.109, -0.02], [0.078, 0.028], [-0.01, 0.045],
    [-0.029, 0.006], [-0.041, -0.061], [-0.105, -0.063], [-0.085, -0.024],
    [-0.101, 0.043], [-0.183, 0.072], [-0.233, 0.083], [-0.292, 0.103]];
  const ice = [[-0.271, -0.101], [-0.244, -0.143], [-0.164, -0.176], [0.192, -0.173],
    [0.266, -0.143], [0.252, -0.111], [0.16, -0.086], [-0.034, -0.077], [-0.172, -0.088]];
  for (const [name, points] of [['Polar bear relief', bear], ['Ice floe relief', ice]]) {
    const mesh = addMesh(group, name, relief(points, 0.009).translate(0, 0.492, 0), raised, false);
    mesh.rotation.y = -Math.PI / 2;
  }
}

function addStoneBand(group) {
  const positions = [];
  const centerZ = BASIN.z + 1.35, count = 88;
  // Segment joints follow the existing paving grade under the circular granite band.
  function vertex(radius, angle) {
    const x = BASIN.x + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;
    positions.push(x, terrainHeightAt(x, z) + PAVEMENT_LIFT, z);
  }
  for (let i = 0; i < count; i++) {
    const start = i * TURN / count + 0.001, end = (i + 1) * TURN / count - 0.001;
    vertex(3.99, start); vertex(4.20, end); vertex(4.20, start);
    vertex(3.99, start); vertex(3.99, end); vertex(4.20, end);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return addMesh(group, 'Granite paving band', geometry, stone('#555350', '#777471', 0.82), false);
}

function addMist(group) {
  const age = uniform(0), drift = uniform(new THREE.Vector2());
  const id = float(instanceIndex);
  const progress = fract(hash(id.add(53)).add(age));
  const angle = hash(id.add(11)).mul(TURN);
  const radius = hash(id.add(37)).mul(1.40).add(0.19);
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.mrtNode = transparentEffectMRT;
  material.positionNode = vec3(angle.cos().mul(radius).add(drift.x.mul(progress)),
    progress.mul(0.94).add(0.31), angle.sin().mul(radius).add(drift.y.mul(progress)));
  material.scaleNode = vec2(progress.mul(1.15).add(0.47), progress.mul(0.48).add(0.28));
  material.colorNode = color('#e9f4f1');
  const spriteUV = uv().sub(0.5);
  const softEdge = smoothstep(0.08, 0.50, spriteUV.length()).oneMinus();
  const variation = mx_noise_float(vec3(spriteUV.mul(4), progress.mul(1.3).add(id))).mul(0.32).add(0.68);
  material.opacityNode = softEdge.mul(variation).mul(progress.mul(Math.PI).sin()).mul(0.17);

  const geometry = new THREE.PlaneGeometry();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 3.4);
  const mist = new THREE.Mesh(geometry, material);
  mist.name = 'On the Rocks water mist';
  mist.count = 19;
  mist.renderOrder = 2;
  mist.userData.nearDetail = 65;
  mist.userData.updateWind = (dt, reading) => {
    age.value = (age.value + dt * 0.34) % 1;
    const speed = Math.min(0.74, (reading?.windSpeed ?? 0) * 0.041);
    const heading = THREE.MathUtils.degToRad(reading?.windDirection ?? 0);
    drift.value.x += (-Math.sin(heading) * speed - drift.value.x) * -Math.expm1(-dt);
    drift.value.y += (Math.cos(heading) * speed - drift.value.y) * -Math.expm1(-dt);
  };
  group.add(mist);
}

function collider({ x, z, radius }, ground, height) {
  const outer = Array.from({ length: 24 }, (_, i) => ({
    x: x + Math.cos(TURN * i / 24) * radius, z: z + Math.sin(TURN * i / 24) * radius,
  }));
  return { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius,
    minY: ground, maxY: ground + height, polygon: { outer, holes: [] } };
}

export function createOnTheRocks() {
  const model = new THREE.Group();
  model.name = 'On the Rocks';
  const basin = new THREE.Group(), cork = new THREE.Group();
  const basinGround = terrainHeightAt(BASIN.x, BASIN.z), corkGround = terrainHeightAt(CORK.x, CORK.z);
  basin.position.set(BASIN.x, basinGround + 0.05, BASIN.z);
  cork.position.set(CORK.x, corkGround + 0.055, CORK.z);
  model.add(basin, cork);
  addBasin(basin);
  addGlass(basin);
  addMist(basin);
  addCork(cork);
  const band = addStoneBand(model);
  model.userData.colliders = [collider(BASIN, basinGround, 1.62), collider(CORK, corkGround, 0.57)];
  const silhouette = new CivicBatch();
  silhouette.solid(band.geometry.clone(), 0x64635e);
  const basinY = basin.position.y, corkY = cork.position.y;
  silhouette.solid(new THREE.CylinderGeometry(BASIN.radius, 2.21, 0.54, 20)
    .translate(BASIN.x, basinY + 0.18, BASIN.z), 0x252d2d);
  silhouette.solid(new THREE.CylinderGeometry(CORK.radius, 0.54, 0.58, 12)
    .translate(CORK.x, corkY + 0.20, CORK.z), 0x9b9485);
  for (let i = 0; i < 9; i++) {
    const angle = TURN * i / 9;
    const radius = i % 2 ? 0.95 : 1.51;
    const height = i % 2 ? 1.02 : 0.63;
    silhouette.solid(new THREE.CylinderGeometry(0.32, 0.49, height, 5).rotateZ(0.18)
      .translate(BASIN.x + Math.cos(angle) * radius, basinY + 0.42 + height / 2, BASIN.z + Math.sin(angle) * radius),
    i % 3 ? 0x779c92 : 0xb8ccc5);
  }
  return addLandmarkLod(model, silhouette, 72);
}
