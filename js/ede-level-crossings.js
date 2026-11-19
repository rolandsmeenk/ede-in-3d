import * as THREE from 'three/webgpu';
import { getEdeGrade, gradeWayAt } from './ede-grade.js';
import { EDE_DATA } from './ede-geodata.js';
import { terrainHeightAt } from './terrain.js';
import { TRAIN_CONSISTS, trainCarOffset, trainModel } from './ede-train-traffic.js';

const WARNING = 21, LIGHTS_ONLY = 5, LOWER = 12, RAISE = 4, CLEAR = 2;
const MAX_STOP_DISTANCE = 75;
const clamp01 = value => Math.max(0, Math.min(1, value));

function makeEquipment(group) {
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0xa0a39f, roughness: 0.7 });
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf6efdc });
  const stripes = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const black = new THREE.MeshStandardNodeMaterial({ color: 0x25282b });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x5b151a });
  const lit = new THREE.MeshStandardNodeMaterial({ color: 0xff3425, emissive: 0xff180d, emissiveIntensity: 1.5 });
  const mast = new THREE.BoxGeometry(0.12, 2.6, 0.12);
  const head = new THREE.BoxGeometry(0.72, 0.31, 0.22);
  const cross = new THREE.BoxGeometry(0.62, 0.105, 0.04);
  const lamp = new THREE.SphereGeometry(0.103, 10, 6).scale(1, 1, 0.35);
  const caseGeometry = new THREE.BoxGeometry(0.31, 0.90, 0.33);
  const box = new THREE.BoxGeometry(1, 0.12, 0.083, 8, 1, 1);
  const armGeometry = box.toNonIndexed().translate(0.5, 0, 0);
  box.dispose();
  const positions = armGeometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const paint = [new THREE.Color(0xc72b31), new THREE.Color(0xf6efdc)];
  for (let i = 0; i < positions.count; i += 3) {
    const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
    const color = paint[Math.min(7, Math.floor(x * 8)) % 2];
    for (let j = 0; j < 3; j++) color.toArray(colors, (i + j) * 3);
  }
  armGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  function mesh(parent, geometry, material, x, y, z) {
    const piece = new THREE.Mesh(geometry, material);
    piece.position.set(x, y, z);
    parent.add(piece);
    return piece;
  }

  return function equipment(approach, side, halfBarrier) {
    const pole = new THREE.Group();
    pole.name = 'Crossing signal and barrier';
    const { x, z, dx, dz, y, width, back, heading } = approach;
    const roadside = width / 2 + 0.65;
    const px = x + (-dz * roadside - dx * back) * side;
    const pz = z + (dx * roadside - dz * back) * side;
    pole.position.set(px, y, pz);
    pole.rotation.y = heading + (side < 0 ? Math.PI : 0);
    group.add(pole);

    mesh(pole, mast, metal, 0, 1.3, 0);
    mesh(pole, caseGeometry, metal, 0.08, 0.45, -0.04);
    mesh(pole, head, black, 0, 1.9, -0.055);
    for (const tilt of [-0.55, 0.55]) mesh(pole, cross, white, 0, 2.4, -0.06).rotation.z = tilt;
    const lamps = [-0.20, 0.20].map(offset => mesh(pole, lamp, dark, offset, 1.9, -0.18));
    const arm = new THREE.Group();
    arm.position.set(0.08, 0.99, 0.075);
    pole.add(arm);
    const length = halfBarrier ? roadside : width + 0.45;
    mesh(arm, armGeometry, stripes, 0, 0, 0).scale.x = length;
    arm.rotation.z = Math.PI / 2;
    return (amount, flash) => {
      arm.rotation.z = (1 - amount) * Math.PI / 2;
      arm.updateMatrixWorld(true);
      lamps[0].material = flash === 0 ? lit : dark;
      lamps[1].material = flash === 1 ? lit : dark;
    };
  };
}

