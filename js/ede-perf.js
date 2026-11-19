const HISTORY = 480;
const GPU_BATCH_FRAMES = 8;

function nameRenderPass(scene, target) {
  const texture = target?.texture?.name;
  if (texture === 'SunShadowMap') {
    return target.viewport.x < target.width / 2 ? 'Sun shadow / near' : 'Sun shadow / far';
  }
  if (scene.name?.startsWith('Shadow Map')) return 'Other shadows';
  if (texture === 'PMREM') return 'Environment map';
  if (scene.isQuadMesh && scene.name) return scene.name;
  return scene.isScene ? 'Scene' : 'Other render';
}

function distribution(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return {
    median: values[Math.ceil(values.length * 0.50) - 1],
    p95: values[Math.ceil(values.length * 0.95) - 1],
  };
}

// Read Three's inspection hooks rather than wrapping renderer.render(): some passes
// call _renderScene directly, and the stats reset before the next animation callback.
export function createEdeProfiler(renderer, { capacity = HISTORY } = {}) {
  const backend = renderer.backend;
  // WebGL permits only one active timer, so nested passes would be charged to the outer pass.
  if (!backend.isWebGPUBackend) backend.trackTimestamp = false;
  const gpuTiming = Boolean(backend.isWebGPUBackend && backend.trackTimestamp);
  const frames = new Array(capacity);
  const passStack = [];
  const inspector = renderer.inspector;
  const originalBeginRender = inspector.beginRender.bind(inspector);
  const originalFinishRender = inspector.finishRender.bind(inspector);
  const originalBeginCompute = inspector.beginCompute.bind(inspector);
  const originalFinishCompute = inspector.finishCompute.bind(inspector);
  let frame;
  let sequence = 0;
  let count = 0;
  let previousFrameTime;
  let boundary;
  let pendingQueries = [];
  let readback;
  let gpuReadbackFailed = false;

  function beginPass(uid, name, type) {
    const { drawCalls, triangles } = renderer.info.render;
    passStack.push({ uid, name, type, drawCalls, triangles, start: performance.now(),
      childDraws: 0, childTriangles: 0, childCpuMs: 0 });
  }

  function finishPass() {
    const current = passStack.pop();
    if (!current) return;
    const draws = renderer.info.render.drawCalls - current.drawCalls;
    const triangles = renderer.info.render.triangles - current.triangles;
    const cpuMs = performance.now() - current.start;
    const totals = frame.passes[current.name] ??= {
      calls: 0, drawCalls: 0, triangles: 0, cpuMs: 0, gpuMs: null, gpuSamples: 0,
    };
    totals.calls++;
    totals.drawCalls += draws - current.childDraws;
    totals.triangles += triangles - current.childTriangles;
    totals.cpuMs += Math.max(0, cpuMs - current.childCpuMs);
    const parent = passStack.at(-1);
    if (parent) {
      parent.childDraws += draws;
      parent.childTriangles += triangles;
      parent.childCpuMs += cpuMs;
    }
    if (gpuTiming && current.uid) pendingQueries.push({ uid: current.uid, type: current.type, totals });
  }

  inspector.beginRender = (uid, scene, camera, target) => {
    if (frame) beginPass(uid, nameRenderPass(scene, target), 'render');
    originalBeginRender(uid, scene, camera, target);
  };
  inspector.finishRender = uid => {
    originalFinishRender(uid);
    if (frame) finishPass();
  };
  inspector.beginCompute = (uid, nodes) => {
    if (frame) {
      const name = (Array.isArray(nodes) ? nodes[0] : nodes)?.name;
      beginPass(uid, name ? `Compute / ${name}` : 'Compute', 'compute');
    }
    originalBeginCompute(uid, nodes);
  };
  inspector.finishCompute = uid => {
    originalFinishCompute(uid);
    if (frame) finishPass();
  };

  function resolveGpu() {
    if (readback || !pendingQueries.length) return readback;
    const batch = pendingQueries;
    pendingQueries = [];
    const types = new Set(batch.map(query => query.type));
    readback = Promise.all([...types].map(type => renderer.resolveTimestampsAsync(type)))
      .then(() => {
        for (const { uid, totals } of batch) {
          if (!backend.hasTimestampQuery(uid)) continue;
          totals.gpuMs = (totals.gpuMs ?? 0) + backend.getTimestamp(uid);
          totals.gpuSamples++;
        }
      })
      .catch(() => { gpuReadbackFailed = true; })
      .finally(() => { readback = null; });
    return readback;
  }

  function beginFrame(now) {
    const { drawCalls, triangles, frameCalls } = renderer.info.render;
    frame = {
      frameMs: previousFrameTime === undefined ? null : now - previousFrameTime,
      cpu: {},
      passes: {},
      render: { drawCalls, triangles, calls: frameCalls },
    };
    previousFrameTime = now;
    boundary = performance.now();
  }

  function stage(name) {
    const now = performance.now();
    frame.cpu[name] = (frame.cpu[name] ?? 0) + now - boundary;
    boundary = now;
  }

  function endFrame() {
    const { drawCalls, triangles, frameCalls } = renderer.info.render;
    frame.render = {
      drawCalls: drawCalls - frame.render.drawCalls,
      triangles: triangles - frame.render.triangles,
      calls: frameCalls - frame.render.calls,
    };
    frames[sequence++ % capacity] = frame;
    count = Math.min(count + 1, capacity);
    passStack.length = 0;
    frame = null;
    // A suspended readback must not retain references to an unbounded number of older frames.
    if (pendingQueries.length > 2048) pendingQueries.splice(0, pendingQueries.length - 2048);
    if (sequence % GPU_BATCH_FRAMES === 0) resolveGpu();
  }

  function reset() {
    frames.fill(undefined);
    count = 0;
    previousFrameTime = undefined;
    pendingQueries = [];
  }

  async function report({ frames: includeFrames = false } = {}) {
    const sample = Array.from({ length: count }, (_, i) => frames[(sequence - count + i) % capacity]);
    if (readback) await readback;
    await resolveGpu();
    const elapsed = sample.map(row => row.frameMs).filter(ms => ms > 0);
    const cpu = {};
    const passes = {};
    for (const name of new Set(sample.flatMap(row => Object.keys(row.cpu)))) {
      cpu[name] = distribution(sample.map(row => row.cpu[name] ?? 0));
    }
    for (const name of new Set(sample.flatMap(row => Object.keys(row.passes)))) {
      const entries = sample.map(row => row.passes[name]).filter(Boolean);
      const gpuTimes = entries.filter(pass => pass.gpuSamples === pass.calls).map(pass => pass.gpuMs);
      passes[name] = {
        frames: entries.length,
        calls: distribution(entries.map(pass => pass.calls)),
        drawCalls: distribution(entries.map(pass => pass.drawCalls)),
        triangles: distribution(entries.map(pass => pass.triangles)),
        cpuMs: distribution(entries.map(pass => pass.cpuMs)),
        gpuFrames: gpuTimes.length,
        gpuMs: distribution(gpuTimes),
      };
    }
    return {
      frameCount: sample.length,
      frameMs: distribution(elapsed),
      cpu,
      render: {
        calls: distribution(sample.map(row => row.render.calls)),
        drawCalls: distribution(sample.map(row => row.render.drawCalls)),
        triangles: distribution(sample.map(row => row.render.triangles)),
      },
      passes,
      gpuTiming,
      gpuReadbackFailed,
      ...(includeFrames && { frames: sample }),
    };
  }

  return { beginFrame, stage, endFrame, reset, report };
}
