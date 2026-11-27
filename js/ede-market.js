import * as THREE from 'three/webgpu';
import { smoothstep, uv } from 'three/tsl';
import { CivicBatch } from './ede-civic-landmarks.js';
import { edeMarketState } from './ede-market-schedule.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';
import { terrainHeightAt } from './terrain.js';

// One representative row at each market, placed within the mapped square or car park.
const sites = [
  { id: 'marktplein', name: 'Marktplein', x: -122, z: -52, yaw: 0.20, count: 7 },
  { id: 'stadspoort', name: 'Stadspoort', x: -1541, z: 3175, yaw: -1.38, count: 4 },
  { id: 'bennekom', name: 'Bennekom', x: 350, z: 5301, yaw: -1.42, count: 4 },
];

const goods = [
  { canvas: 0x9c3230, boards: 0x5f774e, items: [0xbc452c, 0x8f9b38, 0xd6842a], round: true },
  { canvas: 0x39634f, boards: 0x4c713c, items: [0xb84865, 0xe2bd45, 0xf3dfd0], flowers: true },
  { canvas: 0x2f5071, boards: 0x777c76, items: [0xb5c3c8, 0xd7c7ae, 0x98aaa5] },
  { canvas: 0xbd994b, boards: 0x835c3e, items: [0xe1b861, 0xbd8046, 0xe2c385], round: true },
  { canvas: 0x895350, boards: 0x66625a, items: [0x636a87, 0x895552, 0xc0ae89] },
  { canvas: 0x3b706a, boards: 0x906f4b, items: [0xe1a14b, 0xe2bf68, 0xc88c45], round: true },
  { canvas: 0x634764, boards: 0x6c5d45, items: [0xbb7a37, 0xc3a662, 0x9d5937], round: true },
];
const spacing = 4.55;
const turn = 2 * Math.PI;
const ground = (_, x, z) => terrainHeightAt(x, z) + 0.035;

function frame(x, z, yaw) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return {
    toWorld: (u, v) => [x + cs * u + sn * v, z - sn * u + cs * v],
    yaw, cs, sn,
  };
}

