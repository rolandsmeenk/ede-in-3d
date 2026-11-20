const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { gzipSync } = require('node:zlib');
const { loadModule } = require('./helpers/module.cjs');

const file = name => path.join(__dirname, '..', 'js', name);
const source = name => readFileSync(file(name), 'utf8');

async function fixture(grade = {}, fetch = globalThis.fetch) {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const imports = { 'three/webgpu': THREE };
  const geometry = loadModule(source('ede-geometry.js').replace('export function* edeTerrainGeometries', 'function* edeTerrainGeometries'), {
    imports: { ...imports, './city-config.js': {}, './terrain.js': {}, './ede-grade.js': {} }
  });
  const detail = source('ede-detail.js')
    .replace('export async function loadEdeDetail', 'async function loadEdeDetail')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file('ede-detail.js')).href)) + '\nexport { loadEdeDetail };\n';
  return {
    THREE,
    ...loadModule(detail, {
      imports: { ...imports, './ede-geometry.js': geometry, './ede-grade.js': grade,
        './terrain.js': { getTerrain: () => ({ napOrigin: 22.54 }), terrainHeightAt: () => 2 } },
      globals: { fetch, URL, Response, DecompressionStream }
    }),
    ...loadModule(source('scene-culling.js'), { imports })
  };
}

test('street detail honors gate gaps, surveyed levels, and polygon holes', async () => {
  const { buildEdeDetail, THREE } = await fixture({
    gradeProfileAt(x, z, mode, priority, fallback, id) {
      return id === 'overpass' ? { id, y: 8 + x / 20, kind: 'bridge' } : null;
    }
  });
  const fence = { source: 'bgt', type: 'fence', profileId: 'overpass', level: 1, collidable: true };
  const result = buildEdeDetail(new THREE.Scene(), [
    { ...fence, id: 'before-gate', points: [[0, 0], [6, 0]] },
    { ...fence, id: 'after-gate', points: [[10, 0], [16, 0]], surfaceId: 'bgt-deck' },
    { id: 'courtyard', source: 'bgt', type: 'hedge', level: 0, collidable: true,
      polygon: [[0, 4], [8, 4], [8, 12], [0, 12]], holes: [[[2, 6], [6, 6], [6, 10], [2, 10]]] },
    { id: 'unmatched', source: 'bgt', type: 'bench', level: -1, position: [0, 15] }
  ], { deckProfiles: new Map([['bgt-deck', (x, z) => 11 + x / 20]]) });
  assert.equal(result.stats.bgt, 3);
  assert.equal(result.stats.unresolved[0].id, 'unmatched');
  const { colliders } = result;
  assert.equal(colliders.length, 3);
  assert.ok(colliders[0].maxX < 8 && colliders[1].minX > 8);
  assert.equal(colliders[0].minYAt(5, 0), 8.25);
  assert.equal(colliders[0].maxYAt(5, 0), 9.45);
  assert.equal(colliders[1].minYAt(12, 0), 11.6);
  assert.equal(colliders[2].polygon.holes[0].length, 4);
  assert.equal(colliders[2].minYAt(1, 5), 2);
});

test('instanced furniture and half gantry follow the culling and elevation contracts', async () => {
  const { buildEdeDetail, setupSceneCulling, updateSceneCulling, THREE } = await fixture({
    gradeProfileAt: () => null,
    gradeWayAt: () => ({ y: 7, span: { profile: { site: { kind: 'bridge' } } } })
  });
  const scene = new THREE.Scene();
  const coincidentLamp = { x: 0.2, z: 15 }, freeEndLamp = { x: 12, z: 15 };
  const result = buildEdeDetail(scene, [
    { id: 'stop', type: 'shelter', source: 'bgt', stopId: 'stop-id', level: 0, angle: Math.PI / 2, position: [0, 0] },
    { id: 'distant', type: 'bench', source: 'bgt', level: 0, position: [400, 0] },
    { id: 'half', type: 'gantry', source: '1gis', level: 0, wayId: 'raised-road', points: [[0, 15], [12, 15]], half: true, beamY: 31.54 }
  ], { mappedLamps: [coincidentLamp, freeEndLamp] });
  assert.ok(result.stopIds.has('stop-id'));
  assert.equal(result.stats.counts.gantry, 1);
  const [gantry] = result.gantries;
  assert.equal(gantry.id, 'half');
  assert.equal(gantry.length, 12);
  assert.equal(gantry.ux, 1);
  assert.equal(gantry.level, 0);
  assert.ok(Math.abs(gantry.beam - 9) < 1e-6);
  assert.equal(result.colliders.length, 0);
  const tiles = result.group.children.filter(mesh => mesh.isInstancedMesh);
  const post = tiles.find(mesh => mesh.name === '1GIS detail box');
  assert.equal(post.count, 1);
  assert.equal(post.instanceMatrix.array[12], 0);
  assert.equal(post.instanceMatrix.array[13], 5.5);
  assert.equal(post.instanceMatrix.array[14], 15);
  assert.equal(result.stats.sharedLampSupports, 1);
  assert.equal(result.gantryLampMounts.has(freeEndLamp), false);
  const mount = result.gantryLampMounts.get(coincidentLamp);
  assert.equal(mount.x, 0);
  assert.ok(Math.abs(mount.top - 9.18) < 1e-6);
  const beam = result.group.children.find(mesh => mesh.name === '1GIS detail solid');
  beam.geometry.computeBoundingBox();
  assert.ok(Math.abs(beam.geometry.boundingBox.max.y - 9.18) < 1e-6);

  setupSceneCulling(scene, [result.group]);
  assert.ok(tiles.every(tile => tile.parent === result.group && tile.boundingSphere));
  const near = new THREE.Vector3(0, 2, 0);
  updateSceneCulling(near);
  const farBench = tiles.find(mesh => mesh.boundingSphere.center.x > 380);
  assert.equal(farBench.visible, false);
  assert.equal(post.visible, true);
  updateSceneCulling(new THREE.Vector3(400, 2, 0));
  assert.equal(farBench.visible, true);
});

