export function createPavingWorker(prepare) {
  if (typeof Worker !== 'function') return null;
  let worker, available = true;
  return function request(tile) {
    if (!available) return null;
    try {
      worker ??= new Worker(new URL('./ede-paving-worker.js?v=20261127-terrain-normals', import.meta.url), { type: 'module' });
      const current = worker;
      const { input, transfers } = prepare(tile);
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      function finish(value, failed = false) {
        current.onmessage = current.onerror = current.onmessageerror = null;
        if (failed) {
          available = false;
          current.terminate();
          worker = null;
        }
        resolve(value);
      }
      current.onmessage = ({ data }) => {
        if (data.error) {
          console.warn('[paving] using the main thread:', data.error);
          finish(null, true);
        } else finish(data.chunks);
      };
      current.onerror = event => {
        console.warn('[paving] using the main thread:', event.message);
        finish(null, true);
      };
      current.onmessageerror = () => finish(null, true);
      current.postMessage(input, transfers);
      return {
        promise,
        cancel() {
          current.terminate();
          worker = null;
          finish(null);
        },
      };
    } catch (error) {
      console.warn('[paving] using the main thread:', error);
      available = false;
      worker?.terminate();
      worker = null;
      return null;
    }
  };
}
