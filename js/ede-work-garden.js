import * as THREE from 'three/webgpu';
import { texture, uv, vertexColor } from 'three/tsl';
import { CivicBatch, along, facePanel, makeGroup, polygonNormal, wallColliders, wallExtent } from './ede-civic-landmarks.js';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { terrainHeightAt } from './terrain.js';

// 3DBAG LoD 2.2, pand 0228100000077693. Coordinates use the Oude Kerk NAP datum.
const vertices = [
  [-38.14,9.19,-232.12], [-38.14,-1.51,-232.12], [-47.99,-1.51,-232.7], [-47.99,9.22,-232.7],
  [-49.95,-1.51,-232.47], [-49.95,9.23,-232.47], [-48.77,-1.51,-221.57], [-48.77,9.23,-221.57],
  [-30.48,4.03,-223.56], [-30.48,-1.51,-223.56], [-30.86,-1.51,-226.19], [-30.86,4.04,-226.19],
  [-31.4,3.03,-229.91], [-31.4,-1.51,-229.91], [-31.69,-1.51,-231.97], [-31.69,3.03,-231.97],
  [-31.4,7.67,-229.91], [-31.79,3.02,-229.83], [-31.79,7.71,-229.83], [-30.86,7.66,-226.19],
  [-31.85,4.1,-233.03], [-31.85,-1.51,-233.03], [-35.74,-1.51,-232.46], [-35.74,4.13,-232.46],
  [-36.95,-1.51,-222.86], [-36.95,5.96,-222.86], [-36.95,9.2,-222.86], [-32.06,4.08,-228.84],
  [-32.06,3.02,-228.84], [-32.76,3.01,-228.46], [-32.76,4.1,-228.46], [-32.06,7.75,-228.84],
  [-31.4,4.06,-225.86], [-31.4,7.72,-225.86], [-34.82,6.0,-223.77], [-34.82,2.98,-223.77],
  [-34.38,2.99,-224.04], [-34.38,6.01,-224.04], [-35.61,2.98,-231.65], [-35.61,4.12,-231.65],
  [-35.61,6.01,-231.65], [-37.82,5.98,-232.16], [-37.82,9.19,-232.16], [-31.9,4.07,-223.41],
  [-31.9,3.01,-223.41], [-31.9,-1.51,-223.41], [-31.69,4.09,-231.97], [-31.54,7.69,-229.13],
  [-31.54,3.02,-229.13], [-35.74,6.01,-232.46], [-37.82,-1.51,-232.16], [-34.23,-1.51,-223.16],
  [-34.23,2.99,-223.16], [-34.23,6.01,-223.16], [-34.32,6.01,-223.67], [-34.32,2.99,-223.67],
];

const surfaces = [
  null, [0,[0,1,2,3]], [0,[3,2,4,5]], [0,[5,4,6,7]], [0,[8,9,10,11]],
  [0,[12,13,14,15]], [0,[16,12,17,18]], [0,[19,11,10,13,12,16]], [0,[20,21,22,23]], [0,[7,6,24,25,26]],
  [0,[27,28,29,30]], [0,[31,27,32,33]], [0,[34,35,36,37]], [0,[37,36,38,39,40]], [0,[26,25,41,42]],
  [0,[43,44,45,9,8]], [0,[39,38,15,46]], [0,[47,48,28,27,31]], [0,[18,17,48,47]], [0,[49,23,22,50,41]],
  [0,[40,39,23,49]], [0,[42,41,50,1,0]], [0,[25,24,51,52,53]], [0,[52,51,45,44]], [0,[54,55,35,34]],
  [0,[53,52,55,54]], [0,[33,32,11,19]], [0,[46,15,14,21,20]], [0,[30,29,44,43]], [1,[42,0,3,5,7,26]],
  [1,[53,54,34,37,40,49,41,25]], [1,[33,19,16,18,47,31]], [1,[44,29,28,48,17,12,15,38,36,35,55,52]], [1,[46,20,23,39]], [1,[30,43,8,11,32,27]],
];

