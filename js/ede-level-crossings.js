import * as THREE from 'three/webgpu';
import { getEdeGrade, gradeWayAt } from './ede-grade.js';
import { EDE_DATA } from './ede-geodata.js';
import { terrainHeightAt } from './terrain.js';
import { TRAIN_CONSISTS, trainCarOffset, trainModel } from './ede-train-traffic.js';

const WARNING = 21, PRE_WARNING = 5, LOWER = 12, RAISE = 6, CLEAR = 2;
const MAX_STOP_DISTANCE = 75;
const clamp01 = value => Math.max(0, Math.min(1, value));

function makeEquipment(group) {
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0xa0a39f, roughness: 0.7 });
  const paint = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const black = new THREE.MeshStandardNodeMaterial({ color: 0x25282b });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x5b151a });
  const lit = new THREE.MeshStandardNodeMaterial({ color: 0xff3425, emissive: 0xff180d, emissiveIntensity: 1.5 });
  const mast = new THREE.CylinderGeometry(0.055, 0.055, 1, 10);
  const bracket = new THREE.BoxGeometry(0.65, 0.07, 0.10);
  const housing = new THREE.CylinderGeometry(0.138, 0.138, 0.115, 14).rotateX(Math.PI / 2);
  const hood = new THREE.CylinderGeometry(0.122, 0.122, 0.15, 8, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
  const lamp = new THREE.SphereGeometry(0.103, 10, 6).scale(1, 1, 0.35);
  const bell = new THREE.CylinderGeometry(0.0875, 0.0875, 0.11, 12).rotateX(Math.PI / 2);
  const caseGeometry = new THREE.BoxGeometry(0.37, 0.94, 0.39);
  const counterweight = new THREE.BoxGeometry(0.24, 0.16, 0.19);
  const skirtRail = new THREE.BoxGeometry(1, 0.035, 0.035);
  const skirtDrop = 0.64;
  const skirtPicket = new THREE.BoxGeometry(0.025, skirtDrop, 0.025).translate(0, -skirtDrop / 2, 0);
  const red = new THREE.Color(0xc72b31), white = new THREE.Color(0xf6efdc);

  function paintedBox(length, height, depth, palette) {
    const box = new THREE.BoxGeometry(length, height, depth, palette.length, 1, 1);
    const geometry = box.toNonIndexed();
    box.dispose();
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i += 3) {
      const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
      const section = Math.min(palette.length - 1, Math.floor((x / length + 0.5) * palette.length));
      for (let j = 0; j < 3; j++) palette[Math.max(0, section)].toArray(colors, (i + j) * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  const armGeometry = paintedBox(1, 0.12, 0.083, [red, white, red, white, red, white, red, white, red]).translate(0.5, 0, 0);
  const crossBlade = paintedBox(1.2, 0.13, 0.03, [red, white, white, white, red]);

  function mesh(parent, geometry, material, x, y, z) {
    const piece = new THREE.Mesh(geometry, material);
    piece.position.set(x, y, z);
    parent.add(piece);
    return piece;
  }

  return function equipment(approach, type, trackCount, stationGate) {
    const pole = new THREE.Group();
    pole.name = `Crossing ${type}`;
    const { state, x, z, dx, dz, y, width, back, heading, side, modes } = approach;
    const compact = type === 'AHOB-MINI';
    const roadside = width / 2 + 0.65;
    const px = x + (-dz * roadside - dx * back) * side;
    const pz = z + (dx * roadside - dz * back) * side;
    pole.position.set(px, y, pz);
    pole.rotation.y = heading + (side < 0 ? Math.PI : 0);
    group.add(pole);

    const postHeight = stationGate ? 1.55 : compact ? 2.46 : 2.87;
    mesh(pole, mast, metal, 0, postHeight / 2, 0).scale.y = postHeight;
    mesh(pole, caseGeometry, metal, 0.08, 0.47, 0.07).scale.z = compact ? 0.75 : 1;
    const sounder = mesh(pole, bell, black, 0, postHeight - 0.10, 0.11);
    sounder.name = 'Crossing bell';
    state.bells.push(sounder.getWorldPosition(new THREE.Vector3()));

    const lamps = [];
    if (!stationGate) {
      const lampHeight = compact ? 1.69 : 1.9;
      mesh(pole, bracket, metal, 0, lampHeight, -0.045);
      for (const x of [-0.20, 0.20]) {
        mesh(pole, housing, black, x, lampHeight, -0.12);
        mesh(pole, hood, black, x, lampHeight, -0.23);
        const lens = mesh(pole, lamp, dark, x, lampHeight, -0.19);
        lens.name = 'Crossing red lamp';
        lamps.push(lens);
      }
      const crossbuck = new THREE.Group();
      crossbuck.name = trackCount > 1 ? 'J13 crossbuck' : 'J12 crossbuck';
      crossbuck.position.set(0, postHeight - 0.22, -0.09);
      pole.add(crossbuck);
      for (const height of trackCount > 1 ? [0, -0.30] : [0]) {
        for (const tilt of [-0.48, 0.48]) {
          mesh(crossbuck, crossBlade, paint, 0, height, tilt < 0 ? 0 : -0.032).rotation.z = tilt;
        }
      }
    }

    const arm = new THREE.Group();
    arm.name = 'Crossing boom';
    arm.position.set(0.08, 1.01, 0.075);
    pole.add(arm);
    const length = (modes.has('motor') && type !== 'AOB' ? width / 2 : width) + 0.65 - arm.position.x;
    const beam = mesh(arm, armGeometry, paint, 0, 0, 0);
    beam.name = 'Crossing boom beam';
    beam.scale.set(length, compact ? 0.82 : 1, 1);
    mesh(arm, counterweight, metal, -0.13, 0, 0);

    const pickets = [];
    let lowerRail, skirtCenter;
    if (stationGate) {
      // The hinged skirt folds alongside the boom as it rises.
      const start = 0.35, end = length - 0.18;
      skirtCenter = (start + end) / 2;
      lowerRail = mesh(arm, skirtRail, metal, skirtCenter, 0, 0);
      lowerRail.name = 'Crossing skirt rail';
      lowerRail.scale.x = end - start;
      for (let i = 0; i < 6; i++) pickets.push(mesh(arm, skirtPicket, metal, start + (end - start) * i / 5, 0, 0));
    }

    const setEquipment = (amount, flash) => {
      const angle = (1 - amount) * Math.PI / 2;
      arm.rotation.z = angle;
      if (lowerRail) {
        lowerRail.position.x = skirtCenter - Math.sin(angle) * skirtDrop;
        lowerRail.position.y = -Math.cos(angle) * skirtDrop;
        for (const picket of pickets) picket.rotation.z = -angle;
      }
      arm.updateMatrixWorld(true);
      for (let i = 0; i < lamps.length; i++) lamps[i].material = flash === i ? lit : dark;
    };
    setEquipment(0, -1);
    return setEquipment;
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
    const state = { id: site.id, phase: 'open', arm: 0, flash: -1, warningAt: null, releaseAt: -Infinity, equipment: [], bells: [] };
    const controls = Array.isArray(site.controls) ? site.controls : [site.controls];
    for (const control of controls) {
      if (!['AHOB', 'AHOB-MINI', 'AOB'].includes(control?.type)) continue;
      const { x, z, heading, width, roadWayIds, trackSpan, type, railWayIds } = control;
      // The independently mapped Boslaan path has red lights, unlike a station overpad.
      const stationGate = type === 'AOB' && !site.evidence.osmNode;
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
        state.equipment.push(buildEquipment(approach, type, railWayIds.length, stationGate));
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
        if (state.phase === 'opening' && state.arm > 0) state.warningAt = at - PRE_WARNING - state.arm * LOWER;
        if (state.occupied) state.warningAt = Math.min(state.warningAt, at - PRE_WARNING - LOWER);
        state.releaseAt = at + CLEAR;
      }
      if (state.warningAt !== null && at < state.releaseAt) {
        const amount = clamp01((at - state.warningAt - PRE_WARNING) / LOWER);
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
