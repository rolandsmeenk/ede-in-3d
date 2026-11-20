const assert = require('node:assert/strict');
const test = require('node:test');

test('BAG identity and wall orientation match a specific diagonal wall', async () => {
  const { readBagFacadeFeatures, facadeFrame, matchBagWall, facadePoint } = await import('../js/ede-facades.js');
  const wall = { a: [2, 3], b: [7, 8], minY: 20, baseOffset: 0.4, height: 5 };
  const ids = ['NL.IMBAG.Pand.0228100000015551', '0228100000030468'];
  const bytes = new TextEncoder().encode(ids.join(''));
  const offsets = Uint32Array.from([0, ids[0].length, bytes.length]);
  const gltf = { parser: { json: { extensions: { EXT_structural_metadata: { propertyTables: [
    { count: 2, properties: { identificatie: { values: 0, stringOffsets: 1, stringOffsetType: 'UINT32' } } }
  ] } } }, async getDependency(_, i) { return [bytes.buffer, offsets.buffer][i]; } } };
  const [features] = await readBagFacadeFeatures(gltf, new Map([[ids[0].slice(-16), [wall]]]));
  assert.deepEqual([...features.keys()], [0]);
  const frame = facadeFrame(features.get(0)[0], 4);
  const points = [facadePoint(frame, 1, 0), facadePoint(frame, 6, 0), facadePoint(frame, 1, 5)];
  const normal = [frame.nx, 0, frame.nz];
  const matched = matchBagWall([frame], points, normal);
  assert.equal(matched.frame.y, 4.4);
  assert.ok(Math.abs(matched.verts[1][0] - 6) < 1e-9);
  assert.equal(matchBagWall([frame], points, normal.map(x => -x)), undefined);
  assert.equal(matchBagWall([frame], points.map(p => [p[0], p[1] + 7, p[2]]), normal), undefined);
});

test('BAG original construction years decode from the per-building metadata table', async () => {
  const { readBagBuildYears } = await import('../js/ede-facades.js');
  const buffer = new ArrayBuffer(12), view = new DataView(buffer);
  [1934, 2147483647, 1982].forEach((year, i) => view.setInt32(i * 4, year, true));
  const metadata = {
    schema: { classes: { building: { properties: {
      oorspronkelijkbouwjaar: { componentType: 'INT32', type: 'SCALAR', noData: 2147483647 }
    } } } },
    propertyTables: [
      { class: 'building', count: 3, properties: { oorspronkelijkbouwjaar: { values: 0 } } },
      { class: 'building', count: 1, properties: {} }
    ]
  };
  const gltf = { parser: { json: { extensions: { EXT_structural_metadata: metadata } }, getDependency: async () => buffer } };
  const [years, missing] = await readBagBuildYears(gltf);
  assert.deepEqual(Array.from(years), [1934, 0, 1982]);
  assert.equal(missing, undefined);
});

test('recess clipping preserves the masonry surface around a doorway across both triangles', async () => {
  const { cutFacadeOpening } = await import('../js/ede-facades.js');
  const vertex = (x, y) => ({ local: [x, y, 0], position: [x, y, 0] });
  const corners = [vertex(0, 0), vertex(8, 0), vertex(8, 6), vertex(0, 6)];
  const cut = [[0, 1, 2], [0, 2, 3]].map(indices => cutFacadeOpening(indices.map(i => corners[i]),
    { x: 2, y: 0, width: 2, height: 3 }));
  const area = points => Math.abs(points.reduce((sum, { local: [x, y] }, i) => {
    const [u, v] = points[(i + 1) % points.length].local;
    return sum + x * v - y * u;
  }, 0)) / 2;
  assert.equal(cut.reduce((sum, p) => sum + area(p.inside), 0), 6);
  assert.equal(cut.flatMap(p => p.outside).reduce((sum, p) => sum + area(p), 0), 42);
});

test('two openings share a wall batch and each exposes its own modeled depth, jambs and trim', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { applyBagFacades, openingTop } = await import('../js/ede-facades.js');
  const wall = {
    a: [0, 0], b: [8, 0], minY: 0, height: 6, wallType: 'street', status: 'observed',
    openings: [
      { kind: 'door', x: 1, y: 0.05, width: 1.5, height: 3.1, arch: 'pointed', depth: 0.28, surround: 0.16 },
      { kind: 'window', x: 5, y: 2, width: 1.6, height: 1.45, depth: 0.12, sill: 0.11 }
    ],
  };
  assert.ok(openingTop(wall.openings[0], 1.75) > openingTop(wall.openings[0], 1.02));
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([0,0,0, 8,0,0, 8,6,0, 0,6,0], 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1, 0,0,1], 3));
  geometry.setAttribute('buildingHeight', new T.Float32BufferAttribute([0, 0, 6, 6], 1));
  geometry.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(12).fill(0.4), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const features = new T.Float32BufferAttribute([0, 0, 0, 0], 1);
  const atlas = {
    physical: new Set([wall]), rects: new Map([[wall, [0, 0, 1, 1]]]), rows: new Map([[wall, 0.5]])
  };
  const measured = applyBagFacades(geometry, features, new Map([[0, [wall]]]), new Map([[0, 0]]), atlas,
    (_wall, _rect, x, y) => [x / 8, y / 6, 1], () => null);
  assert.equal(measured.recesses, 2);
  assert.deepEqual(measured.matched, [wall]);
  const { facadeUv, facadeRelief, facadeStyle, position } = geometry.attributes;
  assert.equal(facadeStyle.count, position.count);
  const depths = Array.from(facadeRelief.array);
  assert.ok(depths.some(depth => Math.abs(depth + 0.28) < 0.0001));
  assert.ok(depths.some(depth => Math.abs(depth + 0.12) < 0.0001));
  assert.ok(depths.some(depth => Math.abs(depth - 0.075) < 0.0001));
  assert.ok(Array.from(facadeUv.array).includes(2), 'jambs have their own surface');
  assert.ok(Array.from(facadeUv.array).includes(3), 'projecting trim has its own surface');
});

