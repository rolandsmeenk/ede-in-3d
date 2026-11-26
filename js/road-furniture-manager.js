import * as THREE from 'three/webgpu';
import { userData } from 'three/tsl';
import { addMemberStroke, createMemberStrokes, memberStrokeMaterial, memberStrokeMesh } from './ede-mast-strokes.js';
import { createRoadFurnitureAtlases } from './road-furniture-atlas.js';
import {
  SIGN_FOIL, createSignRetroreflection, createRetroreflectiveSignMaterial, createSurveyedSignMaterial, roadFurnitureVisibility
} from './retroreflective-sign-material.js';
import {
  ROAD_FURNITURE_CELL, ROAD_FURNITURE_PAD, advanceRoadFurnitureFade, indexRoadFurniture,
  roadFurnitureCellBounds, roadFurnitureCellVisible
} from './ede-road-furniture-cells.js';
import { createRoadFurniturePlacement, isA12Hectometer } from './ede-road-furniture-placement.js';
import { edeRoadCells, nearestEdeRoad, overlapsEdeTravelPavement } from './ede-geometry.js';
import { gradeProfileAt, gradeWayAt } from './ede-grade.js';
import { getTerrain, terrainHeightAt } from './terrain.js';
import { SCENE_NAP_ORIGIN } from './ede-scene-coordinates.js';

const CELL_RANGE = 270;
const MOTORWAY_RANGE = 660;
const rangeOf = cell => cell.records.some(feature => feature.type === 'exit') ? MOTORWAY_RANGE : CELL_RANGE;
const routeOf = feature => feature.wegnummer ?? feature.roadRef ?? feature.route;
const onRoad = (road, route) => (road.ref ?? '').split(/[;\s]+/).includes(route);

