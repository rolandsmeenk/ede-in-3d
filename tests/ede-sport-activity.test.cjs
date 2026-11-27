const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { pitches } = require('../assets/ede-sports.json');

const read = name => readFileSync(join(__dirname, '../js', name + '.js'), 'utf8');
const collision = loadModule(read('building-collision'));
const fit = loadModule(read('ede-sport-fit'), { imports: { './building-collision.js': collision } });
const { sportLayout } = loadModule(read('ede-sport-layouts'));

class Object3D {
  constructor() {
    this.children = [];
    this.position = this.rotation = this.scale = { set() {}, copy() {}, setScalar() {} };
  }
  add(...children) { this.children.push(...children); }
  updateMatrix() {}
  updateMatrixWorld() {}
}
class Mesh extends Object3D {
  material = { color: { setHex() {} } };
}
class Instances extends Mesh {
  instanceMatrix = {};
  setMatrixAt() {}
}
class Color {
  constructor(hex) { this.r = hex >> 16; this.g = (hex >> 8) & 255; this.b = hex & 255; }
}
const athleteKits = [];
class Crowd {
  meshes = [];
  begin() { this.count = 0; athleteKits.length = 0; }
  add(_rig, _distance, kit) { this.count++; assert.ok(this.count <= 12); athleteKits.push(kit); }
  end() {}
}
class Rig { update() {} solve() {} skate() {} }
const { fitPlayableSport, scheduledSport, createEdeSportActivity } = loadModule(read('ede-sport-activity'), {
  imports: {
    'three/webgpu': {
      Group: Object3D, Mesh, Vector3: Object3D, MeshStandardMaterial: Object3D, Color,
      InstancedMesh: Instances, BoxGeometry: Object3D, Object3D,
      TorusGeometry: Object3D, CylinderGeometry: Object3D, IcosahedronGeometry: Object3D,
    },
    './pedestrians.js': { PersonCrowd: Crowd, PersonRig: Rig },
    './ede-sport-fit.js': fit,
    './building-collision.js': collision,
    './terrain.js': { terrainHeightAt: () => 1 },
  },
});

const points = ring => Array.from({ length: ring.length / 2 }, (_, i) => ({ x: ring[i * 2], z: ring[i * 2 + 1] }));
const playable = pitches.flatMap(record => {
  const frame = fit.fitSportField(record);
  if (!frame) return [];
  const polygon = { outer: points(record.ring), holes: (record.holes ?? []).map(points) };
  const layout = sportLayout(record.sports, frame.length, frame.width, { ...frame, ...record });
  const rink = record.id === 'w60580311' || record.sports.includes('ice_skating');
  const field = fitPlayableSport(record.id, frame, polygon, layout, rink, 0.052);
  return field ? [[field, polygon]] : [];
});

test('mapped fields fit football drills, tennis rallies and running lanes, including both skating rinks', () => {
  const fields = playable.map(([field]) => field);
  assert.ok(fields.filter(f => f.sport === 'football').length >= 75);
  assert.ok(fields.some(f => f.sport === 'football' && f.count === 6));
  assert.ok(fields.some(f => f.sport === 'football' && f.count === 4));
  assert.ok(fields.filter(f => f.sport === 'tennis').length >= 60);
  assert.ok(fields.some(f => f.id === 'r6992377' && f.sport === 'running' && f.paths[0].closed));
  assert.ok(fields.some(f => f.id === 'w1195663334' && f.sport === 'running' && !f.paths[0].closed));
  assert.deepEqual(fields.filter(f => f.sport === 'skating').map(f => f.id), ['r11821354', 'w60580311']);
  for (const [field, polygon] of playable) {
    for (const path of field.paths ?? []) {
      for (const { a, b } of path.segments) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          assert.ok(collision.polygonContains(polygon, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])), field.id);
        }
      }
    }
  }
});

const weekday = { date: '2026-11-27', minute: 1000, weekday: 5, daylight: true, weather: 'dry' };

test('schedules favor weekday afternoons, weekend daylight and weekday morning runs', () => {
  const football = { sport: 'football', id: 'track' };
  const running = { sport: 'running', id: 'track' };
  const tennis = { sport: 'tennis', id: 'court' };
  assert.equal(scheduledSport(football, weekday, {}, false), true);
  assert.equal(scheduledSport({ ...football, id: 'practice' }, weekday, {}, false), false);
  assert.equal(scheduledSport(football, { ...weekday, minute: 570 }, {}, false), false);
  assert.equal(scheduledSport(football, { ...weekday, minute: 720, weekday: 6 }, {}, false), true);
  assert.equal(scheduledSport(football, { ...weekday, minute: 720, holiday: true }, {}, false), true);
  assert.equal(scheduledSport(running, { ...weekday, minute: 480 }, {}, false), true);
  assert.equal(scheduledSport(football, { ...weekday, heavyRain: true }, {}, false), false);
  assert.equal(scheduledSport(tennis, { ...weekday, weather: 'rain' }, {}, false), false);
  assert.equal(scheduledSport(running, { ...weekday, daylight: false }, {}, false), false);
});

