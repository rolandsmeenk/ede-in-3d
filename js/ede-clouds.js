import { Data3DTexture, LinearFilter, RedFormat, RepeatWrapping, Vector2 } from 'three/webgpu';
import { Break, Fn, If, Loop, float, int, mix, screenCoordinate, smoothstep, texture3D, uniform, vec3 } from 'three/tsl';

// Toronto-inspired single cloud layer. Tileable density noise keeps the march to one lookup per step.
const TILE_METRES = 16000;
const DRIFT_PERIOD = TILE_METRES * 3;
const MAX_DISTANCE = 24000;

function makeCloudNoise() {
  const size = 48;
  const data = new Uint8Array(size ** 3);
  const octaves = [[4, 0.52], [9, 0.29], [20, 0.19]];
  for (const [cells, weight] of octaves) {
    const lattice = new Float32Array(cells ** 3);
    for (let i = 0; i < lattice.length; i++) {
      let n = Math.imul(i + 1361, 0x45d9f3b);
      n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
      lattice[i] = ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }
    const axis = Array.from({ length: size }, (_, index) => {
      const p = (index + 0.5) * cells / size;
      const low = Math.floor(p);
      const f = p - low;
      return { low, high: (low + 1) % cells, weight: f * f * (3 - 2 * f) };
    });
    let index = 0;
    for (const z of axis) {
      for (const y of axis) {
        const a = (z.low * cells + y.low) * cells;
        const b = (z.low * cells + y.high) * cells;
        const c = (z.high * cells + y.low) * cells;
        const d = (z.high * cells + y.high) * cells;
        for (const x of axis) {
          const row = (offset) => lattice[offset + x.low] * (1 - x.weight) + lattice[offset + x.high] * x.weight;
          const near = row(a) * (1 - y.weight) + row(b) * y.weight;
          const far = row(c) * (1 - y.weight) + row(d) * y.weight;
          data[index++] += Math.round((near * (1 - z.weight) + far * z.weight) * weight * 253);
        }
      }
    }
  }
  const noise = new Data3DTexture(data, size, size, size);
  noise.format = RedFormat;
  noise.minFilter = noise.magFilter = LinearFilter;
  noise.wrapS = noise.wrapT = noise.wrapR = RepeatWrapping;
  noise.needsUpdate = true;
  return noise;
}

export function createVolumetricClouds(steps, moonDirection, moonlight) {
  const atlas = texture3D(makeCloudNoise());
  const drift = uniform(new Vector2());
  const evolution = uniform(0);
  const baking = uniform(0);

  // Fair-weather cumulus, a stratocumulus deck, then a low overcast sheet as coverage increases.
  const layer = Fn(([coverage]) => {
    const deck = smoothstep(0.43, 0.73, coverage);
    const overcast = smoothstep(0.74, 0.96, coverage);
    return vec3(mix(mix(940, 750, deck), 460, overcast), mix(mix(1560, 840, deck), 560, overcast), deck);
  }, { coverage: 'float', return: 'vec3' });

  const densityAt = Fn(([point, shape, threshold]) => {
    const height = point.y.sub(shape.x).div(shape.y).toVar();
    const uv = point.xz.sub(drift).div(TILE_METRES);
    const noise = atlas.sample(vec3(uv.x, height.mul(0.57).add(evolution), uv.y)).level(0).r;
    // A gentle flat base and rounded top for cumulus, a broader profile for the denser decks.
    const envelope = smoothstep(0, mix(0.23, 0.10, shape.z), height)
      .mul(smoothstep(mix(0.46, 0.78, shape.z), 1, height).oneMinus());
    return noise.sub(threshold).mul(4.5).clamp(0, 1).mul(envelope);
  });

  const traceLayer = Fn(([ray, eye, coverage, density, light, sampleCount, shadeCloud, jitter]) => {
    const result = vec3(1, 0, 0).toVar();
    const shape = layer(coverage).toVar();
    const rayY = ray.y.abs().max(0.001).mul(ray.y.lessThan(0).select(-1, 1));
    const low = shape.x.sub(eye.y).div(rayY).toVar();
    const high = shape.x.add(shape.y).sub(eye.y).div(rayY).toVar();
    const start = low.min(high).max(0).toVar();
    const end = low.max(high).min(MAX_DISTANCE).toVar();
    If(end.greaterThan(start).and(coverage.greaterThan(0.045)), () => {
      const count = int(sampleCount);
      const stride = end.sub(start).div(float(count)).toVar();
      const t = start.add(stride.mul(jitter)).toVar();
      const regionUV = eye.add(ray.mul(start.add(end).mul(0.5))).xz.sub(drift).div(DRIFT_PERIOD);
      const region = atlas.sample(vec3(regionUV.x, evolution.add(0.27), regionUV.y)).level(0).r;
      const threshold = mix(0.88, 0.22, coverage).sub(region.sub(0.5).mul(0.24)).toVar();
      const extinction = mix(0.005, 0.015, density).mul(stride).toVar();
      const transmission = float(1).toVar();
      const distanceSum = float(0).toVar();
      Loop({ start: 0, end: count, type: 'int', condition: '<' }, () => {
        const localDensity = densityAt(eye.add(ray.mul(t)), shape, threshold);
        const absorbed = transmission.mul(localDensity.mul(extinction).negate().exp().oneMinus()).toVar();
        distanceSum.addAssign(absorbed.mul(t));
        transmission.subAssign(absorbed);
        If(transmission.lessThan(0.0005), () => Break());
        t.addAssign(stride);
      });
      const alpha = transmission.oneMinus().toVar();
      const distance = distanceSum.div(alpha.max(0.001)).toVar();
      const aerial = smoothstep(10500, MAX_DISTANCE, distance).oneMinus();
      result.y.assign(alpha);
      result.z.assign(alpha.mul(aerial));
      If(shadeCloud.greaterThan(0).and(alpha.greaterThan(0.002)), () => {
        const point = eye.add(ray.mul(distance)).toVar();
        const lightDensity = densityAt(point.add(light.mul(mix(540, 330, shape.z))), shape, threshold);
        const topLight = smoothstep(0.03, 0.92, point.y.sub(shape.x).div(shape.y));
        result.x.assign(lightDensity.mul(-2.5).exp().mul(mix(0.46, 1, topLight)));
      });
    });
    return result;
  });

  let lastTime;
  return {
    baking,
    trace(ray, eye, coverage, density, sun) {
      const light = sun.y.lessThan(-0.10).and(moonlight.greaterThan(0)).select(moonDirection, sun);
      // A stable sub-step offset breaks up horizontal sampling bands in the far cloud deck.
      const jitter = screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))
        .fract().mul(52.9829189).fract().mul(0.2).add(0.4);
      return traceLayer(ray, eye, coverage, density, light, mix(steps, 3, baking), baking.oneMinus(), mix(jitter, 0.5, baking));
    },
    transmission(ray, eye, coverage, density) {
      return traceLayer(ray, eye, coverage, density, vec3(0, 1, 0), 3, 0, 0.5).z.oneMinus();
    },
    update(windX, windZ, time) {
      if (!Number.isFinite(time)) return;
      const elapsed = lastTime === undefined ? 0 : Math.min(0.25, Math.max(0, time - lastTime));
      lastTime = time;
      drift.value.x = (drift.value.x + windX * elapsed * 1.6) % DRIFT_PERIOD;
      drift.value.y = (drift.value.y + windZ * elapsed * 1.6) % DRIFT_PERIOD;
      evolution.value = (evolution.value + elapsed / 760) % 1;
    },
  };
}
