import * as THREE from 'three/webgpu';
import { PersonCrowd, PersonRig } from './pedestrians.js';
import { clipSportLine } from './ede-sport-fit.js';
import { polygonContains } from './building-collision.js';
import { terrainHeightAt } from './terrain.js';

const ENTER_RANGE = 180;
const KEEP_RANGE = 220;
const MAX_VENUES = 2;
const MAX_ATHLETES = 12;
const FOOTBALL_PASSERS = [0, 1, 2, 3, 1];
const FOOTBALL_RECEIVERS = [1, 2, -1, 1, 0];
const FULL_DRILL_PASSERS = [0, 4, 1, 5, 2, 3, 1];
const FULL_DRILL_RECEIVERS = [4, 1, 5, 2, -1, 1, 0];
const SMALL_DRILL_PASSERS = [0, 1, 2, 1];
const SMALL_DRILL_RECEIVERS = [1, 2, -1, 0];

const mix = (a, b, t) => a + (b - a) * t;
const between = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t)];

function stringHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function fullLine(a, b, polygon) {
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) return polygonContains(polygon, ...a);
  const [piece, gap] = clipSportLine(a, b, polygon);
  return Boolean(piece && !gap && piece[0][0] === a[0] && piece[0][1] === a[1] && piece[1] === b);
}

function buildPath(points, polygon) {
  const segments = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const span = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (span < 0.001) continue;
    if (!fullLine(a, b, polygon)) return null;
    segments.push({ a, b, start: length, span });
    length += span;
  }
  return length > 8 ? { segments, length } : null;
}

function ringPath(polygon, inset) {
  const ring = polygon.outer;
  const area = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return sum + a.x * b.z - a.z * b.x;
  }, 0);
  const normal = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, span = Math.hypot(dx, dz) || 1;
    return [-dz / span * Math.sign(area), dx / span * Math.sign(area)];
  };
  const path = ring.map((b, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
    const [ax, az] = normal(a, b), [bx, bz] = normal(b, c);
    const scale = inset / Math.max(0.5, 1 + ax * bx + az * bz);
    return [b.x + (ax + bx) * scale, b.z + (az + bz) * scale];
  });
  return buildPath([...path, path[0]], polygon);
}