test('a mapped pond bank tapers to a low crown without adding a collider', async () => {
  const { buildEdeDetail, THREE } = await fixture({ gradeProfileAt: () => null });
  const { group, colliders } = buildEdeDetail(new THREE.Scene(), [
    { id: 'pond-edge', source: 'bgt', type: 'waterEdge', level: 0, points: [[0, 0], [4, 0]] }
  ]);
  const position = group.children[0].geometry.attributes.position;
  assert.ok(Math.abs(position.getY(0) - 2.15) < 1e-6);
  assert.ok(Math.abs(position.getZ(0)) < Math.abs(position.getZ(4)));
  assert.equal(position.count, 12);
  assert.equal(colliders.length, 0);
});

test('a surveyed parapet shoulder joins the fitted deck without creating a travel collider', async () => {
  const { buildEdeDetail, THREE } = await fixture({ gradeProfileAt: () => ({ id: 'bridge', kind: 'bridge', y: 8 }) });
  const { group, colliders } = buildEdeDetail(new THREE.Scene(), [{ id: 'parapet', source: '1gis', type: 'fence',
    level: 1, profileId: 'bridge', points: [[1, 10], [7, 10]], deckShoulder: [[1, 5], [7, 5]] }]);
  const { position } = group.children.find(mesh => mesh.name === '1GIS detail solid').geometry.attributes;
  const yAtInnerEdge = [];
  for (let i = 0; i < position.count; i++) if (position.getZ(i) === 5) yAtInnerEdge.push(position.getY(i));
  assert.ok(yAtInnerEdge.some(y => Math.abs(y - 8.055) < 1e-6));
  assert.ok(yAtInnerEdge.some(y => Math.abs(y - 7.445) < 1e-6));
  assert.equal(colliders.length, 0);
});

test('offline detail loading accepts packed and already decoded responses', async () => {
  const requested = [];
  const { loadEdeDetail } = await fixture({}, async url => {
    const name = path.basename(url.pathname);
    requested.push(name);
    const asset = JSON.stringify({ version: 1, features: [{ id: name }] });
    return new Response(name.includes('bgt') ? gzipSync(asset) : asset);
  });
  const { features } = await loadEdeDetail({ directional: false, bgtStage: 'infrastructure' });
  assert.equal(features[0].source, 'bgt');
  assert.equal(features[1].source, '1gis');
  await loadEdeDetail({ bgt: false, directional: false });
  assert.deepEqual(requested, ['ede-bgt-detail.json.gz', 'ede-1gis-detail.json.gz', 'ede-1gis-detail.json.gz']);
});

test('directional sign faces look toward the approach at the baked NAP height', async () => {
  const { buildEdeDetail, THREE } = await fixture();
  const texture = new THREE.Texture();
  const { group, stats } = buildEdeDetail(new THREE.Scene(), [{ id: '065137003', source: 'nbd', type: 'directionalSign',
    position: [12, 24], centerY: 29.54, angle: Math.PI / 2, width: 6, height: 2, uv: [0, 0, 0.5, 0.5] }], { nbdTexture: texture });
  assert.equal(stats.nbd, 1);
  const face = group.children.find(mesh => mesh.name === 'NBD detail directionalSign');
  const { position, normal } = face.geometry.attributes;
  assert.equal(face.material.map, texture);
  assert.ok(normal.getX(0) > 0.99);
  assert.ok(Math.abs(position.getX(0) - 12.05) < 1e-6);
  assert.equal(position.getY(0), 6);
});

