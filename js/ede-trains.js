import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildEdeTrainTracks } from './ede-train-tracks.js';
import { createEdeTrainTraffic, watchEdeTrains } from './ede-train-traffic.js';

const POOL_SIZE = 8, ENTER = 720, LEAVE = 900;
const MAX_SPEED = 52;
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
    intercity: { length: 23.7, cars: 4, body: nsYellow, belt: nsBlue, doors: nsBlue, tall: true },
    sprinter: { length: 17.7, cars: 4, body: 0xf3f5f6, belt: 0x0862a8, doors: nsYellow, nose: nsYellow },
    international: { length: 24.5, cars: 5, body: 0xe1e6eb, belt: 0xaa243a, doors: 0xb1b7bd },
    nightjet: { length: 24.5, cars: 4, body: 0x293d65, belt: 0x963949, doors: 0x42577d },
    rs34: { length: 19.1, cars: 3, doors: 0xb7c2cb,
      gradient: [0x6343a9, 0x087eb7, 0x30ae9b].map(color => new THREE.Color(color)) }
  };
  for (const model of Object.values(definitions)) {
    model.coach = carriageGeometry(model.length, model, false);
    model.cab = carriageGeometry(model.length, model, true);
  }
  return definitions;
}

function modelFor(trip, models) {
  if (trip.operator === 'RRReis') return models.rs34;
  if (/sprinter/i.test(trip.serviceType)) return models.sprinter;
  if (/nightjet/i.test(trip.serviceType)) return models.nightjet;
  if (/ice/i.test(trip.serviceType)) return models.international;
  return models.intercity;
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
  return { root, cars, plan: null, distance: 0, speed: 0 };
}

function configure(actor, plan, models) {
  const model = modelFor(plan.trip, models);
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
  const focus = new THREE.Vector3(Infinity, 0, Infinity);
  const front = {}, rear = {}, location = {};
  let hudText = '', preparedAt = -Infinity;

  function retire(key, actor) {
    active.delete(key);
    actor.plan = null;
    actor.root.visible = false;
  }

  function sync() {
    if (document.hidden || !Number.isFinite(focus.x)) return;
    const at = Date.now() / 1000;
    if (at < preparedAt || at - preparedAt >= 0.75 || traffic.plans.some(plan => plan.fix?.expiry <= at)) {
      traffic.prepare(at);
      preparedAt = at;
    }

    const nearby = [];
    for (const plan of traffic.plans) {
      const target = traffic.position(plan, at);
      if (!target) continue;
      const actor = active.get(plan.key) ?? active.get(plan.turnFrom);
      const position = actor ? actor.plan.path.sample(actor.distance, location) : plan.path.sample(target.distance, location);
      const ds = (position.x - focus.x) ** 2 + (position.z - focus.z) ** 2;
      if (ds < (actor ? LEAVE : ENTER) ** 2) nearby.push({ plan, target, ds, actor });
    }
    nearby.sort((a, b) => a.ds - b.ds);
    nearby.length = Math.min(nearby.length, POOL_SIZE);
    const reserved = new Set(nearby.map(row => row.actor));
    for (const [key, actor] of active) {
      if (!reserved.has(actor)) retire(key, actor);
    }

    for (const row of nearby) {
      const { plan, target } = row;
      let actor = row.actor;
      if (!actor) {
        actor = pool.find(item => !item.plan);
        if (!actor) continue;
        actor.distance = target.distance;
        actor.speed = target.speed;
      } else if (actor.plan.path !== plan.path) {
        const previous = actor.plan.path.sample(actor.distance, location);
        const transfer = plan.path.project(previous.x, previous.z);
        // A changed assignment may use a common stem or the same terminal berth.
        if (transfer.error > 1.25) {
          if (!traffic.position(actor.plan, at)) retire(actor.plan.key, actor);
          continue;
        }
        actor.distance = transfer.distance;
        if (actor.plan.path.direction !== plan.path.direction) actor.speed = 0;
      }
      if (actor.plan?.key !== plan.key) active.delete(actor.plan?.key);
      actor.plan = plan;
      actor.target = target;
      configure(actor, plan, models);
      active.set(plan.key, actor);
      actor.root.visible = true;
    }

    const closest = nearby.find(row => row.ds < 310 ** 2 && active.get(row.plan.key)?.plan === row.plan);
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

  function positionActor(actor, dt, at) {
    const { plan, model, cars } = actor;
    const target = traffic.position(plan, at);
    if (!target) return;
    actor.target = target;
    const remaining = target.distance - actor.distance;
    const wanted = clamp(target.speed + remaining / 2.5, 0, MAX_SPEED);
    actor.speed = clamp(wanted, Math.max(0, actor.speed - dt), actor.speed + 0.58 * dt);
    if (actor.distance < target.limit) {
      actor.distance = Math.min(target.limit, actor.distance + actor.speed * dt);
    }
    const limit = plan.path.length;
    const wheelbase = model.length * 0.34;
    for (let i = 0; i < model.cars; i++) {
      const cart = cars[i];
      const center = actor.distance + ((model.cars - 1) / 2 - i) * (model.length + 0.3);
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

  setInterval(sync, 250);
  watchEdeTrains(traffic);
  return {
    group, traffic, tracks, pool,
    update(dt, camera) {
      focus.copy(camera);
      const at = Date.now() / 1000;
      for (const actor of active.values()) positionActor(actor, dt, at);
    },
    get active() { return [...active].map(([key, actor]) => ({
      key, status: actor.plan.status, path: actor.plan.path.id, updateAt: actor.plan.updateAt,
      distance: actor.distance, speed: actor.speed, platform: actor.target.platform, root: actor.root
    })); }
  };
}