function storefront(batch, masonry, rings, a, b, width, normal, ground) {
  const point = (u, y, depth = 0) => {
    const p = along(a, b, u / width);
    return [p.x + normal.x * depth, y, p.z + normal.z * depth];
  };
  const panel = (u, v, lo, hi, color, depth, sheen) =>
    facePanel(batch, a, b, normal, u / width, v / width, lo, hi, color, depth, sheen);

  // The street-facing glazing has dark profiles and a continuous row of high transoms.
  const bays = [
    [0.48, 2.20], [2.27, 4.03], [4.10, 5.87], [5.94, 7.73], [7.80, 9.95]
  ].map(([u, v], i) => ({ u, v, low: ground + (i === 1 ? 0.06 : 0.22), high: ground + 3.30,
    transom: ground + 2.55, storefront: true, door: i === 1 }));
  // shortcut: The upper openings are estimated from the residential floor heights until an exterior view is available.
  for (const floor of [4.56, 7.54]) {
    for (const u of [0.95, 4.52, 8.08]) {
      bays.push({ u, v: u + 1.73, low: ground + floor, high: ground + floor + 1.45 });
    }
  }
  const apertures = bays.map(({ u, v, low, high }) =>
    [point(u, low), point(v, low), point(v, high), point(u, high)]);
  masonry.polygon([...rings, ...apertures], 0x906a59);
  panel(0.04, width - 0.04, ground + 3.37, ground + 3.53, 0xc0b8aa, 0.023);

  for (const [i, bay] of bays.entries()) {
    const { u, v, low, high, transom, door } = bay;
    const depth = bay.storefront ? -0.12 : -0.19;
    const opening = apertures[i];
    const inset = [point(u, low, depth), point(v, low, depth), point(v, high, depth), point(u, high, depth)];
    for (let edge = 0; edge < 4; edge++) {
      const next = (edge + 1) % 4;
      batch.quad(opening[edge], opening[next], inset[next], inset[edge], bay.storefront ? 0x4a4340 : 0xaa8a78);
    }

    panel(u, v, low, high, 0x242727, depth);
    const glass = bay.storefront ? 0x414b4a : 0x465458;
    const bar = transom ?? low + (high - low) * 0.68;
    panel(u + 0.064, v - 0.064, low + 0.068, bar - 0.032, glass, depth + 0.006, 0.65);
    panel(u + 0.064, v - 0.064, bar + 0.032, high - 0.068, 0x607172, depth + 0.006, 0.7);
    const middle = (u + v) / 2;
    panel(middle - 0.021, middle + 0.021, door || !bay.storefront ? low : bar, high, 0x282a28, depth + 0.014);
    if (door) {
      panel(middle + 0.13, middle + 0.37, low + 0.91, low + 0.95, 0xa29c8d, depth + 0.025);
      panel(middle - 0.37, middle - 0.13, low + 0.91, low + 0.95, 0xa29c8d, depth + 0.025);
    } else if (!bay.storefront) {
      panel(u - 0.08, v + 0.08, low - 0.06, low + 0.012, 0xbcb3a4, 0.045);
    }
  }

  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 25px Arial, sans-serif';
  ctx.fillStyle = '#f5f2e9';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Work Garden', 96, 20, 184);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.235),
    new THREE.MeshStandardNodeMaterial({ map, alphaTest: 0.4, roughness: 0.82 }));
  sign.name = 'Work Garden window lettering';
  sign.position.set(...point(6.85, ground + 1.59, -0.109));
  sign.rotation.y = Math.atan2(normal.x, normal.z);
  return sign;
}

export function createWorkGarden() {
  const batch = new CivicBatch(), masonry = new CivicBatch(), colliders = [];
  let lettering;
  for (const [index, face] of surfaces.entries()) {
    if (!face) continue;
    const [roof, ...rings] = face;
    const polygons = rings.map(ring => ring.map(i => vertices[i]));
    if (roof) {
      batch.polygon(polygons, 0x595954);
      continue;
    }
    const points = polygons[0], normal = polygonNormal(points);
    const { a, b, width } = wallExtent(points, normal);
    const low = Math.min(...points.map(p => p[1])), high = Math.max(...points.map(p => p[1]));
    const middle = along(a, b, 0.5);
    const pavement = terrainHeightAt(middle.x + normal.x * 0.7, middle.z + normal.z * 0.7);
    if (index === 3) {
      lettering = storefront(batch, masonry, polygons, a, b, width, normal, Math.max(low, pavement));
    } else {
      masonry.polygon(polygons, 0x8b6b5e);
    }
    const foundation = low < pavement + 1 ? Math.min(low, pavement - 0.06) : low;
    if (foundation < low) facePanel(batch, a, b, normal, 0, 1, foundation, low, 0x675b54, 0);
    colliders.push(...wallColliders(a, b, foundation, high));
  }
  const group = makeGroup('Work Garden', batch, colliders);
  const walls = masonry.mesh();
  const positions = walls.geometry.getAttribute('position');
  const normals = walls.geometry.getAttribute('normal');
  const coords = [];
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i) * normals.getZ(i) - positions.getZ(i) * normals.getX(i);
    coords.push(u / 0.88, positions.getY(i) / 0.61);
  }
  walls.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
  const brick = texture(createFacadeSurfaceTexture().texture, uv()).r;
  walls.material.colorNode = vertexColor().mul(brick.mul(0.58).add(0.49));
  group.add(walls);
  group.userData.bagId = '0228100000077693';
  if (lettering) group.add(lettering);
  return group;
}
