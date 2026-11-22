import * as THREE from 'three/webgpu';
import { getEdeGrade, gradeDeckAt, gradeSections, nearbyRailHeightAt } from './ede-grade.js';
import { terrainHeightAt } from './terrain.js';
import { createMemorialPlaque } from './ede-memorial-plaque.js';

const TIMBER = 0xc89356;
const STEEL = 0x40464a;
const ZINC = 0x829097;
const GLASS = 0x46626c;
const ROOF = 0x4a4d4f;
const SEDUM = 0x74734a;

// The 2026 PDOK orthophoto fixes the three staggered rows of 27 m canopy bays.
// Roof heights are AHN6 DSM samples in the Oude Kerk vertical frame (22.54 m NAP).
const bayHeights = [
  [9.6, 11.0, 10.9, 10.6], [10.7, 12.2, 12.0, 11.8], [11.9, 13.3, 13.1, 12.8],
  [13.0, 11.9, 11.7, 11.4], [11.6, 10.5, 10.3, 10.0], [10.2, 0, 8.8, 8.5],
];
const wing = [
  [193.9, 2107.7], [243.9, 2122.3], [248.6, 2135.3],
  [223.8, 2157.8], [201.3, 2152.1],
];
const tower = [[174.4, 2153.3], [180.1, 2154.2], [179.1, 2149.0]];
const span = (x, z, count) => Array.from({ length: count }, (_, i) => [x + i * 26.82, z + i * 7.83]);
const point = ([x, z], y) => new THREE.Vector3(x, y, z);
const midpoint = (a, b) => a.clone().lerp(b, 0.5);
const spread = (a, b, c, i, j, n) => a.clone().lerp(b, i / n).addScaledVector(c.clone().sub(a), j / n);

