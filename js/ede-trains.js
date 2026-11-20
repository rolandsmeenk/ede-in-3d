import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { makeTrainModels } from './ede-train-models.js';
import { buildEdeTrainTracks } from './ede-train-tracks.js';
import { createEdeTrainTraffic, trainCarOffset, trainModel, watchEdeTrains } from './ede-train-traffic.js';

const POOL_SIZE = 8, ENTER = 720, LEAVE = 900;
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
    mesh.geometry = i === 0 ? model.cab : i === model.cars - 1 ? model.rearCab : model.coach;
    mesh.visible = i < model.cars;
  }
}

export function createEdeTrainSystem(scene, timetable, hud, options) {
  const tracks = buildEdeTrainTracks();
  const traffic = createEdeTrainTraffic(timetable, tracks, options);
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.51, metalness: 0.12 });
  material.emissiveNode = attribute('trainGlow', 'vec3');
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
