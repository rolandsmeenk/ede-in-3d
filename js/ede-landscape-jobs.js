import { captureTerrainContext } from './terrain.js';

let worker, active, disabled = false, canopyConfigured = false;
const waiting = [];

function advance() {
  if (disabled || active || !waiting.length) return;
  active = waiting.shift();
  const { type, buffer, tile, terrainBounds, boundary, napOrigin } = active;
  try {
    const context = captureTerrainContext(terrainBounds);
    const fields = [context.terrain, ...context.patches, context.expansion?.field, context.expansion?.detail,
      context.expansion?.overviewField];
    worker.postMessage({ type, buffer, tile, context, boundary: canopyConfigured ? undefined : boundary, napOrigin },
      [buffer, ...fields.filter(Boolean).map(field => field.heights.buffer)]);
    if (boundary) canopyConfigured = true;
  } catch (error) {
    fail(error);
  }
}

function fail(error) {
  if (disabled) return;
  disabled = true;
  worker.terminate();
  if (active) active.finish(null);
  active = null;
  for (const job of waiting.splice(0)) job.finish(null);
  console.warn('[landscape worker] using main-thread meshes:', error);
}

export function runLandscapeJob(type, buffer, tile, terrainBounds, signal, options = {}) {
  if (disabled || typeof Worker === 'undefined' || signal.aborted) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./ede-landscape-worker.js?v=20261126-terrain-clipping', import.meta.url), { type: 'module' });
    } catch (error) {
      disabled = true;
      console.warn('[landscape worker] using main-thread meshes:', error);
      return null;
    }
    worker.onmessage = ({ data }) => {
      if (data.error) console.warn('[landscape worker tile]', data.error);
      active?.finish(data.error ? null : data);
      active = null;
      advance();
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
  }
  return new Promise(resolve => {
    const finish = data => {
      signal.removeEventListener('abort', cancel);
      resolve(data);
    };
    const cancel = () => {
      const index = waiting.indexOf(job);
      if (index >= 0) waiting.splice(index, 1);
      finish(null);
    };
    // Keep the small response buffer in the caller so worker failures can fall back without another fetch.
    const job = { type, buffer: buffer.slice(0), tile, terrainBounds, ...options, finish };
    signal.addEventListener('abort', cancel, { once: true });
    waiting.push(job);
    advance();
  });
}