export function createEdeStationLandmark() {
  const group = new THREE.Group();
  group.name = 'Station Ede-Wageningen';
  const solid = [], colors = [], skylights = [];
  const tint = new THREE.Color();
  const colliders = [];
  const up = new THREE.Vector3(0, 1, 0);

  function triangle(a, b, c, color) {
    const coordinates = color === undefined ? skylights : solid;
    coordinates.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    if (color !== undefined) {
      tint.setHex(color);
      colors.push(...tint.toArray(), ...tint.toArray(), ...tint.toArray());
    }
  }

  function quad(a, b, c, d, color) {
    triangle(a, b, c, color);
    triangle(a, c, d, color);
  }

  function meshGeometry(geometry, color) {
    const positions = geometry.attributes.position;
    const indices = geometry.index;
    tint.setHex(color);
    for (let i = 0; i < indices.count; i++) {
      const j = indices.getX(i);
      solid.push(positions.getX(j), positions.getY(j), positions.getZ(j));
      colors.push(tint.r, tint.g, tint.b);
    }
    geometry.dispose();
  }

  function beam(a, b, width, depth, color) {
    const direction = b.clone().sub(a);
    const length = direction.length();
    if (length < 0.01) return;
    const center = midpoint(a, b);
    direction.divideScalar(length);
    const right = Math.abs(direction.y) > 0.999
      ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, direction, right.clone().cross(direction));
    meshGeometry(new THREE.BoxGeometry(width, length, depth).applyMatrix4(basis).translate(...center.toArray()), color);
  }

  function fascia(a, b, thickness, color) {
    quad(a, b, b.clone().addScaledVector(up, -thickness), a.clone().addScaledVector(up, -thickness), color);
  }

  function plane(outline, y, color) {
    const path = outline.map(([x, z]) => new THREE.Vector2(x, z));
    const vertices = outline.map(p => point(p, y));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(path, [])) {
      triangle(vertices[a], vertices[b], vertices[c], color);
    }
    return vertices;
  }

  function lattice(points, height, seed, green = false) {
    const [a, b, c] = points.map(p => point(p, height));
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      fascia(p, q, 0.62, ZINC);
      beam(p.clone().addScaledVector(up, -0.88), q.clone().addScaledVector(up, -0.88), 0.28, 1.42, TIMBER);
    }
    // Subdivisions follow the real timber lattice. Keep the beams and skylights in two shared batches.
    const fine = 6;
    function roofCell(p, q, r, n) {
      const glass = (n * 13 + seed * 11) % 19 < 6;
      if (glass) triangle(p, q, r);
      else {
        triangle(p, q, r, green ? SEDUM : n % 5 ? ROOF : 0x53575a);
        const below = v => v.clone().addScaledVector(up, -0.26);
        triangle(below(r), below(q), below(p), n % 3 ? 0xc89155 : 0xd6a574);
      }
    }
    for (let i = 0, n = 0; i < fine; i++) {
      for (let j = 0; i + j < fine; j++) {
        const p = spread(a, b, c, i, j, fine), q = spread(a, b, c, i + 1, j, fine);
        const r = spread(a, b, c, i, j + 1, fine);
        roofCell(p, q, r, n++);
        if (i + j < fine - 1) roofCell(q, spread(a, b, c, i + 1, j + 1, fine), r, n++);
      }
    }
    const under = [a, b, c].map(p => p.clone().addScaledVector(up, -0.4));
    for (const [p, q, r] of [under, [under[1], under[2], under[0]], [under[2], under[0], under[1]]]) {
      for (let i = 1; i < 4; i++) {
        beam(p.clone().lerp(r, i / 4), q.clone().lerp(r, i / 4), 0.11, 0.21, TIMBER);
      }
    }
  }

  function wallCollider(a, b, base, top, thickness) {
    const dx = b.x - a.x, dz = b.z - a.z, size = Math.hypot(dx, dz);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const hx = size / 2, hz = thickness / 2, cs = dx / size, sn = -dz / size;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: base, maxY: top,
      obb: { cx, cz, hx, hz, cs, sn } });
  }

  function facade(a, b, base, type) {
    const width = a.distanceTo(b), panes = Math.ceil(width / 2.55);
    const height = a.y - base, levels = type === 'tower' ? 1 : 3;
    for (let i = 0; i < panes; i++) {
      const p = a.clone().lerp(b, i / panes), q = a.clone().lerp(b, (i + 1) / panes);
      for (let j = 0; j < levels; j++) {
        const y = base + height * j / levels, top = base + height * (j + 1) / levels;
        const pane = (v, y) => v.clone().setY(y);
        const color = j === 0 || type === 'tower' ? (i % 4 ? GLASS : 0x56707a)
          : (j === 1 ? 0x40494c : i % 4 === 1 ? GLASS : 0x6e787a);
        quad(pane(p, y), pane(q, y), pane(q, top), pane(p, top), color);
        beam(pane(p, y), pane(p, top), 0.115, 0.115, STEEL);
        beam(pane(p, top), pane(q, top), 0.105, 0.105, STEEL);
      }
    }
    wallCollider(a, b, base, a.y, 0.16);
  }

  const north = span(97.27, 2017.05, 6);
  const center = span(76.64, 2036.38, 7);
  const south = span(82.51, 2065.22, 7);
  for (let i = 0; i < 6; i++) {
    const [nw, ne, se, sw] = bayHeights[i];
    lattice([center[i], center[i + 1], north[i]], nw, i * 4);
    if (i + 1 < north.length) lattice([north[i], north[i + 1], center[i + 1]], ne, i * 4 + 1);
    lattice([south[i], south[i + 1], center[i + 1]], se, i * 4 + 2);
    lattice([center[i], center[i + 1], south[i]], sw, i * 4 + 3);
  }

  // The platform columns sit off the surveyed track centrelines and clear the passenger stairs.
  for (const [x, z, roof] of [
    [78.0, 2037.0, 9.6], [103.6, 2045.7, 10.6], [130.4, 2053.7, 11.8],
    [155.5, 2061.2, 12.5], [210.9, 2077.3, 10.0], [236.8, 2085.0, 8.5],
    [150.9, 2035.9, 11.9], [204.6, 2051.9, 10.5],
    [84.1, 2063.3, 10.6], [109.4, 2071.4, 11.2], [136.2, 2078.8, 12.0],
    [216.6, 2102.4, 8.8], [241.3, 2109.6, 8.6],
  ]) {
    const base = gradeDeckAt(x, z) ?? ((nearbyRailHeightAt(x, z, 16) ?? terrainHeightAt(x, z) - 0.89) + 0.89);
    const axis = new THREE.CylinderGeometry(0.52, 0.37, roof - base - 0.66, 3, 1)
      .rotateY(0.62).translate(x, (base + roof - 0.66) / 2, z);
    meshGeometry(axis, STEEL);
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, minY: base, maxY: roof - 0.66 });
  }

  // The sedum-clad bicycle/retail hall sits to the east of the mapped pedestrian passage.
  const canopySide = [[189.81, 2096.54], [243.46, 2112.20], wing[1], wing[0]];
  lattice(canopySide.slice(0, 3), 8.45, 31);
  lattice([canopySide[0], canopySide[2], canopySide[3]], 8.45, 32);
  const westSplit = [198.3, 2134.1], eastSplit = [236.7, 2146.1];
  const highRoof = plane([wing[0], wing[1], wing[2], eastSplit, westSplit], 8.42, SEDUM);
  const lowRoof = plane([westSplit, eastSplit, wing[3], wing[4]], 7.18, SEDUM);
  const facadeEdges = [[highRoof, [0, 1, 2, 4]], [lowRoof, [1, 2, 3]]];
  for (const [roof, edges] of facadeEdges) {
    for (const i of edges) {
      const a = roof[i], b = roof[(i + 1) % roof.length];
      const base = Math.min(terrainHeightAt(a.x, a.z), terrainHeightAt(b.x, b.z)) - 0.16;
      facade(a.clone().addScaledVector(up, -0.65), b.clone().addScaledVector(up, -0.65), base, 'hall');
      fascia(a, b, 0.7, ZINC);
    }
  }
  fascia(highRoof[3], highRoof[4], 1.25, ZINC);

  for (const [x, z, y, count] of [[219.7, 2121.7, 8.49, 8], [216.5, 2149.0, 7.25, 6]]) {
    const u = new THREE.Vector3(0.96, 0, 0.28), v = new THREE.Vector3(-0.28, 0, 0.96);
    for (let row = -2; row <= 2; row++) {
      for (let col = 0; col < count; col++) {
        const a = new THREE.Vector3(x, y, z).addScaledVector(u, (col - count / 2) * 2.65).addScaledVector(v, row * 1.7);
        const b = a.clone().addScaledVector(u, 2.53), c = b.clone().addScaledVector(v, 1.55);
        quad(a, b, c, a.clone().addScaledVector(v, 1.55), (row + col) % 3 ? 0x293846 : 0x2f4051);
      }
    }
  }

  // A lower covered forecourt ties the zinc clock tower to the hall and leaves the plaza open.
  const forecourt = [[172.9, 2153.7], [189.4, 2134.3], [201.3, 2152.1], [219, 2162.0], [199.2, 2159.6]];
  lattice(forecourt.slice(0, 3), 4.48, 33, true);
  lattice([forecourt[0], forecourt[2], forecourt[4]], 4.48, 34, true);
  lattice([forecourt[2], forecourt[3], forecourt[4]], 4.48, 35, true);

  const towerBase = Math.min(...tower.map(([x, z]) => terrainHeightAt(x, z))) - 0.12;
  const bottom = tower.map(p => point(p, 4.47));
  const centerTower = tower.reduce(([x, z], p) => [x + p[0] / 3, z + p[1] / 3], [0, 0]);
  const taper = (p, amount, y) => point([centerTower[0], centerTower[1]], y).lerp(p.clone().setY(y), amount);
  const clockBottom = bottom.map(p => taper(p, 0.88, 23.8));
  const crown = bottom.map((p, i) => taper(p, 0.79, [33.55, 30.1, 31.65][i]));
  for (let i = 0; i < tower.length; i++) {
    const j = (i + 1) % tower.length;
    facade(bottom[i], bottom[j], towerBase, 'tower');
    quad(bottom[i], bottom[j], clockBottom[j], clockBottom[i], 0x78838a);
    quad(clockBottom[i], clockBottom[j], crown[j], crown[i], ZINC);
    const origin = midpoint(clockBottom[i], clockBottom[j]);
    const across = clockBottom[j].clone().sub(clockBottom[i]).normalize();
    const outward = new THREE.Vector3(across.z, 0, -across.x);
    const towardsCenter = point(centerTower, origin.y).sub(origin);
    if (outward.dot(towardsCenter) > 0) outward.negate();
    const width = clockBottom[i].distanceTo(clockBottom[j]);
    for (let k = 1; k < width * 3; k++) {
      const t = k / (width * 3);
      const foot = bottom[i].clone().lerp(bottom[j], t).addScaledVector(outward, 0.024);
      const top = clockBottom[i].clone().lerp(clockBottom[j], t).addScaledVector(outward, 0.024);
      beam(foot, top, 0.024, 0.024, 0x525d63);
    }
    const faceCenter = midpoint(origin, midpoint(crown[i], crown[j])).addScaledVector(outward, 0.065);
    const radius = width * 0.37;
    const dial = (angle, r) => faceCenter.clone().addScaledVector(across, Math.sin(angle) * r).addScaledVector(up, Math.cos(angle) * r);
    for (let hour = 0; hour < 12; hour++) {
      const angle = hour * Math.PI / 6;
      beam(dial(angle, radius * 0.83), dial(angle, radius), 0.056, 0.047, 0x22282d);
    }
    beam(dial(Math.PI * 0.38, 0.02), dial(Math.PI * 0.38, radius * 0.92), 0.073, 0.06, 0x22282d);
    beam(dial(-Math.PI * 0.34, 0.02), dial(-Math.PI * 0.34, radius * 0.63), 0.101, 0.065, 0x22282d);
  }
  triangle(...crown, ZINC);
  beam(point([173.4, 2109.7], -1.8), point([190, 2114.65], -1.8), 0.9, 1.5, 0x4d5356);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(solid, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const structure = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.84, side: THREE.DoubleSide }));
  structure.name = 'Station roof, hall and clock tower';
  structure.castShadow = true;
  structure.receiveShadow = true;
  group.add(structure);

  const roofGlass = new THREE.BufferGeometry();
  roofGlass.setAttribute('position', new THREE.Float32BufferAttribute(skylights, 3));
  roofGlass.computeVertexNormals();
  group.add(new THREE.Mesh(roofGlass, new THREE.MeshStandardNodeMaterial({
    color: 0x6d8b99, roughness: 0.43, side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false,
  })));
  if (typeof document !== 'undefined') group.add(stationSign());
  const memorial = stationMemorial();
  if (memorial) group.add(memorial);
  group.userData.colliders = colliders;
  return group;
}

