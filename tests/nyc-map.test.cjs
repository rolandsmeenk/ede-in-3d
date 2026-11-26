const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/nyc-map.js'), 'utf8');
const ISLAND_BOUNDS = { minX: -10000, maxX: 10000, minZ: -10000, maxZ: 10000 };
const mapImports = {
  './nyc-geodata.js': { GEO: {} }, './city-config.js': {
    ROADS: [], ISLAND_BOUNDS, WATERFRONT_PIERS: [], EAST_RIVER_BRIDGES: [], OUTER_BRIDGES: []
  },
  './ede-coverage.js': { edeCoverage: null }
};

test('surveyed building courtyards remain holes in the map footprint layer', () => {
  class Path2D {
    rings = [];
    moveTo(x, z) { this.rings.push([[x, z]]); }
    lineTo(x, z) { this.rings.at(-1).push([x, z]); }
    closePath() {}
  }
  const { footprintLayers } = loadModule(source + '\nexport { footprintLayers };', {
    globals: { Path2D },
    imports: mapImports
  });
  const ring = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  const layers = footprintLayers([{ footprints: [{ h: 120, pts: ring(0, 0, 20, 20), holes: [ring(5, 5, 15, 15)] }] }]);
  const [tile] = layers.tones[2].tiles.values();
  const areas = tile.path.rings.map((r) => r.reduce((sum, p, i) => {
    const q = r[(i + 1) % r.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2);
  assert.deepEqual(areas, [400, -100], 'opposite winding cuts the courtyard out under the nonzero fill rule');
});

test('hidden buildings are absent from the map block and footprint layers', () => {
  class Path2D {
    starts = [];
    moveTo(x) { this.starts.push(x); }
    lineTo() {}
    closePath() {}
  }
  const blocks = ['w1', 'w2', 'w3', 'w4'].map((id, i) => {
    const x = (i + 1) * 10;
    const poly = [{ x, z: 10 }, { x: x + 5, z: 10 }, { x, z: 15 }];
    return { id, osmId: id, poly, footprints: [{ h: 4, pts: poly }] };
  });
  const { mapLayers, footprintLayers } = loadModule(source + '\nexport { mapLayers, footprintLayers };', {
    globals: { Path2D },
    imports: { ...mapImports, './city-config.js': {
      ...mapImports['./city-config.js'], BLOCKS: blocks, MANHATTAN_COASTLINE: [],
      NYC_LANDMARKS: [{ hideOnMap: true, osmId: 'w1', annexOsmIds: ['w2'], replaceParcelSources: ['OSM:w3'] }]
    } }
  });
  for (const layer of [mapLayers().blocks, footprintLayers(blocks).tones[0]]) {
    assert.deepEqual([...layer.tiles.values()].flatMap(({ path }) => path.starts), [40]);
  }
});

for (const [width, height, dpr] of [[500, 300, 1], [320, 180, 1.5], [1920, 1080, 2]]) {
  test(`map clicks match rendered world positions at ${width}x${height}, DPR ${dpr}`, () => {
    const window = { innerWidth: width, innerHeight: height, devicePixelRatio: dpr };
    const { NYCMapSystem } = loadModule(source, {
      globals: { window, performance: { now: () => 0 } },
      imports: mapImports
    });
    const map = Object.create(NYCMapSystem.prototype);
    // Capture the production render viewport; drawing primitives are irrelevant to coordinate conversion.
    const context = new Proxy({}, { get: () => () => {} });
    let view;
    Object.assign(map, {
      fullCanvas: { clientWidth: width, clientHeight: height },
      fullCtx: context,
      allBlocks: [],
      fullStatic: { getContext: () => context },
      isFullMapOpen: true,
      viewCenterX: 200,
      viewCenterZ: -300,
      viewZoom: 0.5,
      controllerManager: { getActiveEntity: () => ({ position: { x: 200, z: -300 }, heading: 0 }) },
      renderFullMapStatic: (_context, viewport) => { view = viewport; }
    });
    map.resizeFullCanvas();
    map.renderFullMap();

    for (const point of [{ x: 200, z: -300 }, { x: 325, z: -375 }]) {
      // Convert the renderer's centred coordinates through the canvas backing store to CSS pixels.
      const screenX = (view.toX(point.x) + view.w / 2) * view.dpr * width / map.fullCanvas.width;
      const screenY = (view.toY(point.z) + view.h / 2) * view.dpr * height / map.fullCanvas.height;
      const clicked = map.screenToWorld(screenX, screenY, width, height);
      // The pixel budget can yield a fractional DPR; integer backing sizes may round by less than one pixel.
      const tolerance = 1 / (view.s * view.dpr);
      assert.ok(Math.abs(clicked.x - point.x) < tolerance, `clicked x ${clicked.x} should match drawn x ${point.x}`);
      assert.ok(Math.abs(clicked.z - point.z) < tolerance, `clicked z ${clicked.z} should match drawn z ${point.z}`);
    }
  });
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function classList() {
  const names = new Set();
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    contains: (name) => names.has(name),
    toggle(name, enabled) { if (enabled) names.add(name); else names.delete(name); }
  };
}

function mapHarness(landmarks = [], teleportsById = {}, geo = {}, boundaryConfig = {}) {
  const window = { ...eventTarget(), innerWidth: 200, innerHeight: 200 };
  const canvas = {
    ...eventTarget(), style: {}, clientWidth: 200, clientHeight: 200,
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 200 })
  };
  const controls = eventTarget();
  const wrapper = { classList: classList() };
  const zoomIn = eventTarget(), zoomOut = eventTarget(), viewAll = eventTarget();
  const hoverInfo = { textContent: '' };
  const elements = {
    'fullmap-canvas': canvas, 'fullmap-canvas-wrap': wrapper,
    'fullmap-modal': { classList: classList() },
    'map-zoom-in': zoomIn, 'map-zoom-out': zoomOut, 'map-view-all': viewAll, 'fullmap-hover-info': hoverInfo
  };
  const document = {
    ...eventTarget(), hidden: false,
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => []
  };
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    canvas.dispatch('lostpointercapture', { pointerId: id });
  };
  const config = {
    ROADS: [], BLOCKS: [], NYC_LANDMARKS: landmarks, TELEPORT_LOCATIONS: teleportsById,
    ISLAND_BOUNDS,
    getIslandBoundsAtZ: () => ({ westX: -10000, eastX: 10000 }),
    getLocationLabel: (x, z) => `${x}, ${z}`,
    isTypingInField: () => false, ...boundaryConfig
  };
  const { NYCMapSystem } = loadModule(source, {
    globals: { window, document },
    imports: { ...mapImports, './nyc-geodata.js': { GEO: geo }, './city-config.js': config }
  });
  const teleports = [], landmarkTeleports = [], toggles = [];
  const map = new NYCMapSystem({
    controllerManager: { getActiveEntity: () => ({ position: { x: 1000, z: 2000 } }) },
    onTeleport: (x, z) => teleports.push([x, z]),
    onLandmark: (id) => landmarkTeleports.push(id),
    onToggle: (open) => toggles.push(open)
  });
  // Exercise the real viewport/input state without drawing the map's geographic layers.
  map.renderFullMap = () => {};
  map.viewZoom = 1;
  map.toggleFullMap(true);
  return {
    map, canvas, controls, wrapper, window, document, captured, teleports, landmarkTeleports, toggles, zoomIn, zoomOut, viewAll, hoverInfo,
    pointer(target, type, id, x = 110, y = 120, pointerType = 'touch', button = 0) {
      const event = { pointerId: id, clientX: x, clientY: y, pointerType, button, preventDefault() {} };
      (captured.has(id) ? canvas : target).dispatch(type, event);
      window.dispatch(type, event);
    }
  };
}

