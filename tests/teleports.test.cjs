const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let TELEPORT_LOCATIONS, LANDMARK_SITES, defaultSpawn, blockAt, nearestRoads, ISLAND_BOUNDS;
test.before(async () => {
  ({ TELEPORT_LOCATIONS, LANDMARK_SITES, defaultSpawn, blockAt, nearestRoads, ISLAND_BOUNDS } = await import('../js/city-config.js'));
});

test('every teleport button has a destination on a real roadway in Ede', () => {
  const buttons = [...read('index.html').matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(Object.keys(TELEPORT_LOCATIONS).sort(), buttons.sort());
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    assert.ok(Number.isFinite(point.heading), `${name} has a heading`);
    const block = blockAt(point.x, point.z);
    assert.ok(!block || block.sidewalk, `${name} lands outside building blocks`);
    assert.ok(point.x > ISLAND_BOUNDS.minX && point.x < ISLAND_BOUNDS.maxX);
    assert.ok(point.z > ISLAND_BOUNDS.minZ && point.z < ISLAND_BOUNDS.maxZ);
    const nearby = nearestRoads(point.x, point.z, 20);
    assert.ok(nearby.some(({ road, dist }) => dist < road.w / 2), `${name} lands within a street's width`);
  }
});

test('the player starts on Driehoek and the Oude Kerk teleport faces the church from Torenstraat', () => {
  assert.equal(defaultSpawn.name, 'Driehoek');
  const point = TELEPORT_LOCATIONS.oudekerk;
  assert.equal(point.name, 'Torenstraat');
  assert.ok(nearestRoads(point.x, point.z, 10).some(({ road, dist }) => road.name === point.name && dist < road.w / 2));
  const church = LANDMARK_SITES['Oude Kerk'];
  const distance = Math.hypot(church.x - point.x, church.z - point.z);
  assert.ok(distance > 35 && distance < 65 && point.x < church.x, 'arrive west of the tower with room to see it');
  const alignment = ((church.x - point.x) * Math.sin(point.heading) + (church.z - point.z) * Math.cos(point.heading)) / distance;
  assert.ok(alignment > 0.999, 'face the church');
});

test('preset and map teleports share arrival resets and mark the resolved landing point', () => {
  const main = read('js/main.js');
  const start = main.indexOf('  function teleportTo(');
  const end = main.indexOf('  const openMapBtn', start);
  const handlers = new Map();
  const calls = [];
  const landed = { x: -305.7, z: 5210 };
  let map;
  const environment = {
    TELEPORT_LOCATIONS,
    controllerManager: {
      teleportActiveTo: (...args) => { calls.push(['teleport', ...args]); return landed; }
    },
    touchControls: { reset: () => calls.push(['touch']) },
    gamepadControls: { reset: () => calls.push(['gamepad']) },
    cameraSystem: { resetForTeleport: () => calls.push(['camera']) },
    selectCamera: (...args) => calls.push(['selectCamera', ...args]),
    getLocationLabel: (x, z) => `${x}, ${z}`,
    cityBlocks: { allBlocks: [] },
    trafficSystem: {},
    NYCMapSystem: class {
      constructor(options) { this.onTeleport = options.onTeleport; map = this; }
    },
    teleportButtons: Object.keys(TELEPORT_LOCATIONS).map((key) => ({
      getAttribute: () => key,
      addEventListener: (_event, handler) => handlers.set(key, handler)
    })),
    closePopovers: () => {}
  };
  vm.runInNewContext(main.slice(start, end), environment);
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    calls.length = 0;
    handlers.get(name)();
    assert.deepEqual(calls, [
      ['teleport', point.x, point.z, point.heading, null], ['touch'], ['gamepad'], ['camera'], ['selectCamera', 'chase', true]
    ]);
    assert.equal(map.waypoint.x, landed.x);
    assert.equal(map.waypoint.z, landed.z);
  }
  map.waypoint = { x: 100, z: 200, name: 'inside a building' };
  map.onTeleport(100, 200);
  assert.equal(map.waypoint.x, landed.x, 'map marker follows the safe position returned by the controller');
  assert.equal(map.waypoint.z, landed.z);
  assert.equal(map.waypoint.name, `${landed.x}, ${landed.z}`);
  calls.length = 0;
  map.onTeleport(100, 200, 1.5, -7);
  assert.deepEqual(calls[0], ['teleport', 100, 200, 1.5, -7], 'layered teleports pass the requested altitude');
});
