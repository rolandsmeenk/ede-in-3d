import { Float32BufferAttribute } from 'three/webgpu';
import { attribute, mix, texture, uv, vertexColor } from 'three/tsl';
import { createFacadeSurfaceTexture } from './ede-facade-material.js';
import { CivicBatch, along, civicSigns, facePanel, makeGroup, offsetEdge, polygonNormal, wallExtent } from './ede-civic-landmarks.js';
import { getTerrain, terrainHeightAt } from './terrain.js';

const brick = 0x8d5944, timber = 0x373633, green = 0x233b30, cream = 0xd0c3a4;
const tile = 0x4e4b49, thatch = 0x80705b, glass = 0x384449;
let brickTexture;

export function createOudeHofstede() {
  return farm('Kinderboerderij De Oude Hofstede', [
    [HOF_MAIN, brick, tile, -3.7, 'hof'],
    [HOF_BARN, timber, tile, -4.6, 'barn'],
    [HOF_STALL, 0x63564c, tile],
    [HOF_SHED, 0x705342, 0x776157],
  ]);
}

export function createProosdij() {
  return farm('Kinderboerderij De Proosdij', [
    [PRO_MAIN, 0x95604a, tile, -1.08, 'pro'],
    [PRO_SHED, timber, tile, undefined, 'schenkerij'],
    [PRO_BARN, 0x795443, 0x5b5651],
    [PRO_STALL, 0x805443, 0x645a53],
  ]);
}

function farm(name, buildings) {
  const shell = new CivicBatch(), details = new CivicBatch(), colliders = [], labels = [], masonry = [];
  for (const [{ ground, footprint, points, faces }, wallColor, roofColor, thatchLine, style] of buildings) {
    const foundation = (x, z) => getTerrain() ? Math.min(ground, terrainHeightAt(x, z) - 0.16) : ground;
    for (const [roof, ...indices] of faces) {
      const rings = indices.map(ring => ring.map(i => points[i]));
      const ring = rings[0], normal = polygonNormal(ring);
      if (roof) {
        roofSurface(shell, details, rings, roofColor, thatchLine, normal);
        continue;
      }
      const base = ring.some(p => p[1] === ground);
      const { a, b, width } = wallExtent(ring, normal);
      const first = shell.vertices.length / 3;
      shell.polygon(base ? rings.map(outer => outer.map(([x, y, z]) =>
        [x, y === ground ? foundation(x, z) : y, z])) : rings, wallColor);
      if (wallColor !== timber) {
        for (let i = first; i < shell.vertices.length / 3; i++) masonry[i] = 1;
      }
      if (style && base && width > 1.15 && Math.abs(normal.y) < 0.16) {
        const eave = Math.min(...ring.filter(p => p[1] > ground).map(p => p[1]));
        decorateWall(details, labels, style, a, b, normal, width, ground, eave);
      }
    }
    const [outer, ...holes] = footprint.map(ring => ring.map(([x, z]) => ({ x, z })));
    colliders.push({
      minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
      minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)),
      minY: Math.min(...outer.map(p => foundation(p.x, p.z))),
      maxY: Math.max(...points.map(p => p[1])), polygon: { outer, holes },
    });
  }
  const group = makeGroup(name, shell, colliders);
  const mesh = group.children[0];
  const { position, normal } = mesh.geometry.attributes;
  const coordinates = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    coordinates[i * 2] = (position.getX(i) * normal.getZ(i) - position.getZ(i) * normal.getX(i)) / 0.99;
    coordinates[i * 2 + 1] = position.getY(i) / 0.64;
  }
  mesh.geometry.setAttribute('uv', new Float32BufferAttribute(coordinates, 2));
  mesh.geometry.setAttribute('farmMasonry', new Float32BufferAttribute(
    Float32Array.from({ length: position.count }, (_, i) => masonry[i] ?? 0), 1));
  brickTexture ??= createFacadeSurfaceTexture().texture;
  mesh.material.colorNode = vertexColor().mul(mix(1,
    texture(brickTexture, uv()).r.mul(0.86).add(0.29), attribute('farmMasonry', 'float')));
  const detail = details.mesh();
  detail.userData.nearDetail = true;
  group.add(detail);
  const signs = civicSigns(labels, { wide: true });
  if (signs) {
    signs.userData.nearDetail = true;
    group.add(signs);
  }
  return group;
}