test('unrelated touches cannot move or release the map pan', () => {
  const h = mapHarness();
  assert.equal(h.canvas.style.touchAction, 'none');
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.controls, 'pointerdown', 2);
  h.pointer(h.canvas, 'pointerdown', 3);
  h.pointer(h.controls, 'pointermove', 2, 190);
  h.pointer(h.canvas, 'pointermove', 3, 190);
  h.pointer(h.controls, 'pointerup', 2);
  h.pointer(h.canvas, 'pointercancel', 3);
  assert.equal(h.map.viewCenterX, 1000);
  assert.equal(h.map.isPanning, true);
  assert.equal(h.teleports.length, 0);

  h.pointer(h.controls, 'pointermove', 1, 130);
  assert.equal(h.map.viewCenterX, 980);
  h.pointer(h.controls, 'pointerup', 1, 130);
  assert.equal(h.map.isPanning, false);
  assert.equal(h.wrapper.classList.contains('is-panning'), false);
  assert.equal(h.teleports.length, 0);
});

test('a normal map tap teleports once and releases capture', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.teleports, [[1000, 2000]]);
  assert.equal(h.map.waypoint.name, '1000, 2000');
  assert.equal(h.captured.size, 0);
  assert.equal(h.map.isPanning, false);
});

test('map taps reach the exterior travel area and reject scenery beyond it', () => {
  const playableBoundary = [[[990, 1990, 1010, 1990, 1010, 2010, 990, 2010]]];
  const h = mapHarness([], {}, { city: 'Ede', ede: { meta: { playableBoundary } } }, {
    containsPlayablePoint: (x, z) => x >= 990 && x <= 1010 && z >= 1990 && z <= 2010,
    containsTravelPoint: (x, z) => x >= 980 && x <= 1020 && z >= 1980 && z <= 2020,
    constrainToTravelArea: (x, z) => ({ x, z }),
    blockAt: () => null, waterAt: () => false
  });
  h.pointer(h.canvas, 'pointermove', 1, 131, 120, 'mouse');
  assert.equal(h.hoverInfo.textContent, 'Outside the travel area');
  h.pointer(h.canvas, 'pointerdown', 1, 131, 120);
  h.pointer(h.canvas, 'pointerup', 1, 131, 120);
  assert.deepEqual(h.teleports, []);
  assert.equal(h.map.isFullMapOpen, true);
  h.pointer(h.canvas, 'pointermove', 2, 130, 120, 'mouse');
  assert.match(h.hoverInfo.textContent, /^Outside Gemeente Ede/);
  h.pointer(h.canvas, 'pointerdown', 2, 130, 120);
  h.pointer(h.canvas, 'pointerup', 2, 130, 120);
  assert.deepEqual(h.teleports, [[1020, 2000]]);
});

