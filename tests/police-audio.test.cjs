const assert = require('node:assert/strict');
const test = require('node:test');

test('Dutch police horn alternates clean 375 Hz and 500 Hz notes', async () => {
  const { createSynthResources } = await import('../js/audio-synthesis.js');
  const sampleRate = 16000;
  const context = {
    sampleRate,
    createBuffer(channels, count, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(count));
      return { duration: count / rate, getChannelData: channel => data[channel] };
    }
  };
  const horn = createSynthResources(context).policeHorn.getChannelData(0);
  const energy = (frequency, start) => {
    let real = 0, imaginary = 0;
    for (let i = start; i < start + sampleRate / 5; i++) {
      const phase = 2 * Math.PI * frequency * i / sampleRate;
      real += horn[i] * Math.cos(phase);
      imaginary += horn[i] * Math.sin(phase);
    }
    return Math.hypot(real, imaginary);
  };
  const low = sampleRate / 10, high = 6 * sampleRate / 10;
  assert.equal(horn.length, sampleRate);
  assert.ok(energy(375, low) > 50 * energy(500, low));
  assert.ok(energy(500, high) > 50 * energy(375, high));
  assert.ok(Math.abs(horn[0] - horn.at(-1)) < 1e-5);
  assert.ok(Math.abs(horn[sampleRate / 2]) < 0.001);
  assert.ok(Math.abs(horn[sampleRate / 2 - 1]) < 0.001);
});