export function fitPlayableSport(id, frame, polygon, layout, isRink, surfaceY) {
  const field = { id, x: frame.x, z: frame.z, surfaceY };
  const at = (u, v) => [frame.x + frame.ux * u + frame.vx * v, frame.z + frame.uz * u + frame.vz * v];
  if (isRink) {
    const paths = [2.4, 1.5].map(inset => ringPath(polygon, inset)).filter(Boolean);
    return paths.length ? { ...field, sport: 'skating', count: 4, paths } : null;
  }
  if (layout?.sport === 'athletics') {
    const paths = [];
    for (let i = 1; i < layout.lines.length && paths.length < 3; i++) {
      const a = layout.lines[i - 1].points, b = layout.lines[i].points;
      if (a.length !== b.length || a.length === 2 && [a, b].some(line => Math.abs(line[0][0] - line[1][0]) < 8)) continue;
      const closed = a.length > 2;
      const lane = a.map((point, j) => at(...between(point, b[j], 0.5)));
      if (!closed) {
        lane[0] = between(lane[0], lane[1], 0.06);
        lane[1] = between(lane[0], lane[1], 0.94);
      }
      const path = buildPath(lane, polygon);
      if (path) paths.push({ ...path, closed });
    }
    if (!paths.length && layout.lines[0]?.points.length > 2) {
      const path = ringPath(polygon, 0.9);
      if (path) paths.push({ ...path, closed: true });
    }
    return paths.length ? { ...field, sport: 'running', count: paths.length, paths } : null;
  }
  if (layout?.sport === 'tennis') {
    const length = Math.abs(layout.lines[0].points[0][0]);
    const half = layout.equipment[0].width * 0.27;
    const a = at(-length * 0.68, -half), b = at(length * 0.68, half);
    const c = at(-length * 0.68, half), d = at(length * 0.68, -half);
    const net = layout.equipment[0];
    const netEnds = [at(0, -net.width / 2), at(0, net.width / 2)];
    if (length < 3 || ![a, b, c, d, ...netEnds].every(p => polygonContains(polygon, ...p))
        || ![[a,b], [c,d], [a,c], [b,d], [a,d], [c,b]].every(pair => fullLine(...pair, polygon))) return null;
    return { ...field, sport: 'tennis', count: 2, players: [[a, c], [d, b]], netHeight: net.height };
  }
  if (layout?.sport === 'soccer' || layout?.sport === 'futsal') {
    for (const goal of layout.equipment) {
      const dir = Math.sign(goal.u);
      const goalX = Math.abs(goal.u);
      if (goalX < 3) continue;
      const middle = at(goal.u, 0);
      const goalPosts = [at(goal.u, -goal.width / 2), at(goal.u, goal.width / 2)];
      const target = at(goal.u - dir * 0.22, 0);
      const spread = Math.min(goalX * 0.44, goal.width * 1.15);
      const players = [
        [at(dir * goalX * 0.22, -spread), at(dir * goalX * 0.28, -spread * 0.72)],
        [at(dir * goalX * 0.35, spread), at(dir * goalX * 0.41, spread * 0.74)],
        [at(dir * goalX * 0.63, -spread * 0.1), at(dir * goalX * 0.70, spread * 0.13)],
        [at(dir * goalX * 0.92, -goal.width * 0.28), at(dir * goalX * 0.92, goal.width * 0.28)],
      ];
      const points = [...players.flat(), target, middle];
      if (!goalPosts.every(p => polygonContains(polygon, ...p))
          || !points.every((a, i) => points.slice(i + 1).every(b => fullLine(a, b, polygon)))) continue;
      if (goalX >= 25 && frame.width >= 32) {
        const support = [-1, 1].map(side => [
          at(dir * goalX * 0.08, side * spread * 1.38), at(dir * goalX * 0.21, side * spread * 1.55),
        ]);
        if (support.flat().every(point => points.every(target => fullLine(point, target, polygon)))
            && support.every(pair => fullLine(...pair, polygon))) {
          players.push(...support);
        }
      }
      return { ...field, sport: 'football', count: players.length, players, target, shotHeight: Math.min(0.85, goal.height * 0.36) };
    }
  }
  return null;
}

export function scheduledSport(field, activity, effects, iceReady) {
  if (!activity?.daylight || activity.weather === 'snow' || activity.heavyRain || effects.snow > 0.05) return false;
  if (field.sport === 'skating') {
    return iceReady && activity.weather !== 'rain' && !effects.raining && !(effects.rain > 0.01);
  }
  if ((field.sport === 'tennis' || field.sport === 'running' && field.count === 1)
      && (activity.weather === 'rain' || effects.raining)) return false;
  const weekend = activity.weekday === 0 || activity.weekday === 6 || activity.holiday;
  const running = field.sport === 'running';
  const hash = stringHash(field.id + activity.date);
  if ((hash >>> 16) % (weekend ? 8 : 5) === 0) return false;
  const start = weekend ? 540 : 900;
  const main = activity.minute >= start + hash % 65 && activity.minute < (weekend ? 1100 : 1160) - (hash >>> 8) % 50;
  const morningRun = running && activity.minute >= 420 + hash % 45 && activity.minute < 645;
  return main || morningRun;
}

function walkPath(path, meters) {
  const lap = path.closed === false ? 2 * path.length : path.length;
  const cursor = meters % lap;
  const reverse = cursor >= path.length;
  const distance = reverse ? lap - cursor : cursor;
  const { a, b, start, span } = path.segments.find(s => distance < s.start + s.span) ?? path.segments.at(-1);
  const position = between(a, b, (distance - start) / span);
  const sign = reverse ? -1 : 1;
  return { position, heading: Math.atan2(sign * (b[0] - a[0]), sign * (b[1] - a[1])) };
}

function makeRacket() {
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 5, 14), new THREE.MeshStandardMaterial({ color: 0x6fabce }));
  rim.position.y = 0.28;
  rim.scale.x = 0.82;
  rim.scale.y = 1.22;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.23, 6), new THREE.MeshStandardMaterial({ color: 0x283234 }));
  grip.position.y = 0.065;
  const racket = new THREE.Group();
  racket.add(rim, grip);
  return racket;
}

const athleteGround = (field, x, z) => terrainHeightAt(x, z) + field.surfaceY;
const angleTo = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);

