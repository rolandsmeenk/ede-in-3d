const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('the built AHN asset covers Ede and retains metres relative to Oude Kerk', async () => {
  const { decodeTerrain, sampleTerrain } = await import('../js/terrain.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const raw = readFileSync(path.join(__dirname, '../assets/ede-ahn.bin'));
  const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const terrain = decodeTerrain(bytes);
  const [minX, minZ, maxX, maxZ] = EDE_DATA.meta.bounds;
  assert.ok(terrain.minX <= minX && terrain.minZ <= minZ && terrain.maxX >= maxX && terrain.maxZ >= maxZ);
  assert.equal(sampleTerrain(terrain, 0, 0), 0);
  assert.ok(Math.abs(terrain.napOrigin - 22.54) < 0.01);
  assert.ok(terrain.minY < -10 && terrain.maxY > 20);
  assert.throws(() => decodeTerrain(bytes.slice(0, 80)), /Invalid AHN terrain asset/);
});

test('draped faces keep their offset across terrain cells and both sides of the diagonal', async () => {
  const { sampleTerrain } = await import('../js/terrain.js');
  const terrain = {
    step: 10, columns: 3, rows: 2, minX: 0, minZ: 0,
    heights: [0, 1, 7, 3, 8, 2]
  };
  const heightAt = (x, z) => sampleTerrain(terrain, x, z);
  assert.ok(Math.abs(heightAt(2, 3) - 1.1) < 1e-8);
  assert.ok(Math.abs(heightAt(8, 7) - 4.9) < 1e-8);

  class Attribute {
    constructor(array, size) { this.array = array; this.count = array.length / size; }
    getX(i) { return this.array[i * 3]; }
    getY(i) { return this.array[i * 3 + 1]; }
    getZ(i) { return this.array[i * 3 + 2]; }
  }
  class Geometry {
    attributes = {};
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    computeVertexNormals() {}
    dispose() {}
  }
  const source = readFileSync(path.join(__dirname, '../js/ede-geometry.js'), 'utf8');
  const { drapeEdeSurface } = loadModule(source.replace('export function* edeTerrainGeometries', 'function* edeTerrainGeometries'), {
    imports: {
      'three/webgpu': { BufferGeometry: Geometry, BufferAttribute: Attribute, Float32BufferAttribute: Attribute },
      './city-config.js': {},
      './terrain.js': { getTerrain: () => terrain, terrainHeightAt: heightAt },
      './ede-grade.js': {}
    }
  });
  const surface = new Geometry();
  const offset = 0.06;
  surface.setAttribute('position', new Attribute([2, offset, 1, 4, offset, 9, 18, offset, 4], 3));
  const draped = drapeEdeSurface(surface).getAttribute('position');
  let area = 0;
  assert.ok(draped.count > 3);
  for (let i = 0; i < draped.count; i += 3) {
    const points = [i, i + 1, i + 2].map(j => [draped.getX(j), draped.getY(j), draped.getZ(j)]);
    const [[ax, , az], [bx, , bz], [cx, , cz]] = points;
    const expected = heightAt((ax + bx + cx) / 3, (az + bz + cz) / 3);
    const actual = (points[0][1] + points[1][1] + points[2][1]) / 3;
    assert.ok(Math.abs(actual - expected - offset) < 1e-6);
    area += Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
  }
  assert.ok(Math.abs(area - 61) < 1e-6);
});
