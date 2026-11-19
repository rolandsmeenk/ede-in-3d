import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv, vertexColor } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { carveBagBuildingPassages } from './bag3d.js';
import { buildingPassageOpenings } from './ede-grade.js';
import { terrainHeightAt } from './terrain.js';
import { ENKA_SURVEY, OUDE_KERK_SURVEY } from './ede-heritage-survey.js';

const UP = new THREE.Vector3(0, 1, 0);
const BRICK = 0x765848;
const ARCH = 0x9b7864;
const STONE = 0xb8a995;
const GLASS = 0x364747;
const RED = 0x883747;

function buildMesh() {
  const positions = [], normals = [], colors = [], coordinates = [], masonry = [];
  const tint = new THREE.Color();
  const normal = new THREE.Vector3(), tangent = new THREE.Vector3(), vertical = new THREE.Vector3();
  function draw(a, b, c, color, pattern) {
    normal.subVectors(b, a).cross(vertical.subVectors(c, a)).normalize();
    if (!normal.lengthSq()) return;
    tangent.crossVectors(Math.abs(normal.y) < 0.95 ? UP : new THREE.Vector3(0, 0, 1), normal).normalize();
    vertical.crossVectors(normal, tangent);
    tint.set(color);
    for (const q of [a, b, c]) {
      positions.push(q.x, q.y, q.z);
      normals.push(normal.x, normal.y, normal.z);
      colors.push(tint.r, tint.g, tint.b);
      coordinates.push(q.dot(tangent) / 1.08, q.dot(vertical) / 0.64);
      masonry.push(pattern);
    }
  }
  return {
    face(rings, color, pattern = 0) {
      rings = rings.map(ring => ring[0].equals(ring.at(-1)) ? ring.slice(0, -1) : ring);
      const a = rings[0][0];
      const n = new THREE.Vector3();
      for (let i = 1; i + 1 < rings[0].length; i++) {
        n.add(new THREE.Vector3().subVectors(rings[0][i], a).cross(new THREE.Vector3().subVectors(rings[0][i + 1], a)));
      }
      if (n.lengthSq() < 1e-9) return;
      const u = new THREE.Vector3().crossVectors(Math.abs(n.clone().normalize().y) < 0.95 ? UP : new THREE.Vector3(0, 0, 1), n).normalize();
      const v = new THREE.Vector3().crossVectors(n, u).normalize();
      const points = rings.flat();
      const [outer, ...holes] = rings.map(ring => ring.map(p => new THREE.Vector2(p.dot(u), p.dot(v))));
      for (const indices of THREE.ShapeUtils.triangulateShape(outer, holes)) {
        const [p, q, r] = indices.map(i => points[i]);
        if (new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p)).dot(n) < 0) draw(p, r, q, color, pattern);
        else draw(p, q, r, color, pattern);
      }
    },
    box(center, width, height, depth, heading, color) {
      const geom = new THREE.BoxGeometry(width, height, depth).rotateY(heading).translate(center.x, center.y, center.z);
      const p = geom.getAttribute('position'), index = geom.getIndex();
      for (let i = 0; i < index.count; i += 3) {
        draw(...[0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, index.getX(i + k))), color, 0);
      }
      geom.dispose();
    },
    mesh() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
      g.setAttribute('masonry', new THREE.Float32BufferAttribute(masonry, 1));
      g.computeBoundingBox();
      const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.84, side: THREE.DoubleSide });
      material.shadowSide = THREE.BackSide;
      material.colorNode = vertexColor().mul(mix(1, texture(createFacadeSurfaceTexture().texture, uv()).r.mul(0.41).add(0.66),
        attribute('masonry', 'float')));
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    },
  };
}

function addSurvey(batch, survey, color) {
  const points = survey.points.map(p => new THREE.Vector3(...p));
  for (const [roof, ...rings] of survey.faces) {
    const shape = rings.map(ring => ring.map(i => points[i]));
    batch.face(shape, color(roof, shape[0]), roof ? 0 : 1);
  }
}

