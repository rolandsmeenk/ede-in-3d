import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildEdeTrainTracks } from './ede-train-tracks.js';
import { createEdeTrainTraffic, TRAIN_CONSISTS, trainCarOffset, trainModel, watchEdeTrains } from './ede-train-traffic.js';

const POOL_SIZE = 8, ENTER = 720, LEAVE = 900;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function carriageGeometry(length, livery, cab) {
  const parts = [];
  function box(w, h, d, x, y, z, color) {
    const gradient = typeof color === 'function';
    const geometry = new THREE.BoxGeometry(w, h, d, 1, 1, gradient ? Math.ceil(d / 1.5) : 1).translate(x, y, z);
    const position = geometry.getAttribute('position');
    const paint = new THREE.Color();
    if (!gradient) paint.setHex(color);
    const rgb = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      if (gradient) color(position.getZ(i), paint);
      paint.toArray(rgb, 3 * i);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    parts.push(geometry);
  }

  const { body, belt, doors, tall, gradient } = livery;
  const height = tall ? 3.7 : 3.05, end = length / 2;
  const metal = 0x343b46, glass = 0x203445;
  let bodyPaint = body;
  if (gradient) {
    const [purple, blue, green] = gradient;
    bodyPaint = (z, color) => {
      // Both cabs run from purple at the nose to green at their coupling.
      const progress = clamp(z / length + 0.5, 0, 1);
      if (!cab) color.copy(green).lerp(blue, 1 - Math.abs(2 * progress - 1));
      else if (progress < 0.52) color.copy(purple).lerp(blue, progress / 0.52);
      else color.copy(blue).lerp(green, (progress - 0.52) / 0.48);
    };
  }
  box(2.92, height, length - (cab ? 1.8 : 0.44), 0, 0.78 + height / 2, cab ? 0.55 : 0, bodyPaint);
  box(2.68, 0.3, length - 1.8, 0, height + 0.92, cab ? 0.35 : 0, metal);
  box(2.35, 0.35, length - 1.1, 0, 0.63, 0, metal);
  for (const z of [-length * 0.36, length * 0.36]) {
    box(2.73, 0.57, 2.6, 0, 0.33, z, metal);
  }

  for (const side of [-1, 1]) {
    if (belt !== undefined) {
      box(0.05, tall ? 2.33 : livery.nose ? 1.16 : 0.94, length - 2.65, side * 1.47,
        tall ? 2.78 : 2.75, 0.32, belt);
    }
    for (let z = -end + 3.8; z < end - 2.9; z += 2.05) {
      box(0.055, 0.61, 1.51, side * 1.5, tall ? 3.56 : 2.76, z, glass);
      if (tall) box(0.055, 0.58, 1.51, side * 1.5, 1.97, z, glass);
    }
    for (const z of [-end + (cab ? 3.1 : 1.65), end - 1.62]) {
      box(0.067, 2.38, 1.24, side * 1.49, 2.14, z, doors);
      box(0.07, 0.7, 0.62, side * 1.53, 2.78, z, glass);
    }
  }
  if (cab) {
    box(2.57, height - 0.4, 1.45, 0, 0.78 + (height - 0.4) / 2, -end + 1.18, livery.nose ?? bodyPaint);
    box(2.36, 0.85, 0.09, 0, tall ? 3.56 : 2.94, -end + 0.40, glass);
    for (const x of [-0.88, 0.88]) box(0.32, 0.18, 0.10, x, 1.52, -end + 0.39, 0xfff5c4);
  }
  const combined = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return combined;
}

function makeTrainModels() {
  const nsYellow = 0xffc917, nsBlue = 0x003082;
  const definitions = {
    intercity: { ...TRAIN_CONSISTS.intercity, body: nsYellow, belt: nsBlue, doors: nsBlue, tall: true },
    sprinter: { ...TRAIN_CONSISTS.sprinter, body: 0xf3f5f6, belt: 0x0862a8, doors: nsYellow, nose: nsYellow },
    international: { ...TRAIN_CONSISTS.international, body: 0xe1e6eb, belt: 0xaa243a, doors: 0xb1b7bd },
    nightjet: { ...TRAIN_CONSISTS.nightjet, body: 0x293d65, belt: 0x963949, doors: 0x42577d },
    rs34: { ...TRAIN_CONSISTS.rs34, doors: 0xb7c2cb,
      gradient: [0x6343a9, 0x087eb7, 0x30ae9b].map(color => new THREE.Color(color)) }
  };
  for (const model of Object.values(definitions)) {
    model.coach = carriageGeometry(model.length, model, false);
    model.cab = carriageGeometry(model.length, model, true);
  }
  return definitions;
}

