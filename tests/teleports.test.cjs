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

test('the area menu uses a subset of clear, framed arrivals', () => {
  const entries = [...read('index.html').matchAll(/<button[^>]*class="([^"]+)"[^>]*data-teleport="([^"]+)"/g)];
  const buttons = entries.map(([, , id]) => id);
  const compactButtons = entries.filter(([, classes]) => !classes.split(' ').includes('teleport-extra'))
    .map(([, , id]) => id);
  assert.equal(buttons.length, 16);
  assert.equal(new Set(buttons).size, buttons.length, 'teleport destinations are unique');
  assert.deepEqual(compactButtons, ['oudekerk', 'edewageningen', 'alexanderkerk-bennekom', 'lunteren-centrum',
    'hervormde-kerk-ederveen', 'oude-kerk-otterlo', 'schaapskooi-ginkelse-heide', 'jachthuis-sint-hubertus']);
  for (const id of buttons) assert.ok(TELEPORT_LOCATIONS[id]?.focus, id);
  const scenic = Object.entries(TELEPORT_LOCATIONS).filter(([, point]) => point.focus);
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

test('expansion scenic approaches face their surveyed landmarks', () => {
  const landmarks = NYC_LANDMARKS.filter(site => site.mapScenic);
  for (const id of ['schaapskooi-ginkelse-heide', 'juffrouw-tok', 'mossel', 'planken-wambuis',
    'airborne-monument-ginkel', 'vensters-op-het-verleden', 'huzarenmonument', 'amadeus',
    'natuurcentrum-de-ginkel', 'schaapskooi-de-kreel', 'belgenmonument', 'valenberg', 'nieuw-reemst',
    'wildkijkscherm-nieuw-reemst', 'de-klomp-maalderij', 'hervormde-kerk-ederveen', 'groot-zonneoord',
    'jan-hilgers-monument', 'lunteren-centrum', 'goudsberg', 'wekeromse-zand', 'de-valouwe',
    'station-lunteren', 'de-koepel', 'oude-kerk-lunteren', 'molen-de-hoop', 'museum-lunteren',
    'hessenhut', 'ijzertijdboerderij', 'dennenhorst', 'de-wormshoef', 'de-eekhorst', 'middelpunt-van-nederland',
    'lunteren-de-bron', 'lunteren-de-wegwijzer', 'lunteren-de-triangel', 'lunteren-de-triangel-marterlaan',
    'lunteren-nederwoud', 'bethelkerk-lunteren', 'maranathakerk-lunteren', 'oranjestraat-kerk-lunteren',
    'witte-kerkje-lunteren', 'molukse-kerk-lunteren']) {
    assert.ok(landmarks.some(landmark => landmark.id === id), id + ' has a scenic approach');
  }
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
  const museum = TELEPORT_LOCATIONS['kroller-muller-museum'];
  assert.ok(nearestRoads(museum.x, museum.z, 4).some(({ road, dist }) => road.kind === 'service' && dist < road.w / 2),
    'the museum arrival is on the mapped access lane');
});

test('selected buildings stay modeled when their atlas landmarks are hidden', async () => {
  const { EDE_MODELED_LANDMARKS } = await import('../js/ede-landmark-sites.js');
  for (const id of ['pegasus-flat', 'valkestein-west', 'de-brugge-flat', 'work-garden', 'wildkijkscherm-nieuw-reemst']) {
    assert.ok(EDE_MODELED_LANDMARKS.some(site => site.id === id), id + ' stays modeled');
    assert.equal(NYC_LANDMARKS.find(site => site.id === id)?.hideOnMap, true, id);
    assert.ok(TELEPORT_LOCATIONS[id], id + ' keeps its arrival');
  }
  for (const id of ['nieuw-reemst', 'veluwse-proeftuin', 'ej-bos-diervoeding']) {
    assert.ok(NYC_LANDMARKS.some(site => site.id === id && !site.hideOnMap), id + ' stays visible');
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

test('streamed tiles exclude the surveyed buildings for every grouped heritage landmark', async () => {
  const { EDE_MODELED_LANDMARKS, landmarkBagExclusions, modeledLandmarkFootprints } = await import('../js/ede-landmark-sites.js');
  const cases = [
    ['fischerhuis', 3], ['boerderij-de-driehoek', 2], ['historische-winkelpuien', 4], ['van-essenkazerne', 2],
    ['de-lange-weide', 4], ['waterzoom-kernhem', 1], ['winkelcentrum-parkweide', 2],
    ['p-bos-veevoeders', 1], ['rembrandtlaan-hat', 18], ['jachthuis-sint-hubertus', 4],
  ];
  for (const [id, count] of cases) {
    const site = EDE_MODELED_LANDMARKS.find(landmark => landmark.id === id);
    assert.ok(TELEPORT_LOCATIONS[id].focus, id);
    assert.equal(new Set(site.bagIds).size, count, id);
    const footprints = modeledLandmarkFootprints(site);
    assert.equal(footprints.length, count, id);
    for (const { outer } of footprints) {
      const x = outer.reduce((sum, point) => sum + point.x, 0) / outer.length;
      const z = outer.reduce((sum, point) => sum + point.z, 0) / outer.length;
      const exclusions = landmarkBagExclusions({ min: { x: x - 1, z: z - 1 }, max: { x: x + 1, z: z + 1 } });
      assert.ok(site.bagIds.every(bagId => exclusions.has(bagId)), id);
    }
  }
});

test('preset and map teleports share arrival resets and mark the resolved landing point', () => {
  const main = read('js/main.js');
  const start = main.indexOf('  function teleportTo(');
  const end = main.indexOf('  const openMapBtn', start);
  const handlers = new Map();
  const calls = [];
  const chimes = [];
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
    lightingSystem: { activePresetId: 'golden' },
    audioSystem: { chimeCarillon: motif => chimes.push(motif) },
    setTimeout(callback, delay) {
      assert.equal(delay, 450);
      callback();
    },
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
  assert.deepEqual(chimes, ['quarter']);
  environment.lightingSystem.activePresetId = 'midnight';
  handlers.get('oudekerk')();
  assert.deepEqual(chimes, ['quarter'], 'night arrivals are quiet');
  map.waypoint = { x: 100, z: 200, name: 'inside a building' };
  map.onTeleport(100, 200);
  assert.equal(map.waypoint.x, landed.x, 'map marker follows the safe position returned by the controller');
  assert.equal(map.waypoint.z, landed.z);
  assert.equal(map.waypoint.name, `${landed.x}, ${landed.z}`);
  calls.length = 0;
  map.onTeleport(100, 200, 1.5, -7);
  assert.deepEqual(calls[0], ['teleport', 100, 200, 1.5, -7], 'layered teleports pass the requested altitude');
});