function facade(batch, x, z, tx, tz, outward = 1) {
  const point = (u, y, d = 0) => new THREE.Vector3(x + tx * u + tz * outward * d, y, z + tz * u - tx * outward * d);
  const heading = -Math.atan2(tz, tx);
  const panel = (points, color, depth = 0.035, pattern = 0) => batch.face(
    [points.map(([u, y]) => point(u, y, depth))], color, pattern);
  const rectangle = (u, y, width, height, color, depth, pattern) => panel(
    [[u - width / 2, y], [u + width / 2, y], [u + width / 2, y + height], [u - width / 2, y + height]],
    color, depth, pattern);
  return {
    point, panel, rectangle, heading,
    band(u, y, width, height, depth, color, offset = 0.08) {
      batch.box(point(u, y + height / 2, offset), width, height, depth, heading, color);
    },
    window(u, y, width, height, frame, glass = GLASS, divided = true) {
      rectangle(u, y, width + 0.14, height + 0.13, frame, 0.045);
      rectangle(u, y + 0.08, width, height - 0.03, glass, 0.059);
      if (divided) {
        rectangle(u, y + 0.08, 0.07, height - 0.05, frame, 0.069);
        rectangle(u, y + height * 0.65, width, 0.08, frame, 0.069);
      }
      batch.box(point(u, y - 0.026, 0.117), width + 0.25, 0.105, 0.29, heading, 0x61534c);
    },
  };
}

function arc(width, spring, rise, pointed = false) {
  return Array.from({ length: 13 }, (_, i) => {
    const t = Math.PI * i / 12;
    return [-Math.cos(t) * width / 2, spring + Math.sin(t) ** (pointed ? 0.64 : 1) * rise];
  });
}

function archPanel(face, center, bottom, width, height, rise, outer, inside, depth = 0.08, pointed = true) {
  const shape = (w, h, r, y) => [
    [center - w / 2, y], [center + w / 2, y],
    ...arc(w, y + h - r, r, pointed).reverse().map(([x, y]) => [center + x, y]),
  ];
  face.panel(shape(width, height, rise, bottom), outer, depth);
  face.panel(shape(width - 0.18, height - 0.18, rise - 0.03, bottom + 0.07), inside, depth + 0.023);
}

function gateSign(f, u, y) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '900 54px sans-serif';
  ctx.fillStyle = '#f1eee0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ENKA', 128, 33);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.8), new THREE.MeshStandardMaterial({
    map, transparent: true, roughness: 0.78, depthWrite: false,
  }));
  sign.position.copy(f.point(u, y, 0.28));
  sign.rotation.y = f.heading + Math.PI;
  return sign;
}

function passageColliders(polygon, top) {
  const result = [];
  const { outer } = polygon;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length];
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < 0.25) continue;
    const cuts = buildingPassageOpenings(a, b);
    const edges = [...new Set([0, 1, ...cuts.flatMap(c => [c.from, c.to])])].sort((a, b) => a - b);
    const cs = dx / length, sn = -dz / length, hz = 0.19;
    for (let j = 1; j < edges.length; j++) {
      const from = edges[j - 1], to = edges[j], mid = (from + to) / 2;
      const cx = a.x + mid * dx, cz = a.z + mid * dz, hx = (to - from) * length / 2;
      const seen = cuts.filter(c => mid >= c.from && mid <= c.to);
      const minY = seen.length ? Math.max(...seen.map(c => c.roofAt(cx, cz))) : terrainHeightAt(cx, cz) - 0.35;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      result.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY: top,
        kind: seen.length ? 'passage-lintel' : undefined, obb: { cx, cz, hx, hz, cs, sn } });
    }
  }
  return result;
}