export function createEdeSportActivity(scene, fields) {
  if (!fields.length) return { update() {}, get activeVenues() { return []; }, get athleteCount() { return 0; } };
  const group = new THREE.Group();
  group.name = 'Ede sports activity';
  const crowd = new PersonCrowd(MAX_ATHLETES, { castShadow: false, sportswear: true });
  group.add(...crowd.meshes);
  const skateBlades = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.035, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xb4c5cb, metalness: 0.6, roughness: 0.35 }), MAX_ATHLETES * 2);
  skateBlades.count = 0;
  skateBlades.frustumCulled = false;
  const blades = [new THREE.Object3D(), new THREE.Object3D()];
  group.add(skateBlades);
  const slots = Array.from({ length: MAX_VENUES }, (_, slot) => {
    const rigs = Array.from({ length: MAX_ATHLETES / MAX_VENUES }, (_, id) => new PersonRig({
      seed: (slot * 7 + id + 1) / 15, scale: 0.96 + 0.018 * id, female: id % 2 === 1,
    }));
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.81 }));
    const rackets = Array.from({ length: 2 }, () => makeRacket());
    ball.visible = false;
    for (const racket of rackets) racket.visible = false;
    group.add(ball, ...rackets);
    return { rigs, ball, rackets, field: null, t: 0, positions: [], pose: { hand: new THREE.Vector3() } };
  });
  scene.add(group);
  const candidates = [];
  let nearby = [], nearX = Infinity, nearZ = Infinity;
  let athleteCount = 0;

  function updateAthlete(slot, i, position, heading, dt, camera, pose = null) {
    const { rigs, field } = slot;
    const rig = rigs[i], [x, z] = position;
    if (pose?.skate) {
      rig.skate(x, z, heading, athleteGround, field, pose.cycle, blades);
      for (const blade of blades) {
        blade.updateMatrix();
        skateBlades.setMatrixAt(skateBlades.count++, blade.matrix);
      }
    } else {
      rig.update(dt, x, z, heading, athleteGround, field, 0, !pose);
      if (pose) rig.solve(null, pose);
    }
    athleteCount++;
    crowd.add(rig, Math.hypot(camera.x - x, camera.z - z));
  }

  function drawPlay(slot, dt, camera, raining) {
    const { field, t, ball, rackets, pose, positions } = slot;
    const tennis = field.sport === 'tennis';
    const football = field.sport === 'football';
    const count = !raining ? field.count : football ? Math.max(3, field.count - 2) : Math.max(1, field.count - 1);
    ball.visible = tennis || football;
    for (const racket of rackets) racket.visible = tennis;
    if (!ball.visible) {
      for (let i = 0; i < count; i++) {
        const path = field.paths[i % field.paths.length];
        const skating = field.sport === 'skating';
        const speed = skating ? 3.25 + 0.2 * i : 3.2 + 0.18 * i;
        const { position, heading } = walkPath(path, t * speed + path.length * (0.08 + 0.22 * i));
        pose.skate = skating;
        pose.cycle = t * 0.63 + i * 0.31;
        updateAthlete(slot, i, position, heading, dt, camera, skating ? pose : null);
      }
      return;
    }

    const phase = tennis ? t / 1.75 : t / 2.55;
    const play = Math.floor(phase), progress = phase % 1;
    const hitters = count === 6 ? FULL_DRILL_PASSERS : count > 3 ? FOOTBALL_PASSERS : SMALL_DRILL_PASSERS;
    const receivers = count === 6 ? FULL_DRILL_RECEIVERS : count > 3 ? FOOTBALL_RECEIVERS : SMALL_DRILL_RECEIVERS;
    const drill = play % hitters.length;
    const hitter = tennis ? play % 2 : hitters[drill];
    const receiver = tennis ? 1 - hitter : receivers[drill];
    const shot = receiver === -1;
    const positionAt = (i, p) => between(...field.players[i], (1 + Math.sin(p * (tennis ? Math.PI : 1.72) + i * 1.8)) / 2);
    const windUp = tennis ? 0 : 0.20;
    const flight = Math.min(1, Math.max(0, (progress - windUp) / (tennis ? 1 : shot ? 0.60 : 0.8)));
    for (let i = 0; i < count; i++) positions[i] = positionAt(i, phase);
    const from = positionAt(hitter, play);
    const to = shot ? field.target : positionAt(receiver, play + 1);
    // The keeper retrieves the shot between drills.
    const [x, z] = shot && flight >= 1
      ? between(to, positionAt(count > 3 ? 3 : 1, play + 1), (progress - 0.8) / 0.2)
      : between(from, to, flight);
    let lift = 0;
    if (tennis) {
      const bounce = 0.74;
      lift = flight <= bounce
        ? mix(1.02, 0.05, flight / bounce) + field.netHeight * 1.15 * Math.sin(Math.PI * flight / bounce)
        : mix(0.05, 1.02, (flight - bounce) / (1 - bounce)) + 0.20 * Math.sin(Math.PI * (flight - bounce) / (1 - bounce));
    } else if (shot) lift = field.shotHeight * Math.sin(Math.PI * flight);
    ball.scale.setScalar(tennis ? 0.038 : 0.11);
    ball.material.color.setHex(tennis ? 0xd9ef38 : 0xeeeae0);
    ball.position.set(x, athleteGround(field, x, z) + lift + (tennis ? 0.038 : 0.11), z);
    ball.rotation.x = t * 8;
    ball.updateMatrixWorld();
    for (let i = 0; i < count; i++) {
      const heading = i === hitter && progress < windUp + 0.24 ? angleTo(positions[i], to)
        : tennis ? angleTo(field.players[i][0], field.players[1 - i][0]) : angleTo(positions[i], [x, z]);
      pose.skate = false;
      pose.swing = tennis ? (i === hitter ? Math.exp(-Math.pow(progress / 0.14, 2)) : 0) : null;
      pose.kick = football && i === hitter ? Math.exp(-Math.pow((progress - windUp) / 0.09, 2)) : 0;
      updateAthlete(slot, i, positions[i], heading, dt, camera, pose);
      if (tennis) {
        const racket = rackets[i];
        racket.position.copy(pose.hand);
        racket.rotation.set(0.4 + 0.8 * pose.swing, heading, -0.28 + pose.swing * 1.35, 'YXZ');
        racket.updateMatrixWorld(true);
      }
    }
  }

  function update(dt, camera, activity, effects = {}) {
    const ice = effects.rinkIce ?? 0;
    candidates.length = 0;
    for (const slot of slots) {
      const field = slot.field;
      if (field && (Math.hypot(field.x - camera.x, field.z - camera.z) > KEEP_RANGE
          || !scheduledSport(field, activity, effects, ice >= 0.97))) slot.field = null;
    }
    if (slots.some(slot => !slot.field) && activity?.daylight) {
      if (Math.hypot(camera.x - nearX, camera.z - nearZ) >= 30) {
        nearX = camera.x;
        nearZ = camera.z;
        nearby = fields.filter(field => Math.hypot(field.x - nearX, field.z - nearZ) <= ENTER_RANGE + 30);
      }
      for (const field of nearby) {
        const distance = Math.hypot(field.x - camera.x, field.z - camera.z);
        if (distance > ENTER_RANGE || slots.some(slot => slot.field === field)
            || !scheduledSport(field, activity, effects, ice >= 0.99)) continue;
        candidates.push({ field, score: distance });
      }
      candidates.sort((a, b) => a.score - b.score || a.field.id.localeCompare(b.field.id));
      let i = 0;
      for (const slot of slots) {
        if (slot.field || !candidates[i]) continue;
        slot.field = candidates[i++].field;
        slot.t = (stringHash(slot.field.id + activity.date) % 1000) * 0.1;
        for (const rig of slot.rigs) rig.placed = false;
      }
    }
    crowd.begin();
    athleteCount = 0;
    skateBlades.count = 0;
    for (const slot of slots) {
      if (slot.field) {
        slot.t += Math.min(0.1, Math.max(0, dt));
        drawPlay(slot, dt, camera, activity.weather === 'rain' || effects.raining);
      } else {
        slot.ball.visible = false;
        for (const racket of slot.rackets) racket.visible = false;
      }
    }
    crowd.end();
    if (skateBlades.count) skateBlades.instanceMatrix.needsUpdate = true;
  }

  return {
    update,
    get activeVenues() { return slots.flatMap(({ field }) => field ? [field] : []); },
    get athleteCount() { return athleteCount; },
  };
}
