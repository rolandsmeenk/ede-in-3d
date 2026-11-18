const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

class DataTexture {
  constructor(data, width, height) { this.image = { data, width, height }; }
}
const { buildFacadeMaskAtlas, projectFacadeUv } = loadModule(
  readFileSync(join(__dirname, '../js/ede-facade-material.js'), 'utf8'),
  { imports: { 'three/webgpu': { DataTexture }, 'three/tsl': {}, './tsl-materials.js': {} } }
);

test('diagonal building walls keep openings in wall-local positions with blank shared walls', () => {
  const wall = { a: [-11, 8], b: [-8, 12], minY: 17, height: 4, wallType: 'street',
    openings: [
      { kind: 'window', x: 0.6, y: 2, width: 1.4, height: 1.15, frame: 0.10, sill: 0.15 },
      { kind: 'door', x: 3, y: 0.1, width: 0.9, height: 2 }
    ] };
  const shared = { ...wall, wallType: 'shared' };
  const colourOnly = { ...wall, openings: [], layoutMeasured: false };
  const atlas = buildFacadeMaskAtlas([wall, shared, colourOnly]);
  const { data, width, height } = atlas.texture.image;
  const pixel = (target, u, v) => {
    const x = wall.a[0] + 0.6 * u, y = 30 + v, z = wall.a[1] + 0.8 * u;
    const [s, t, enabled] = projectFacadeUv(target, atlas.rects.get(target), x, y, z, 30);
    assert.equal(enabled, 1);
    const i = 4 * (Math.floor(s * width) + width * Math.floor(t * height));
    return [...data.subarray(i, i + 4)];
  };
  assert.deepEqual(pixel(wall, 1.25, 2.6), [255, 0, 0, 0], 'glazing');
  assert.deepEqual(pixel(wall, 3.4, 1), [0, 255, 0, 0], 'door');
  assert.deepEqual(pixel(wall, 0.65, 2.6), [0, 0, 255, 0], 'frame');
  assert.deepEqual(pixel(wall, 1.25, 1.89), [0, 0, 0, 255], 'sill');
  assert.deepEqual(pixel(wall, 1.25, 0.7), [0, 0, 0, 0], 'masonry');
  assert.deepEqual(pixel(shared, 1.25, 2.6), [0, 0, 0, 0], 'blank wall');
  assert.equal(projectFacadeUv(colourOnly, atlas.rects.get(colourOnly), -10.25, 19.6, 9)[2], 0, 'colour-only fallback');
  assert.equal(atlas.texture.generateMipmaps, true);
  assert.ok(atlas.byteLength > data.length);
});
