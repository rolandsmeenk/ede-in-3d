const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('Ede street features batch painted refuge arms on the raised grade and only replace matching markings', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const filename = join(__dirname, '../js/ede-street-features-world.js');
  const source = readFileSync(filename, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href))
    .replace('export async function', 'async function') + '\nexport { buildEdeStreetFeaturesWorld };';
  const { buildEdeStreetFeaturesWorld } = loadModule(source, { filename, imports: {
    'three/webgpu': THREE,
    'three/tsl': {},
    './road-network.js': { CROSSWALK: 2.5 },
    './ede-grade.js': { gradeProfileAt: () => null, gradeWayAt: id => id === 'grade' ? { y: 8 } : null },
    './terrain.js': { terrainHeightAt: () => 2 },
    './tsl-materials.js': { createRoadSurfaceMaterial: () => new THREE.MeshStandardNodeMaterial() },
    './ede-geometry.js': { nearestEdeRoad: () => null }
  } });
  const feature = { x: 0, z: 0, tangent: [1, 0], wayId: 'source-road', renderWay: 'grade', layer: 1 };
  const bump = { ...feature, id: 'raised', height: 0.10, length: 6, width: 8, profile: 'table',
    footprint: [[-3, -4], [-3, 1.6], [3, 3.4], [3, -4]] };
  const crossing = { ...feature, id: 'surveyed', length: 2, width: 8, control: 'zebra', bumpId: bump.id, segments: [
    { ends: [[0, -4], [0, -1]], width: 3 },
    { ends: [[0, 1], [0, 4]], width: 3 }
  ] };
  const scene = new THREE.Scene();
  const { group, replacesZebra } = await buildEdeStreetFeaturesWorld(scene, { bumps: [bump], crossings: [crossing] });
  assert.equal(scene.getObjectByName('EdeStreetFeatures'), group);
  assert.equal(group.children.length, 2);
  const [table, paint] = group.children;
  const yOf = ({ geometry }) => Array.from(geometry.attributes.position.array).filter((_, i) => i % 3 === 1);
  assert.ok(Math.abs(Math.max(...yOf(table)) - 8.163) < 1e-4);
  assert.ok(Math.abs(Math.max(...yOf(paint)) - 8.183) < 1e-4);
  const ray = new THREE.Raycaster(new THREE.Vector3(0.05, 10, 2.45), new THREE.Vector3(0, -1, 0));
  assert.ok(Math.abs(ray.intersectObject(paint)[0].point.y - ray.intersectObject(table)[0].point.y - 0.02) < 1e-4);
  assert.ok(paint.geometry.attributes.position.array.every((z, i) => i % 3 !== 2 || Math.abs(z) >= 1));
  const edge = { dx: 1, dz: 0, layer: 1 };
  assert.equal(replacesZebra(0, 2, edge), true);
  assert.equal(replacesZebra(0, 0, edge), false);
  assert.equal(replacesZebra(0, 2, { ...edge, layer: 0 }), false);
  assert.equal(replacesZebra(0, 2, { ...edge, dx: 0, dz: 1 }), false);
});