// Clip horizontal tile courses against the surveyed roof edges and dormers.
function roofSlice(ring, height, above) {
  const result = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const aIn = above ? a[1] >= height : a[1] <= height;
    const bIn = above ? b[1] >= height : b[1] <= height;
    if (aIn) result.push(a);
    if (aIn === bIn) continue;
    const t = (height - a[1]) / (b[1] - a[1]);
    result.push([a[0] + (b[0] - a[0]) * t, height, a[2] + (b[2] - a[2]) * t]);
  }
  return result;
}

function roofSurface(shell, details, rings, roofColor, thatchLine, normal) {
  const ring = rings[0];
  const low = Math.min(...ring.map(p => p[1])), high = Math.max(...ring.map(p => p[1]));
  const pitched = high - low > 0.45;
  const hip = pitched && ring.length === 3 && thatchLine !== undefined;
  const cutoff = hip ? low : pitched ? thatchLine ?? high : high;
  shell.polygon(rings, hip ? thatch : roofColor);
  if (thatchLine !== undefined && pitched && !hip) {
    shell.polygon([roofSlice(ring, cutoff, true).map(([x, y, z]) => [x, y + 0.034, z])], thatch);
  }
  if (rings.length !== 1 || normal.y < 0.16 || !pitched || hip) return;
  const courses = [0x56514e, 0x3f403f, 0x494745, 0x62554e];
  for (let y = low, i = 0; y + 0.06 < cutoff; y += 0.23, i++) {
    const strip = roofSlice(roofSlice(ring, y, true), Math.min(cutoff, y + 0.047), false);
    if (strip.length > 2) details.polygon([strip.map(([x, h, z]) => [x, h + 0.023, z])], courses[i % courses.length]);
  }
}

function decorateWall(batch, labels, style, a, b, normal, width, ground, eave) {
  const panel = (x, w, y, h, color, offset = 0.035, sheen = 0) => {
    const left = 0.5 + (x - w / 2) / width, right = 0.5 + (x + w / 2) / width;
    if (left > 0.015 && right < 0.985) facePanel(batch, a, b, normal, left, right, ground + y,
      ground + y + h, color, offset, sheen);
  };
  const window = (x, w, y, h, columns = 2) => {
    panel(x, w, y, h, cream);
    panel(x, w - 0.12, y + 0.06, h - 0.12, glass, 0.049, 0.83);
    panel(x, w - 0.03, y + h * 0.54, 0.046, cream, 0.061);
    for (let i = 1; i < columns; i++) panel(x + w * (i / columns - 0.5), 0.045, y, h, cream, 0.061);
    panel(x, w + 0.13, y - 0.052, 0.075, 0x948c7d, 0.082);
  };
  const tall = eave - ground;
  const end = width > 3.15 && width < 10.2 && tall > 3.25;
  if (style === 'barn' || style === 'schenkerij') {
    if (style === 'barn') {
      for (let y = 0.42; y + 0.05 < tall; y += 0.19) panel(0, width * 0.96, y, 0.027, 0x272925);
    } else {
      for (let x = -width / 2 + 0.21; x < width / 2 - 0.21; x += 0.21) {
        panel(x, 0.023, 0.12, tall - 0.17, 0x292a29);
      }
      if (normal.z > 0.25 && width > 9) {
        for (let x = -width / 2 + 1.1; x < width / 2 - 0.7; x += 1.28) window(x, 1.14, 0.48, 1.93, 1);
      }
    }
  }
  if (style !== 'schenkerij' && end) {
    const doorWidth = Math.min(width * 0.57, style === 'barn' ? 2.2 : 2.86);
    const doorHeight = style === 'barn' ? 2.12 : 2.66;
    for (const [color, w, h, out] of [[style === 'barn' ? timber : 0x5a3f34, doorWidth + 0.18, doorHeight + 0.13, 0.037],
      [green, doorWidth, doorHeight, 0.061]]) {
      const arch = [[-w / 2, 0.04], [w / 2, 0.04], [w / 2, h - 0.31]];
      for (let i = 1; i < 10; i++) {
        const angle = Math.PI * i / 10;
        arch.push([Math.cos(angle) * w / 2, h - 0.31 + Math.sin(angle) * 0.31]);
      }
      arch.push([-w / 2, h - 0.31]);
      batch.polygon([arch.map(([x, y]) => {
        const p = along(a, b, 0.5 + x / width);
        return [p.x + normal.x * out, ground + y, p.z + normal.z * out];
      })], color);
    }
    panel(0, 0.042, 0.06, doorHeight - 0.08, 0x172923, 0.072);
    for (let x = -doorWidth / 2 + 0.16; x < doorWidth / 2; x += 0.16) {
      panel(x, 0.018, 0.06, doorHeight - 0.33, 0x314838, 0.073);
    }
    panel(0, 0.91, doorHeight + 0.29, 0.73, green);
    if (style === 'hof' && normal.x < -0.65) {
      const [start, end] = offsetEdge(along(a, b, 0.1), along(a, b, 0.32), normal, 0.085);
      labels.push({ a: start, b: end, lo: ground + 0.98, hi: ground + 1.27, color: '#eaead4',
        textColor: '#293d31', text: 'DE OUDE HOFSTEDE' });
    }
    return;
  }
  if (style === 'hof' || style === 'pro') {
    if (width > 9.0) {
      const large = style === 'pro' && normal.z < 0;
      for (let x = -width / 2 + 1.7; x < width / 2 - 1.05; x += large ? 3.4 : 3.8) {
        window(x, large ? 1.08 : 0.73, large ? 0.74 : 0.6, large ? 1.11 : 0.59, large ? 3 : 2);
      }
    } else if (width > 1.9) {
      panel(0, 1.25, 0.045, Math.min(tall - 0.2, 1.9), green);
    }
  }
}