test('a map tap finds the framed approach to a landmark outside the area menu', () => {
  const theatre = { id: 'openluchttheater', name: 'De Eder Kuil', x: 1000, z: 2000 };
  const h = mapHarness([theatre, { id: 'old-site', name: 'Old Site', x: 1003, z: 2000 }],
    { [theatre.id]: { focus: { x: theatre.x, z: theatre.z } } });
  h.pointer(h.canvas, 'pointermove', 1, 110, 120, 'mouse');
  assert.match(h.hoverInfo.textContent, /teleport to the approach/);
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.landmarkTeleports, [theatre.id]);
  assert.equal(h.teleports.length, 0);
  assert.equal(h.map.isFullMapOpen, false);

  h.map.toggleFullMap(true);
  h.pointer(h.canvas, 'pointerdown', 2, 113, 120);
  h.pointer(h.canvas, 'pointerup', 2, 113, 120);
  assert.deepEqual(h.teleports, [[1003, 2000]]);
});

test('the atlas omits hidden and commercial labels while keeping public landmarks searchable', async () => {
  const { NYC_LANDMARKS, TELEPORT_LOCATIONS } = await import('../js/city-config.js');
  const mast = { id: 'mast', name: 'Zendmast', short: 'Zendmast', x: 1000, z: 2000, hideOnMap: true };
  const area = { id: 'area', name: 'Village Centre', short: 'Village Centre', x: 1200, z: 2050, hideOnMap: true };
  const church = { id: 'kerk', name: 'Church', short: 'Church', x: 700, z: 2350 };
  const lukkien = { ...NYC_LANDMARKS.find(site => site.id === 'lukkien'), x: 1050, z: 1900 };
  const policeStation = { ...NYC_LANDMARKS.find(site => site.id === 'moeke-ede'), x: 1600, z: 2300 };
  assert.ok(TELEPORT_LOCATIONS[lukkien.id]);
  const h = mapHarness([mast, area, church, lukkien, policeStation], {
    mast: { focus: mast }, area: { focus: area }, kerk: { focus: church },
    lukkien: { focus: lukkien }, 'moeke-ede': { focus: policeStation }
  }, {
    city: 'Ede', ede: { meta: { areas: [
      { name: 'Neighbourhood', labelPoint: [450, 1500] },
      { name: 'Village', place: 'village', labelPoint: [1500, 1500] }
    ] },
      parks: [{ name: 'Local park', kind: 'park', ring: [1240, 1700, 1260, 1700, 1260, 1720, 1240, 1720] }] },
  });
  const labels = [], circles = [];
  const ctx = new Proxy({ canvas: { width: 200, height: 200 }, measureText: () => ({ width: 20 }),
    fillText: label => labels.push(label), arc: (x, y) => circles.push([x, y]) }, {
    get: (target, key) => target[key] ?? (() => {}),
  });
  Object.assign(h.map, { drawWorld() {}, drawRoadLabels() {}, drawScaleBar() {}, viewZoom: 0.1 });
  h.map.renderFullMapStatic(ctx, { w: 200, h: 200, s: 0.1, screen() {},
    toX: x => (x - 1000) * 0.1, toY: z => (z - 2000) * 0.1 });
  assert.deepEqual(labels, ['Village', 'LOCAL PARK', 'Church', 'Oud Politiebureau']);
  assert.deepEqual(circles, [[-30, 35], [-30, 35], [60, 30], [60, 30]]);
  labels.length = circles.length = 0;
  h.map.viewZoom = 0.03;
  h.map.renderFullMapStatic(ctx, { w: 200, h: 200, s: 0.03, screen() {},
    toX: x => (x - 1000) * 0.03, toY: z => (z - 2000) * 0.03 });
  assert.deepEqual(labels, ['Village']);
  assert.deepEqual(circles, []);
  assert.equal(h.map.scenicLandmarkAt(church, { width: 200, height: 200 }), null);
  h.map.viewZoom = 0.1;
  assert.equal(h.map.scenicLandmarkAt(mast, { width: 200, height: 200 }), null);
  assert.equal(h.map.scenicLandmarkAt(lukkien, { width: 200, height: 200 }), null);
  assert.equal(h.map.scenicLandmarkAt(policeStation, { width: 200, height: 200 }).name, 'Oud Politiebureau');
  for (const query of [area.name, lukkien.name, 'Moeke']) {
    h.map.search(query);
    assert.equal(h.map.viewCenterX, 1000);
  }
  h.map.search('Oud Politiebureau');
  assert.equal(h.map.viewCenterX, policeStation.x);
  h.map.search(church.name);
  assert.equal(h.map.viewCenterX, church.x);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'hidden', 'close']) {
  test(`${interruption} cancels a map tap without teleporting or leaving a drag active`, () => {
    const h = mapHarness();
    h.pointer(h.canvas, 'pointerdown', 1);
    if (interruption === 'blur') h.window.dispatch('blur');
    else if (interruption === 'hidden') {
      h.document.hidden = true;
      h.document.dispatch('visibilitychange');
    } else if (interruption === 'close') h.map.toggleFullMap(false);
    else if (interruption === 'lostpointercapture') h.canvas.releasePointerCapture(1);
    else h.pointer(h.canvas, interruption, 1);
    h.pointer(h.canvas, 'pointerup', 1);
    assert.equal(h.teleports.length, 0);
    assert.equal(h.map.isPanning, false);
    assert.equal(h.captured.size, 0);
    assert.equal(h.wrapper.classList.contains('is-panning'), false);
    if (interruption === 'close') {
      assert.deepEqual(h.toggles, [true, false]);
      h.map.toggleFullMap(true);
    }
    h.pointer(h.canvas, 'pointerdown', 2);
    h.pointer(h.canvas, 'pointerup', 2);
    assert.equal(h.teleports.length, 1);
  });
}

