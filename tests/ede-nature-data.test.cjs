const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

test('bundled habitat grid covers both project areas and encodes dry and damp heath separately', async () => {
  const { decodeEdeNatureHabitats, EDE_NATURE_BOUNDS } = await import('../js/ede-nature-habitats.js');
  const source = gunzipSync(readFileSync(join(__dirname, '../assets/ede-nature-habitats.bin.gz')));
  const buffer = Uint8Array.from(source).buffer;
  const habitat = decodeEdeNatureHabitats(buffer);
  const [west, north, east, south] = EDE_NATURE_BOUNDS;
  assert.equal(habitat(west - 1, north), null);
  assert.equal(habitat(east, south - 1), null);
  assert.throws(() => decodeEdeNatureHabitats(buffer.slice(0, 27)), /extent/);
  const found = new Set();
  for (let z = north + 4; z < south; z += 8) {
    for (let x = west + 4; x < east; x += 8) found.add(habitat(x, z));
  }
  assert.deepEqual(found, new Set([null, 'woodland', 'dry-heath', 'grassland', 'damp-heath', 'sand', 'water']));
});

test('flowering curves follow date previews and distinguish spring flowers from late-summer heath', async () => {
  const { edeFlowerBloom } = await import('../js/ede-nature-phenology.js');
  const spring = edeFlowerBloom('2027-04-22');
  const june = edeFlowerBloom('2027-06-22');
  const lateSummer = edeFlowerBloom('2027-08-22');
  assert.ok(spring.daisy > 0.7);
  assert.ok(june.erica > lateSummer.erica);
  assert.ok(june.tormentil > 0.4);
  assert.ok(lateSummer.calluna > 0.8);
  assert.equal(june.calluna, 0);
  assert.deepEqual(edeFlowerBloom('2027-01-15'), { calluna: 0, erica: 0, tormentil: 0, daisy: 0 });
});
