const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let TELEPORT_LOCATIONS, LANDMARK_SITES, defaultSpawn, blockAt, nearestRoads, waterAt, ISLAND_BOUNDS, NYC_LANDMARKS;
test.before(async () => {
  ({ TELEPORT_LOCATIONS, LANDMARK_SITES, defaultSpawn, blockAt, nearestRoads, waterAt, ISLAND_BOUNDS, NYC_LANDMARKS } = await import('../js/city-config.js'));
});

test('the scenic teleport buttons land in clear space and face their targets', () => {
  const buttons = [...read('index.html').matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(buttons).size, buttons.length, 'teleport destinations are unique');
  const mapPinIds = new Set(NYC_LANDMARKS.filter(site => site.mapScenic).map(site => site.id));
  const scenic = Object.entries(TELEPORT_LOCATIONS).filter(([id, point]) => point.focus && !mapPinIds.has(id));
  assert.deepEqual(scenic.map(([name]) => name).sort(), buttons.sort());
  for (const [name, point] of scenic) {
    const { x, z, focus } = point;
    const block = blockAt(x, z);
    assert.ok(!block || block.sidewalk || block.park, `${name} lands outside buildings`);
    assert.ok(!waterAt(x, z), `${name} lands outside water`);
    assert.ok(x > ISLAND_BOUNDS.minX && x < ISLAND_BOUNDS.maxX);
    assert.ok(z > ISLAND_BOUNDS.minZ && z < ISLAND_BOUNDS.maxZ);
    assert.ok(Number.isFinite(focus.height) && focus.height > 0);
    assert.equal(point.heading, Math.atan2(focus.x - x, focus.z - z));
  }
});

test('expansion map pins have clear scenic approaches that face the surveyed landmark', () => {
  const landmarks = NYC_LANDMARKS.filter(site => site.mapScenic);
  assert.equal(landmarks.length, 7);
  for (const landmark of landmarks) {
    const { x, z, focus, heading } = TELEPORT_LOCATIONS[landmark.id];
    const block = blockAt(x, z);
    assert.ok(!block || block.sidewalk || block.park, landmark.id);
    assert.ok(!waterAt(x, z), landmark.id);
    assert.ok(x > ISLAND_BOUNDS.minX + 8 && x < ISLAND_BOUNDS.maxX - 8, landmark.id);
    assert.ok(z > ISLAND_BOUNDS.minZ + 30 && z < ISLAND_BOUNDS.maxZ, landmark.id);
    assert.equal(focus.x, landmark.x);
    assert.equal(focus.z, landmark.z);
    assert.equal(heading, Math.atan2(focus.x - x, focus.z - z));
    assert.ok(focus.height > 0, landmark.id);
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

test('the Eder Kuil teleport frames the stage from above the seating', () => {
  const point = TELEPORT_LOCATIONS.openluchttheater;
  const venue = LANDMARK_SITES['Openluchttheater Ede'];
  assert.match(point.name, /^van Pabstlaan$/i);
  assert.ok(point.z > point.focus.z && point.focus.z > venue.z);
  assert.ok(Math.hypot(point.focus.x - point.x, point.focus.z - point.z) < 40);
});

test('mosque arrivals use their named buildings and replace only the matching BAG records', async () => {
  const { EDE_MODELED_LANDMARKS, landmarkBagExclusions } = await import('../js/ede-landmark-sites.js');
  const records = [
    ['ulu-camii', '0228100000078834'],
    ['al-mouahidin', '0228100000066603'],
    ['sic-ede', '0228100000087276'],
    ['ede-mgt-moskee', '0228100000065566'],
  ];
  for (const [id, bag] of records) {
    const landmark = EDE_MODELED_LANDMARKS.find(site => site.id === id);
    assert.deepEqual(landmark.bagIds, [bag], id);
    assert.ok(LANDMARK_SITES[landmark.name].ring.length >= 6, id);
    assert.ok(TELEPORT_LOCATIONS[id].focus, id);
    const bounds = { min: { x: landmark.x - 20, z: landmark.z - 20 }, max: { x: landmark.x + 20, z: landmark.z + 20 } };
    const replacements = landmarkBagExclusions(bounds);
    assert.ok(replacements.has(bag), id);
    assert.ok(!replacements.has('0228100000069860'), 'keep the structure next to the Molenstraat hall');
  }
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
    terrainHeightAt: () => 4,
    controllerManager: {
      teleportActiveTo: (...args) => { calls.push(['teleport', ...args]); return landed; }
    },
    touchControls: { reset: () => calls.push(['touch']) },
    gamepadControls: { reset: () => calls.push(['gamepad']) },
    cameraSystem: {
      resetForTeleport: (focus) => calls.push(focus ? ['camera', focus.x, focus.y, focus.z] : ['camera'])
    },
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
    const focus = point.focus;
    const camera = focus ? ['camera', focus.x, focus.height + 4, focus.z] : ['camera'];
    assert.deepEqual(calls, [
      ['teleport', point.x, point.z, point.heading, null], ['touch'], ['gamepad'], camera, ['selectCamera', 'chase', true]
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
