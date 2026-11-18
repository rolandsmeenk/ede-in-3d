import * as THREE from 'three/webgpu';
import { EDE_DATA } from './ede-geodata.js';
import { terrainHeightAt } from './terrain.js';

const POLE_HEIGHT = 2.45;
const SIGN_WIDTH = 1.05, SIGN_HEIGHT = 0.38, SIGN_DEPTH = 0.04;
const CELL_WIDTH = 256, CELL_HEIGHT = 92, GUTTER = 4, COLUMNS = 8;

export function collectEdeBusStops(variants, bounds = EDE_DATA.meta.bounds) {
  const [minX, minZ, maxX, maxZ] = bounds;
  const platforms = new Map();
  for (const { line, stops } of variants) {
    for (let i = 0; i < stops.length; i++) {
      const { x, z, name, platform = '' } = stops[i];
      if (!(x >= minX && x <= maxX && z >= minZ && z <= maxZ)) continue;
      const key = `${x}/${z}/${platform}`;
      if (!platforms.has(key)) {
        const before = stops[i - 1] ?? stops[i];
        const after = stops[i + 1] ?? stops[i];
        const heading = Math.atan2(after.x - before.x, after.z - before.z);
        platforms.set(key, { x, z, name, platform, heading, lines: new Set() });
      }
      platforms.get(key).lines.add(line);
    }
  }
  return [...platforms.values()].map((stop) => ({ ...stop, lines: [...stop.lines].sort((a, b) => a - b) }));
}

function drawSignAtlas(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = COLUMNS * CELL_WIDTH;
  canvas.height = Math.ceil(stops.length / COLUMNS) * CELL_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'middle';
  stops.forEach(({ name, platform, lines }, i) => {
    const x = (i % COLUMNS) * CELL_WIDTH, y = Math.floor(i / COLUMNS) * CELL_HEIGHT;
    ctx.fillStyle = '#f7fbff';
    ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
    ctx.fillStyle = '#114574';
    ctx.fillRect(x, y, CELL_WIDTH, 42);
    ctx.fillRect(x, y + 84, CELL_WIDTH, 8);

    // Shared pictogram on the header makes the marker recognizable before its text is readable.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 12, y + 10, 20, 17);
    ctx.fillRect(x + 14, y + 25, 4, 4);
    ctx.fillRect(x + 26, y + 25, 4, 4);
    ctx.fillStyle = '#114574';
    ctx.fillRect(x + 15, y + 13, 14, 6);
    ctx.fillRect(x + 15, y + 22, 3, 2);
    ctx.fillRect(x + 26, y + 22, 3, 2);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 18px Arial, sans-serif';
    const label = platform && name.endsWith(`-${platform}`) ? name.slice(0, -1 - platform.length) : name;
    ctx.fillText(label, x + 39, y + 21, platform ? 170 : 206);
    if (platform) {
      ctx.fillRect(x + 216, y + 7, 30, 27);
      ctx.fillStyle = '#114574';
      ctx.textAlign = 'center';
      ctx.fillText(platform, x + 231, y + 21, 24);
    }

    const badgeWidth = Math.min(48, 224 / lines.length - 5);
    ctx.font = 'bold 23px Arial, sans-serif';
    ctx.textAlign = 'center';
    lines.forEach((line, index) => {
      const left = x + 12 + index * (badgeWidth + 5);
      ctx.fillStyle = '#124574';
      ctx.fillRect(left, y + 46, badgeWidth, 33);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, left + badgeWidth / 2, y + 64, badgeWidth - 6);
    });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildEdeBusStops(scene, variants) {
  const group = new THREE.Group();
  group.name = 'EdeBusStops';
  const stops = collectEdeBusStops(variants);
  group.userData.stopCount = stops.length;
  scene.add(group);
  if (!stops.length) return group;

  const atlas = drawSignAtlas(stops);
  const { width, height } = atlas.image;
  const poleGeometry = new THREE.CylinderGeometry(0.029, 0.036, POLE_HEIGHT, 8).translate(0, POLE_HEIGHT / 2, 0);
  const poleMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x66737d, metalness: 0.45, roughness: 0.55 });
  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, stops.length);
  poles.name = 'EdeBusStopPoles';
  const matrix = new THREE.Matrix4();
  const positions = [], uvs = [], indices = [];

  stops.forEach(({ x, z, heading }, i) => {
    const ground = terrainHeightAt(x, z);
    poles.setMatrixAt(i, matrix.makeTranslation(x, ground, z));
    const col = i % COLUMNS, row = Math.floor(i / COLUMNS);
    const u0 = (col * CELL_WIDTH + GUTTER) / width;
    const u1 = ((col + 1) * CELL_WIDTH - GUTTER) / width;
    const v0 = 1 - ((row + 1) * CELL_HEIGHT - GUTTER) / height;
    const v1 = 1 - (row * CELL_HEIGHT + GUTTER) / height;
    const nx = Math.sin(heading), nz = Math.cos(heading);
    const centerY = ground + POLE_HEIGHT - SIGN_HEIGHT / 2;
    for (const side of [1, -1]) {
      const signX = x + side * nx * SIGN_DEPTH;
      const signZ = z + side * nz * SIGN_DEPTH;
      const first = positions.length / 3;
      for (const [across, up] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const offset = across * side * SIGN_WIDTH / 2;
        positions.push(signX + nz * offset, centerY + up * SIGN_HEIGHT / 2, signZ - nx * offset);
      }
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  });
  poles.instanceMatrix.needsUpdate = true;

  const signs = new THREE.BufferGeometry();
  signs.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  signs.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  signs.setIndex(indices);
  signs.computeVertexNormals();
  const signMesh = new THREE.Mesh(signs, new THREE.MeshBasicNodeMaterial({ map: atlas }));
  signMesh.name = 'EdeBusStopSigns';
  group.add(poles, signMesh);
  return group;
}
