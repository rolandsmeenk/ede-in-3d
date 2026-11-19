const assert = require('node:assert/strict');
const test = require('node:test');

function rendererStub(gpuTimes = null) {
  return {
    backend: {
      isWebGPUBackend: !!gpuTimes,
      trackTimestamp: !!gpuTimes,
      hasTimestampQuery: uid => gpuTimes.has(uid),
      getTimestamp: uid => gpuTimes.get(uid),
    },
    inspector: {
      beginRender() {}, finishRender() {}, beginCompute() {}, finishCompute() {},
    },
    info: { render: { drawCalls: 0, triangles: 0, frameCalls: 0 } },
    queries: [],
    async resolveTimestampsAsync(type) {
      this.queries.push(type);
    },
  };
}

function draw(renderer, count, triangles) {
  renderer.info.render.drawCalls += count;
  renderer.info.render.triangles += triangles;
}

test('frame profiling attributes nested draws once and snapshots counters before reset', async () => {
  const { createEdeProfiler } = await import('../js/ede-perf.js');
  const renderer = rendererStub();
  const profile = createEdeProfiler(renderer);
  const { beginRender, finishRender } = renderer.inspector;

  profile.beginFrame(0);
  profile.stage('traffic');
  beginRender('r:output', { isQuadMesh: true, name: 'Render Pipeline' }, null, null);
  beginRender('r:scene', { isScene: true }, null, null);
  draw(renderer, 1, 100);
  beginRender('r:sun', { isScene: true }, null, {
    texture: { name: 'SunShadowMap' }, width: 4096, viewport: { x: 2049 },
  });
  draw(renderer, 3, 300);
  finishRender('r:sun');
  draw(renderer, 2, 200);
  finishRender('r:scene');
  draw(renderer, 1, 2);
  finishRender('r:output');
  renderer.info.render.frameCalls = 3;
  profile.stage('render');
  profile.endFrame();
  renderer.info.render = { drawCalls: 0, triangles: 0, frameCalls: 0 };

  const result = await profile.report({ frames: true });
  const [frame] = result.frames;
  assert.deepEqual(frame.render, { calls: 3, drawCalls: 7, triangles: 602 });
  assert.equal(frame.passes.Scene.drawCalls, 3);
  assert.equal(frame.passes.Scene.triangles, 300);
  assert.equal(frame.passes['Sun shadow / far'].drawCalls, 3);
  assert.equal(frame.passes['Render Pipeline'].triangles, 2);
  assert.ok(frame.cpu.traffic >= 0);
  assert.ok(frame.cpu.render >= 0);
  assert.equal(result.gpuTiming, false);
  assert.equal(result.passes.Scene.gpuMs, null);
});

test('history remains bounded and keeps unknown GPU timings distinct from zero', async () => {
  const { createEdeProfiler } = await import('../js/ede-perf.js');
  const renderer = rendererStub(new Map([['r:2', 0.8], ['c:2', 0.2]]));
  const profile = createEdeProfiler(renderer, { capacity: 2 });

  for (const [i, timestamp] of [0, 10, 30].entries()) {
    profile.beginFrame(timestamp);
    renderer.inspector.beginRender(`r:${i}`, { isScene: true }, null, null);
    renderer.inspector.beginCompute(`c:${i}`, { name: 'Light grid' });
    renderer.inspector.finishCompute(`c:${i}`);
    renderer.inspector.finishRender(`r:${i}`);
    profile.endFrame();
  }

  const result = await profile.report({ frames: true });
  assert.deepEqual(result.frames.map(frame => frame.frameMs), [10, 20]);
  assert.deepEqual(result.frameMs, { median: 10, p95: 20 });
  assert.equal(result.passes.Scene.gpuFrames, 1);
  assert.deepEqual(result.passes.Scene.gpuMs, { median: 0.8, p95: 0.8 });
  assert.deepEqual(result.passes['Compute / Light grid'].gpuMs, { median: 0.2, p95: 0.2 });
  assert.deepEqual(renderer.queries.sort(), ['compute', 'render']);

  profile.reset();
  assert.equal((await profile.report()).frameCount, 0);
  profile.beginFrame(100);
  profile.endFrame();
  assert.equal((await profile.report()).frameMs, null);
});
