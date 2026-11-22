import * as THREE from 'three/webgpu';
import { CivicBatch, makeGroup, wallColliders } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';

const granite = 0x34383a;
const bronze = 0x474f46;
const iron = 0x303537;
const wood = 0x855737;
const corten = 0x784d38;

function box(batch, x, y, z, w, h, d, color, tilt = 0) {
  batch.solid(new THREE.BoxGeometry(w, h, d).rotateX(-tilt).translate(x, y, z), color);
}

function round(batch, x, y, z, top, bottom, height, color, sides = 16) {
  batch.solid(new THREE.CylinderGeometry(top, bottom, height, sides).translate(x, y, z), color);
}

function branch(batch, a, b, startRadius, endRadius, color) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  batch.solid(new THREE.CylinderGeometry(endRadius, startRadius, delta.length(), 8)
    .applyQuaternion(rotation).translate(...start.lerp(end, 0.5)), color);
}

function ellipse(batch, x, y, z, w, h, d, color, angle = 0) {
  batch.solid(new THREE.SphereGeometry(1, 12, 8).scale(w, h, d)
    .rotateZ(angle).translate(x, y, z), color);
}

export function memorialLettering(labels) {
  if (!labels.length || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const columns = Math.min(labels.length, 8), rows = Math.ceil(labels.length / columns);
  const cellW = 256, cellH = 160;
  canvas.width = columns * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const positions = [], uv = [];
  labels.forEach(({ lines, x = 0, y, z, w, h, tilt = 0, color = '#ddd1ad', marks }, index) => {
    const col = index % columns, row = Math.floor(index / columns);
    const left = col * cellW, top = row * cellH;
    const step = Math.min(100, (cellH - 8) / (lines?.length || 1));
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(step * 0.7)}px Georgia, serif`;
    lines?.forEach((line, i) => ctx.fillText(line,
      left + cellW / 2, top + cellH / 2 + (i - (lines.length - 1) / 2) * step, cellW - 14));
    if (marks) {
      ctx.save();
      ctx.translate(left, top);
      marks(ctx, cellW, cellH);
      ctx.restore();
    }
    const dy = Math.cos(tilt) * h / 2, dz = Math.sin(tilt) * h / 2;
    const corners = [[x - w / 2, y - dy, z + dz], [x + w / 2, y - dy, z + dz],
      [x + w / 2, y + dy, z - dz], [x - w / 2, y + dy, z - dz]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[i]);
      uv.push((col + (i === 1 || i === 2 ? 1 : 0)) / columns,
        1 - (row + (i < 2 ? 1 : 0)) / rows);
    }
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map, alphaTest: 0.4, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  mesh.receiveShadow = true;
  mesh.userData.nearDetail = 32;
  return mesh;
}

function prop(site, draw) {
  const batch = new CivicBatch(), labels = [], colliders = [];
  const ground = terrainHeightAt(site.x, site.z);
  const c = Math.cos(site.heading), s = Math.sin(site.heading);
  const world = (x, z) => ({ x: site.x + x * c + z * s, z: site.z - x * s + z * c });
  const terrain = (x, z) => {
    const p = world(x, z);
    return terrainHeightAt(p.x, p.z) - ground;
  };
  const block = (x, z, width, depth, y, height) => colliders.push(...wallColliders(
    world(x - width / 2, z), world(x + width / 2, z), ground + y - 0.08, ground + y + height, depth));
  draw(batch, labels, block, terrain);
  const group = makeGroup(site.name, batch, colliders);
  const detail = memorialLettering(labels);
  if (detail) group.add(detail);
  return group;
}

function engravedRows(ctx, x, y, columns, rows, stepX, stepY) {
  for (let col = 0; col < columns; col++) for (let row = 0; row < rows; row++) {
    const px = x + col * stepX, py = y + row * stepY;
    ctx.fillRect(px, py, stepX * (0.32 + (row * 7 + col * 3) % 11 / 30), 0.55);
    ctx.fillRect(px + stepX * 0.76, py, stepX * 0.14, 0.55);
  }
}

function jewish(batch, labels, block) {
  const tilt = 1.40, y = 0.63;
  box(batch, 0, -0.02, 0, 3.05, 0.12, 3.05, 0x77726a);
  for (const x of [-0.71, 0.71]) for (const z of [-0.66, 0.66]) {
    const height = z > 0 ? 0.45 : 0.67;
    box(batch, x, height / 2, z, 0.29, height, 0.29, granite);
  }
  box(batch, 0, y - 0.072, -0.011, 2.06, 2.06, 0.132, 0x292b2a, tilt);
  batch.quad([-1, y - 0.17, 0.99], [1, y - 0.17, 0.99], [1, y + 0.17, -0.99],
    [-1, y + 0.17, -0.99], 0x282d30, 0.85);
  labels.push({ y: y + 0.004, z: 0, w: 1.97, h: 1.97, tilt, color: '#d8d4c6',
    marks(ctx) {
      ctx.font = 'bold 5px Georgia, serif';
      ctx.fillText('VERGETEN IS BALLINGSCHAP, HERINNEREN VERLOSSING', 128, 11, 224);
      engravedRows(ctx, 13, 21, 4, 44, 59, 2.75);
      ctx.font = 'bold 5px Georgia, serif';
      ctx.fillText('Moge hun ziel gebundeld worden in de bundel van het eeuwige leven', 128, 150, 223);
    } });
  block(0, 0, 2.04, 2.04, 0, 0.79);
}

function remembranceSeat(batch, labels, block, terrain, x, z, w, inscribed = false) {
  const y = terrain(x, z);
  for (const sign of [-1, 1]) {
    const legX = x + sign * (w / 2 - 0.09);
    box(batch, legX, y + 0.21, z + 0.16, 0.036, 0.42, 0.036, iron);
    box(batch, legX, y + 0.44, z - 0.20, 0.038, 0.88, 0.039, iron);
    box(batch, legX, y + 0.65, z - 0.01, 0.052, 0.041, 0.43, iron);
  }
  for (const offset of [-0.16, 0, 0.16]) box(batch, x, y + 0.46, z + offset, w, 0.043, 0.145, wood);
  box(batch, x, y + 0.68, z - 0.18, w, 0.125, 0.039, wood);
  box(batch, x, y + 0.83, z - 0.19, w, 0.125, 0.039, wood);
  if (inscribed) {
    labels.push({ lines: ['DE GEEST OVERWINT'], x, y: y + 0.67, z: z - 0.156, w: 1.23, h: 0.12,
      color: '#cfdbd7' });
    labels.push({ x, y: y + 0.83, z: z - 0.166, w: 0.18, h: 0.115, color: '#cfdbd7',
      marks(ctx) {
        for (let i = 0; i < 5; i++) {
          const angle = i * Math.PI * 0.4;
          ctx.beginPath();
          ctx.ellipse(128 + Math.sin(angle) * 35, 80 + Math.cos(angle) * 34, 25, 17, -angle + Math.PI / 2, 0, 2 * Math.PI);
          ctx.fill();
        }
      } });
  }
  block(x, z, w, 0.46, y, 0.89);
}

function indie(batch, labels, block, terrain) {
  box(batch, 0, 0.51, 0, 0.57, 1.14, 0.46, granite);
  box(batch, 0, 1.08, 0, 0.60, 0.035, 0.48, 0x474d4e);
  labels.push({ lines: ['15 augustus 1945'], y: 0.92, z: 0.233, w: 0.52, h: 0.08, color: '#b8b9ad' });
  branch(batch, [-0.04, 1.1, 0], [0.09, 1.48, -0.01], 0.22, 0.116, bronze);
  branch(batch, [0.09, 1.43, -0.01], [-0.13, 1.77, -0.01], 0.116, 0.065, bronze);
  branch(batch, [-0.13, 1.75, -0.01], [-0.30, 2.23, 0.02], 0.061, 0.023, bronze);
  branch(batch, [-0.15, 1.78, -0.01], [0.24, 1.91, -0.01], 0.08, 0.046, bronze);
  branch(batch, [0.24, 1.91, -0.01], [0.45, 2.08, -0.04], 0.046, 0.015, bronze);
  const plumage = 0xb7bdb5, darkFeather = 0x525858;
  ellipse(batch, 0.15, 2.08, 0.045, 0.10, 0.18, 0.11, plumage, -0.2);
  ellipse(batch, 0.15, 2.22, 0.10, 0.065, 0.07, 0.067, plumage);
  ellipse(batch, 0.15, 2.21, 0.166, 0.023, 0.014, 0.031, 0x4c4e43);
  ellipse(batch, 0.15, 2.205, 0.199, 0.021, 0.018, 0.016, 0xebe8d9);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      ellipse(batch, 0.15 + side * (0.09 + i * 0.046), 2.09 + i * 0.030,
        0.019 - i * 0.006, 0.037, 0.087 + i * 0.008, 0.023, darkFeather, side * -0.63);
      ellipse(batch, 0.15 + side * (0.083 + i * 0.035), 2.14 + i * 0.027,
        0.036 - i * 0.005, 0.039, 0.070, 0.026, plumage, side * -0.64);
    }
    branch(batch, [0.15 + 0.04 * side, 1.99, 0.06], [0.15 + 0.04 * side, 1.93, 0.062], 0.012, 0.009, bronze);
  }
  block(0, 0, 0.61, 0.49, 0, 1.13);
  // https://www.ede.nl/nieuws/burgemeester-verhulst-onthult-indie-bank
  remembranceSeat(batch, labels, block, terrain, 0, -4.5, 1.78, true);
  remembranceSeat(batch, labels, block, terrain, -1.58, -4.3, 0.59);
  remembranceSeat(batch, labels, block, terrain, 1.58, -4.3, 0.59);
}

function military(batch, labels, block) {
  box(batch, 0, -0.07, 0.11, 2.19, 0.15, 1.98, 0x6b4331);
  box(batch, 0, 0.02, 0.07, 1.93, 0.06, 1.72, corten);
  box(batch, 0, 0.97, 0, 0.85, 1.92, 0.075, corten);
  box(batch, 0, 0.82, 0.049, 0.67, 0.68, 0.021, 0xc3c6bc);
  labels.push({ y: 1.46, z: 0.041, w: 0.79, h: 0.28, color: '#25251f',
    lines: ['GEVALLEN VOOR', 'HET VADERLAND', '1940 – 1949'] });
  labels.push({ y: 1.76, z: 0.041, w: 0.2, h: 0.19, color: '#25251f',
    marks(ctx) {
      ctx.translate(128, 80);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-16, -10);
        ctx.lineTo(-36, -56);
        ctx.lineTo(36, -56);
        ctx.lineTo(16, -10);
        ctx.fill();
        ctx.rotate(Math.PI / 2);
      }
    } });
  labels.push({ y: 0.82, z: 0.061, w: 0.64, h: 0.65, color: '#494940',
    marks(ctx) {
      ctx.font = 'bold 6px Georgia, serif';
      ctx.fillText('KONINKLIJKE LANDMACHT', 59, 6, 113);
      ctx.fillText('KONINKLIJKE MARINE', 189, 6, 113);
      engravedRows(ctx, 3, 13, 2, 12, 129, 4);
      ctx.fillText('KONINKLIJK NEDERLANDS INDISCH LEGER', 190, 71, 117);
      engravedRows(ctx, 132, 78, 1, 15, 123, 4);
      engravedRows(ctx, 3, 61, 1, 23, 126, 4);
    } });
  block(0, 0, 0.85, 0.11, 0, 1.93);
}

function canadian(batch, labels, block) {
  round(batch, 0, -0.005, 0, 2.08, 2.10, 0.13, 0x595853, 32);
  const corners = [[-0.47, 0.14, 0.33], [0.47, 0.14, 0.33], [0, 0.14, -0.49]];
  for (let i = 0; i < 3; i++) {
    const a = corners[i], b = corners[(i + 1) % 3], top = [0, 1.05, 0];
    batch.triangle(a, b, top, [0xb9bec0, 0xa9b0b4, 0xc0c4c5][i], 0.90);
    for (let j = 0; j < 12; j++) {
      const angle = i * Math.PI * 2 / 3 + (j - 6) * 0.105;
      const next = angle + 0.105;
      batch.triangle([0, 0.067, 0], [1.93 * Math.sin(angle), 0.067, 1.93 * Math.cos(angle)],
        [1.93 * Math.sin(next), 0.067, 1.93 * Math.cos(next)], 0xb1afaa);
    }
  }
  round(batch, 0, 0.10, 0, 0.52, 0.52, 0.14, granite, 3);
  labels.push({ y: 0.07, z: 1.20, w: 1.04, h: 0.92, tilt: Math.PI / 2, color: '#343333',
    lines: ['HARSKAMP · 17 APRIL 1945', 'LUNTEREN · 16 APRIL 1945',
      'OTTERLO · 16 APRIL 1945', 'WEKEROM · 16 APRIL 1945'] });
  labels.push({ y: 0.44, z: 0.225, w: 0.30, h: 0.16, tilt: 0.35, color: '#6e5453',
    marks(ctx, w, h) {
      ctx.fillRect(15, 35, 50, 90);
      ctx.fillRect(w - 65, 35, 50, 90);
      const leaf = [[128,38],[137,63],[148,59],[145,77],[165,72],[157,92],[168,97],
        [134,112],[131,128],[126,128],[124,112],[91,97],[101,92],[93,72],[111,77],[108,59],[119,63]];
      ctx.beginPath();
      ctx.moveTo(...leaf[0]);
      for (const p of leaf.slice(1)) ctx.lineTo(...p);
      ctx.fill();
    } });
  block(0, 0, 0.90, 0.90, 0, 1.05);
}

function moens(batch, labels, block) {
  const castIron = 0x252c33;
  box(batch, 0, 0.13, 0, 1.54, 0.38, 1.54, 0x87735e);
  box(batch, 0, 0.14, 0.773, 0.91, 0.21, 0.013, 0x7a6857);
  batch.solid(new THREE.CylinderGeometry(0.79, 0.90, 0.40, 4).rotateY(Math.PI / 4)
    .translate(0, 0.52, 0), castIron);
  batch.solid(new THREE.CylinderGeometry(0.55, 0.79, 1.48, 4).rotateY(Math.PI / 4)
    .translate(0, 1.46, 0), castIron);
  box(batch, 0, 2.18, 0, 0.89, 0.16, 0.89, castIron);
  for (const x of [-0.41, 0.41]) for (const z of [-0.41, 0.41]) {
    ellipse(batch, x, 2.27, z, 0.075, 0.13, 0.075, castIron);
  }
  round(batch, 0, 2.32, 0, 0.14, 0.21, 0.12, castIron);
  ellipse(batch, 0, 2.66, 0, 0.25, 0.29, 0.25, castIron);
  round(batch, 0, 2.83, 0, 0.23, 0.25, 0.064, castIron);
  round(batch, 0, 2.94, 0, 0.072, 0.22, 0.14, castIron);
  ellipse(batch, 0, 3.045, 0, 0.050, 0.053, 0.050, castIron);
  batch.solid(new THREE.TorusGeometry(0.30, 0.031, 6, 32).scale(0.88, 1.36, 1)
    .rotateX(-0.114).translate(0, 1.46, 0.477), 0x303740);
  labels.push({ y: 1.5, z: 0.488, w: 0.42, h: 0.14, tilt: 0.114, color: '#c2a368',
    lines: ['AAN', 'ANNA MARIA MOENS'] });
  block(0, 0, 1.54, 1.54, 0, 2.34);
}

function canadianStone(batch, labels, block) {
  box(batch, 0, 0.35, 0, 1.01, 0.78, 0.42, 0xa09078);
  const shades = [0x97684d, 0x9d715a, 0x865a46, 0xa07156, 0x956955];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 6; col++) {
      const left = Math.max(-0.507, (col - 3) * 0.201 + (row % 2) * 0.101);
      const right = Math.min(0.507, (col - 2) * 0.201 + (row % 2) * 0.101 - 0.009);
      if (right > left) box(batch, (left + right) * 0.5, 0.024 + row * 0.071, 0.211,
        right - left, 0.061, 0.016, shades[(col * 7 + row * 3) % shades.length]);
    }
  }
  box(batch, 0, 0.75, 0, 1.09, 0.078, 0.49, 0x646461);
  box(batch, 0, 0.46, 0.228, 0.53, 0.31, 0.018, 0x4b7770);
  for (const x of [-0.27, 0.27]) for (const y of [0.35, 0.56]) {
    box(batch, x, y, 0.245, 0.052, 0.023, 0.026, bronze);
  }
  labels.push({ y: 0.47, z: 0.24, w: 0.51, h: 0.22, color: '#242f29',
    lines: ['EDE MEMORIAL PARK', 'CONSTRUCTED BY', '7 CANADIAN INFANTRY BRIGADE', 'AUGUST - 1945'] });
  block(0, 0, 1.09, 0.49, 0, 0.79);
}

export const EDE_PAASBERG_MEMORIAL_FACTORIES = {
  'joods-monument-ede': (_, site) => prop(site, jewish),
  'indie-monument-ede': (_, site) => prop(site, indie),
  'militaire-slachtoffers-paasberg': (_, site) => prop(site, military),
  'canadese-bevrijdingsmonument': (_, site) => prop(site, canadian),
  'anna-maria-moens': (_, site) => prop(site, moens),
  'paasberg-canadese-gedenksteen': (_, site) => prop(site, canadianStone),
};
