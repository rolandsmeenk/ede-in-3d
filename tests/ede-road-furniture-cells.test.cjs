const assert = require('node:assert/strict');
const { test } = require('node:test');

test('RD-origin translation keeps points in a single half-open cell, including negative borders', async () => {
  const { indexRoadFurniture, roadFurnitureCellKey } = await import('../js/ede-road-furniture-cells.js');
  const point = { id: 'test', type: 'hecto', rdX: 174499.875, rdY: 450000, sceneCorrection: [0.125, -0.01] };
  const rdOrigin = [174000, 450000];
  const asset = { version: 1, cellSize: 500, rdOrigin, cells: { '1/-1': [point] } };
  const [record] = indexRoadFurniture(asset).get('1/-1').records;
  assert.ok(Math.abs(record.x - 500) < 1e-9);
  assert.equal(record.z, -0.01);
  assert.equal(roadFurnitureCellKey(-500, 500), '-1/1');
  assert.throws(() => indexRoadFurniture({ ...asset, cells: { '0/-1': [point] } }), /different cell/);
  assert.throws(() => indexRoadFurniture({ ...asset, cells: { '1/-1': [point, point] } }), /Invalid road furniture record/);
});

test('padded AABB reaches across borders and reverses a partial fade continuously', async () => {
  const { advanceRoadFurnitureFade, roadFurnitureCellBounds, roadFurnitureCellVisible } =
    await import('../js/ede-road-furniture-cells.js');
  const bounds = roadFurnitureCellBounds(1, -1, 0, 18);
  assert.equal(roadFurnitureCellVisible(bounds, { x: 475, y: 5, z: 20 }, 0), true);
  assert.equal(roadFurnitureCellVisible(bounds, { x: 450, y: 5, z: 20 }, 17), false);
  assert.equal(roadFurnitureCellVisible(bounds, { x: 450, y: 5, z: 20 }, 18), true);
  assert.equal(roadFurnitureCellVisible(bounds, { x: 475, y: 100, z: 20 }, 40), false);
  assert.equal(advanceRoadFurnitureFade(0, true, 0.1), 0.4);
  assert.equal(advanceRoadFurnitureFade(0.4, false, 0.05), 0.2);
  assert.equal(advanceRoadFurnitureFade(0.2, true, 0.5), 1);
  assert.equal(advanceRoadFurnitureFade(1, false, 0.25), 0);
});
