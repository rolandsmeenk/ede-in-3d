const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const filename = join(__dirname, '../js/ede-road-furniture-placement.js');
const { createRoadFurniturePlacement } = loadModule(readFileSync(filename, 'utf8'), { filename });
const road = { ux: 1, uz: 0, x: 3, z: 0, width: 6 };
const pavement = (north, south, layer = 0) => ({ layer, function: 'rijbaan autosnelweg',
  polygons: [[[-10, north, 20, north, 20, south, -10, south]]] });
const hecto = pos_tv_wol => ({ type: 'hecto', roadTangent: [1, 0], pos_tv_wol });

test('Re and Li use opposite outer edges at the same station', () => {
  const place = createRoadFurniturePlacement([pavement(-4, 6), pavement(8, 12), pavement(-9, 12, 1)]);
  assert.deepEqual({ ...place(hecto('Re'), 3, 0, road) }, { x: 3, z: 7 });
  assert.deepEqual({ ...place(hecto('Li'), 3, 0, road) }, { x: 3, z: -5 });
});

test('roadside RVV signs keep their mapped side and cross connected carriageway polygons', () => {
  const place = createRoadFurniturePlacement([pavement(-4, 3), pavement(3, 6)]);
  assert.deepEqual({ ...place({ type: 'rvv' }, 3, 2, road) }, { x: 3, z: 7 });
  assert.deepEqual({ ...place({ type: 'rvv' }, 3, -2, road) }, { x: 3, z: -5 });
  assert.deepEqual({ ...place({ type: 'rvv', yaw: -Math.PI / 2 }, 3, 0, road) }, { x: 3, z: 7 });
  assert.deepEqual({ ...place({ type: 'rvv', yaw: Math.PI / 2 }, 3, 0, road) }, { x: 3, z: -5 });
  assert.deepEqual({ ...place({ type: 'rvv', placement: 'ABOVE' }, 3, 2, road) }, { x: 3, z: 2 });
});

test('uses a mapped verge within the allowed road-edge offsets', () => {
  const verge = { ...pavement(6.7, 6.9), function: 'berm' };
  const place = createRoadFurniturePlacement([pavement(-4, 6), verge]);
  assert.deepEqual({ ...place(hecto('Re'), 3, 0, road) }, { x: 3, z: 6.8 });
});

test('mounts on a same-level BGT post within 1.5 m of the berm anchor', () => {
  const guardrail = { type: 'guardrail', source: 'bgt', level: 0, points: [[0, 7.5], [2, 7.5], [9, 7.5]] };
  const elevated = { ...guardrail, level: 1, points: [[3, 7], [9, 7]] };
  const otherSource = { ...elevated, level: 0, source: '1gis' };
  const place = createRoadFurniturePlacement([pavement(-4, 6)], [guardrail, elevated, otherSource]);
  assert.deepEqual({ ...place(hecto('Re'), 3, 0, road) }, { x: 4, z: 7.5, guardrail });
  assert.deepEqual({ ...place(hecto('Re'), 6, 0, { ...road, x: 6 }) }, { x: 6, z: 7 });
  assert.deepEqual({ ...place(hecto('Li'), 3, 0, road) }, { x: 3, z: -5 });
});

test('uses road width at gaps for centerline hectopunten and retains observed RVV positions', () => {
  const place = createRoadFurniturePlacement();
  assert.deepEqual({ ...place(hecto('Li'), 3, 0, road) }, { x: 3, z: -4 });
  assert.deepEqual({ ...place({ type: 'rvv' }, 3, 2, road) }, { x: 3, z: 2 });
});

test('A12 posts follow each direction to separate right-hand rails on the rendered road level', () => {
  const rail = (z, extra = {}) => ({ type: 'guardrail', source: '1gis', route: 'A12',
    side: 'right', matchConfidence: 'matched', points: [[-10, z], [20, z]], ...extra });
  const eastbound = rail(13), westbound = rail(-12);
  const place = createRoadFurniturePlacement([pavement(-11, 12), pavement(-6, 6, -1)], [
    eastbound, westbound, rail(0), rail(12.3, { level: 1 }), rail(12.1, { side: 'left' }),
    rail(12.2, { matchConfidence: 'review' }), rail(12.4, { solid: true })
  ]);
  const mainline = { kind: 'motorway', layer: 0 };
  const post = { ...hecto('Re'), wegnummer: 'A12', layer: -1 };
  assert.deepEqual({ ...place({ ...post, yaw: -Math.PI / 2 }, 3, 0, { ...road, z: 6, road: mainline }) },
    { x: 3, z: 13, guardrail: eastbound });
  assert.deepEqual({ ...place({ ...post, yaw: Math.PI / 2 }, 3, 0, { ...road, z: -5, road: mainline }) },
    { x: 3, z: -12, guardrail: westbound });
});

test('an A12 rail gap leaves the post on the right verge at its own chainage', () => {
  const place = createRoadFurniturePlacement([pavement(-11, 12)], [
    { type: 'guardrail', source: 'bgt', points: [[7, 12.5], [20, 12.5]] },
    { type: 'guardrail', source: 'bgt', points: [[-10, 20], [20, 20]] }
  ]);
  assert.deepEqual({ ...place({ ...hecto('Re'), wegnummer: 'A12', yaw: -Math.PI / 2 }, 3, 0, road) },
    { x: 3, z: 13 });
});

test('an A12 verge fallback clears asphalt on an adjacent exit lane', () => {
  const exit = { ...pavement(12.5, 16), function: 'verbindingsweg', resolution: 'bgt-general' };
  const place = createRoadFurniturePlacement([pavement(-11, 12), exit]);
  assert.deepEqual({ ...place({ ...hecto('Re'), wegnummer: 'A12', yaw: -Math.PI / 2 }, 3, 0, road) },
    { x: 3, z: 17 });
});
