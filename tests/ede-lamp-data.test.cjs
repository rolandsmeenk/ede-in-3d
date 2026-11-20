const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { gunzipSync } = require('node:zlib');

test('the checked-in BGT lamp posts cover the Ede scene and reject an incomplete asset', async () => {
  const { decodeEdeLamps } = await import('../js/ede-lamp-data.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const bytes = gunzipSync(readFileSync(join(__dirname, '../assets/ede-lamps.bin.gz')));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const lamps = decodeEdeLamps(buffer);
  const [minX, minZ, maxX, maxZ] = EDE_DATA.meta.bounds;
  assert.ok(lamps.length > 14000);
  assert.ok(lamps.every(({ x, z }) => x >= minX - 0.1 && x <= maxX + 0.1 && z >= minZ - 0.1 && z <= maxZ + 0.1));
  assert.ok(lamps.filter(({ x, z }) => Math.hypot(x, z) < 350).length > 300);
  assert.ok(lamps.every(lamp => lamp.height >= 3 && lamp.height <= 20 &&
    Math.abs(Math.hypot(lamp.nx, lamp.nz) - 1) < 1e-12));
  assert.throws(() => decodeEdeLamps(buffer.slice(0, -4)), /asset length/);
  const doubleArm = lamps.filter(lamp => lamp.doubleArm);
  assert.equal(doubleArm.length, 94);
  assert.ok(doubleArm.every(lamp => lamp.surveyed));
  assert.ok(doubleArm.some(lamp => lamp.layer === 1 && lamp.fitted));

  const upper = lamps.filter(({ x, z, layer }) => layer === 1 && x >= -1460 && x <= -1360 && z >= 3400 && z <= 3610);
  assert.equal(upper.length, 35);
  assert.equal(upper.filter(lamp => lamp.surveyed).length, 25);
  assert.ok(upper.every(lamp => lamp.fitted && lamp.baseY > -4.6 && Math.abs(lamp.targetY - lamp.baseY) < 0.7));
  const corrected = upper.find(lamp => Math.hypot(lamp.x + 1395.17, lamp.z - 3489.69) < 0.15);
  assert.ok(corrected && Math.abs(corrected.baseY + 3.57) < 0.03);
  for (const [x, z] of [[-1418.45, 3529.93], [-1445.24, 3529.76]]) {
    const under = lamps.filter(lamp => lamp.layer === 0 && Math.hypot(lamp.x - x, lamp.z - z) < 0.15);
    assert.equal(under.length, 1);
    assert.ok(under[0].baseY < -8);
  }
});

test('the lamp decoder still accepts coordinate-only EDL1 data', async () => {
  const { decodeEdeLamps } = await import('../js/ede-lamp-data.js');
  const bytes = Buffer.from([69, 68, 76, 49, 1, 0, 0, 0, 10, 0, 15, 0]);
  assert.deepEqual(decodeEdeLamps(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    [{ x: 2, z: 3 }]);
});
