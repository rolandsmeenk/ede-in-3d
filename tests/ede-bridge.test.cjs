const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const asset = name => JSON.parse(readFileSync(new URL(`../assets/${name}`, require('node:url').pathToFileURL(__filename))));
const FOOT = 16, BICYCLE = 8, CAR = 1;

test('small bridge matching uses the surveyed footprint and rejects road or rail sharing the deck', async () => {
  const { matchSmallBridgeDecks } = await import('../js/ede-bridge.js');
  const deck = { kind: 'deck', layer: 1, ids: ['deck'], axis: [0, 0, 12, 0],
    polygons: [[[0, -2, 0, 2, 12, 2, 12, -2], [4, -0.5, 5, -0.5, 5, 0.5, 4, 0.5]]] };
  const path = { id: 'path', kind: 'cycleway', modes: [BICYCLE | FOOT, BICYCLE | FOOT],
    pts: [-1, 0, 13, 0], layer: 1, bridge: true, surface: 'asphalt' };
  const survey = { deck: { code: 'KBR-1', material: 'wood' } };
  const match = matchSmallBridgeDecks([deck], [path], [], survey).get(deck);
  assert.equal(match.material, 'bridgeAsphalt');
  assert.equal(match.structure, 'bridgeWood');
  assert.deepEqual(match.wayIds, ['path']);
  assert.ok(match.contains(2, 0));
  assert.ok(!match.contains(4.5, 0));
  const road = { ...path, id: 'road', kind: 'residential', modes: [CAR, CAR] };
  assert.equal(matchSmallBridgeDecks([deck], [path, road], []).size, 0);
  assert.equal(matchSmallBridgeDecks([deck], [path, { ...road, layer: -1 }], []).size, 1);
  assert.equal(matchSmallBridgeDecks([deck], [path], [{ ...path, kind: 'rail', modes: undefined }]).size, 0);
});

test('bridge rails follow a sloped deck without closing its ends and wood joints honor holes', async () => {
  const { buildSmallBridge } = await import('../js/ede-bridge.js');
  const outer = [[0, -2], [0, 2], [12, 2], [12, -2]].map(([x, z]) => ({ x, z }));
  const hole = [[4, -0.5], [5, -0.5], [5, 0.5], [4, 0.5]].map(([x, z]) => ({ x, z }));
  const rings = [outer, hole], surface = x => 3 + 0.04 * x;
  const rails = [], joints = [], colliders = [];
  buildSmallBridge({ rings, axis: [0, 0, 12, 0], surface, material: 'bridgeWood', structure: 'bridgeWood' }, {
    slab(kind, form, top, base, options) {
      assert.equal(kind, 'bridgeWood');
      assert.equal(form, rings);
      assert.equal(top(5, 0), surface(5));
      assert.ok(Math.abs(top(5, 0) - base(5, 0) - 0.23) < 1e-9);
      assert.equal(options.underside, true);
    },
    beam(kind, a, b) { rails.push([a, b]); },
    append(kind, coords) { joints.push(coords); },
    addCollider(outline) { colliders.push(outline); },
  });
  assert.ok(rails.flat().every(([x, y, z]) => Math.abs(z) > 1.9 && y >= surface(x) && y <= surface(x) + 1.05));
  assert.equal(new Set(rails.flat().map(p => Math.sign(p[2]))).size, 2);
  assert.equal(colliders.length, 12);
  assert.ok(joints.some(coords => coords[0] > 4.02 && coords[0] < 4.98));
  assert.ok(joints.every(coords => !(coords[0] > 4.02 && coords[0] < 4.98 && coords[2] < 0 && coords[5] > 0)));
});

test('Kraatsvijver uses the BGT footprint, IMWA structure and AHN deck elevation', async () => {
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const { gradeWayAt, setEdeGrade } = await import('../js/ede-grade.js');
  const { matchSmallBridgeDecks } = await import('../js/ede-bridge.js');
  const grade = asset('ede-grade.json');
  const structures = asset('ede-bgt.json').structures;
  const site = structures.find(feature => feature.ids.includes('G0228.23df2a3e919e43e783f49716e62ffb60'));
  const decks = matchSmallBridgeDecks(structures, EDE_DATA.roads, EDE_DATA.railways, asset('ede-bridge-materials.json').decks);
  const bridge = decks.get(site);
  assert.ok(bridge.wayIds.includes('w6954427'));
  assert.equal(bridge.material, 'bridgeAsphalt');
  assert.equal(bridge.structure, 'bridgeWood');
  assert.equal(bridge.survey.code, 'KBR-2185');
  assert.equal(bridge.survey.soffitNap, 15.07);
  setEdeGrade(grade);
  const deckNap = gradeWayAt('w6954427', ...bridge.survey.position).y + grade.datumNAP;
  assert.ok(Math.abs(deckNap - 15.27) < 0.02);
});
