import * as THREE from 'three/webgpu';
import { DOESBURGERMOLENPAD, DOESBURGERMOLENPAD_GATES, EDE_CYCLE_JUNCTIONS } from './ede-recreation-route-data.js';

const count = DOESBURGERMOLENPAD.length / 2 - 1;

function routePoint(index) {
  const i = ((index % count + count) % count) * 2;
  return [DOESBURGERMOLENPAD[i], DOESBURGERMOLENPAD[i + 1]];
}

function bearing(index, step) {
  const [x, z] = routePoint(index);
  for (let i = index + step; i !== index + step * count; i += step) {
    const [px, pz] = routePoint(i);
    const dx = px - x, dz = pz - z, distance = Math.hypot(dx, dz);
    if (distance >= 9) return [dx / distance, dz / distance];
  }
}

export function doesburgermolenpadMarkers() {
  const markers = [];
  let spacing = 0;
  for (let index = 0; index < count; index++) {
    const [x, z] = routePoint(index), [px, pz] = routePoint(index - 1);
    const before = bearing(index, -1), after = bearing(index, 1);
    spacing += Math.hypot(px - x, pz - z);
    const dot = before[0] * after[0] + before[1] * after[1];
    if (index === 0 || spacing > 320 || (spacing > 42 && dot > -0.64)) {
      markers.push({ index, x, z, before, after });
      spacing = 0;
    }
  }
  return markers;
}

export function buildEdeRecreationRoutes(scene, heightAt, canPlace) {
  const group = new THREE.Group();
  group.name = 'Ede walking and cycling markers';
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const boardGeometry = new THREE.PlaneGeometry(1, 1);
  const wood = new THREE.MeshStandardMaterial({ color: 0x62513e, roughness: 0.91 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x5a6966, roughness: 0.68, metalness: 0.22 });
  const boards = new Map();
  const all = [];

  function box(parent, material, x, y, z, sx, sy, sz) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.userData.cullDistance = 155;
    parent.add(mesh);
  }

  function boardMaterial(kind, label) {
    const key = kind + ':' + label;
    if (boards.has(key)) return boards.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const bg = kind === 'walk' ? '#7f2945' : '#f0f1e8';
    const fg = kind === 'walk' ? '#fff6e8' : '#167447';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 96, 96);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 84, 84);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px Arial, sans-serif';
    ctx.fillText(label, 48, 43);
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillText(kind === 'walk' ? 'DMP' : 'FIETS', 48, 75);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map, roughness: 0.72, side: THREE.DoubleSide });
    boards.set(key, material);
    return material;
  }

  function post(name, kind, label, x, z, yaw) {
    const anchor = new THREE.Group();
    anchor.name = name;
    anchor.position.set(x, heightAt(x, z), z);
    anchor.rotation.y = yaw;
    const walk = kind === 'walk';
    const material = walk ? wood : metal;
    const size = walk ? 0.27 : 0.33;
    box(anchor, material, 0, 0.58, 0, 0.085, 1.25, 0.085);
    box(anchor, material, 0, 1.12, 0, size, size, 0.035);
    for (const side of walk ? [1] : [1, -1]) {
      const sign = new THREE.Mesh(boardGeometry, boardMaterial(kind, label));
      sign.position.set(0, 1.12, 0.019 * side);
      sign.rotation.y = side === 1 ? 0 : Math.PI;
      sign.scale.set(size, size, 1);
      sign.userData.cullDistance = 155;
      anchor.add(sign);
    }
    all.push(anchor);
  }

  function verge(x, z, dx, dz) {
    for (const width of [1.35, 2.25, 3.5, 5]) {
      const sx = x - dz * width, sz = z + dx * width;
      if (canPlace(sx, sz)) return [sx, sz];
    }
    return null;
  }

  for (const marker of doesburgermolenpadMarkers()) {
    const { x, z, before, after, index } = marker;
    for (const [approach, exit] of [[before, after], [after, before]]) {
      const [dx, dz] = approach;
      const site = verge(x + dx * 2.4, z + dz * 2.4, dx, dz);
      if (!site) continue;
      const right = approach[1] * exit[0] - approach[0] * exit[1];
      const arrow = right > 0.48 ? '→' : right < -0.48 ? '←' : '↑';
      post(index === 0 ? 'Doesburgermolenpad at Kernhem' : 'Doesburgermolenpad trail marker',
        'walk', arrow, ...site, Math.atan2(dx, dz));
    }
  }

  for (const [index, type] of DOESBURGERMOLENPAD_GATES) {
    const [x, z] = routePoint(index);
    const [dx, dz] = bearing(index, 1);
    const anchor = new THREE.Group();
    anchor.name = 'Doesburgermolenpad · ' + type;
    anchor.position.set(x, heightAt(x, z), z);
    anchor.rotation.y = Math.atan2(dx, dz);
    const swing = type === 'swing_gate';
    const gateMaterial = swing ? metal : wood;
    for (const side of [-1, 1]) box(anchor, wood, side * 1.18, 0.54, 0, 0.16, 1.12, 0.16);
    // Park the gate leaf open along the verge so the mapped walking passage stays usable.
    for (const y of [0.39, 0.64, 0.88]) box(anchor, gateMaterial, -1.18, y, 0.66, 0.075, 0.075, 1.31);
    box(anchor, gateMaterial, -1.18, 0.64, 1.27, 0.075, 0.57, 0.075);
    all.push(anchor);
  }

  for (const [number, x, z, dx, dz] of EDE_CYCLE_JUNCTIONS) {
    let site;
    // Junctions are tagged in the roadway. Check the nearby approaches when the junction itself is too wide.
    for (const along of [0, -4, 4, -8, 8]) {
      const px = x + dx * along, pz = z + dz * along;
      site = verge(px, pz, dx, dz) ?? verge(px, pz, -dx, -dz);
      if (site) break;
    }
    if (site) post('Cycling junction ' + number, 'cycle', number, ...site, Math.atan2(dx, dz));
  }

  group.add(...all);
  scene.add(group);
  return group;
}
