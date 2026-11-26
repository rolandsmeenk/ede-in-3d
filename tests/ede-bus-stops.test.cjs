const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const stubs = (names) => Object.fromEntries(names.map(name => [name, {}]));
const { boardingDirections, collectEdeBusStops, fitEdeBusStop } = loadModule(
  readFileSync(join(__dirname, '../js/ede-bus-stops.js'), 'utf8'), {
    imports: {
      ...stubs(['three/webgpu', './city-config.js', './ede-geometry.js', './ede-grade.js',
        './ede-playable-boundary.js', './ede-scene-coordinates.js', './terrain.js',
        './ede-bus-shelter-sites.js', './ede-bus-shelters.js', './ede-snow.js']),
      './ede-geodata.js': { EDE_DATA: { meta: { bounds: [0, 0, 20, 30] } } },
    },
  });

test('bus stop markers combine lines on a platform and retain the opposite curb', () => {
  const platform = { id: 'outbound', name: 'Ede, Voorbeeld', platform: 'A', x: 10, z: 17 };
  const variants = [
    { line: '303', stops: [platform, { ...platform, id: 'regional', x: 500 }] },
    { line: '1', stops: [{ ...platform, id: 'duplicate-record' }] },
    { line: '1', stops: [{ ...platform, id: 'inbound', platform: 'B', x: 16 }] }
  ];
  const stops = collectEdeBusStops(variants);
  assert.equal(stops.length, 2);
  assert.equal(stops[0].name, platform.name);
  assert.equal(stops[0].platform, 'A');
  assert.equal(stops[0].lines.join(','), '1,303');
  assert.equal(stops[0].ids.join(','), 'outbound,duplicate-record');
  assert.equal(stops[1].platform, 'B');
  assert.equal(stops[1].lines.join(','), '1');
  assert.equal(stops[1].x, 16);
  assert.equal(stops[1].z, 17);
});

test('bus stop layout prefers the boarding edge that puts the platform on the right', () => {
  const stop = { x: 10, z: 2.6 };
  const stops = [{ index: 0, leg: 0 }];
  const edges = ['20,0,0,0', '0,0,20,0'];
  const variants = [{ stops: [stop], slices: edges.map((_, edge) => ({ stops, legs: [{ edge }] })) }];
  const direction = boardingDirections({ variants, edges }).get('10/2.6/');
  assert.equal(direction.tx, 1);
  assert.equal(direction.tz, 0);
});

test('platform follows the carriageway edge and the pole clears the boarding tiles', () => {
  const stop = { x: 10, z: 2.6, ax: 10, az: 0, tx: 1, tz: 0 };
  const traffic = (x, z) => z < 3 + 0.035 * (x - 10);
  const clear = (x, z, margin) => !traffic(x, z - margin);
  const ground = () => 4;
  const fit = fitEdeBusStop(stop, {}, traffic, clear, ground);
  const { platform, sign } = fit;
  assert.ok(platform);
  assert.equal(platform.end - platform.start, 12);
  assert.equal(platform.width, 1.5);
  assert.ok(platform.offsetAt(-5) < platform.offsetAt(0));
  assert.ok(Math.abs(platform.bed(0, 0.15) - platform.roadbed(0) - 0.18) < 0.001);
  assert.ok(clear(sign.x, sign.z, 0.3));
  assert.ok(sign.z > fit.point(0, platform.offsetAt(0) + 1.5).z);
});

test('a cycle path can rule out a platform while leaving space for a standalone sign', () => {
  const stop = { x: 10, z: 2.6, ax: 10, az: 0, tx: 1, tz: 0 };
  const traffic = (x, z) => z < 3 || z >= 3.25 && z < 4.5;
  const clear = (x, z, margin) => !traffic(x, z) && !traffic(x, z - margin) && !traffic(x, z + margin);
  const ground = () => 4;
  const fit = fitEdeBusStop(stop, {}, traffic, clear, ground);
  assert.equal(fit.platform, undefined);
  assert.ok(fit.sign.z > 4.8);
  const signsOnly = fitEdeBusStop(stop, { platform: false, signOffset: [0, 2.8] }, traffic, clear, ground);
  assert.equal(signsOnly.sign.x, 10);
  assert.equal(signsOnly.sign.z, 5.4);
});

test('shelter footprints stay behind the boarding point and clear paving and the post', () => {
  const { fitShelter } = loadModule(readFileSync(join(__dirname, '../js/ede-bus-shelters.js'), 'utf8'), {
    imports: stubs(['three/webgpu', './ede-advertising.js', './ede-snow.js']),
  });
  const site = { x: 10, z: 20, tx: 1, tz: 0, green: true,
    pose: { sign: { x: 8.5, z: 23 }, platform: { width: 1.5 } } };
  const road = (x, z) => z < 22.15;
  const ground = () => 4.2;
  const fit = fitShelter(site, road, ground);
  assert.equal(fit.y, 4.2);
  assert.equal(fit.halfLength * 2, 4.70);
  assert.ok(fit.corners.every(p => !road(p.x, p.z)));
  assert.ok(fit.point(0, -fit.halfDepth).z < fit.z);
  assert.ok(fit.point(0, -fit.halfDepth).z >= 22.1);
  assert.equal(fitShelter(site, () => true, ground), undefined);
});
