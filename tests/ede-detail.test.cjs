const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { gzipSync } = require('node:zlib');
const { loadModule } = require('./helpers/module.cjs');

const file = name => path.join(__dirname, '..', 'js', name);
const source = name => readFileSync(file(name), 'utf8');

async function fixture(grade = {}, fetch = globalThis.fetch, roadPavement = () => false) {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const imports = { 'three/webgpu': THREE };
  const geometry = loadModule(source('ede-geometry.js').replace('export function* edeTerrainGeometries', 'function* edeTerrainGeometries'), {
    imports: { ...imports, './city-config.js': { EDE_DATA: { roads: [] } }, './ede-road-surfaces.js': { isEdeTrafficPavement: roadPavement },
      './terrain.js': { getTerrain: () => null }, './ede-grade.js': {} }
  });
  const detail = source('ede-detail.js')
    .replace('export async function loadEdeDetail', 'async function loadEdeDetail')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file('ede-detail.js')).href)) + '\nexport { loadEdeDetail };\n';
  return {
    THREE,
    ...loadModule(detail, {
      imports: { ...imports, './ede-geometry.js': geometry, './ede-grade.js': grade,
        './ede-signal-hardware.js?v=20261121-hospital-signals': await import('../js/ede-signal-hardware.js'),
        './ede-playground-equipment.js': loadModule(source('ede-playground-equipment.js')),
        './ede-scene-coordinates.js': loadModule(source('ede-scene-coordinates.js')),
        './terrain.js': { getTerrain: () => ({ napOrigin: 22.54 }), terrainHeightAt: () => 2 } },
      globals: { fetch, URL, Response, DecompressionStream, AbortController }
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

test('parcel styles use tiled close detail and keep inferred boundaries decorative', async () => {
  const { buildEdeDetail, THREE } = await fixture({ gradeProfileAt: () => null });
  const fence = { source: 'parcel', type: 'fence', level: 0, collidable: true };
  const result = buildEdeDetail(new THREE.Scene(), [
    { ...fence, id: 'metal', status: 'observed', style: 'metalMesh', points: [[0, 0], [5, 0]] },
    { ...fence, id: 'rear-fence', status: 'inferred', style: 'timber', points: [[0, 12], [5, 12]] },
    { ...fence, id: 'front-hedge', type: 'hedge', status: 'inferred', style: 'clippedHedge', points: [[0, 24], [5, 24]] },
    { id: 'patio', type: 'parcelSurface', source: 'parcel', level: 0, status: 'inferred',
      surface: 'patio', polygon: [[0, 30], [3, 30], [3, 33], [0, 33]] },
  ]);
  assert.equal(result.stats.parcel, 4);
  assert.equal(result.colliders.length, 1);
  const wire = result.group.getObjectByName('PARCEL detail wireFence');
  assert.equal(wire.geometry.attributes.uv.count, 4);
  assert.equal(wire.material.map.generateMipmaps, true);
  assert.equal(wire.userData.cullDistance, 105);
  assert.equal(result.group.getObjectByName('PARCEL detail tuft').userData.cullDistance, 75);
});

test('parcel tiles build close to the camera and dispose on a long jump', async () => {
  const row = { id: 'garden', type: 'parcelSurface', source: 'parcel', level: 0, status: 'inferred',
    surface: 'patio', polygon: [[1, 1], [3, 1], [3, 3], [1, 3]] };
  const requests = [];
  const { THREE, buildEdeDetail, streamParcelTiles } = await fixture({ gradeProfileAt: () => null }, async url => {
    requests.push(url.pathname.split('/').at(-1));
    return new Response(JSON.stringify({ version: 1, features: [row] }));
  });
  const scene = new THREE.Scene();
  const { resources } = buildEdeDetail(scene, [row]);
  const stream = streamParcelTiles(scene, [
    { id: '0_0', bounds: [0, 0, 5, 5], count: 1 },
    { id: '3_0', bounds: [500, 0, 510, 5], count: 1 },
  ], resources, false);
  const camera = new THREE.Vector3(0, 3, 0);
  stream.update(camera, 0);
  await new Promise(resolve => setImmediate(resolve));
  stream.update(camera, 40);
  assert.deepEqual(requests, ['0_0.json.gz']);
  assert.equal(stream.stats.placements, 1);
  const group = scene.getObjectByName('EdeParcelTiles');
  let disposed = false;
  group.children[0].children[0].geometry.addEventListener('dispose', () => { disposed = true; });
  camera.x = 500;
  stream.update(camera, 41);
  assert.deepEqual(requests, ['0_0.json.gz', '3_0.json.gz']);
  assert.equal(stream.stats.placements, 0);
  assert.equal(group.children.length, 0);
  assert.equal(disposed, true);
  stream.dispose();
});

test('utility replacements are registered only after valid exterior geometry is built', async () => {
  const { buildEdeDetail, THREE } = await fixture();
  const source = 'utility', type = 'utilityHouse', height = 2.45, baseY = 3;
  const polygon = [[0, 0], [4, 0], [4, 3], [0, 3]];
  const result = buildEdeDetail(new THREE.Scene(), [
    { id: 'confirmed', source, type, polygon, height, baseY, roofRise: 0.7, bagId: '0123', osmId: 'w21', door: [0, 0.5] },
    { id: 'broken', source, type, polygon: [[0, 0]], height, baseY, bagId: '0124', osmId: 'w22' },
    { id: 'cabinet', type: 'electricalCabinet', source, position: [8, 5], height: 1.2, width: 0.5, depth: 0.3 },
  ]);
  assert.deepEqual([...result.group.userData.replacements.bag], ['0123']);
  assert.deepEqual([...result.group.userData.replacements.osm], ['w21']);
  assert.equal(result.stats.utility, 2);
  assert.equal(result.stats.unresolved[0].id, 'broken');
  assert.equal(result.colliders[0].maxYAt(1, 1), 5.45);
  const shell = result.group.getObjectByName('UTILITY detail utilityShell');
  shell.geometry.computeBoundingBox();
  assert.equal(shell.userData.cullDistance, 0);
  assert.ok(Math.abs(shell.geometry.boundingBox.max.y - 5.45) < 1e-6);
});

test('missing or invalid parcel assets preserve the previous BGT barriers', async () => {
  const base = { id: 'bgt-id', type: 'fence', level: 0, points: [[0, 0], [2, 0]] };
  let parcel = null;
  const { loadEdeDetail } = await fixture({}, async url => {
    if (url.pathname.endsWith('ede-parcel-detail.json.gz')) return parcel
      ? new Response(JSON.stringify(parcel)) : new Response('', { status: 404 });
    if (url.pathname.endsWith('ede-bgt-land.bin.gz')) {
      const bytes = new Uint8Array(25), header = new DataView(bytes.buffer);
      header.setUint32(0, 0x314c4742, true);
      header.setUint32(4, 1, true);
      header.setUint32(8, 1, true);
      header.setFloat32(20, 2, true);
      return new Response(bytes);
    }
    return new Response(JSON.stringify({ version: 1, features: [base] }));
  });
  const options = { parcels: true, motorway: false, directional: false, municipal: false };
  const read = async () => Array.from((await loadEdeDetail(options)).features, f => f.source);
  assert.deepEqual(await read(), ['bgt']);
  parcel = { version: 1, replaces: ['bgt-id'], features: [{ id: 'broken', type: 'fence' }] };
  assert.deepEqual(await read(), ['bgt']);
  parcel.features = [{ ...base, id: 'reviewed', status: 'observed' }];
  assert.deepEqual(await read(), ['parcel']);
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
  const beam = tiles.find(mesh => mesh.name === '1GIS detail round');
  assert.equal(beam.count, 1);
  assert.equal(beam.geometry.type, 'CylinderGeometry');
  const matrix = new THREE.Matrix4();
  beam.getMatrixAt(0, matrix);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(new THREE.Vector3(6, 9, 15)) < 1e-6);
  const along = new THREE.Vector3().setFromMatrixColumn(matrix, 1);
  assert.ok(along.distanceTo(new THREE.Vector3(12, 0, 0)) < 1e-6);
  for (const column of [0, 2]) {
    assert.ok(Math.abs(new THREE.Vector3().setFromMatrixColumn(matrix, column).length() - 0.36) < 1e-6);
  }

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

test('a full gantry has three truss chords and keeps its destination panel in front', async () => {
  const { buildEdeDetail, THREE } = await fixture();
  const { group, gantries } = buildEdeDetail(new THREE.Scene(), [
    { id: 'exit', source: 'nbd', type: 'directionalSign', mountId: 'portal', position: [12, 15.3],
      centerY: 31.54, bracketY: 31.54, bracket: [12, 15], angle: 0, width: 4, height: 3, uv: [0, 0, 1, 1] },
    { id: 'portal', source: '1gis', type: 'gantry', sourceSubtype: 'VDC106/CB-1',
      points: [[0, 15], [24, 15]], beamY: 31.54 }
  ], { nbdTexture: new THREE.Texture() });
  const [gantry] = gantries;
  assert.equal(gantry.halfDepth, 0.8);
  const chords = group.getObjectByName('1GIS detail round');
  assert.equal(chords.count, 3);
  const centers = [];
  for (let i = 0; i < chords.count; i++) {
    const matrix = new THREE.Matrix4();
    chords.getMatrixAt(i, matrix);
    centers.push(new THREE.Vector3().setFromMatrixPosition(matrix));
  }
  const closeTo = (a, b) => Math.abs(a - b) < 1e-5;
  assert.ok(centers.every(center => closeTo(center.x, 12)));
  assert.ok(centers.some(center => closeTo(center.y, gantry.beam + Math.sqrt(3) * gantry.halfDepth) && closeTo(center.z, 15)));
  for (const z of [14.2, 15.8]) {
    assert.ok(centers.some(center => closeTo(center.y, gantry.beam) && closeTo(center.z, z)));
  }
  assert.ok(gantry.panels[0].z > 15.8);
  const backing = group.getObjectByName('NBD detail solid').geometry;
  backing.computeBoundingBox();
  assert.ok(closeTo(backing.boundingBox.min.z, 15.8));
});

test('a surveyed cantilever corrects its foot independently of the optional signal asset', async () => {
  const { buildEdeDetail, THREE } = await fixture({}, globalThis.fetch, (x, z, layer) => layer === 0 && x < 3);
  const { gantries, group } = buildEdeDetail(new THREE.Scene(), [
    { id: 'signal-span', source: '1gis', type: 'gantry', half: true, points: [[0, 0], [8, 0]], beamY: 31.54 },
  ]);
  assert.equal(gantries[0].x, 8);
  assert.equal(gantries[0].ux, -1);
  const post = group.getObjectByName('1GIS detail box');
  const matrix = new THREE.Matrix4();
  post.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[12], 8);
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

test('the municipal sidecar suppresses matched BGT duplicates and leaves unrelated furniture', async () => {
  const { loadEdeDetail } = await fixture({}, async url => {
    const name = path.basename(url.pathname);
    if (name === 'ede-bgt-land.bin.gz') return new Response(null, { status: 404 });
    const data = name === 'ede-municipal-detail.json.gz' ?
      { replaces: ['duplicate'], features: [{ id: 'mor_afvalbakken.7', type: 'bin' }] } :
      { features: [{ id: 'duplicate', type: 'bin' }, { id: 'unrelated', type: 'bench' }] };
    return new Response(gzipSync(JSON.stringify({ version: 1, ...data })));
  });
  const base = { bgt: true, motorway: false, directional: false };
  const ids = result => [...result.features].map(feature => `${feature.source}/${feature.id}`);
  assert.deepEqual(ids(await loadEdeDetail(base)), ['bgt/unrelated', 'municipal/mor_afvalbakken.7']);
  assert.deepEqual(ids(await loadEdeDetail({ ...base, municipal: false })), ['bgt/duplicate', 'bgt/unrelated']);
});

test('municipal underground shafts respect supporting levels and use close-range instance tiles', async () => {
  const { buildEdeDetail, THREE } = await fixture({ gradeProfileAt: () => ({ kind: 'surface', y: 4 }) });
  const { group, colliders, stats } = buildEdeDetail(new THREE.Scene(), [
    { id: 'mor_acv_containers.8', source: 'municipal', type: 'container', model: 'underground',
      position: [25, 42], angle: 0.7, baseOffset: 0.065, height: 0.95,
      width: 0.7, length: 0.6, level: 0, collidable: true, streams: ['glass', 'pmd'] },
  ]);
  assert.equal(stats.municipal, 1);
  assert.equal(colliders.length, 1);
  assert.equal(colliders[0].minY, 4.065);
  assert.ok(Math.abs(colliders[0].maxY - 5.015) < 1e-7);
  const [tile] = group.children;
  assert.equal(tile.userData.cullDistance, 112);
  assert.equal(tile.count, 6);
  const bounds = new THREE.Box3().setFromObject(tile);
  assert.ok(bounds.min.y > 4.04 && bounds.max.y < 5.03);
});

test('the motorway sign atlas uses truecolor for Safari WebGPU uploads', () => {
  const png = readFileSync(path.join(__dirname, '../assets/ede-nbd-signs.png'));
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png[25], 2, 'PNG color type 2 stores RGB without a palette');
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
  assert.ok(Math.abs(position.getX(0) - 12.0475) < 1e-6);
  assert.equal(position.getY(0), 6);
});

test('a directional panel has a single front surface and its roadside post sits behind it', async () => {
  const { buildEdeDetail, THREE } = await fixture();
  const { group } = buildEdeDetail(new THREE.Scene(), [{ id: 'roadside', source: 'nbd', type: 'directionalSign',
    position: [0, 0], centerY: 28.54, angle: 0, width: 2, height: 2, support: true, uv: [0, 0, 0.5, 0.5] }],
    { nbdTexture: new THREE.Texture() });
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0.025, 5.2, 25), new THREE.Vector3(0, 0, -1));
  const panel = group.children.find(mesh => mesh.name === 'NBD detail directionalSign');
  const backing = group.children.find(mesh => mesh.name === 'NBD detail solid');
  const support = group.children.find(mesh => mesh.name === 'NBD detail pole');
  assert.equal(ray.intersectObject(group, true)[0].object, panel);
  assert.ok(ray.intersectObject(backing)[0].point.z < -0.04);
  assert.ok(ray.intersectObject(support)[0].point.z < -0.04);
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