function block(batch, w, h, d, x, y, z, color) {
  batch.solid(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

function collider(frame, u, v, hx, hz, minY, maxY, isRoofVisible) {
  const [cx, cz] = frame.toWorld(u, v), { cs, sn } = frame;
  const dx = Math.abs(cs) * hx + Math.abs(sn) * hz;
  const dz = Math.abs(sn) * hx + Math.abs(cs) * hz;
  return { minX: cx - dx, maxX: cx + dx, minZ: cz - dz, maxZ: cz + dz, minY, maxY,
    kind: 'market', obb: { cx, cz, cs, sn, hx, hz }, isRoofVisible };
}

function stallModel({ canvas, boards, items, round, flowers }) {
  const b = new CivicBatch();
  const steel = 0x716d64, pale = 0xe2dbca;
  for (const x of [-1.81, 1.81]) {
    for (const z of [-0.99, 0.99]) {
      block(b, 0.055, 2.16, 0.055, x, 1.07, z, steel);
      block(b, 0.14, 0.025, 0.14, x, 0.015, z, steel);
    }
    block(b, 0.05, 0.07, 2.02, x, 2.11, 0, steel);
  }
  for (const z of [-1, 1]) block(b, 3.66, 0.05, 0.055, 0, 2.13, z, steel);
  for (let stripe = 0; stripe < 9; stripe++) {
    const x = -2.16 + stripe * 0.48, end = x + 0.48;
    const tint = stripe % 2 ? pale : canvas;
    b.quad([x, 2.18, 1.33], [end, 2.18, 1.33], [end, 2.68, -0.12], [x, 2.68, -0.12], tint);
    b.quad([x, 2.68, -0.12], [end, 2.68, -0.12], [end, 2.17, -1.27], [x, 2.17, -1.27], tint);
    b.quad([end, 2.02, 1.33], [end, 2.18, 1.33], [x, 2.18, 1.33], [x, 2.02, 1.33], tint);
  }
  block(b, 3.43, 0.12, 0.92, 0, 0.99, 0.63, 0xb28e65);
  block(b, 3.28, 0.83, 0.07, 0, 0.51, 1.05, boards);
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.62;
    block(b, 0.56, 0.10, 0.46, x, 1.10, 0.58, 0xaf906b);
    block(b, 0.52, 0.035, 0.38, x, 1.158, 0.58, 0x685644);
    for (let j = 0; j < 6; j++) {
      const u = x + (j % 3 - 1) * 0.155, v = 0.49 + Math.floor(j / 3) * 0.16;
      const tint = items[(i + j % 2) % items.length];
      if (flowers) {
        block(b, 0.017, 0.19, 0.018, u, 1.24, v, 0x536d40);
        b.solid(new THREE.IcosahedronGeometry(0.055).scale(1, 0.58, 1).translate(u, 1.36, v), tint);
      } else if (round) {
        b.solid(new THREE.IcosahedronGeometry(0.085).scale(0.9, 0.75, 0.9).translate(u, 1.22, v), tint);
      } else {
        block(b, 0.13, 0.07, 0.13, u, 1.205, v, tint);
      }
    }
  }
  const mesh = b.mesh();
  mesh.material.side = THREE.DoubleSide;
  return mesh;
}

function buildRow(scene, site, models, colliders) {
  const local = frame(site.x, site.z, site.yaw);
  const row = { ...site, ...local, open: false };
  const group = new THREE.Group();
  group.name = site.name + ' · weekly market';
  group.visible = false;
  row.group = group;
  row.stalls = Array.from({ length: site.count }, (_, i) => (i - (site.count - 1) / 2) * spacing);
  row.stalls.forEach((u, i) => {
    const [x, z] = local.toWorld(u, 0), y = ground(null, x, z);
    const mesh = models[i].clone();
    mesh.position.set(x, y - 0.06, z);
    mesh.rotation.y = site.yaw;
    group.add(mesh);
    const visible = () => row.open;
    colliders.push(collider(local, u, 0.62, 1.74, 0.48, y - 0.16, y + 1.08, visible));
    for (const side of [-1, 1]) {
      for (const v of [-0.99, 0.99]) {
        colliders.push(collider(local, u + side * 1.81, v, 0.055, 0.055, y - 0.16, y + 2.13, visible));
      }
    }
  });
  row.audio = { id: site, kind: 'market', x: site.x, y: ground(null, site.x, site.z) + 1.4,
    z: site.z, seed: 1409 + site.count, intensity: site.count > 4 ? 0.73 : 0.52 };
  scene.add(group);
  return row;
}

function buildOvertuin(scene, colliders) {
  const local = frame(-139, -87, 0.31);
  const [x, z] = local.toWorld(0, 0);
  const group = new THREE.Group();
  group.name = 'Marktplein · overtuin';
  const b = new CivicBatch(), cladding = 0x8c7661;
  block(b, 9.90, 0.62, 5.7, 0, 0.03, 0, cladding);
  block(b, 9.65, 0.05, 5.45, 0, 0.345, 0, 0x543e2e);
  for (const u of [-4.15, 4.15]) {
    for (let i = 0; i < 8; i++) {
      const v = -2.12 + i * 0.54;
      b.solid(new THREE.IcosahedronGeometry(0.63, 1).scale(1, 0.85, 1).translate(u, 0.65, v), i % 2 ? 0x4b6035 : 0x586d3b);
    }
  }
  for (let i = 0; i < 15; i++) {
    const u = -3.95 + i * 0.56;
    b.solid(new THREE.IcosahedronGeometry(0.62, 1).scale(1, 0.82, 1).translate(u, 0.66, -2.02), i % 2 ? 0x425835 : 0x536b3a);
  }
  for (let i = 0; i < 27; i++) {
    const u = -3.44 + (i % 9) * 0.86 + 0.15 * Math.sin(i * 2.1);
    const v = -0.95 + Math.floor(i / 9) * 1.22 + 0.17 * Math.cos(i * 3.6);
    const h = 0.16 + (i % 4) * 0.04;
    b.solid(new THREE.IcosahedronGeometry(0.31, 1).scale(1.2, 0.85, 1).translate(u, 0.48, v), i % 3 ? 0x687b47 : 0x546e41);
    for (let j = 0; j < 3; j++) {
      const offset = (j - 1) * 0.11;
      block(b, 0.016, h, 0.017, u + offset, 0.56 + h / 2, v + offset ** 2 * 7, 0x52703e);
      b.solid(new THREE.IcosahedronGeometry(0.055).translate(u + offset, 0.57 + h, v + offset ** 2 * 7),
        [0xc9a4b6, 0xe6d1aa, 0x88698d][(i + j) % 3]);
    }
  }
  block(b, 9.70, 0.09, 0.46, 0, 0.375, 2.78, 0x81705d);
  for (let i = 0; i < 4; i++) {
    block(b, 9.68, 0.054, 0.095, 0, 0.443, 2.57 + i * 0.111, i % 2 ? 0xa28360 : 0xb29470);
  }
  const y = ground(null, x, z);
  const mesh = b.mesh();
  // Follow the shallow slope so the wall base and the continuous seat read as part of the square.
  const positions = mesh.geometry.attributes.position;
  let low = y, high = y;
  for (let i = 0; i < positions.count; i++) {
    const [wx, wz] = local.toWorld(positions.getX(i), positions.getZ(i));
    const dy = ground(null, wx, wz);
    positions.setY(i, positions.getY(i) + dy - y);
    low = Math.min(low, dy);
    high = Math.max(high, dy);
  }
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.position.set(x, y, z);
  mesh.rotation.y = local.yaw;
  group.add(mesh);
  scene.add(group);
  colliders.push(collider(local, 0, 0.04, 4.95, 3, low - 0.28, high + 1.16));
}

function buildFountain(scene) {
  // Centre of the pale paving inset on the PDOK orthophoto.
  const x = -126.4, z = -58.4, y = ground(null, x, z);
  const group = new THREE.Group(), water = new THREE.Group();
  group.name = 'Marktplein · bedriegertjes';
  water.name = 'Jets and wet paving';
  water.visible = false;
  group.add(water);
  scene.add(group);

  const wetMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0x272e36, roughness: 0.22, metalness: 0.02, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  wetMaterial.opacityNode = smoothstep(0.12, 0.52, uv().sub(0.5).length()).oneMinus().mul(0.42);
  const wetGeometry = new THREE.PlaneGeometry(15.5, 14, 16, 16).rotateX(-Math.PI / 2).translate(x, 0, z);
  const positions = wetGeometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, ground(null, positions.getX(i), positions.getZ(i)) + 0.008);
  }
  wetGeometry.computeVertexNormals();
  const wet = new THREE.Mesh(wetGeometry, wetMaterial);
  wet.receiveShadow = true;
  water.add(wet);

  const nozzleGeometry = new THREE.CylinderGeometry(0.067, 0.067, 0.017, 10);
  const nozzleMaterial = new THREE.MeshStandardMaterial({ color: 0x606867, metalness: 0.6, roughness: 0.4 });
  const jetGeometry = new THREE.CylinderGeometry(0.026, 0.044, 1, 7).translate(0, 0.5, 0);
  const jetMaterial = new THREE.MeshStandardMaterial({ color: 0x9dc9dd, emissive: 0x486674,
    emissiveIntensity: 0.32, roughness: 0.16, transparent: true, opacity: 0.73, depthWrite: false });
  const sprayMaterial = new THREE.MeshStandardMaterial({ color: 0xc4e0ec, emissive: 0x829caa, emissiveIntensity: 0.42,
    roughness: 0.25, transparent: true, opacity: 0.78, depthWrite: false });
  const layout = [new THREE.Vector3(x, ground(null, x, z) + 0.009, z)];
  for (const [count, radius] of [[6, 1.6], [12, 3.25], [18, 5.0]]) {
    for (let i = 0; i < count; i++) {
      const angle = turn * (i + 0.5) / count;
      const wx = x + radius * Math.cos(angle), wz = z + 0.92 * radius * Math.sin(angle);
      layout.push(new THREE.Vector3(wx, ground(null, wx, wz) + 0.009, wz));
    }
  }
  const nozzles = new THREE.InstancedMesh(nozzleGeometry, nozzleMaterial, layout.length);
  const jets = new THREE.InstancedMesh(jetGeometry, jetMaterial, layout.length);
  const dropletsPerJet = 5;
  const spray = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1), sprayMaterial, layout.length * dropletsPerJet);
  for (const mesh of [jets, spray]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  const dummy = new THREE.Object3D();
  for (const [i, position] of layout.entries()) {
    dummy.position.copy(position);
    dummy.updateMatrix();
    nozzles.setMatrixAt(i, dummy.matrix);
  }
  nozzles.instanceMatrix.needsUpdate = true;
  group.add(nozzles);
  water.add(jets, spray);
  const audio = { id: group, kind: 'fountain', x, y: y + 0.25, z, seed: 1923, intensity: 0.65 };
  return {
    group, water, audio,
    animate(t) {
      let flow = 0;
      for (const [i, position] of layout.entries()) {
        const pulse = Math.max(0, Math.sin(t * (1.09 + 0.037 * i) + i * 1.67));
        const height = 0.035 + Math.pow(pulse, 1.8) * (0.65 + 0.18 * (i % 5));
        dummy.position.copy(position);
        dummy.rotation.z = 0.025 * Math.sin(i * 2);
        dummy.scale.set(1, height, 1);
        dummy.updateMatrix();
        jets.setMatrixAt(i, dummy.matrix);
        flow += height;
        dummy.rotation.z = 0;
        for (let j = 0; j < dropletsPerJet; j++) {
          const phase = (t * (1.1 + 0.04 * j) + i * 0.11 + j * 0.137) % 1;
          const angle = 2.4 * j + 0.65 * i;
          const fall = Math.max(0, 1 + 2 * phase - 3 * phase * phase);
          const spread = phase * (0.14 + 0.045 * (j % 4)) * height;
          dummy.position.set(position.x + Math.cos(angle) * spread, position.y + fall * height,
            position.z + Math.sin(angle) * spread);
          const size = 0.006 + (0.008 + 0.003 * (j % 3)) * pulse;
          dummy.scale.set(size, size * (1 + 2 * Math.abs(phase - 0.33)), size);
          dummy.updateMatrix();
          spray.setMatrixAt(i * dropletsPerJet + j, dummy.matrix);
        }
      }
      jets.instanceMatrix.needsUpdate = true;
      spray.instanceMatrix.needsUpdate = true;
      audio.intensity = Math.min(0.83, 0.38 + flow / layout.length * 0.7);
    },
  };
}