export function createEdeLevelCrossings(scene, trainSystem) {
  const group = new THREE.Group();
  group.name = 'EdeLevelCrossings';
  scene.add(group);
  const buildEquipment = makeEquipment(group);
  const byWay = new Map(), byPath = new Map(), crossings = [];
  const { sites } = getEdeGrade();
  const ways = new Map(EDE_DATA.roads.map(way => [way.id, way]));
  const atNode = new Map();
  for (const way of ways.values()) {
    if (way.layer || way.bridge || way.tunnel) continue;
    for (const offset of [0, way.pts.length - 2]) {
      const key = way.pts.slice(offset, offset + 2).join('/');
      if (!atNode.has(key)) atNode.set(key, new Set());
      atNode.get(key).add(way.id);
    }
  }

  for (const site of sites) {
    if (site.kind !== 'level' || !site.evidence?.public) continue;
    const state = { id: site.id, phase: 'open', arm: 0, flash: -1, warningAt: null, releaseAt: -Infinity, equipment: [] };
    const controls = Array.isArray(site.controls) ? site.controls : [site.controls];
    for (const control of controls) {
      if (control?.type !== 'AHOB') continue;
      const { x, z, heading, width, roadWayIds, trackSpan } = control;
      const profiles = site.profiles.filter(profile => profile.wayIds.some(id => roadWayIds.includes(id)));
      const modes = new Set(profiles.flatMap(profile => profile.modes));
      const dx = Math.sin(heading), dz = Math.cos(heading);
      const back = (trackSpan || 0) / 2 + 5.5;
      const wayIds = new Set(roadWayIds);
      const approaches = [];
      for (const side of [-1, 1]) {
        const sx = x - side * dx * back, sz = z - side * dz * back;
        const y = roadWayIds.map(id => gradeWayAt(id, sx, sz, width / 2)).find(Boolean)?.y ?? terrainHeightAt(sx, sz);
        const approach = { state, x, z, dx, dz, width, back, y, heading, side, modes };
        approaches.push(approach);
        state.equipment.push(buildEquipment(approach, side, modes.has('motor')));
      }
      // Short crossings can end before the barrier. Keep their connected surface approaches in the lookup.
      for (const id of roadWayIds) {
        const way = ways.get(id);
        if (!way) continue;
        for (const offset of [0, way.pts.length - 2]) {
          const [nx, nz] = way.pts.slice(offset, offset + 2);
          if (Math.hypot(nx - x, nz - z) > back + width / 2 + 3) continue;
          for (const neighbor of atNode.get(`${nx}/${nz}`) || []) wayIds.add(neighbor);
        }
      }
      for (const id of wayIds) {
        if (!byWay.has(id)) byWay.set(id, []);
        byWay.get(id).push(...approaches);
      }
    }
    crossings.push(state);

    for (const path of trainSystem.tracks.paths) {
      let start = Infinity, end = -Infinity;
      for (const point of site.crossings) {
        const hit = path.project(point.x, point.z, point.railWayId);
        if (hit.error > 0.75) continue;
        const railHeading = path.sample(hit.distance).heading;
        for (const control of controls) {
          if (!control?.nodeIds.includes(point.nodeId)) continue;
          const width = Math.max(...site.profiles.filter(p => p.wayIds.some(id => point.roadWayIds.includes(id)))
            .map(p => p.width), 3);
          const half = width / (2 * Math.max(0.25, Math.abs(Math.sin(railHeading - control.heading)))) + 1.5;
          start = Math.min(start, hit.distance - half);
          end = Math.max(end, hit.distance + half);
        }
      }
      if (end >= start) {
        if (!byPath.has(path)) byPath.set(path, []);
        byPath.get(path).push({ state, start, end });
      }
    }
  }

  let lastAt = -Infinity;
  function update(dt, at = Date.now() / 1000) {
    const traffic = trainSystem.traffic;
    const reset = at < lastAt || at - lastAt > 2;
    lastAt = at;
    for (const state of crossings) {
      state.demand = state.occupied = false;
      if (reset) {
        state.warningAt = null;
        state.releaseAt = -Infinity;
        state.arm = 0;
      }
    }
    function detect(train, present) {
      const zones = byPath.get(train.plan.path);
      if (!zones) return;
      const consist = TRAIN_CONSISTS[trainModel(train.plan.trip)];
      const half = trainCarOffset(consist, 0) + consist.length / 2;
      const nose = train.distance + half, tail = train.distance - half;
      const forecast = traffic.forecast(train, at, WARNING) + half;
      for (const { state, start, end } of zones) {
        if (tail > end || forecast < start) continue;
        if (present && nose >= start) state.occupied = true;
        if (state.warningAt === null || reset) {
          // Recover the warning lead if a train first appears partway through the approach.
          let lo = 0, hi = WARNING;
          for (let i = 0; i < 8; i++) {
            const mid = (lo + hi) / 2;
            if (traffic.forecast(train, at, mid) + half >= start) hi = mid;
            else lo = mid;
          }
          state.warningAt = Math.min(state.warningAt ?? Infinity, at + hi - WARNING);
        }
        state.demand = true;
      }
    }
    for (const train of traffic.progress.values()) detect(train, true);
    for (const train of traffic.upcoming(at, WARNING)) detect(train, false);
    for (const state of crossings) {
      const oldArm = state.arm, oldFlash = state.flash;
      if (state.demand) {
        if (state.warningAt === null) state.warningAt = at;
        if (state.phase === 'opening' && state.arm > 0) state.warningAt = at - LIGHTS_ONLY - state.arm * LOWER;
        if (state.occupied) state.warningAt = Math.min(state.warningAt, at - LIGHTS_ONLY - LOWER);
        state.releaseAt = at + CLEAR;
      }
      if (state.warningAt !== null && at < state.releaseAt) {
        const amount = clamp01((at - state.warningAt - LIGHTS_ONLY) / LOWER);
        state.arm = Math.max(state.arm, amount);
        state.phase = state.arm === 1 ? 'closed' : state.arm > 0 ? 'closing' : 'warning';
      } else {
        state.arm = Math.max(0, state.arm - dt / RAISE);
        state.phase = state.arm > 0 ? 'opening' : 'open';
        if (state.phase === 'open') state.warningAt = null;
      }
      state.flash = state.warningAt === null ? -1 : Math.floor((at - state.warningAt) * 2) % 2;
      if (oldArm !== state.arm || oldFlash !== state.flash || reset) {
        for (const equipment of state.equipment) equipment(state.arm, state.flash);
      }
    }
  }

  function stopDistance({ x, y, z, dx, dz, wayId, mode, layer = 0 }) {
    if (layer || !Number.isFinite(y)) return Infinity;
    const ways = Array.isArray(wayId) ? wayId : [wayId];
    let stop = Infinity;
    for (const id of ways) {
      for (const approach of byWay.get(id) || []) {
        if (approach.state.phase === 'open' || !approach.modes.has(mode) || Math.abs(approach.y - y) > 2) continue;
        const forward = dx * approach.dx + dz * approach.dz;
        if (forward * approach.side < 0.4) continue;
        const relX = x - approach.x, relZ = z - approach.z;
        const along = relX * approach.dx + relZ * approach.dz;
        const distance = (-approach.side * approach.back - along) / forward;
        if (distance < 0 || distance > MAX_STOP_DISTANCE || distance >= stop) continue;
        const across = (relX + distance * dx) * approach.dz - (relZ + distance * dz) * approach.dx;
        if (Math.abs(across) <= approach.width / 2 + 1.5) stop = distance;
      }
    }
    return stop;
  }

  return { group, crossings, update, stopDistance };
}