test('a pointer released outside the map or far from its start does not teleport', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 205);
  h.pointer(h.controls, 'pointerup', 1, 215);
  h.pointer(h.canvas, 'pointerdown', 2, 110);
  h.pointer(h.canvas, 'pointerup', 2, 130);
  assert.equal(h.teleports.length, 0);
});

test('mouse hover and zoom buttons remain available without a pan', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointermove', 1, 120, 130, 'mouse');
  assert.equal(h.hoverInfo.textContent, '1010, 2010 · Click to teleport here');
  h.pointer(h.canvas, 'pointermove', 2, 180, 130);
  assert.equal(h.hoverInfo.textContent, '1010, 2010 · Click to teleport here', 'untracked touch does not update hover');
  h.zoomIn.dispatch('click');
  assert.equal(h.map.viewZoom, 1.45);
  h.zoomOut.dispatch('click');
  assert.equal(h.map.viewZoom, 1);
});

test('pan and wheel events leave a single redraw to the animation frame', () => {
  const h = mapHarness();
  let renders = 0;
  h.map.renderFullMap = () => { renders++; };
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointermove', 1, 120);
  h.pointer(h.canvas, 'pointermove', 1, 130);
  h.pointer(h.canvas, 'pointerup', 1, 130);
  const before = h.map.screenToWorld(80, 60, 200, 200);
  const wheel = { clientX: 90, clientY: 80, deltaY: -1, preventDefault() {} };
  h.canvas.dispatch('wheel', wheel);
  h.canvas.dispatch('wheel', wheel);
  const after = h.map.screenToWorld(80, 60, 200, 200);
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 1e-9);
  assert.equal(renders, 0);
  h.map.update();
  assert.equal(renders, 1);
});