// 3DBAG LoD 2.2, projected into the Oude Kerk frame with heights relative to 22.54 m NAP.
const HOF_MAIN = { // NL.IMBAG.Pand.0228100000027167
  ground: -8.14,
  footprint: [[[-553.2,3311.19],[-549.3,3322.86],[-532.84,3317.46],[-536.45,3305.81]]],
  points: [
    [-536.45,-5.96,3305.81], [-536.45,-8.14,3305.81], [-553.2,-8.14,3311.19], [-553.2,-6.45,3311.19], [-535.5,-2.55,3308.9],
    [-535.5,-8.14,3308.9], [-552.16,-3.0,3314.28], [-552.16,-8.14,3314.28], [-550.09,-8.14,3320.49], [-550.09,-3.18,3320.49],
    [-549.3,-8.14,3322.86], [-549.3,-5.85,3322.86], [-532.84,-8.14,3317.46], [-532.84,-5.86,3317.46], [-533.78,-2.45,3314.43],
    [-533.78,-8.14,3314.43], [-548.98,0.42,3316.6], [-537.02,0.56,3312.55],
  ],
  faces: [
    [0,[0,1,2,3]], [0,[4,5,1,0]], [0,[6,7,8,9]],
    [0,[9,8,10,11]], [0,[3,2,7,6]], [0,[11,10,12,13]],
    [0,[14,15,5,4]], [0,[13,12,15,14]], [1,[16,6,9]],
    [1,[17,4,0,3,6,16]], [1,[17,14,4]], [1,[13,14,17,16,9,11]],
  ],
};

const HOF_BARN = { // NL.IMBAG.Pand.0228100000028120
  ground: -8.08,
  footprint: [[[-562.37,3346.32],[-554.86,3346.49],[-554.64,3336.56],[-562.16,3336.4]]],
  points: [
    [-554.86,-6.25,3346.49], [-554.86,-8.08,3346.49], [-554.64,-8.08,3336.56], [-554.64,-6.48,3336.56], [-560.49,-4.51,3346.37],
    [-560.49,-8.08,3346.37], [-556.38,-8.08,3346.46], [-556.38,-4.61,3346.46], [-562.16,-6.51,3336.4], [-562.16,-8.08,3336.4],
    [-562.37,-8.08,3346.32], [-562.37,-6.57,3346.32], [-558.42,-8.08,3336.48], [-558.42,-2.42,3336.48], [-558.48,-2.35,3344.19],
  ],
  faces: [
    [0,[0,1,2,3]], [0,[4,5,6,7]], [0,[8,9,10,11]],
    [0,[11,10,5,4]], [0,[3,2,12,13]], [0,[13,12,9,8]],
    [0,[7,6,1,0]], [1,[14,4,7]], [1,[14,13,8,11,4]],
    [1,[13,14,7,0,3]],
  ],
};

