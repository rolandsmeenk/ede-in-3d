const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const test = require('node:test');

const asset = require('../assets/ede-signal-hardware.json');
const readAsset = name => JSON.parse(gunzipSync(readFileSync(join(__dirname, '..', 'assets', name))));

test('baked signal heads join the current OSM controls and reuse surveyed gantries', async () => {
  const { indexEdeSignalHardware } = await import('../js/ede-signal-hardware.js');
  const { byAnchor, supports } = indexEdeSignalHardware(asset);
  const { containsPlayablePoint } = await import('../js/ede-playable-boundary.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const anchors = new Set(EDE_DATA.signals.map(({ x, z }) => `${x}/${z}`));
  const ways = new Set(EDE_DATA.roads.map(road => road.id));
  const gantries = new Set(readAsset('ede-1gis-detail.json.gz').features.filter(f => f.type === 'gantry').map(f => f.id));
  for (const [key, heads] of byAnchor) {
    assert.ok(anchors.has(key), key);
    for (const head of heads) {
      assert.ok(ways.has(head.wayId), head.source);
      assert.ok(containsPlayablePoint(...head.point), head.source);
      assert.ok(containsPlayablePoint(...head.anchor), head.source);
      if (head.pole) assert.ok(containsPlayablePoint(...head.pole), head.source);
      if (head.mount === 'overhead') assert.equal(supports[head.support].level, head.level, head.source);
    }
  }
  assert.equal(new Set(asset.heads.map(head => head.source)).size, asset.heads.length);
  assert.ok(asset.heads.some(head => head.mount === 'roadside'));
  assert.ok(asset.heads.some(head => head.mount === 'overhead'));
  assert.ok(supports.some(s => s.kind === 'gantry'));
  assert.ok(supports.some(s => s.kind === 'cantilever'));
  for (const support of supports) {
    if (support.existingId) assert.ok(gantries.has(support.existingId), support.existingId);
    assert.ok(support.points.every(point => containsPlayablePoint(...point)), support.source);
  }
});

test('invalid signal support references are rejected before replacing the roadside fallback', async () => {
  const { indexEdeSignalHardware } = await import('../js/ede-signal-hardware.js');
  const head = asset.heads.find(head => head.mount === 'overhead');
  assert.throws(() => indexEdeSignalHardware({ ...asset, supports: [], heads: [head] }), /Invalid Ede signal head/);
});

test('the four hospital gantries face their existing directed motor approaches', () => {
  for (const [direction, way, count, faceX, faceZ] of [
    ['northbound', 'w1055535553', 5, 0, 1],
    ['southbound', 'w1055535551', 5, 0, -1],
    ['westbound', 'w1055715727', 5, 1, 0],
    ['eastbound', 'w1055535552', 4, -1, 0],
  ]) {
    const source = `pdok:aerial:ede-vri-2:${direction}`;
    const support = asset.supports.findIndex(row => row.source === source);
    assert.equal(asset.supports[support]?.kind, 'gantry');
    const heads = asset.heads.filter(head => head.support === support);
    assert.equal(heads.length, count, direction);
    assert.ok(heads.every(head => head.wayId === way && head.mount === 'overhead' &&
      faceX * Math.sin(head.heading) + faceZ * Math.cos(head.heading) > 0.95), direction);
  }
});

test('signal feet stay on the approach side, and a reused cantilever can reverse on its surveyed span', async () => {
  const { fitEdeSignalPole, fitEdeSignalSpan } = await import('../js/ede-signal-hardware.js');
  const verge = x => x >= 0.5;
  assert.deepEqual(fitEdeSignalPole([0, 0], [1, 0], verge, 0.75), [0.5, 0]);
  assert.equal(fitEdeSignalPole([0, 0], [1, 0], x => x < -0.1, 1), null);
  assert.equal(fitEdeSignalPole([0, 0], [1, 0], verge, 0.25), null);
  const span = [[0, 0], [8, 0]];
  assert.deepEqual(fitEdeSignalSpan(span, true, x => x > 7), [span[1], span[0]]);
  assert.deepEqual(fitEdeSignalSpan(span, false, x => x < 0 || x > 8), [[-0.25, 0], [8.25, 0]]);
  assert.equal(fitEdeSignalSpan(span, true, () => false), null);
});

test('signal clearance uses the mapped carriageway holes and each level independently', async () => {
  const { loadModule } = require('./helpers/module.cjs');
  const roadSource = readFileSync(join(__dirname, '../js/ede-road-surfaces.js'), 'utf8')
    .replace('export async function', 'async function').replace('import.meta.url', '"https://example.test/js/ede-road-surfaces.js"');
  const surfaces = [
    { layer: 1, function: 'rijbaan regionale weg', polygons: [
      [[0, 0, 12, 0, 12, 12, 0, 12], [3, 3, 6, 3, 6, 6, 3, 6]],
    ] },
    { layer: 0, function: 'fietspad', polygons: [[[0, 14, 12, 14, 12, 16, 0, 16]]] },
  ];
  const roadSurfaces = loadModule(roadSource + '\nexport { loadEdeRoadSurfaces };', {
    globals: { URL, Response, fetch: async url => url.pathname.includes('corridor')
      ? new Response(null, { status: 404 }) : Response.json({ version: 1, surfaces, covered: {} }) },
  });
  await roadSurfaces.loadEdeRoadSurfaces();
  const geometrySource = readFileSync(join(__dirname, '../js/ede-geometry.js'), 'utf8')
    .replace('export function* edeTerrainGeometries', 'function* edeTerrainGeometries');
  const { overlapsEdeTravelPavement: overlaps } = loadModule(geometrySource, {
    imports: {
      'three/webgpu': {}, './terrain.js': {}, './ede-grade.js': {}, './ede-road-surfaces.js': roadSurfaces,
      './ede-road-cell-query.js': await import('../js/ede-road-cell-query.js'),
      './ede-surface-geometry.js': await import('../js/ede-surface-geometry.js'),
      './city-config.js': { EDE_DATA: { roads: [{ id: 'r', kind: 'residential', width: 6, pts: [20, 0, 32, 0] }] } },
    },
  });
  assert.equal(overlaps(2, 2), false);
  assert.equal(overlaps(2, 2, 1), true);
  assert.equal(overlaps(4, 4, 1, 0.2), false);
  assert.equal(overlaps(3.1, 4, 1, 0.2), true);
  assert.equal(overlaps(5, 15), true);
  assert.equal(overlaps(22, 3.1, 0, 0.15), true);
  assert.equal(overlaps(22, 3.1, 1, 0.15), false);
});

async function loadSignalModels() {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const { loadModule } = require('./helpers/module.cjs');
  const source = file => readFileSync(join(__dirname, '..', file), 'utf8');
  const utils = loadModule(source('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), { imports: { '../../../build/three.core.js': THREE } });
  const models = loadModule(source('js/ede-signal-models.js'), {
    globals: { Float32Array },
    imports: { 'three/webgpu': THREE, 'three/addons/utils/BufferGeometryUtils.js': utils },
  });
  return { THREE, ...models };
}

test('Dutch shields fit the lens cover, with round ends and full-width stripes for both lens sizes', async () => {
  const { THREE, createEdeSignalHeadGeometries } = await loadSignalModels();
  const { backplate, largeBackplate, lenses } = createEdeSignalHeadGeometries();
  for (const [geometry, scale, width, height, stripe] of [
    [backplate, 1, 0.60, 1.19, 0.030],
    [largeBackplate, 1.5, 0.90, 1.60, 0.050],
  ]) {
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(scale);
    assert.ok(Math.abs(size.x - width) < 1e-6);
    assert.ok(Math.abs(size.y - height) < 1e-6);
    const shield = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    shield.scale.setScalar(scale);
    shield.updateMatrixWorld();
    const lens = new THREE.Mesh(lenses, new THREE.MeshBasicMaterial());
    lens.scale.setScalar(scale);
    lens.updateMatrixWorld();
    const rayAt = (x, y) => new THREE.Raycaster(new THREE.Vector3(x, y, 2), new THREE.Vector3(0, 0, -1));
    function redAt(x, y) {
      const hit = rayAt(x, y).intersectObject(shield)[0];
      return hit && geometry.attributes.color.getX(hit.face.a);
    }
    const rim = rayAt(width / 2 - stripe / 2, 0).intersectObject(shield)[0];
    assert.ok(Math.abs(rim.point.z / scale - 0.11) < 1e-6);
    for (const y of [-0.25, 0, 0.25]) {
      const ray = rayAt(0, y * scale);
      const cover = ray.intersectObject(shield)[0];
      const litLens = ray.intersectObject(lens)[0];
      assert.ok(cover.point.z < rim.point.z, 'the shield leaves an aperture in front of each lens');
      assert.ok(litLens.point.z > rim.point.z, 'the lens projects through the shield');
    }
    assert.ok(redAt(width / 2 - stripe + 0.001, 0) > 0.8);
    assert.ok(redAt(width / 2 - stripe - 0.001, 0) < 0.05);
    assert.equal(redAt(width / 2 - 0.015, height / 2 - 0.015), undefined);
    assert.ok(redAt(0, height / 2 - stripe / 2) > 0.8);
  }
});

test('roadside signal clearance is measured at the shield or housing lower edge', async () => {
  const { fitEdeRoadsideSignalY } = await import('../js/ede-signal-hardware.js');
  const roadY = -12;
  for (const halfHeight of [0.595, 0.415]) {
    const inRange = roadY + halfHeight + 2.35;
    assert.equal(fitEdeRoadsideSignalY(roadY, halfHeight, inRange), inRange);
    for (const observedY of [undefined, roadY + 1.85, roadY + 4]) {
      const center = fitEdeRoadsideSignalY(roadY, halfHeight, observedY);
      assert.ok(Math.abs(center - halfHeight - roadY - 2.3) < 1e-9);
    }
  }
});

test('the photographed Schutterweg cantilever preserves raw head heights and records the beam fit', () => {
  const supportId = asset.supports.findIndex(support => support.existingId === '1gis:31:2102709001');
  const support = asset.supports[supportId];
  assert.equal(support.headAlignment, 'beamCenter');
  assert.equal(support.alignmentEvidence.date, '2022-10-08');
  const heads = asset.heads.filter(head => head.support === supportId);
  assert.equal(heads.length, 2);
  assert.ok(heads.every(head => head.y - support.beamY > 0.5));
});

test('all Dutch arrow directions stencil the three main lenses and a single auxiliary lens', async () => {
  const { THREE, createEdeArrowLenses } = await loadSignalModels();
  const diagonal = Math.SQRT1_2;
  for (const [direction, [dx, dy]] of Object.entries({
    left: [-1, 0], 'ahead-left': [-diagonal, diagonal], straight: [0, 1],
    'ahead-right': [diagonal, diagonal], right: [1, 0],
  })) {
    for (const auxiliary of [false, true]) {
      const geometry = createEdeArrowLenses(direction, auxiliary);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      const maskAt = (x, y) => {
        const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 2), new THREE.Vector3(0, 0, -1));
        const hit = ray.intersectObject(mesh)[0];
        return hit && geometry.attributes.signalMask.getX(hit.face.a);
      };
      for (const center of auxiliary ? [0] : [-0.25, 0, 0.25]) {
        assert.equal(maskAt(0.07 * dx, center + 0.07 * dy), 1, direction);
        assert.equal(maskAt(-0.07 * dy, center + 0.07 * dx), 0, direction);
      }
      if (auxiliary) assert.equal(maskAt(0, 0.25), undefined);
    }
  }
});

test('the asset keeps reviewed arrows and supports explicitly phased auxiliary green arrows', async () => {
  const { indexEdeSignalHardware } = await import('../js/ede-signal-hardware.js');
  const reviewed = asset.heads.filter(head => head.arrow);
  assert.deepEqual(reviewed.map(({ source, arrow }) => [source, arrow]).sort(),
    [['1gis:13:237719', 'left'], ['1gis:13:496247', 'left']]);
  const greenArrow = { direction: 'ahead-right', side: 'right', phases: ['red', 'amber'] };
  const head = { ...reviewed[0], greenArrow };
  const check = head => indexEdeSignalHardware({ ...asset, heads: [head] });
  assert.equal(check(head).byAnchor.get(head.anchor.join('/'))[0].greenArrow, greenArrow);
  assert.throws(() => check({ ...head, arrow: 'down' }), /Invalid Ede signal head/);
  assert.throws(() => check({ ...head, greenArrow: { ...greenArrow, phases: ['off'] } }), /Invalid Ede signal head/);
});