export async function loadEdeRoadFurniture() {
  const response = await fetch(new URL('../assets/ede-road-furniture.json.gz', import.meta.url));
  if (!response.ok) throw new Error(`Ede road furniture HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = new Response(bytes);
  const json = bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.body.pipeThrough(new DecompressionStream('gzip'))) : body;
  return indexRoadFurniture(await json.json());
}

export function roadFurnitureReplacementIds(cells, detail = []) {
  const ndw = new Set(), hectometers = new Map(), replaced = new Set();
  for (const { records } of cells?.values() ?? []) {
    for (const record of records) {
      if (record.type === 'rvv') ndw.add(record.id.replace(/^ndw:/, ''));
      if (record.type !== 'hecto') continue;
      const key = `${record.wegnummer}/${record.hectometer}`;
      if (!hectometers.has(key)) hectometers.set(key, []);
      hectometers.get(key).push(record);
    }
  }
  for (const feature of detail) {
    if (feature.type !== 'hectometre' || !feature.position) continue;
    const key = `${feature.route}/${String(feature.label).replace('.', ',')}`;
    if (hectometers.get(key)?.some(record =>
      Math.hypot(record.x - feature.position[0], record.z - feature.position[1]) <
        (isA12Hectometer(record) && record.roadSectionId != null && record.roadSectionId === feature.nwbId ? 30 : 16) &&
      (!Number.isFinite(record.yaw) || !Number.isFinite(feature.angle) || Math.cos(record.yaw - feature.angle) > 0.5))) {
      replaced.add(feature.id);
    }
  }
  return { ndw, hectometers: replaced };
}

function matchRoad(feature) {
  const { x, z, wayId, yaw } = feature;
  const route = routeOf(feature);
  const a12Post = isA12Hectometer(feature);
  const exact = wayId && nearestEdeRoad(x, z, 55, wayId, feature.layer);
  if (exact) return exact;
  const nearest = a12Post ? null : nearestEdeRoad(x, z, 42, undefined, feature.layer);
  if (!route && !Number.isFinite(yaw)) return nearest;
  const nearby = edeRoadCells({ minX: x, maxX: x, minZ: z, maxZ: z }, 42);
  let best = nearest, score = Infinity;
  for (const edge of new Set([...nearby.values()].flat())) {
    const { a, ux, uz, len, road } = edge;
    // NWB's relative level can differ from the rendered A12 at the same station.
    if (a12Post ? road.kind !== 'motorway' || road.ref && !onRoad(road, route)
      : feature.layer != null && (road.layer ?? 0) !== feature.layer) continue;
    const along = THREE.MathUtils.clamp((x - a.x) * ux + (z - a.z) * uz, 0, len);
    const px = a.x + ux * along, pz = a.z + uz * along;
    const distance = Math.hypot(px - x, pz - z);
    if (distance > 42) continue;
    const direction = road.reverse ? -1 : 1;
    const alignment = Number.isFinite(yaw) ? (ux * Math.sin(yaw) + uz * Math.cos(yaw)) * direction : -1;
    if (a12Post && alignment > -0.7) continue;
    const away = road.oneway && alignment > 0.45;
    const value = distance + (route && !onRoad(road, route) ? 25 : 0) + (away ? 9 : 0);
    if (value >= score) continue;
    score = value;
    best = { ...edge, x: px, z: pz, distance };
  }
  return best;
}

function facing(feature, road) {
  if (Number.isFinite(feature.yaw)) return feature.yaw;
  if (!road) return undefined;
  const side = (feature.z - road.z) * road.ux - (feature.x - road.x) * road.uz;
  const reverse = road.road.oneway ? road.road.reverse : side < 0;
  return Math.atan2(reverse ? road.ux : -road.ux, reverse ? road.uz : -road.uz);
}

function nearbyGantry(x, z, yaw, gantries) {
  let found, reach = 6;
  for (const mount of gantries) {
    if (!mount.halfDepth || Math.abs(mount.ux * Math.sin(yaw) + mount.uz * Math.cos(yaw)) > 0.32) continue;
    const t = THREE.MathUtils.clamp((x - mount.x) * mount.ux + (z - mount.z) * mount.uz, 0, mount.length);
    const d = Math.hypot(x - mount.x - t * mount.ux, z - mount.z - t * mount.uz);
    if (d > reach) continue;
    found = mount;
    reach = d;
  }
  return found;
}

export function buildEdeRoadFurniture(scene, cells, { surfaces, detail, gantries = [], surveyedGroup, nbdTexture, webgpu = false } = {}) {
  if (!cells?.size) return null;
  const records = [...cells.values()].flatMap(cell => cell.records);
  const { faces } = createRoadFurnitureAtlases(records);
  const surveyedBoards = surveyedGroup && nbdTexture ? (detail ?? []).filter(f => f.type === 'directionalSign') : [];
  const group = new THREE.Group();
  group.name = 'Ede road furniture';
  const snap = createRoadFurniturePlacement(surfaces, detail);
  const retro = createSignRetroreflection();
  if (surveyedBoards.length) {
    const material = createSurveyedSignMaterial(nbdTexture, retro);
    for (const mesh of surveyedGroup.children) {
      if (mesh.name === 'NBD detail directionalSign') mesh.material = material;
    }
  }
  const pole = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const tube = new THREE.BoxGeometry();
  const panel = new THREE.PlaneGeometry();
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x919da2, roughness: 0.66, metalness: 0.42, alphaTest: 0.5 });
  steel.opacityNode = roadFurnitureVisibility();
  const materials = new Map();
  let filteredSteel;
  const object = new THREE.Object3D();
  const axis = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const active = new Set();
  const stats = { records: records.length, cells: cells.size, builtCells: 0, activeCells: 0, activeBatches: 0, activeInstances: 0 };
  const surveyedIds = new Set(surveyedBoards.map(board => board.id));
  const roadFor = new Map();
  const clusters = new Map();
  for (const cell of cells.values()) {
    let minY = Infinity, maxY = -Infinity;
    for (const record of cell.records) {
      const ground = terrainHeightAt(record.x, record.z);
      minY = Math.min(minY, ground);
      maxY = Math.max(maxY, ground + 12);
      if (record.type !== 'rvv' || record.placement === 'ABOVE' || record.mountingHeightClass === 'overhead') continue;
      const i = Math.floor(record.x / 0.4), j = Math.floor(record.z / 0.4);
      const level = record.layer ?? 0;
      let match, distance = 0.4;
      for (let a = i - 1; a <= i + 1; a++) {
        for (let b = j - 1; b <= j + 1; b++) {
          for (const candidate of clusters.get(`${level}/${a}/${b}`) ?? []) {
            const d = Math.hypot(candidate.x - record.x, candidate.z - record.z);
            if (d > distance) continue;
            match = candidate;
            distance = d;
          }
        }
      }
      if (!match) {
        match = { x: record.x, z: record.z, owner: record, signs: [] };
        const key = `${level}/${i}/${j}`;
        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key).push(match);
      }
      record.pole = match;
      match.signs.push(record);
    }
    cell.bounds = roadFurnitureCellBounds(cell.ix, cell.iz, minY, maxY);
    cell.reach = rangeOf(cell);
  }
  scene.add(group);

  function approach(feature) {
    if (!roadFor.has(feature.id)) {
      const road = matchRoad(feature);
      roadFor.set(feature.id, { road, yaw: facing(feature, road) });
    }
    return roadFor.get(feature.id);
  }

  function buildCell(cell) {
    const support = [], truss = [], panels = new Map(), braces = createMemberStrokes();
    const addFace = (feature, x, y, z, yaw) => {
      const face = faces.get(feature.id);
      if (!face) return;
      if (!panels.has(face.texture)) panels.set(face.texture, []);
      panels.get(face.texture).push({ x, y, z, yaw, face, type: feature.type, reflector: /^BB1[45]/.test(feature.rvvCode ?? '') });
    };
    function member(start, end, width, rail = false) {
      if (rail && width < 0.12) {
        addMemberStroke(braces, start, end, width / 2, 0x919da2);
        return;
      }
      const length = axis.set(end[0] - start[0], end[1] - start[1], end[2] - start[2]).length();
      if (length < 0.025) return;
      object.position.set((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2);
      object.quaternion.setFromUnitVectors(up, axis.divideScalar(length));
      object.scale.set(width, length, width);
      object.updateMatrix();
      (rail ? truss : support).push(object.matrix.clone());
    }
    function makeTruss(start, end, beam) {
      const dx = end[0] - start[0], dz = end[1] - start[1];
      const length = Math.hypot(dx, dz);
      if (length < 2) return;
      const depth = Math.min(0.7, length * 0.045);
      const rise = depth * 1.7;
      const point = (t, y, side) => [start[0] + dx * t - dz / length * side, y, start[1] + dz * t + dx / length * side];
      const chord = (t, side) => point(t, beam + (side === 0 ? rise : 0), side * depth);
      for (const side of [-1, 0, 1]) member(chord(0, side), chord(1, side), 0.17, true);
      for (const t of [0, 1]) {
        const [x, , z] = chord(t, 0);
        const y = terrainHeightAt(x, z);
        member([x, y, z], [x, beam, z], 0.32, true);
        member(chord(t, -1), chord(t, 1), 0.26, true);
      }
      const bays = Math.max(2, Math.ceil(length / 2.6));
      for (let i = 0; i < bays; i++) {
        const a = i / bays, b = (i + 1) / bays;
        for (const side of [-1, 1]) {
          member(chord(a, side), chord((a + b) * 0.5, 0), 0.085, true);
          member(chord((a + b) * 0.5, 0), chord(b, side), 0.085, true);
        }
        member(chord(a, -1), chord(b, 1), 0.075, true);
      }
    }

    for (const f of cell.records) {
      if (surveyedIds.has(f.surveyedId) || f.pole && f.pole.owner !== f) continue;
      const face = faces.get(f.id);
      if (!face) continue;
      const { road, yaw } = approach(f);
      if (!Number.isFinite(yaw) || (isA12Hectometer(f) && !road)) continue;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const deck = road && (gradeWayAt(road.road.id, road.x, road.z, 2)?.y ?? terrainHeightAt(road.x, road.z));
      if (f.type === 'exit' && f.isOverheadGantry) {
        const mount = gantries.find(gantry => gantry.id === f.mountId) ?? nearbyGantry(f.x, f.z, yaw, gantries);
        if (surveyedBoards.some(board => board.position && Math.cos(board.angle - yaw) > 0.6 &&
          (mount && mount.id === board.mountId || Math.hypot(board.position[0] - f.x, board.position[1] - f.z) < 6) &&
          board.displayText?.some(label => String(label) === String(f.exitNumber)))) continue;
        let span = f.span;
        if (!span?.length) {
          // An OSM gantry point supplies the centre, so clear each shoulder independently.
          const endpoint = (side) => {
            let width = Math.max(10, (road?.width ?? 13) * 0.84);
            while (width < 30 && overlapsEdeTravelPavement(f.x + cos * width * side,
              f.z - sin * width * side, road?.road.layer ?? 0, 1.25)) width += 1;
            return [f.x + cos * width * side, f.z - sin * width * side];
          };
          span = [endpoint(-1), endpoint(1)];
        }
        const centerY = Number.isFinite(f.centerNap) ? f.centerNap - (getTerrain()?.napOrigin ?? SCENE_NAP_ORIGIN) : undefined;
        const beam = mount?.beam ?? (centerY !== undefined ? centerY - face.height / 2 :
          Math.max(deck ?? terrainHeightAt(f.x, f.z), ...span.map(([x, z]) => terrainHeightAt(x, z) - 3.6)) + 5.45);
        if (!mount) makeTruss(span[0], span[1], beam);
        const gap = (mount?.halfDepth ?? 0.7) + 0.08;
        addFace(f, f.x + sin * gap, centerY ?? beam + face.height / 2, f.z + cos * gap, yaw);
        continue;
      }
      if (f.type === 'exit') {
        if (surveyedBoards.some(board => board.position && Math.cos(board.angle - yaw) > 0.7 &&
          Math.hypot(board.position[0] - f.x, board.position[1] - f.z) < 30 &&
          board.displayText?.some(label => String(label) === String(f.exitNumber)))) continue;
        const half = Math.min(face.width * 0.39, face.width / 2 - 0.12);
        const edge = (road?.width ?? 0) / 2 + half + 1.15;
        const clear = inset => [-half, half].every(side =>
          !overlapsEdeTravelPavement(road.x + cos * (inset + side), road.z - sin * (inset + side), road.road.layer ?? 0, 0.14));
        let inset = edge;
        if (road) {
          while (inset < edge + 14 && !clear(inset)) inset += 1;
          if (!clear(inset)) continue;
        }
        const x = road ? road.x + cos * inset : f.x;
        const z = road ? road.z - sin * inset : f.z;
        const top = Math.max(deck ?? -Infinity, terrainHeightAt(x, z)) + 2.25 + face.height;
        for (const side of [-half, half]) {
          const px = x + cos * side, pz = z - sin * side;
          member([px, terrainHeightAt(px, pz), pz], [px, top - 0.12, pz], 0.14);
        }
        addFace(f, x + sin * 0.085, top - face.height / 2, z + cos * 0.085, yaw);
        continue;
      }
      if (f.placement === 'ABOVE' || f.mountingHeightClass === 'overhead') {
        const mount = nearbyGantry(f.x, f.z, yaw, gantries);
        const ground = terrainHeightAt(f.x, f.z);
        const y = (mount?.beam ?? (deck ?? ground) + 5.45) + face.height / 2;
        if (!mount) {
          const half = (road?.width ?? 8) / 2 + 1.25;
          makeTruss([f.x - cos * half, f.z + sin * half], [f.x + cos * half, f.z - sin * half], y - face.height / 2);
        }
        addFace(f, f.x + sin * 0.8, y, f.z + cos * 0.8, yaw);
        continue;
      }

      const { x, z, guardrail } = snap(f, f.x, f.z, road);
      const railGrade = guardrail?.profileId && gradeProfileAt(x, z, undefined, undefined, undefined, guardrail.profileId, 14);
      const ground = (railGrade?.id === guardrail?.profileId ? railGrade?.y : undefined)
        ?? (guardrail?.level && guardrail.wayId ? gradeWayAt(guardrail.wayId, x, z, 14)?.y : undefined)
        ?? terrainHeightAt(x, z);
      const base = ground + (guardrail ? (guardrail.height ?? 0.8) - 0.15 : 0);
      let top = base + (f.type === 'hecto' ? 0.28 :
        /^BB(?:07|08|09|14|15)/.test(f.rvvCode) || f.mountingHeightClass === 'low' ? 0.35 : 1.9);
      for (const sign of f.pole?.signs ?? [f]) {
        const artwork = faces.get(sign.id);
        const angle = approach(sign).yaw;
        if (!artwork || !Number.isFinite(angle)) continue;
        addFace(sign, x + Math.sin(angle) * 0.052, top + artwork.height / 2, z + Math.cos(angle) * 0.052, angle);
        top += artwork.height + 0.035;
      }
      if (!guardrail || top - base > 0.5 || isA12Hectometer(f)) {
        member([x, base, z], [x, top - 0.07, z], f.type === 'hecto' ? 0.044 : 0.067);
      }
    }

    const meshes = [];
    const addMesh = (geometry, material, count) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      if (webgpu) mesh.instanceMatrix = new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array, 16);
      mesh.userData.spawnAlpha = 0;
      mesh.visible = false;
      meshes.push(mesh);
      return mesh;
    };
    for (const [geometry, transforms] of [[pole, support], [tube, truss]]) {
      if (!transforms.length) continue;
      const mesh = addMesh(geometry, steel, transforms.length);
      transforms.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    }
    for (const [texture, signs] of panels) {
      if (!materials.has(texture)) materials.set(texture, createRetroreflectiveSignMaterial(texture, retro));
      const geometry = panel.clone();
      const rects = new THREE.InstancedBufferAttribute(new Float32Array(signs.length * 4), 4);
      const foils = new THREE.InstancedBufferAttribute(new Float32Array(signs.length * 2), 2);
      geometry.setAttribute('signAtlasRect', rects);
      geometry.setAttribute('signFoil', foils);
      const mesh = addMesh(geometry, materials.get(texture), signs.length);
      signs.forEach(({ x, y, z, yaw, face, type, reflector }, i) => {
        object.position.set(x, y, z);
        object.rotation.set(0, yaw, 0);
        object.scale.set(face.width, face.height, 1);
        object.updateMatrix();
        mesh.setMatrixAt(i, object.matrix);
        rects.setXYZW(i, ...face.uv);
        foils.setXY(i, type === 'exit' || reflector ? SIGN_FOIL.R2 : SIGN_FOIL.R1, type === 'hecto' ? 1 : 0);
      });
    }
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.updateMatrixWorld(true);
    }
    if (braces.start.length) {
      filteredSteel ??= memberStrokeMaterial(userData('spawnAlpha', 'float'));
      const mesh = memberStrokeMesh(braces, filteredSteel);
      mesh.name = 'OSM detail gantryBrace';
      mesh.userData.spawnAlpha = 0;
      mesh.visible = false;
      mesh.updateMatrixWorld(true);
      meshes.push(mesh);
    }
    stats.builtCells++;
    return meshes;
  }

  function activate(cell) {
    if (active.has(cell)) return;
    active.add(cell);
    if (cell.meshes.length) group.add(...cell.meshes);
  }

  return {
    stats,
    update(camera, dt, night, playerLights, trafficLights) {
      const { x, z } = camera.position;
      const search = MOTORWAY_RANGE + ROAD_FURNITURE_PAD;
      let next, nearest = Infinity;
      for (let i = Math.floor((x - search) / ROAD_FURNITURE_CELL); i <= Math.floor((x + search) / ROAD_FURNITURE_CELL); i++) {
        for (let j = Math.floor((z - search) / ROAD_FURNITURE_CELL); j <= Math.floor((z + search) / ROAD_FURNITURE_CELL); j++) {
          const cell = cells.get(`${i}/${j}`);
          if (!cell || !roadFurnitureCellVisible(cell.bounds, camera.position, cell.reach)) continue;
          if (cell.meshes) activate(cell);
          else {
            const distance = Math.hypot(x - (i + 0.5) * ROAD_FURNITURE_CELL, z - (j + 0.5) * ROAD_FURNITURE_CELL);
            if (distance < nearest) {
              next = cell;
              nearest = distance;
            }
          }
        }
      }
      if (next) {
        next.meshes = buildCell(next);
        activate(next);
      }
      let batches = 0, instances = 0;
      for (const cell of active) {
        const visible = roadFurnitureCellVisible(cell.bounds, camera.position, cell.reach + 12);
        cell.spawnAlpha = advanceRoadFurnitureFade(cell.spawnAlpha, visible, dt);
        for (const mesh of cell.meshes) {
          mesh.userData.spawnAlpha = cell.spawnAlpha;
          mesh.visible = cell.spawnAlpha > 0;
          if (mesh.visible) {
            batches++;
            instances += mesh.isInstancedMesh ? mesh.count : mesh.geometry.instanceCount;
          }
        }
        if (cell.spawnAlpha === 0) {
          active.delete(cell);
          if (cell.meshes.length) group.remove(...cell.meshes);
        }
      }
      stats.activeCells = active.size;
      stats.activeBatches = batches;
      stats.activeInstances = instances;
      retro.update(batches || surveyedBoards.length ? night : 0, playerLights, trafficLights);
    }
  };
}