test('district masonry survives inferred BAG layouts and yields to observed finishes', async () => {
  const T = await import('../vendor/three/build/three.webgpu.js');
  const { applyBagFacades } = await import('../js/ede-facades.js');
  for (const [status, openingY, expected] of [['inferred', 0.8, 0.25], ['observed', 4.5, 0.5], ['inferred', 4.5, 0.25]]) {
    const openings = [{ kind: 'window', x: 1, y: openingY, width: 1, height: 1 }];
    const wall = { a: [0, 0], b: [8, 0], minY: 0, height: 6, status, openings, wallColor: '#abcdef' };
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([0,0,0, 8,0,0, 8,6,0], 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1], 3));
    geometry.setAttribute('buildingHeight', new T.Float32BufferAttribute([0, 0, 6], 1));
    geometry.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(9).fill(0.25), 3));
    geometry.setAttribute('edeFacadeLayout', new T.Float32BufferAttribute(new Float32Array(12).fill(2), 4));
    geometry.setAttribute('edeFacadeBay', new T.Float32BufferAttribute([0,5, 3,5, 3,5], 2));
    const ids = new T.Float32BufferAttribute([0, 0, 0], 1);
    const atlas = { physical: new Set(), rects: new Map([[wall, [0,0,1,1]]]), rows: new Map([[wall, 0.5]]) };
    const result = applyBagFacades(geometry, ids, new Map([[0, [wall]]]), new Map([[0, 0]]), atlas,
      () => [0, 0, 1], () => [0.5, 0.5, 0.5]);
    if (status === 'inferred' && openingY > 4) assert.equal(result, null);
    else assert.deepEqual(result.matched, [wall]);
    assert.ok(geometry.attributes.color.array.every(value => value === expected));
  }
});

test('BAG bounds fetch and share only intersecting local parameter tiles', async (t) => {
  const { gzipSync } = require('node:zlib');
  const { loadEdeFacades } = await import('../js/ede-facades.js');
  const requested = [];
  const wall = { bagId: '0228100000015551', wallId: 'south', a: [10, 20], b: [16, 20], minY: 0,
    height: 3.4, status: 'observed', openings: [{ kind: 'door', x: 1, y: 0, width: 1, height: 2 }] };
  const inferred = { ...wall, wallId: 'adjacent', b: [10, 23], status: 'inferred' };
  const scoped = { ...inferred, a12: true, wallMaterial: 'corten' };
  const a30Measured = { ...inferred, motorway: 'A30', status: 'observed', wallMaterial: 'metal' };
  const a30Only = { ...inferred, motorway: 'A30', wallId: 'other-side', a: [10, 23], b: [16, 23] };
  t.mock.method(globalThis, 'fetch', async ({ pathname }) => {
    requested.push(pathname.split('/').at(-1));
    if (pathname.endsWith('/ede-facades.json')) return Response.json({
      version: 2, tileSize: 384, tiles: {
        '0,0': 'ede-facades/0_0.json.gz',
        '1,0': 'ede-facades/1_0.json.gz',
        '9,0': 'ede-facades/9_0.json.gz'
      },
      a12Tiles: { '0,0': 'ede-facades/a12_0_0.json.gz', '8,0': 'ede-facades/a12_8_0.json.gz' },
      a30Tiles: { '0,0': 'ede-facades/a30_0_0.json.gz', '8,0': 'ede-facades/a30_8_0.json.gz' },
    });
    const corridor = pathname.endsWith('/a12_0_0.json.gz');
    const a30 = pathname.endsWith('/a30_0_0.json.gz');
    assert.ok(corridor || a30 || pathname.endsWith('/0_0.json.gz'));
    const walls = a30 ? [{ ...wall, motorway: 'A30' }, a30Measured, a30Only]
      : corridor ? [{ ...wall, status: 'inferred', a12: true }, scoped] : [wall, inferred];
    return new Response(gzipSync(JSON.stringify({ version: 2, walls })));
  });
  const index = await loadEdeFacades();
  const bounds = { min: { x: 9, z: 18 }, max: { x: 19, z: 22 } };
  const [first, second] = await Promise.all([index.forBounds(bounds), index.forBounds(bounds)]);
  assert.deepEqual(first.get(wall.bagId), [wall, a30Measured, a30Only]);
  assert.deepEqual(second, first);
  assert.deepEqual(requested, ['ede-facades.json', '0_0.json.gz', 'a12_0_0.json.gz', 'a30_0_0.json.gz']);
});