const HOF_STALL = { // NL.IMBAG.Pand.0228100000048803
  ground: -8.07,
  footprint: [[[-549.76,3353.55],[-548.64,3362.0],[-541.46,3361.04],[-541.89,3357.76],[-543.13,3357.92],[-543.82,3352.76]]],
  points: [
    [-548.64,-5.74,3362.0], [-548.64,-8.07,3362.0], [-541.46,-8.07,3361.04], [-541.46,-5.68,3361.04], [-549.76,-6.3,3353.55],
    [-549.76,-8.07,3353.55], [-549.23,-8.07,3357.58], [-549.23,-6.27,3357.58], [-543.82,-6.24,3352.76], [-543.82,-8.07,3352.76],
    [-543.26,-6.2,3356.92], [-543.26,-8.07,3356.92], [-541.59,-8.07,3360.07], [-541.59,-4.62,3360.07], [-541.89,-8.07,3357.76],
    [-541.89,-5.72,3357.76], [-548.77,-8.07,3361.01], [-548.77,-4.64,3361.01], [-543.13,-5.72,3357.92], [-543.13,-8.07,3357.92],
  ],
  faces: [
    [0,[0,1,2,3]], [0,[4,5,6,7]], [0,[8,9,5,4]],
    [0,[10,11,9,8]], [0,[3,2,12,13]], [0,[13,12,14,15]],
    [0,[7,6,16,17]], [0,[17,16,1,0]], [0,[18,19,11,10]],
    [0,[15,14,19,18]], [1,[17,0,3,13]], [1,[7,10,8,4]],
    [1,[15,18,10,7,17,13]],
  ],
};

const HOF_SHED = { // NL.IMBAG.Pand.0228100000064178
  ground: -8.26,
  footprint: [[[-566.7,3309.96],[-565.34,3318.93],[-566.72,3319.17],[-566.41,3321.17],[-564.5,3320.87],[-564.19,3322.82],[-559.87,3322.13],[-561.78,3308.16],[-564.11,3308.53],[-563.95,3309.54]]],
  points: [
    [-563.43,-4.56,3308.42], [-563.43,-6.82,3308.42], [-563.43,-8.26,3308.42], [-564.11,-8.26,3308.53], [-564.11,-4.85,3308.53],
    [-563.95,-8.26,3309.54], [-563.95,-4.85,3309.54], [-566.7,-8.26,3309.96], [-566.7,-6.03,3309.96], [-565.37,-8.26,3318.71],
    [-565.37,-6.04,3318.71], [-561.89,-8.26,3318.41], [-561.89,-4.56,3318.41], [-560.4,-8.26,3318.28], [-560.4,-5.64,3318.28],
    [-561.72,-8.26,3308.64], [-561.72,-6.86,3308.64], [-561.72,-5.76,3308.64], [-563.29,-6.95,3309.31], [-563.29,-4.56,3309.31],
    [-561.78,-8.26,3308.16], [-561.78,-6.79,3308.16],
  ],
  faces: [
    [0,[0,1,2,3,4]], [0,[4,3,5,6]], [0,[6,5,7,8]],
    [0,[8,7,9,10]], [0,[10,9,11,12]], [0,[12,11,13,14]],
    [0,[14,13,15,16,17]], [0,[17,16,18,19]], [0,[19,18,1,0]],
    [0,[16,15,20,21]], [0,[21,20,2,1]], [1,[17,19,12,14]],
    [1,[19,0,4,6,8,10,12]], [1,[21,1,18,16]],
  ],
};