export function createEnkaWesthal(footprints) {
  const group = new THREE.Group(), batch = buildMesh();
  const tx = 0.94712, tz = 0.32087;
  const uOf = p => (p.x - 363.9) * tx + (p.z - 2251.19) * tz;
  const vOf = p => -(p.x - 363.9) * tz + (p.z - 2251.19) * tx;
  addSurvey(batch, ENKA_SURVEY, (roof, face) => {
    if (!roof) return BRICK;
    const span = Math.max(...face.map(p => p.y)) - Math.min(...face.map(p => p.y));
    if (span < 0.45) return 0x85837b;
    const band = face.reduce((a, p) => a + vOf(p) / face.length, 0);
    if (uOf(face[0]) < 79 && band > 12) return span > 1.65 ? 0x354552 : 0x53656a;
    return 0x5d6665;
  });
  const north = facade(batch, 363.9, 2251.19, tx, tz);
  for (let u = 2.55; u < 89; u += 4.42) {
    north.window(u, 0.67, 2.42, 3.16, 0x504843, GLASS);
    north.window(u, 4.88, 2.42, 2.48, RED, GLASS);
    north.band(u + 2.12, 0.23, 0.33, 7.75, 0.28, 0x785947, 0.09);
  }
  north.band(45.0, 7.71, 89.2, 0.20, 0.28, STONE);
  for (const centers of [[94.5, 97.15, 101.0, 103.65, 106.40], [120.3, 122.72, 126.05, 128.47, 131.64]]) {
    for (const u of centers) {
      for (const [y, h] of [[0.58, 3.02], [4.29, 2.36], [7.94, 2.33], [11.63, 2.36]]) north.window(u, y, 1.47, h, RED);
    }
  }
  for (let u = 109.63; u < 117.4; u += 1.12) {
    for (const y of [8.36, 11.75]) north.window(u, y, 0.82, 2.18, RED);
  }
  north.band(113.45, 5.31, 11.65, 0.22, 0.50, STONE, 0.20);
  north.band(113.45, 15.36, 10.10, 0.16, 0.52, STONE, 0.12);
  for (const u of [108.45, 118.25]) {
    north.band(u, 5.51, 0.58, 10.18, 0.41, BRICK, 0.20);
    north.band(u, 15.68, 0.82, 0.25, 0.62, STONE, 0.16);
  }

  // The mapped crossing is straight through this five-metre-deep arch.
  // Its decorative vault follows the restored gate photographs.
  const roadU = 113.25, spring = 1.47, rise = 2.83;
  const inner = arc(6.33, spring, rise);
  const outline = arc(7.06, spring, rise + 0.36);
  const back = facade(batch, 362.26, 2256.00, tx, tz, -1);
  const frontRim = [];
  for (const face of [north, back]) {
    for (let i = 1; i < inner.length; i++) {
      const [[x0,y0],[x1,y1]] = inner.slice(i - 1, i + 1);
      const [[s0,h0],[s1,h1]] = outline.slice(i - 1, i + 1);
      const p0 = [roadU+x0,y0], p1 = [roadU+x1,y1];
      face.panel([p0,p1,[roadU+s1,h1],[roadU+s0,h0]], i % 2 ? ARCH : BRICK, 0.07, 1);
      if (face === north) frontRim.push([p0,p1]);
    }
    for (const direction of [-1, 1]) face.band(roadU + direction * 3.34, 0.06, 0.36, spring - 0.06, 0.26, ARCH, 0.07);
  }
  const archLining = buildMesh();
  const vault = (a, b, tint) => archLining.face([[
    north.point(...a, 0.028), north.point(...b, 0.028), back.point(...b, 0.04), back.point(...a, 0.04),
  ]], tint, 1);
  for (const [a,b] of frontRim) vault(a,b,0x674b3e);
  const left = roadU + inner[0][0], right = roadU + inner.at(-1)[0];
  vault([left,0.025],[left,spring],0x745747);
  vault([right,spring],[right,0.025],0x745747);

  const west = facade(batch, 349.67, 2260.61, -tz, tx, -1);
  for (let u = 2.6; u < 95; u += 4.5) {
    west.window(u, 1.03, 2.61, 3.11, 0x5d5049);
    west.window(u, 5.00, 2.62, 2.05, RED);
    west.band(u + 2.1, 0.32, 0.35, 7.87, 0.30, BRICK);
  }
  west.band(47.5, 7.65, 96, 0.20, 0.34, STONE);
  // East factory face carries the repeated industrial bays below the surveyed sawtooth roof.
  const east = facade(batch, 389.86, 2300.09, -tz, tx);
  for (let u = 4; u < 118; u += 6.54) {
    east.window(u, 1.03, 3.21, 3.4, 0x564b42);
    east.band(u + 3.0, 0.20, 0.46, 7.30, 0.34, BRICK);
  }

  // Use the shared prism clipping code with the curved soffit as the ceiling.
  const reference = north.point(0, 0);
  const u0 = reference.x * tx + reference.z * tz;
  const v0 = -reference.x * tz + reference.z * tx;
  const archPlanes = [[tx,0,tz,u0+left],[-tx,0,-tz,-u0-right],[-tz,0,tx,v0-0.23],[tz,0,-tx,-v0-5.5]];
  for (let i = 1; i < inner.length; i++) {
    const [a,y] = inner[i - 1], [b,z] = inner[i];
    const dx = b-a, dy = z-y;
    archPlanes.push([dy*tx,-dx,dy*tz, dy*(u0+roadU+a)-dx*y - 0.005]);
  }
  const shell = batch.mesh();
  carveBagBuildingPassages(shell.geometry, { removeLandmarks: false,
    customCuts: [{ minX: 465, maxX: 476, minZ: 2284, maxZ: 2295, planes: archPlanes }],
  });
  const lining = archLining.mesh();
  lining.material.dispose();
  lining.material = shell.material;
  group.add(shell, lining);
  const sign = gateSign(north, 113.44, 14.51);
  if (sign) group.add(sign);
  group.userData.colliders = passageColliders(footprints[0], 17.4);
  return group;
}

