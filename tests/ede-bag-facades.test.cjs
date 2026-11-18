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