const PRO_MAIN = { // NL.IMBAG.Pand.0228100000049983
  ground: -6.91,
  footprint: [[[-1363.91,636.22],[-1344.75,648.81],[-1337.45,637.75],[-1356.62,625.01]]],
  points: [
    [-1362.25,-1.12,633.66], [-1362.25,-6.91,633.66], [-1363.91,-6.91,636.22], [-1363.91,-4.05,636.22], [-1344.75,-6.91,648.81],
    [-1344.75,-3.93,648.81], [-1337.45,-4.68,637.75], [-1337.45,-6.91,637.75], [-1356.62,-6.91,625.01], [-1356.62,-4.63,625.01],
    [-1350.01,-1.74,632.79], [-1350.01,-1.4,632.79], [-1351.4,-1.41,632.25], [-1360.98,-3.79,637.85], [-1360.98,-1.35,637.85],
    [-1359.39,-1.39,635.9], [-1349.06,-3.66,631.19], [-1349.06,-1.37,631.19], [-1353.82,-1.38,628.47], [-1353.82,-3.26,628.47],
    [-1354.78,-2.02,629.28], [-1354.78,-1.4,629.28], [-1352.67,-1.39,629.77], [-1352.67,-2.81,629.77], [-1352.77,-1.41,631.34],
    [-1342.79,-0.52,645.85], [-1342.79,-6.91,645.85], [-1339.68,-6.91,641.13], [-1339.68,-0.51,641.13], [-1353.76,-3.81,642.66],
    [-1353.76,-1.36,642.66], [-1358.5,-1.07,627.9], [-1358.5,-6.91,627.9], [-1353.16,-3.45,642.62], [-1353.16,-1.37,642.62],
    [-1351.78,-1.41,640.98], [-1343.04,2.3,642.15], [-1357.91,2.32,632.25],
  ],
  faces: [
    [0,[0,1,2,3]], [0,[3,2,4,5]], [0,[6,7,8,9]],
    [0,[10,11,12]], [0,[13,14,15]], [0,[11,10,16,17]],
    [0,[18,19,20,21]], [0,[22,23,19,18]], [0,[17,16,23,22]],
    [0,[21,20,24]], [0,[25,26,27,28]], [0,[14,13,29,30]],
    [0,[31,32,1,0]], [0,[5,4,26,25]], [0,[9,8,32,31]],
    [0,[28,27,7,6]], [0,[30,29,33,34]], [0,[34,33,35]],
    [1,[28,36,25]], [1,[0,37,31]], [1,[5,25,36,37,0,3],[35,33,29,13,15]],
    [1,[28,6,9,31,37,36],[20,19,23,16,10,12,24]], [1,[34,35,15,14,30]], [1,[24,12,11,17,22,18,21]],
  ],
};

const PRO_SHED = { // NL.IMBAG.Pand.0228100000052209
  ground: -7.04,
  footprint: [[[-1302.65,603.15],[-1310.23,606.01],[-1308.06,610.83],[-1307.04,613.0],[-1312.13,615.36],[-1319.46,618.68],[-1311.92,635.36],[-1292.18,626.48]]],
  points: [
    [-1308.06,-4.03,610.83], [-1308.06,-7.04,610.83], [-1307.23,-7.04,612.6], [-1307.23,-4.02,612.6], [-1307.23,-3.99,612.6],
    [-1307.18,-3.99,612.57], [-1310.23,-4.02,606.01], [-1310.23,-7.04,606.01], [-1306.41,-1.66,604.57], [-1306.41,-7.04,604.57],
    [-1308.16,-1.68,633.67], [-1308.16,-7.04,633.67], [-1304.43,-7.04,632.0], [-1304.43,-4.04,632.0], [-1311.92,-4.05,635.36],
    [-1311.92,-7.04,635.36], [-1307.04,-3.99,613.0], [-1307.04,-7.04,613.0], [-1312.13,-7.04,615.36], [-1312.13,-4.0,615.36],
    [-1292.18,-3.87,626.48], [-1292.18,-7.04,626.48], [-1302.65,-7.04,603.15], [-1302.65,-3.98,603.15], [-1319.46,-4.01,618.68],
    [-1319.46,-7.04,618.68], [-1315.76,-1.67,617.0], [-1315.76,-7.04,617.0], [-1295.68,-1.66,628.05], [-1295.68,-7.04,628.05],
    [-1299.42,-4.03,629.74], [-1299.42,-7.04,629.74], [-1304.54,-7.04,631.75], [-1304.54,-4.04,631.75], [-1312.13,-3.97,615.36],
    [-1299.45,-7.04,629.66], [-1299.45,-4.03,629.66],
  ],
  faces: [
    [0,[0,1,2,3]], [0,[3,4,5]], [0,[6,7,1,0]],
    [0,[8,9,7,6]], [0,[10,11,12,13]], [0,[14,15,11,10]],
    [0,[16,17,18,19]], [0,[4,3,2,17,16]], [0,[20,21,22,23]],
    [0,[24,25,15,14]], [0,[26,27,25,24]], [0,[28,29,21,20]],
    [0,[23,22,9,8]], [0,[30,31,29,28]], [0,[13,12,32,33]],
    [0,[19,34,33]], [0,[34,19,18,27,26]], [0,[33,32,35,36]],
    [0,[36,35,31,30]], [1,[10,26,24,14]], [1,[23,8,28,20]],
    [1,[34,26,10,13,33]], [1,[33,36,5,4,16,19]], [1,[36,30,28,8,6,0,3,5]],
  ],
};

