import * as THREE from 'three/webgpu';
import { createFlockMesh, createFlyingAnimal, createMammal } from './ede-wildlife-models.js';
import { findWildlifeSite, wildlifeActivity, wildlifeHash } from './ede-wildlife-activity.js';
import { EDE_FLOCK_ROUTES, sampleFlock } from './ede-wildlife-routes.js';

const TAU = 2 * Math.PI;
const altitudeLimits = { skylark: 95, nightjar: 58, butterfly: 12, mammal: 62 };
const encounterRanges = { skylark: 155, nightjar: 160, butterfly: 17, mammal: 115 };

function soundSource(kind, name, range, seed) {
  return { id: { name }, kind, range, seed, x: 0, y: 0, z: 0 };
}

function near(camera, x, z, distance) {
  return (camera.x - x) ** 2 + (camera.z - z) ** 2 <= distance ** 2;
}

function fly(kind, model, site, age, index, terrainHeightAt, butterflyAllowed) {
  let x, y, z, yaw, roll, pitch, lift;
  if (kind === 'skylark') {
    const cycle = (age + 5) % 48;
    const angle = age * .55;
    const radius = 5 + 5 * Math.sin(Math.PI * cycle / 48);
    x = site.x + Math.sin(angle) * radius;
    z = site.z + Math.cos(angle) * radius;
    y = 1.5 + 27 * Math.sin(Math.PI * cycle / 48) ** 1.25;
    yaw = angle + Math.PI / 2;
    roll = .21;
    pitch = -.21 * Math.cos(Math.PI * cycle / 48);
    lift = Math.sin(age * TAU * 9) * .76;
  } else if (kind === 'nightjar') {
    const cycle = age % 33;
    const t = Math.min(1, Math.max(0, (cycle - 12) / 9));
    const angle = t * TAU;
    const swing = Math.sin(t * Math.PI);
    x = site.x + 14 * Math.sin(angle) * swing;
    z = site.z + 11 * (1 - Math.cos(angle)) * swing;
    y = .15 + 7.7 * swing + Math.sin(age * 3.1) * .24 * swing;
    yaw = angle + Math.PI / 2;
    roll = .22 * swing;
    pitch = -.17 * Math.cos(t * Math.PI) * swing;
    lift = swing > .02 ? Math.sin(age * TAU * 6) * .58 : 1.26;
  } else {
    const offsetAge = age + index * 2.7;
    const radius = 1.22 + index * 1.15;
    const rest = offsetAge % 15;
    const airborne = Math.min(1, Math.max(0, Math.min(rest, 11 - rest)));
    const local = Math.floor(offsetAge / 15) * 15 + Math.min(rest, 11);
    x = site.x + Math.sin(local * 1.65) * radius + Math.sin(local * 3.87) * .28;
    z = site.z + Math.cos(local * 1.65) * radius + Math.cos(local * 3.28) * .35;
    if (!butterflyAllowed(x, z)) {
      x = site.x;
      z = site.z;
    }
    y = .18 + airborne * (.47 + .27 * Math.sin(offsetAge * 3 + index));
    yaw = local * 1.65 + Math.PI / 2;
    roll = Math.cos(age * 3.1) * .19 * airborne;
    pitch = .15;
    lift = airborne > .01 ? .42 + Math.sin(age * TAU * (index ? 11 : 9.2)) * .84 : 1.35;
  }
  model.group.position.set(x, terrainHeightAt(x, z) + y, z);
  model.group.rotation.set(pitch, yaw, roll, 'YXZ');
  model.flap(lift);
  model.group.updateMatrixWorld(true);
}