function makeActor(group, material, initial) {
  const root = new THREE.Group();
  root.name = 'Ede passenger train';
  root.visible = false;
  const cars = Array.from({ length: 5 }, () => {
    const mesh = new THREE.Mesh(initial.coach, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.rotation.order = 'YXZ';
    root.add(mesh);
    return mesh;
  });
  group.add(root);
  return { root, cars, key: null, train: null };
}

function configure(actor, plan, models) {
  const model = models[trainModel(plan.trip)];
  if (actor.model === model) return;
  actor.model = model;
  for (let i = 0; i < actor.cars.length; i++) {
    const mesh = actor.cars[i];
    mesh.geometry = i === 0 || i === model.cars - 1 ? model.cab : model.coach;
    mesh.visible = i < model.cars;
  }
}

export function createEdeTrainSystem(scene, timetable, hud, options) {
  const tracks = buildEdeTrainTracks();
  const traffic = createEdeTrainTraffic(timetable, tracks, options);
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.51, metalness: 0.12 });
  const models = makeTrainModels();
  const group = new THREE.Group();
  group.name = 'EdePassengerTrains';
  scene.add(group);
  const pool = Array.from({ length: POOL_SIZE }, () => makeActor(group, material, models.intercity));
  const active = new Map();
  const front = {}, rear = {}, location = {};
  let hudText = '', syncedAt = -Infinity;

  function retire(key, actor) {
    active.delete(key);
    actor.key = actor.train = null;
    actor.root.visible = false;
  }

  function sync(focus) {
    const nearby = [];
    for (const train of traffic.progress.values()) {
      const { plan } = train;
      const actor = active.get(plan.key) ?? active.get(plan.turnFrom);
      const position = plan.path.sample(train.distance, location);
      const ds = (position.x - focus.x) ** 2 + (position.z - focus.z) ** 2;
      if (ds < (actor ? LEAVE : ENTER) ** 2) nearby.push({ train, ds, actor });
    }
    nearby.sort((a, b) => a.ds - b.ds);
    nearby.length = Math.min(nearby.length, POOL_SIZE);
    const reserved = new Set(nearby.map(row => row.actor));
    for (const [key, actor] of active) {
      if (!reserved.has(actor)) retire(key, actor);
    }

    for (const row of nearby) {
      const { train } = row;
      const { plan } = train;
      const actor = row.actor ?? pool.find(item => !item.train);
      if (!actor) continue;
      if (actor.key !== plan.key) active.delete(actor.key);
      actor.key = plan.key;
      actor.train = train;
      configure(actor, plan, models);
      active.set(plan.key, actor);
      actor.root.visible = true;
    }

    const closest = nearby.find(row => row.ds < 310 ** 2 && active.get(row.train.plan.key)?.train === row.train)?.train;
    const platform = closest?.target.platform;
    const trip = closest?.plan.trip;
    const label = trip?.operator === 'RRReis' ? 'RS34' : /^(ICE|Nightjet)$/i.test(trip?.serviceType) ? trip.serviceType : 'NS';
    const next = closest ? `${label} ${trip.number} · ${closest.plan.status}` +
      (platform ? ` · Track ${platform}` : '') : '';
    if (hud && hudText !== next) {
      hudText = next;
      hud.textContent = next;
      hud.hidden = !next;
    }
  }

  function positionActor(actor) {
    const { train, model, cars } = actor;
    const { plan, distance } = train;
    const limit = plan.path.length;
    const wheelbase = model.length * 0.34;
    for (let i = 0; i < model.cars; i++) {
      const cart = cars[i];
      const center = distance + trainCarOffset(model, i);
      cart.visible = center >= 0 && center <= limit;
      if (!cart.visible) continue;
      plan.path.sample(center + wheelbase, front);
      plan.path.sample(center - wheelbase, rear);
      const dx = front.x - rear.x, dz = front.z - rear.z;
      const reverse = i === model.cars - 1;
      cart.position.set((front.x + rear.x) / 2, (front.y + rear.y) / 2, (front.z + rear.z) / 2);
      cart.rotation.set(Math.atan2(front.y - rear.y, Math.hypot(dx, dz)) * (reverse ? -1 : 1),
        Math.atan2(-dx, -dz) + (reverse ? Math.PI : 0), 0);
      cart.updateMatrixWorld();
    }
  }

  watchEdeTrains(traffic);
  return {
    group, traffic, tracks, pool,
    update(dt, camera, at = Date.now() / 1000) {
      traffic.advance(dt, at);
      if (at < syncedAt || at - syncedAt >= 0.25) {
        syncedAt = at;
        sync(camera);
      }
      for (const [key, actor] of active) {
        if (traffic.progress.get(actor.train.plan.key) === actor.train) positionActor(actor);
        else retire(key, actor);
      }
    },
    get active() { return [...active].map(([key, actor]) => ({
      key, status: actor.train.plan.status, path: actor.train.plan.path.id, updateAt: actor.train.plan.updateAt,
      distance: actor.train.distance, speed: actor.train.speed, platform: actor.train.target.platform, root: actor.root
    })); }
  };
}
