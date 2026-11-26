const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function testAtlas() {
  class CanvasTexture {
    constructor(image) {
      this.image = image;
    }
  }

  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const calls = [];
      const ctx = new Proxy({
        getImageData(x, y, width, height) {
          calls.push(['getImageData', x, y, width, height]);
          const data = new Uint8ClampedArray(width * height * 4);
          for (let row = 0; row < height; row++) {
            for (let column = 0; column < width; column++) {
              const offset = (row * width + column) * 4;
              data[offset] = column % 256;
              data[offset + 1] = row % 256;
              data[offset + 3] = 255;
            }
          }
          return { data };
        },
      }, {
        get(target, prop) {
          return target[prop] || ((...values) => calls.push([prop, ...values]));
        },
        set(target, prop, value) {
          calls.push([prop, value]);
          target[prop] = value;
          return true;
        },
      });
      return { calls, getContext: () => ctx };
    }
  };
  return loadModule(readFileSync(join(__dirname, '../js/road-furniture-atlas.js'), 'utf8'), {
    imports: { 'three/webgpu': {
      CanvasTexture, SRGBColorSpace: 'srgb', LinearMipmapLinearFilter: 'mip', LinearFilter: 'linear',
    } },
    globals: { document },
  }).createRoadFurnitureAtlases;
}

test('road furniture atlases draw plate contents, share duplicate artwork and handle empty input', () => {
  const build = testAtlas();
  assert.equal(build([]).textures.length, 0);
  const hecto = {
    id: 'hecto', type: 'hecto', wegnummer: 'A12', hectometer: '108,7', hecto_lttr: 'j',
    weglet: 'a', pos_tv_wol: 'Re', daytimeBadge: true,
  };
  const exit = {
    id: 'exit', type: 'exit', exitNumber: 24, destinations: ['Ede', 'Wageningen'],
    roadShields: ['A12', 'N781'], isOverheadGantry: true, laneCount: 3,
  };
  const { faces, textures } = build([hecto, { ...hecto, id: 'duplicate', rdX: 10 }, exit]);
  assert.equal(textures.length, 1);
  assert.equal(faces.get('hecto'), faces.get('duplicate'));
  assert.notDeepEqual(faces.get('hecto').uv, faces.get('exit').uv);
  const [texture] = textures;
  assert.equal(texture.colorSpace, 'srgb');
  assert.equal(texture.minFilter, 'mip');
  assert.equal(texture.magFilter, 'linear');
  assert.equal(texture.generateMipmaps, true);
  const { calls } = texture.image;
  const drawnText = calls.filter(([name]) => name === 'fillText').map(([, label]) => label);
  for (const label of ['A12', 'N781', 'Re', 'j', 'a', '108,7', '100', '6-19h', '24', 'Ede', 'Wageningen']) {
    assert.ok(drawnText.includes(label), label);
  }
  const paintColors = calls.filter(([name]) => name === 'fillStyle').map(([, color]) => color);
  for (const color of ['#006B3F', '#003DA5', '#c81921', '#ffd334']) assert.ok(paintColors.includes(color), color);
  assert.equal(calls.filter(([name, amount]) => name === 'rotate' && amount === Math.PI).length, 3);
  assert.equal(calls.filter(([name]) => name === 'getImageData').length, 1);
  assert.equal(calls.filter(([name]) => name === 'drawImage').length, 0);
  const [[, { data }]] = calls.filter(([name]) => name === 'putImageData');
  const [u, v, w, h] = faces.get('exit').uv;
  const x = Math.round(u * texture.image.width - 0.5);
  const bottom = Math.round((1 - v) * texture.image.height - 0.5);
  const right = x + Math.round(w * texture.image.width);
  const y = bottom - Math.round(h * texture.image.height);
  const pixel = (x, y) => {
    const offset = (y * texture.image.width + x) * 4;
    return [...data.subarray(offset, offset + 4)];
  };
  assert.deepEqual(pixel(x - 16, y - 16), pixel(x, y));
  assert.deepEqual(pixel(right + 16, bottom + 16), pixel(right, bottom));
  assert.deepEqual(pixel(x - 1, y + 1), pixel(x, y + 1));
});

test('every supported RVV code produces its own artwork and mirrored variants split tiles', () => {
  const build = testAtlas();
  const codes = ['J02', 'J03', 'J04', 'J05', 'BB01', 'BB02', 'BB07', 'BB08', 'BB09', 'BB10',
    'BB14', 'BB15', 'L08', 'L09', 'BB14-L', 'L09-L'];
  const signs = codes.map(rvvCode => ({ type: 'rvv', id: rvvCode, rvvCode }));
  const { faces, textures } = build([...signs,
    { type: 'rvv', id: 'short-code', rvvCode: 'J2' },
    { type: 'rvv', id: 'unsupported', rvvCode: 'C01' },
  ]);
  assert.equal(faces.size, codes.length + 1);
  assert.equal(faces.get('short-code'), faces.get('J02'));
  assert.equal(new Set(codes.map(code => faces.get(code))).size, codes.length);
  assert.ok(!faces.has('unsupported'));
  const calls = textures.flatMap(texture => texture.image.calls);
  assert.equal(calls.filter(([name]) => name === 'bezierCurveTo').length, 4);
  assert.equal(calls.filter(([name]) => name === 'quadraticCurveTo').length, 2);
  assert.ok(calls.some(([name, label]) => name === 'fillText' && label === 'UIT'));
});

test('atlas pages stay bounded, deterministic and nonoverlapping under a large import', () => {
  const build = testAtlas();
  const features = Array.from({ length: 900 }, (_, index) => ({
    type: 'hecto', id: index, wegnummer: 'A30', hectometer: (index / 10).toFixed(1), pos_tv_wol: 'L',
  }));
  const atlas = build(features);
  const reverse = build(features.toReversed());
  assert.ok(atlas.textures.length > 1);
  assert.equal(atlas.faces.size, features.length);

  for (const { id } of features) {
    const face = atlas.faces.get(id);
    const reordered = reverse.faces.get(id);
    assert.deepEqual(face.uv, reordered.uv);
    assert.equal(atlas.textures.indexOf(face.texture), reverse.textures.indexOf(reordered.texture));
    const [u, v, w, h] = face.uv;
    assert.ok(u > 0 && v > 0 && u + w < 1 && v + h < 1);
    assert.equal(face.width / face.height, 192 / 128);
  }

  for (const texture of atlas.textures) {
    assert.ok(texture.image.width <= 2048 && texture.image.height <= 2048);
    const rects = [...atlas.faces.values()].filter(face => face.texture === texture).map(face => face.uv);
    for (const [i, [u, v, w, h]] of rects.entries()) {
      for (const [x, y, dx, dy] of rects.slice(i + 1)) {
        assert.ok(u + w < x || x + dx < u || v + h < y || y + dy < v);
      }
    }
  }
});