export function createEdeWildlife(scene, terrainHeightAt, habitatAt) {
  const root = new THREE.Group();
  root.name = 'Ede seasonal wildlife';
  scene.add(root);
  const soundSources = [];
  const flocks = EDE_FLOCK_ROUTES.map(route => ({
    route, pose: {}, source: soundSource('sheep', route.id, route.range, route.departure), model: null,
  }));
  const slots = Object.keys(altitudeLimits).map(kind => ({
    kind, age: 0, retry: 0, site: null, animals: null,
    source: soundSource(kind, kind, encounterRanges[kind], encounterRanges[kind]),
  }));
  const butterflyAllowed = (x, z) => {
    const site = habitatAt(x, z);
    return !site.woodland && !site.pavement && (site.heath || site.sand);
  };
  let time = 0, withinMinute = 0, previousMinute, previousDate;
  let previousState, activity = wildlifeActivity();
  let previousX = Infinity, previousZ = Infinity;

  function updateFlocks(camera, minute, altitude, state) {
    for (const flock of flocks) {
      const { route, pose, source } = flock;
      const [yard, field] = [route.path[0], route.path.at(-1)];
      const nearFlock = altitude < 155 && (near(camera, ...yard, 265) || near(camera, ...field, 245));
      if (flock.model) flock.model.group.visible = nearFlock;
      if (!nearFlock) continue;
      if (!flock.model) {
        flock.model = createFlockMesh(route.name, route.sheep.length);
        root.add(flock.model.group);
      }
      const seconds = Number.isFinite(state?.seconds) ? state.seconds : minute * 60 + withinMinute;
      for (let i = 0; i < route.sheep.length; i++) {
        sampleFlock(route, seconds, i, time, activity.grazingDay, pose);
        pose.y = terrainHeightAt(pose.x, pose.z);
        flock.model.setPose(i, pose, time, terrainHeightAt);
        if (i === 2) {
          source.x = pose.x;
          source.y = pose.y + .9;
          source.z = pose.z;
        }
      }
      flock.model.commit();
      flock.model.group.updateMatrixWorld(true);
      if (altitude < 55 && (state?.sunElevation ?? -1) > -3 && near(camera, source.x, source.z, source.range)) {
        soundSources.push(source);
      }
    }
  }

  return {
    soundSources,
    update(dt, camera, state) {
      soundSources.length = 0;
      time += dt;
      const minute = state?.minute ?? 0;
      const newDate = previousDate !== state?.date;
      const relocated = !near(camera, previousX, previousZ, 95);
      previousX = camera.x;
      previousZ = camera.z;
      if (newDate || minute !== previousMinute) {
        withinMinute = 0;
        previousDate = state?.date;
        previousMinute = minute;
      } else {
        withinMinute = Math.min(withinMinute + dt, 59.99);
      }
      if (previousState !== state) {
        activity = wildlifeActivity(state);
        previousState = state;
      }
      const altitude = camera.y - terrainHeightAt(camera.x, camera.z);
      updateFlocks(camera, minute, altitude, state);
      for (const slot of slots) {
        const { kind, source } = slot;
        const requested = activity[kind] && altitude <= altitudeLimits[kind];
        for (const animal of slot.animals ?? []) animal.group.visible = false;
        if (!requested || newDate || relocated || (slot.site && !near(camera, slot.site.x, slot.site.z, encounterRanges[kind]))) {
          slot.site = null;
          slot.retry = 0;
          slot.age = 0;
        }
        if (!requested) continue;
        if (!slot.site) {
          if (time < slot.retry) continue;
          slot.site = findWildlifeSite(kind, camera, habitatAt, activity.seed);
          slot.retry = time + (kind === 'butterfly' ? .7 : 2.5);
          if (!slot.site) continue;
          slot.age = 0;
        }
        slot.age += dt;
        if (kind === 'mammal') {
          const wait = 6 + wildlifeHash(activity.seed + 19) * 11;
          const cycle = (slot.age - wait) % (78 + wildlifeHash(activity.seed + 47) * 32);
          if (cycle < 0 || cycle > 18) continue;
          if (slot.species !== activity.mammal) {
            const old = slot.animals?.[0].group;
            if (old) {
              root.remove(old);
              old.traverse(mesh => {
                mesh.geometry?.dispose();
                mesh.material?.dispose();
              });
            }
            slot.species = activity.mammal;
            const animal = createMammal(slot.species);
            animal.group.name = slot.species === 'red-deer' ? 'Red deer' : 'Wild boar';
            slot.animals = [animal];
            root.add(animal.group);
          }
          const [animal] = slot.animals;
          const { x, z, dx, dz, heading } = slot.site;
          const progress = cycle / 18;
          const wx = x + dx * progress, wz = z + dz * progress;
          animal.group.visible = true;
          animal.group.position.set(wx, terrainHeightAt(wx, wz) + .024 * Math.sin(cycle * 12), wz);
          animal.group.rotation.y = heading;
          animal.walk(cycle, activity.antlers);
          animal.group.updateMatrixWorld(true);
        } else {
          if (!slot.animals) {
            slot.animals = Array.from({ length: kind === 'butterfly' ? 2 : 1 }, () => createFlyingAnimal(kind));
            for (const animal of slot.animals) {
              animal.group.name = kind === 'butterfly' ? 'Heathland butterfly' : kind === 'skylark' ? 'Skylark' : 'Nightjar';
              root.add(animal.group);
            }
          }
          for (const [i, animal] of slot.animals.entries()) {
            animal.group.visible = true;
            fly(kind, animal, slot.site, slot.age, i, terrainHeightAt, butterflyAllowed);
          }
          if (kind === 'skylark' || (kind === 'nightjar' && (slot.age % 33 < 11 || slot.age % 33 > 22))) {
            const { x, y, z } = slot.animals[0].group.position;
            Object.assign(source, { x, y, z });
            soundSources.push(source);
          }
        }
      }
    },
  };
}