export function buildEdeMarkets(scene) {
  const colliders = [];
  const models = goods.map(stallModel);
  const rows = sites.map(site => buildRow(scene, site, models, colliders));
  buildOvertuin(scene, colliders);
  const fountain = buildFountain(scene);
  const crowd = new PersonCrowd(sites[0].count * 2, { castShadow: false });
  const group = new THREE.Group();
  group.name = 'Market vendors and shoppers';
  group.add(...crowd.meshes);
  scene.add(group);
  const rigs = Array.from({ length: sites[0].count * 2 }, (_, i) => new PersonRig({
    seed: (i + 1) / 16, female: i % 3 === 1, scale: 0.91 + (i % 5) * 0.041,
  }));
  let lastActivity, activeRow, fountainActive = false, audioSource = null, elapsed = 0;
  const nearby = (camera, source, range) => (camera.x - source.x) ** 2 + (camera.z - source.z) ** 2 < range ** 2;

  function updateShoppers(dt, camera, row) {
    crowd.begin();
    row.stalls.forEach((u, i) => {
      const phase = elapsed * (0.37 + 0.009 * i) + i * 2.17;
      const moving = Math.cos(phase);
      const along = u + 1.9 * Math.sin(phase);
      const across = 2.85 + 0.81 * Math.abs(moving) + 0.42 * (i % 2);
      const [ax, az] = row.toWorld(along, across);
      // Slow by the counters and turn back toward the aisle as the next stall approaches.
      const heading = row.yaw + (Math.abs(moving) < 0.38 ? Math.PI : Math.sign(moving) * Math.PI / 2);
      const shopper = rigs[i * 2];
      shopper.update(dt, ax, az, heading, ground);
      crowd.add(shopper, Math.hypot(camera.x - ax, camera.z - az));
      const [vx, vz] = row.toWorld(u + 0.37 * Math.sin(phase / 2), -0.30);
      const vendor = rigs[i * 2 + 1];
      vendor.update(dt, vx, vz, row.yaw, ground);
      crowd.add(vendor, Math.hypot(camera.x - vx, camera.z - vz));
    });
    crowd.end();
  }

  return {
    colliders,
    get audioSource() { return audioSource; },
    get openSite() { return activeRow?.id ?? null; },
    get fountainActive() { return fountainActive; },
    update(dt, camera, activity) {
      elapsed = (elapsed + Math.min(dt, 0.1)) % (turn * 1000);
      if (activity !== lastActivity) {
        lastActivity = activity;
        const state = edeMarketState(activity);
        for (const row of rows) row.open = row.id === state.openSite;
        activeRow = rows.find(row => row.open);
        fountainActive = state.fountain;
      }
      for (const row of rows) row.group.visible = row.open && nearby(camera, row, 220);
      const crowdVisible = Boolean(activeRow && nearby(camera, activeRow, 105) && Math.abs(camera.y - activeRow.audio.y) < 44);
      if (crowdVisible && !group.visible) {
        for (const rig of rigs) rig.placed = false;
      }
      group.visible = crowdVisible;
      if (crowdVisible) updateShoppers(dt, camera, activeRow);
      fountain.group.visible = nearby(camera, fountain.audio, 180);
      fountain.water.visible = fountainActive && fountain.group.visible;
      if (fountain.water.visible) fountain.animate(elapsed);
      audioSource = activeRow && nearby(camera, activeRow, 55) ? activeRow.audio
        : fountain.water.visible && nearby(camera, fountain.audio, 37) ? fountain.audio : null;
    },
  };
}