test('camera-local slots cap active venues and keep them through the exit margin', () => {
  const field = playable.find(([item]) => item.sport === 'football')[0];
  const fields = [field, { ...field, id: 'second' }, { ...field, id: 'third' }];
  const sim = createEdeSportActivity(new Object3D(), fields);
  const update = offset => sim.update(1 / 60, { x: field.x + offset, z: field.z }, weekday);
  update(201);
  assert.equal(sim.activeVenues.length, 0);
  update(179);
  assert.equal(sim.activeVenues.length, 2);
  assert.equal(sim.athleteCount, sim.activeVenues.reduce((n, venue) => n + venue.count, 0));
  const active = Array.from(sim.activeVenues);
  update(201);
  assert.deepEqual(Array.from(sim.activeVenues), active);
  update(221);
  assert.equal(sim.activeVenues.length, 0);
});

test('club pitches dress home players together and use contrasting opposition colors', () => {
  const dts = playable.find(([field]) => field.id === 'w618016978')[0];
  const publicPitch = playable.find(([field]) => field.id === 'w1015673535')[0];
  const day = { ...weekday, date: '2027-06-12', weekday: 6, minute: 840 };
  const sim = createEdeSportActivity(new Object3D(), [dts, publicPitch]);

  sim.update(1 / 60, dts, day);
  assert.equal(athleteKits.length, 6);
  const home = athleteKits[0], away = athleteKits[3];
  assert.deepEqual(Array.from(home.slice(0, 7)), [37, 88, 166, 1, 244, 242, 232]);
  assert.deepEqual(Array.from(away.slice(0, 4)), [231, 113, 37, 1]);
  assert.deepEqual(athleteKits, [home, home, home, away, home, away]);

  sim.update(1 / 60, dts, { ...day, weather: 'rain' });
  assert.deepEqual(athleteKits, [home, home, home, away]);

  const publicDay = [weekday, day].find(activity => scheduledSport(publicPitch, activity, {}, false));
  assert.ok(publicDay);
  sim.update(1 / 60, publicPitch, publicDay);
  assert.ok(sim.athleteCount > 0);
  assert.ok(athleteKits.every(kit => kit === undefined));
});

test('shared grounds update the home kit when the simulated date changes', () => {
  const shared = playable.find(([field]) => field.id === 'w670236921')[0];
  const sim = createEdeSportActivity(new Object3D(), [shared]);
  const days = ['2027-06-12', '2027-06-13'].map((date, i) => ({ ...weekday, date, weekday: i === 0 ? 6 : 0, minute: 840 }));

  const shirts = days.map(day => {
    sim.update(1 / 60, shared, day);
    assert.equal(sim.activeVenues[0], shared);
    return Array.from(athleteKits[0].slice(0, 3)).join(',');
  });
  assert.deepEqual(shirts.sort(), ['197,47,56', '231,113,37']);
});

test('light rain reduces football and running attendance, while heavy rain empties the venue', () => {
  const day = { ...weekday, date: '2027-06-12', weekday: 6, minute: 840 };
  for (const id of ['w618016978', 'r6992377']) {
    const field = playable.find(([f]) => f.id === id)[0];
    const sim = createEdeSportActivity(new Object3D(), [field]);
    sim.update(1 / 60, field, day);
    assert.equal(sim.athleteCount, field.count);
    sim.update(1 / 60, field, { ...day, weather: 'rain' });
    assert.ok(sim.athleteCount > 0 && sim.athleteCount < field.count);
    sim.update(1 / 60, field, { ...day, weather: 'rain', heavyRain: true });
    assert.equal(sim.athleteCount, 0);
  }
});

test('skaters use rink ice hysteresis and leave immediately for precipitation or darkness', () => {
  const field = playable.find(([item]) => item.id === 'r11821354')[0];
  const sim = createEdeSportActivity(new Object3D(), [field]);
  const update = (rinkIce, overrides = {}, moreEffects = {}) => sim.update(
    1 / 60, field, { ...weekday, ...overrides }, { rinkIce, ...moreEffects },
  );
  for (const [ice, expected] of [[0.98, 0], [0.99, 1], [0.98, 1], [0.969, 0], [0.98, 0], [1, 1]]) {
    update(ice);
    assert.equal(sim.activeVenues.length, expected);
  }
  for (const weather of ['rain', 'snow']) {
    update(1, { weather });
    assert.equal(sim.activeVenues.length, 0);
  }
  update(1, { daylight: false });
  assert.equal(sim.activeVenues.length, 0);
  update(1, {}, { rain: 0.5 });
  assert.equal(sim.activeVenues.length, 0);
  update(0.98);
  assert.equal(sim.activeVenues.length, 0);
});