test('BGT stages admit only the intended props and fetch the land mask for all', async () => {
  const requested = [];
  const data = Buffer.alloc(28);
  data.write('BGL1');
  data.writeUInt32LE(2, 4);
  data.writeUInt32LE(2, 8);
  data.writeFloatLE(-125, 12);
  data.writeFloatLE(20, 16);
  data.writeFloatLE(2, 20);
  data.set([1, 2, 4, 5], 24);
  const { loadEdeDetail, THREE } = await fixture({}, async url => {
    const name = path.basename(url.pathname);
    requested.push(name);
    if (name.endsWith('.bin.gz')) return new Response(gzipSync(data));
    const types = name.includes('bgt') ? ['fence', 'drain', 'canopy'] : ['guardrail', 'marking'];
    return new Response(JSON.stringify({ version: 1, features: types.map(type => ({ type })) }));
  });
  const street = await loadEdeDetail({ bgtStage: 'street', directional: false });
  assert.equal(street.features.map(f => f.type).join(','), 'fence,guardrail');
  assert.equal(street.markings.length, 1);
  assert.equal(street.landCover, null);
  assert.ok(!requested.some(file => file.endsWith('.bin.gz')));
  const infrastructure = await loadEdeDetail({ bgtStage: 'infrastructure', motorway: false });
  assert.equal(infrastructure.features.map(f => f.type).join(','), 'fence,drain,canopy');
  assert.ok(!requested.some(file => file.endsWith('.bin.gz')));
  const { landCover } = await loadEdeDetail({ motorway: false });
  assert.equal(requested.filter(file => file.endsWith('.bin.gz')).length, 1);
  assert.equal(landCover.minX, -125);
  assert.equal(landCover.minZ, 20);
  assert.equal(landCover.sizeX, 4);
  assert.equal(landCover.sizeZ, 4);
  assert.equal(landCover.texture.format, THREE.RedFormat);
  assert.equal(landCover.texture.image.data.join(','), '1,2,4,5');
  assert.equal(landCover.palette.image.width, 6);
});

test('BGT drains, bridge balustrades and canopies use the assigned elevations', async () => {
  const { buildEdeDetail, THREE } = await fixture({
    gradeProfileAt(x, z, mode, priority, fallback, id) {
      return id === 'deck' ? { id, y: 8, kind: 'bridge' } : null;
    }
  });
  const { group, stats, colliders } = buildEdeDetail(new THREE.Scene(), [
    { id: 'gutter-at-grade', source: 'bgt', type: 'gutter', level: 0, points: [[10, 15], [30, 15]] },
    { id: 'drain-on-deck', source: 'bgt', type: 'drain', level: 1, profileId: 'deck', points: [[20, 24], [26, 24]] },
    { id: 'railing-on-deck', source: 'bgt', type: 'balustrade', level: 1, profileId: 'deck', points: [[20, 20], [26, 20]] },
    { id: 'roof', source: 'bgt', type: 'canopy', level: 2, topY: 35.54,
      polygon: [[10, 10], [16, 10], [16, 14], [10, 14]],
      supports: [{ position: [11, 11], baseY: 24.54, width: 0.48, depth: 0.35, angle: 0 }] },
    { id: 'unsupported-roof', source: 'bgt', type: 'canopy', level: 1, topY: 35.54,
      polygon: [[40, 10], [46, 10], [46, 14], [40, 14]] }
  ]);
  assert.equal(stats.bgt, 4);
  assert.equal(stats.unresolved[0]?.id, 'unsupported-roof');
  assert.equal(colliders.length, 0);
  const drains = group.children.find(mesh => mesh.name === 'BGT detail inset');
  assert.equal(drains.userData.cullDistance, 65);
  drains.geometry.computeBoundingBox();
  assert.ok(Math.abs(drains.geometry.boundingBox.max.y - 8.074) < 1e-6);
  assert.ok(Math.abs(drains.geometry.boundingBox.min.y - 2.067) < 1e-6);
  const solids = group.children.find(mesh => mesh.name === 'BGT detail solid');
  solids.geometry.computeBoundingBox();
  assert.ok(Math.abs(solids.geometry.boundingBox.max.y - 13.0) < 1e-6);
  const columns = group.children.find(mesh => mesh.name === 'BGT detail pole');
  const matrix = new THREE.Matrix4();
  columns.getMatrixAt(columns.count - 1, matrix);
  const columnHeight = matrix.elements[5];
  assert.ok(Math.abs(matrix.elements[13] - columnHeight / 2 - 2) < 1e-6);
  assert.ok(Math.abs(matrix.elements[13] + columnHeight / 2 - 12.85) < 1e-6);
});