const PRO_BARN = { // NL.IMBAG.Pand.0228100000048949
  ground: -6.97,
  footprint: [[[-1327.07,648.66],[-1323.29,656.91],[-1308.84,650.18],[-1312.5,642.01]]],
  points: [
    [-1321.51,-3.95,656.08], [-1321.51,-6.97,656.08], [-1308.84,-6.97,650.18], [-1308.84,-3.88,650.18], [-1323.29,-4.11,656.91],
    [-1323.29,-6.97,656.91], [-1321.51,-3.42,656.08], [-1327.07,-4.07,648.66], [-1327.07,-6.97,648.66], [-1323.71,-2.01,647.13],
    [-1323.71,-2.78,647.13], [-1322.34,-2.71,649.53], [-1322.34,0.61,649.53], [-1312.5,-1.88,642.01], [-1312.5,-6.97,642.01],
    [-1323.71,-6.97,647.13], [-1321.61,-2.66,650.8], [-1321.61,-0.44,650.8], [-1311.4,-6.97,644.46], [-1311.4,0.67,644.46],
    [-1320.79,-2.57,653.65], [-1320.79,-2.83,653.65], [-1321.02,-3.02,654.44],
  ],
  faces: [
    [0,[0,1,2,3]], [0,[4,5,1,0,6]], [0,[7,8,5,4]],
    [0,[9,10,11,12]], [0,[13,14,15,10,9]], [0,[10,15,8,7]],
    [0,[12,11,16,17]], [0,[3,2,18,19]], [0,[19,18,14,13]],
    [0,[20,21,22]], [0,[6,0,22]], [0,[17,16,21,20]],
    [1,[17,20,22,0,3,19,12]], [1,[19,13,9,12]], [1,[21,16,11,10,7,4,6,22]],
  ],
};

const PRO_STALL = { // NL.IMBAG.Pand.0228100000034592
  ground: -7.0,
  footprint: [[[-1344.46,660.09],[-1339.43,663.38],[-1331.75,651.65],[-1336.79,648.31]]],
  points: [
    [-1339.43,-3.69,663.38], [-1339.43,-7.0,663.38], [-1331.75,-7.0,651.65], [-1331.75,-3.62,651.65], [-1341.64,-1.06,661.93],
    [-1341.64,-7.0,661.93], [-1336.91,-4.49,648.49], [-1336.91,-7.0,648.49], [-1344.46,-7.0,660.09], [-1344.46,-4.28,660.09],
    [-1333.99,-1.12,650.48], [-1333.99,-7.0,650.48], [-1333.84,-1.12,650.26], [-1333.84,-7.0,650.26],
  ],
  faces: [
    [0,[0,1,2,3]], [0,[4,5,1,0]], [0,[6,7,8,9]],
    [0,[9,8,5,4]], [0,[10,11,7,6]], [0,[12,13,11,10]],
    [0,[3,2,13,12]], [1,[10,6,9,4]], [1,[3,12,10,4,0]],
  ],
};