export function createOudeKerk() {
  const group = new THREE.Group(), batch = buildMesh();
  addSurvey(batch, OUDE_KERK_SURVEY, (roof, face) => {
    if (roof) return face[0].y > 29 ? 0x76695d : 0x62534e;
    if (face.every(p => p.x < -14.8) && Math.max(...face.map(p => p.y)) > 9) return 0x9b8873;
    return 0x9a7863;
  });

  const tower = [[-24.63,-13.34], [-27.15,-3.64], [-17.66,-1.14], [-14.96,-10.74]];
  const center = new THREE.Vector3(-21.1, 0, -7.24);
  for (let i = 0; i < tower.length; i++) {
    const [x,z] = tower[i], [bx,bz] = tower[(i + 1) % tower.length];
    const width = Math.hypot(bx - x, bz - z);
    const wall = facade(batch, x, z, (bx - x) / width, (bz - z) / width, -1);
    wall.band(width / 2, 31.99, width + 0.22, 0.27, 0.25, 0x816854, 0.05);
    wall.band(width / 2, 28.56, width, 0.20, 0.23, 0x786650);
    wall.band(width / 2, 18.59, width, 0.24, 0.24, STONE);
    wall.band(width / 2, 9.87, width, 0.22, 0.22, STONE);
    wall.rectangle(width / 2, 28.76, width - 0.07, 3.18, 0x98715c, 0.085, 1);
    for (let j = 0; j < 12; j++) {
      const u = width * (j + 0.50) / 12;
      for (const [y,h] of [[27.81,0.71],[29.25,1.06],[30.96,0.78]]) {
        archPanel(wall, u, y, width / 12 - 0.06, h, 0.29, 0x6e5548, 0xb48d78, 0.112, y < 30);
      }
    }
    for (const offset of [-2.17, 2.17]) {
      const u = width / 2 + offset;
      archPanel(wall, u, 19.53, 1.72, 7.17, 1.07, 0x716250, 0x362f2a, 0.08);
      archPanel(wall, u, 10.39, 1.76, 7.39, 1.19, 0x776651, 0xac9881, 0.08);
      for (let y = 20.01; y < 25.5; y += 0.65) wall.rectangle(u, y, 1.49, 0.13, 0x807263, 0.15);
      wall.rectangle(u, 19.68, 0.09, 6.54, STONE, 0.16);
      wall.rectangle(u, 10.58, 0.10, 6.12, 0x806b58, 0.15);
    }
    const clock = width / 2, clockY = 24.15;
    wall.rectangle(clock, clockY - 1.035, 2.08, 2.08, 0xe0ceab, 0.16);
    wall.rectangle(clock, clockY - 0.94, 1.87, 1.87, 0x354554, 0.18);
    for (let j = 0; j < 12; j++) {
      const angle = Math.PI * j / 6, dx = Math.sin(angle), dy = Math.cos(angle);
      wall.panel([[clock + 0.60*dx - 0.065*dy, clockY + 0.60*dy + 0.065*dx],
        [clock + 0.84*dx - 0.084*dy, clockY + 0.84*dy + 0.084*dx],
        [clock + 0.84*dx + 0.084*dy, clockY + 0.84*dy - 0.084*dx],
        [clock + 0.60*dx + 0.065*dy, clockY + 0.60*dy - 0.065*dx]], 0xf2e3b7, 0.20);
    }
    for (const [dx, dy] of [[-0.44,0.52],[0.32,-0.31]]) {
      wall.panel([[clock - 0.05,clockY - 0.04], [clock + dx,clockY + dy],
        [clock + dx + 0.09,clockY + dy - 0.07], [clock + 0.05,clockY + 0.05]], 0xf1dfae, 0.215);
    }
  }

  // The BAG crown is flat. The native 0.5 m DSM reaches 69.58 m NAP on the slate spire.
  const octagon = tower.flatMap((a, i) => [0.22, 0.78].map(t => {
    const b = tower[(i + 1) % tower.length];
    return new THREE.Vector3(a[0], 32.15, a[1]).lerp(new THREE.Vector3(b[0], 32.15, b[1]), t);
  }));
  const tier = (s, y) => octagon.map(p => new THREE.Vector3(
    center.x + (p.x - center.x) * s, y, center.z + (p.z - center.z) * s));
  const rings = [octagon, tier(0.70, 35.0), tier(0.12, 45.5), tier(0.018, 47.04)];
  for (let k = 1; k < rings.length; k++) {
    for (let i = 0; i < octagon.length; i++) {
      const j = (i + 1) % octagon.length;
      batch.face([[rings[k-1][i],rings[k-1][j],rings[k][j],rings[k][i]]], i % 2 === 0 ? 0x444951 : 0x50565b);
    }
  }
  batch.box(new THREE.Vector3(center.x, 47.82, center.z), 0.077, 1.57, 0.077, 0, 0x49382a);
  batch.box(new THREE.Vector3(center.x, 48.11, center.z), 0.58, 0.07, 0.075, 0, 0x665039);
  batch.box(new THREE.Vector3(center.x + 0.16, 48.64, center.z), 0.37, 0.20, 0.10, 0, 0xc6a258);

  const churchDoor = facade(batch, -24.63, -13.34, -0.2514, 0.9679, -1);
  archPanel(churchDoor, 5.02, -0.36, 1.81, 3.37, 0.72, STONE, 0x503a2e, 0.115);
  churchDoor.rectangle(5.02, -0.23, 0.06, 2.52, 0x241f1a, 0.15);
  const churchSide = facade(batch, -17.57, 3.94, 0.966, 0.259, -1);
  for (const u of [3.1, 7.4, 11.6, 15.7]) {
    archPanel(churchSide, u, 1.27, 1.84, 5.58, 0.96, 0x9a8772, 0x405052, 0.08);
    churchSide.rectangle(u, 1.37, 0.11, 4.57, STONE, 0.13);
  }

  group.add(batch.mesh());
  return group;
}