function stationMemorial() {
  const passage = getEdeGrade().sites.find(site => site.id === 'oosttunnel-lower')?.profiles[0];
  if (!passage) return null;
  // The 2025 photograph shows the plaque on the west side of the passenger tunnel.
  const distance = passage.covered[0] + 4;
  const wall = gradeSections(passage).find(({ a, b, covered }) => covered && a.distance <= distance && b.distance > distance);
  if (!wall) return null;
  const { a, b } = wall;
  const fraction = (distance - a.distance) / (b.distance - a.distance);
  const plaqueWall = point([a.left.x, a.left.z], a.y).lerp(point([b.left.x, b.left.z], b.y), fraction);
  const normal = new THREE.Vector3(a.x - a.left.x, 0, a.z - a.left.z).normalize();
  plaqueWall.addScaledVector(normal, 0.028);
  return createMemorialPlaque({
    name: 'Plaquette in het NS-station Ede-Wageningen', x: plaqueWall.x, z: plaqueWall.z,
    y: plaqueWall.y + 1.31, heading: Math.atan2(normal.x, normal.z),
    width: 0.54, height: 0.44, base: '#836849', ink: '#33291e', border: '#af9264', metalness: 0.52,
    lines: [
      ['TER GEDACHTENIS', 0.15, 0.095], ['AAN HEN DIE VIELEN', 0.26, 0.095], ['1940–1945', 0.37, 0.095],
      ...['L. BRAAFHART', 'A.A. GAASBEEK', 'A. MERLIJN', 'J. ROZENBOOM'].map((line, i) => [line, 0.52 + i * 0.071, 0.062]),
    ],
    decorations(ctx, w, h) {
      ctx.strokeStyle = '#c5a575';
      ctx.lineWidth = w * 0.005;
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.88, w * 0.012, h * 0.018, 0, 0, Math.PI * 2);
      for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
        ctx.moveTo(w * (0.5 + side * 0.014), h * (0.88 + row * 0.007));
        ctx.quadraticCurveTo(w * (0.5 + side * 0.036), h * (0.849 + row * 0.014),
          w * (0.5 + side * (0.115 - row * 0.018)), h * (0.86 + row * 0.011));
      }
      ctx.stroke();
    },
  });
}

function stationSign() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4e5356';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f3f5f5';
  ctx.font = '600 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Ede-Wageningen', 256, 33);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.375), new THREE.MeshBasicNodeMaterial({ map }));
  sign.name = 'Ede-Wageningen entrance nameplate';
  sign.position.set(181.6, -1.8, 2112.67);
  sign.rotation.y = -0.29;
  return sign;
}
