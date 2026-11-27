import * as THREE from 'three/webgpu';
import { CivicBatch } from './ede-civic-landmarks.js';
import { localClock } from './ede-transit-time.js';
import { terrainHeightAt } from './terrain.js';

// The track-1 bay under the timber canopy, immediately east of the north stairs.
const PLATFORM = 'L0004.38486c4e2b4b489997fe54ed8e1753b8';
const steel = 0x414a52;

function boardFace(group, position, yaw, width, height, canvasWidth, canvasHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new THREE.MeshBasicNodeMaterial({ map });
  const geometry = new THREE.PlaneGeometry(width, height);
  for (const side of [-1, 1]) {
    const sign = new THREE.Mesh(geometry, material);
    sign.rotation.y = yaw + (side === 1 ? 0 : Math.PI);
    sign.position.set(position[0] + side * 0.053 * Math.sin(yaw), position[1], position[2] + side * 0.053 * Math.cos(yaw));
    group.add(sign);
  }
  return { ctx, map };
}

function localTime(epoch) {
  const { seconds } = localClock(epoch);
  const twoDigits = n => String(n).padStart(2, '0');
  return twoDigits(Math.floor(seconds / 3600)) + ':' + twoDigits(Math.floor(seconds / 60) % 60);
}

export function buildEdeStationBay(platforms = []) {
  const platform = platforms.find(item => item.id === PLATFORM);
  if (!platform) return null;
  const group = new THREE.Group();
  group.name = 'Ede-Wageningen · spoor 1';
  group.userData.nearDetail = 175;
  const colliders = [];
  const [a, b] = platform.outer;
  const height = platform.renderedHeight ?? platform.height;
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / span, uz = (b.z - a.z) / span;
  const yaw = -Math.atan2(uz, ux);
  const point = (u, v, lift = 0) => {
    const x = a.x + u * ux + v * uz, z = a.z + u * uz - v * ux;
    // The core terrain skin overlaps part of this BGT slab near the track edge.
    const surface = Math.max(height(x, z), terrainHeightAt(x, z) - 0.025);
    return [x, surface + lift, z];
  };
  const tactile = new CivicBatch(), furniture = new CivicBatch();
  function strip(u, v, width, lift, color) {
    const start = 14.8 + u * 0.6, end = start + 0.6;
    tactile.quad(point(start, v, lift), point(end, v, lift),
      point(end, v + width, lift), point(start, v + width, lift), color);
  }
  for (let i = 0; i < 46; i++) {
    strip(i, 0.16, 0.23, 0.013, 0x45484b);
    strip(i, 0.60, 0.31, 0.017, 0xe7e1d2);
    for (const rib of [0.63, 0.70, 0.77, 0.84]) strip(i, rib, 0.024, 0.023, 0xf7f1e5);
  }
  const tactileMesh = tactile.mesh();
  tactileMesh.name = 'Spoor 1 tactile guide and platform edge';
  tactileMesh.castShadow = false;
  group.add(tactileMesh);

  function box(u, v, lift, width, height, depth, color) {
    const center = point(u, v, lift);
    furniture.solid(new THREE.BoxGeometry(width, height, depth).rotateY(yaw).translate(...center), color);
  }
  function collider(u, v, width, depth, height) {
    const [cx, y, cz] = point(u, v);
    const hx = width / 2, hz = depth / 2, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minY: y - 0.08, maxY: y + height,
      minZ: cz - ez, maxZ: cz + ez, obb: { cx, cz, hx, hz, cs, sn } });
  }
  for (const u of [19.1, 23.0]) {
    const v = 4.25;
    for (const side of [-1, 1]) {
      box(u + side * 0.77, v, 0.19, 0.09, 0.49, 0.46, steel);
      box(u + side * 0.77, v + 0.22, 0.61, 0.085, 0.43, 0.095, steel);
      box(u + side * 0.60, v, 0.59, 0.047, 0.035, 0.4, steel);
    }
    for (let j = -2; j <= 2; j++) box(u, v + j * 0.088, 0.47, 1.94, 0.052, 0.075, j % 2 ? 0xbe936b : 0x9d744f);
    for (let j = 0; j < 3; j++) box(u, v + 0.222, 0.62 + j * 0.089, 1.94, 0.073, 0.048, j % 2 ? 0xbf966c : 0xad8058);
    collider(u, v, 1.94, 0.47, 0.85);
  }

  for (const u of [34.5, 38.1]) {
    const v = 4.35;
    box(u, v, 0.235, 1.84, 0.60, 0.92, 0x9a9487);
    box(u, v, 0.51, 1.92, 0.085, 1.00, 0xc0b6a4);
    box(u, v, 0.557, 1.68, 0.035, 0.76, 0x403a2f);
    for (let i = 0; i < 23; i++) {
      const uu = u - 0.73 + (i * 0.213) % 1.46, vv = v - 0.31 + (i * 0.157) % 0.62;
      const blade = new THREE.ConeGeometry(0.031, 0.27 + 0.055 * (i % 6), 3).rotateZ(0.22 * Math.sin(i * 1.7));
      furniture.solid(blade.translate(...point(uu, vv, 0.69 + 0.02 * (i % 5))),
        [0x737d4f, 0x556543, 0x9b8e53, 0x959d65][i % 4]);
      if (i % 4 === 0) {
        const tuft = new THREE.IcosahedronGeometry(0.20, 1).scale(1, 0.63, 1);
        furniture.solid(tuft.translate(...point(uu, vv, 0.65)), i % 3 ? 0x637644 : 0x7f7d48);
      }
    }
    collider(u, v, 1.92, 1.00, 0.90);
  }

  // Mount wayfinding and the timetable off the clear route between the stairs and boarding line.
  const signU = 28.3, displayU = 31.2, v = 4.35;
  for (const [u, width, height, center] of [[signU, 0.81, 0.72, 2.47], [displayU, 1.70, 0.57, 2.37]]) {
    box(u, v, center / 2, 0.094, center + 0.12, 0.094, steel);
    box(u, v, 0.04, 0.26, 0.10, 0.26, 0x6b6c67);
    box(u, v, center, width, height, 0.10, steel);
    collider(u, v, 0.14, 0.14, center - height / 2);
  }
  const furnitureMesh = furniture.mesh();
  furnitureMesh.name = 'Spoor 1 timber benches, planters and signs';
  group.add(furnitureMesh);

  let display;
  if (typeof document !== 'undefined') {
    const { ctx, map } = boardFace(group, point(signU, v, 2.47), yaw, 0.78, 0.69, 192, 170);
    ctx.fillStyle = '#063a75';
    ctx.fillRect(0, 0, 192, 170);
    ctx.fillStyle = '#f7fafb';
    ctx.textAlign = 'center';
    ctx.font = '600 23px sans-serif';
    ctx.fillText('spoor', 96, 33);
    ctx.font = '700 94px sans-serif';
    ctx.fillText('1', 96, 122);
    ctx.font = '500 19px sans-serif';
    ctx.fillText('Valleilijn', 96, 153);
    map.needsUpdate = true;

    const screenPosition = point(displayU, v, 2.37);
    const screen = boardFace(group, screenPosition, yaw, 1.66, 0.53, 640, 204);
    const displayContext = screen.ctx;
    let lastText;
    display = {
      x: screenPosition[0], z: screenPosition[2],
      update(rows) {
        const text = rows.map(row => [localTime(row.departure), row.platform,
          row.live ? Math.max(0, Math.round((row.departure - row.scheduled) / 60)) : 0]);
        const key = JSON.stringify(text);
        if (key === lastText) return;
        lastText = key;
        displayContext.fillStyle = '#102b47';
        displayContext.fillRect(0, 0, 640, 204);
        displayContext.fillStyle = '#0060a9';
        displayContext.fillRect(0, 0, 640, 45);
        displayContext.fillStyle = '#fff';
        displayContext.font = '600 24px sans-serif';
        displayContext.fillText('VERTREK  /  RS34', 18, 30);
        displayContext.fillText('SPOOR', 545, 30);
        displayContext.font = '600 30px sans-serif';
        if (text.length === 0) displayContext.fillText('Geen vertrek binnen 2 uur', 18, 103);
        for (const [i, [time, platform, delay]] of text.entries()) {
          const y = 96 + i * 70;
          displayContext.fillStyle = '#fff';
          displayContext.fillText(time, 18, y);
          displayContext.fillText('Amersfoort Centraal', 148, y);
          displayContext.fillText(platform, 568, y);
          if (delay) {
            displayContext.fillStyle = '#ffd05a';
            displayContext.font = '600 18px sans-serif';
            displayContext.fillText('+' + delay, 105, y);
            displayContext.font = '600 30px sans-serif';
          }
        }
        screen.map.needsUpdate = true;
      },
    };
    display.update([]);
  }
  return { group, colliders, display };
}