test('the Ede road graph connects both railway stations', async () => {
  const { TELEPORT_LOCATIONS, waterAt, roadCrossesWater } = await import('../js/city-config.js');
  const { GEO } = await import('../js/nyc-geodata.js');
  const { getEdeMapRoute } = loadModule(source, { imports: {
    ...mapImports, './nyc-geodata.js': { GEO },
    './city-config.js': { ...mapImports['./city-config.js'], waterAt, roadCrossesWater }
  } });
  const { edecentrum: start, edewageningen: end } = TELEPORT_LOCATIONS;
  const route = getEdeMapRoute(start.x, start.z, end.x, end.z);
  assert.ok(route.length > 10, 'route follows mapped roads between the stations');
  assert.equal(route[0].x, start.x);
  assert.equal(route.at(-1).z, end.z);
});

test('the city overview fits the whole map on a small canvas', () => {
  const { map, canvas, viewAll, zoomOut } = mapHarness();
  viewAll.dispatch('click');
  const { minX, maxX, minZ, maxZ } = ISLAND_BOUNDS;
  assert.equal(map.viewCenterX, (minX + maxX) / 2);
  assert.equal(map.viewCenterZ, (minZ + maxZ) / 2);
  assert.ok((maxX - minX) * map.viewZoom < canvas.clientWidth);
  assert.ok((maxZ - minZ) * map.viewZoom < canvas.clientHeight);
  const fit = map.viewZoom;
  zoomOut.dispatch('click');
  assert.ok(map.viewZoom <= fit);
});

test('the Ede overview draws the main roads and defers local features until zoomed in', () => {
  class Path2D {
    starts = [];
    moveTo(x) { this.starts.push(x); }
    lineTo() {}
    closePath() {}
  }
  const line = x => [{ x, z: 10 }, { x: x + 5, z: 15 }];
  const roads = [
    { kind: 'tertiary', w: 6, pts: line(10) },
    { kind: 'residential', w: 6, pts: line(20) },
    { kind: 'primary', w: 6, bridge: true, pts: line(30) },
    { kind: 'service', w: 6, bridge: true, pts: line(40) },
  ];
  const poly = [...line(50), { x: 50, z: 15 }];
  const cover = x => [{ x, z: 20 }, { x: x + 5, z: 20 }, { x: x + 40, z: 20 }, { x, z: 90 }];
  const geo = { city: 'Ede', centralPark: { water: [{ ring: cover(100) }] } };
  const blocks = [{ poly }, { poly: cover(80), area: 1400, park: 1 }, { poly: cover(90), area: 200, park: 1 }];
  const bakedParks = [];
  const parkCanvas = { getContext: () => ({ setTransform() {}, fill: path => bakedParks.push(...path.starts) }) };
  const { NYCMapSystem } = loadModule(source, {
    globals: { Path2D, document: { createElement: () => parkCanvas } },
    imports: { ...mapImports, './nyc-geodata.js': { GEO: geo }, './city-config.js': {
      ...mapImports['./city-config.js'], BLOCKS: blocks, ROADS: roads, MANHATTAN_COASTLINE: []
    } }
  });
  const map = Object.create(NYCMapSystem.prototype);
  map.fringePavingMap = { each: (_, draw) => draw({ starts: [60] }) };
  map.exteriorBuildingMap = { each: (_, draw) => draw({ starts: [70] }) };
  function drawnAt(s) {
    const starts = [];
    const record = path => starts.push(...path.starts);
    map.drawWorld({ fill: record, stroke: record, save() {}, restore() {}, clip() {}, drawImage(image) {
      assert.equal(image, parkCanvas);
      starts.push(...bakedParks);
    } }, { s, minX: 0, minZ: 0, maxX: 200, maxZ: 100, sees: () => true, world() {} }, false);
    return starts.sort((a, b) => a - b);
  }
  assert.deepEqual(drawnAt(0.04), [10, 30, 80, 100]);
  assert.deepEqual(drawnAt(0.05), [10, 30, 80, 100]);
  assert.deepEqual(bakedParks, [80]);
  assert.deepEqual(drawnAt(0.12), [10, 20, 30, 40, 50, 60, 70, 80, 80, 90, 90, 100, 100]);
});

