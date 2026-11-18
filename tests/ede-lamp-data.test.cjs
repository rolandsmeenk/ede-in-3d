const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

test('the checked-in BGT lamp posts cover the Ede scene and reject an incomplete asset', async () => {
  const { decodeEdeLamps } = await import('../js/ede-lamp-data.js');
  const { EDE_DATA } = await import('../js/ede-geodata.js');
  const bytes = readFileSync(join(__dirname, '../assets/ede-lamps.bin'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const lamps = decodeEdeLamps(buffer);
  const [minX, minZ, maxX, maxZ] = EDE_DATA.meta.bounds;
  assert.ok(lamps.length > 14000);
  assert.ok(lamps.every(({ x, z }) => x >= minX - 0.1 && x <= maxX + 0.1 && z >= minZ - 0.1 && z <= maxZ + 0.1));
  assert.ok(lamps.filter(({ x, z }) => Math.hypot(x, z) < 350).length > 300);
  assert.throws(() => decodeEdeLamps(buffer.slice(0, -4)), /asset length/);
});