test('the municipality overview also fits the complete terrain buffer', () => {
  const terrainBoundary = [[[-17000, -16000, 16000, -16000, 16000, 12000, -17000, 12000]]];
  const { NYCMapSystem } = loadModule(source, {
    imports: { ...mapImports, './ede-coverage.js': { edeCoverage: { terrainBoundary } } }
  });
  const map = Object.create(NYCMapSystem.prototype);
  map.fullSize = () => ({ w: 320, h: 200 });
  const zoom = map.cityOverviewZoom();
  assert.ok(33000 * zoom < 320);
  assert.ok(28000 * zoom < 200);
});

test('the map includes mapped roads in the outer Ede districts', async () => {
  const { EDE_DATA, nearestRoads } = await import('../js/city-config.js');
  for (const [district, road] of [
    ['Kernhem', 'Heuvingerzand'],
    ['Veldhuizen', 'Hofbeeklaan'],
    ['Rietkampen', 'Trumandreef'],
    ['Maandereng', 'Judith Leysterstraat'],
    ['Bedrijventerrein', 'Archimedesstraat'],
    ['Veluwse Poort', 'Renkumseweg']
  ]) {
    const { labelPoint: [x, z] } = EDE_DATA.meta.areas.find(area => area.name === district);
    assert.ok(nearestRoads(x, z, 200).some(q => q.road.name === road), `${district} includes ${road}`);
  }
});

test('atlas GPS connectors stay inside the municipal outline', () => {
  const GEO = {
    city: 'Ede',
    roadGraph: { nodes: [3, 0, 8, 0], links: [[0, 1, '', 6, '', 1, []]] }
  };
  const { getEdeMapRoute } = loadModule(source, { imports: {
    ...mapImports, './nyc-geodata.js': { GEO },
    './city-config.js': { ...mapImports['./city-config.js'],
      containsPlayablePoint: x => x !== 1, waterAt: () => false }
  } });
  assert.deepEqual(Array.from(getEdeMapRoute(0, 0, 9, 0), p => p.x), [3, 8, 9]);
});

test('atlas GPS connections stop at open water and can reach a mapped bridge', () => {
  const GEO = {
    city: 'Ede',
    roadGraph: { nodes: [2, 0, 8, 0], links: [[0, 1, '', 6, '', 1, []]] }
  };
  let crossing = false;
  const { getEdeMapRoute } = loadModule(source, { imports: {
    ...mapImports, './nyc-geodata.js': { GEO },
    './city-config.js': { ...mapImports['./city-config.js'],
      waterAt: x => x >= 0 && x <= 1, roadCrossesWater: () => crossing }
  } });
  const xs = (...positions) => Array.from(getEdeMapRoute(...positions), point => point.x);
  assert.deepEqual(xs(-4, 0, 9, 0), [2, 8, 9]);
  assert.deepEqual(xs(9, 0, -4, 0), []);
  crossing = true;
  assert.deepEqual(xs(-4, 0, 9, 0), [-4, 2, 8, 9]);
});
