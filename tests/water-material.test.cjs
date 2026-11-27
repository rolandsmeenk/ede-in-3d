const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Extract createWaterMaterial + its TSL helpers (hash2D, noise2D, filteredPulse, boxCoverage) directly from
// js/tsl-materials.js and evaluate emissiveNode numerically across time-of-day presets and water regions.
const source = readFileSync(join(__dirname, '../js/tsl-materials.js'), 'utf8');
const sliceBetween = (startToken, endToken) => {
  const s = source.indexOf(startToken);
  assert.ok(s >= 0, `found ${startToken}`);
  const e = source.indexOf(endToken, s);
  assert.ok(e > s, `found ${endToken}`);
  return source.slice(s, e);
};

const pulseAndBox = sliceBetween('const filteredPulse = Fn(', '// Keep distant lit windows');
const waterFnSrc = sliceBetween('function createWaterMaterial()', '/**\n * Central Park & Manhattan Park');

const env = {
  posWorld: [-1200, -2.2, 500],
  camPos: [-1350, 18, 500],
  interiorGlow: 0.48,
  wind: [0, 0, 0],
  waterTravel: [0, 0],
  waveSamples: null,
  nonUniformRead: false,
  branchDepth: 0,
  nonUniformBranchDepth: 0,
  fwidthRuns: 0,
  fwidthInsideBranch: 0,
  skylineRaycastRuns: 0
};

const arr = (v) => (v instanceof TNode ? v.eval() : typeof v === 'number' ? [v] : v);
const broadcast = (a, b, fn) => {
  const va = arr(a), vb = arr(b);
  const n = Math.max(va.length, vb.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(va[i % va.length], vb[i % vb.length]);
  return out;
};
const smoothstepScalar = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

class TNode {
  constructor(fn) {
    this._fn = typeof fn === 'function' ? fn : () => fn;
  }
  eval() { return this._fn(); }
  get x() { return new TNode(() => [this.eval()[0]]); }
  get y() { return new TNode(() => [this.eval()[1]]); }
  get z() { return new TNode(() => [this.eval()[2]]); }
  get w() { return new TNode(() => [this.eval()[3]]); }
  get xy() { return new TNode(() => this.eval().slice(0, 2)); }
  get xz() { return new TNode(() => { const v = this.eval(); return [v[0], v[2]]; }); }
  add(b) { return new TNode(() => broadcast(this, b, (x, y) => x + y)); }
  sub(b) { return new TNode(() => broadcast(this, b, (x, y) => x - y)); }
  mul(b) { return new TNode(() => broadcast(this, b, (x, y) => x * y)); }
  div(b) { return new TNode(() => broadcast(this, b, (x, y) => x / y)); }
  negate() { return new TNode(() => this.eval().map((x) => -x)); }
  greaterThan(b) { return new TNode(() => broadcast(this, b, (x, y) => (x > y ? 1 : 0))); }
  and(b) { return new TNode(() => broadcast(this, b, (x, y) => (x > 0 && y > 0 ? 1 : 0))); }
  toVar() {
    const prev = env.nonUniformRead;
    env.nonUniformRead = false;
    let slot = this.eval().slice();
    const tainted = env.nonUniformRead;
    env.nonUniformRead = prev || tainted;
    const variable = new TNode(() => {
      if (tainted) env.nonUniformRead = true;
      return slot;
    });
    variable.assign = (rhs) => { slot = arr(rhs).slice(); };
    variable.addAssign = (rhs) => {
      slot = broadcast(slot, rhs, (x, y) => x + y);
    };
    return variable;
  }
}

const wrap = (v) => (v instanceof TNode ? v : new TNode(Array.isArray(v) ? v : [v]));
const unary = (fn) => (a) => new TNode(() => arr(a).map(fn));

function Fn(builder) {
  return (...args) => new TNode(() => arr(args.length ? builder(args) : builder()));
}

function evalCond(cond) {
  const prev = env.nonUniformRead;
  env.nonUniformRead = false;
  const matched = arr(cond)[0] > 0;
  const nonUniform = env.nonUniformRead;
  env.nonUniformRead = prev || nonUniform;
  return { matched, nonUniform };
}

function If(cond, body) {
  let { matched, nonUniform } = evalCond(cond);
  if (matched) {
    env.branchDepth++;
    if (nonUniform) env.nonUniformBranchDepth++;
    try { body(); } finally {
      if (nonUniform) env.nonUniformBranchDepth--;
      env.branchDepth--;
    }
  }
  const api = {
    ElseIf(c, b) {
      if (!matched) {
        const next = evalCond(c);
        nonUniform = nonUniform || next.nonUniform;
        if (next.matched) {
          matched = true;
          env.branchDepth++;
          if (nonUniform) env.nonUniformBranchDepth++;
          try { b(); } finally {
            if (nonUniform) env.nonUniformBranchDepth--;
            env.branchDepth--;
          }
        }
      }
      return api;
    },
    Else(b) {
      if (!matched) {
        matched = true;
        env.branchDepth++;
        if (nonUniform) env.nonUniformBranchDepth++;
        try { b(); } finally {
          if (nonUniform) env.nonUniformBranchDepth--;
          env.branchDepth--;
        }
      }
      return api;
    }
  };
  return api;
}

const iceSnowMask = wrap(0.5);
const sandbox = {
  Math,
  Infinity,
  THREE: {
    MeshStandardNodeMaterial: class {
      userData = {};
      constructor(opts) { Object.assign(this, opts); }
    }
  },
  ISLAND_BOUNDS: { minX: -1100, maxX: 1100, minZ: -5600, maxZ: 6400, waterLevel: -2.2 },
  EDE_DATA: null,
  waterSnowCover: wrap(0),
  iceSnowRetention: () => iceSnowMask,
  applySnowMaterial: (material, options) => Object.assign(material, { snowOptions: options }),
  getEdeReflectionBanks: () => [[-950, -6000, -950, 6000, 70], [950, 6000, 950, -6000, 70]],
  CENTRAL_PARK_BOUNDS: { minX: -420, maxX: 420, minZ: -3800, maxZ: -600 },
  getIslandBoundsAtZ: () => ({ westX: -950, eastX: 950 }),
  NJ_SHORELINE_POLYGON: [{ x: -2100, z: -7000 }, { x: -2100, z: 8000 }, { x: -4000, z: 8000 }, { x: -4000, z: -7000 }],
  LONG_ISLAND_POLYGONS: [[{ x: 1900, z: -7000 }, { x: 1900, z: 8000 }, { x: 4000, z: 8000 }, { x: 4000, z: -7000 }]],
  streetZ: (n) => (42 - n) * 80,
  getWaterWaveTexture: () => ({}),
  WATER_WAVE_AXIS: 0.3,
  cityUniforms: {
    uInteriorGlow: new TNode(() => [env.interiorGlow]),
    uWind: new TNode(() => env.wind),
    uWaterTravel: new TNode(() => env.waterTravel),
    uWaterIce: new TNode(() => [env.waterIce ?? 0])
  },
  positionWorld: new TNode(() => { env.nonUniformRead = true; return env.posWorld; }),
  cameraPosition: new TNode(() => env.camPos),
  normalWorldGeometry: wrap([0, 1, 0]),
  cameraViewMatrix: { transformDirection: (n) => n },
  time: wrap([1.5]),
  Fn,
  If,
  float: (v) => wrap(v),
  vec2: (...args) => new TNode(() => args.flatMap((a) => arr(a)).slice(0, 2)),
  vec3: (...args) => new TNode(() => {
    const flat = args.flatMap((a) => arr(a));
    return flat.length === 1 ? [flat[0], flat[0], flat[0]] : flat.slice(0, 3);
  }),
  vec4: (...args) => new TNode(() => args.flatMap((a) => arr(a)).slice(0, 4)),
  color: (hex) => wrap([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]),
  sin: unary(Math.sin),
  cos: unary(Math.cos),
  abs: unary(Math.abs),
  floor: unary(Math.floor),
  fract: unary((x) => x - Math.floor(x)),
  sqrt: (a) => new TNode(() => {
    if (env.branchDepth > 0) env.skylineRaycastRuns++;
    return arr(a).map(Math.sqrt);
  }),
  min: (a, b) => new TNode(() => broadcast(a, b, Math.min)),
  max: (a, b) => new TNode(() => broadcast(a, b, Math.max)),
  clamp: (v, lo, hi) => new TNode(() => broadcast(broadcast(v, lo, Math.max), hi, Math.min)),
  mix: (a, b, t) => new TNode(() => {
    const va = arr(a), vb = arr(b), vt = arr(t);
    const n = Math.max(va.length, vb.length);
    return Array.from({ length: n }, (_, i) => va[i % va.length] * (1 - vt[i % vt.length]) + vb[i % vb.length] * vt[i % vt.length]);
  }),
  step: (edge, x) => new TNode(() => broadcast(edge, x, (e, v) => (v < e ? 0 : 1))),
  smoothstep: (e0, e1, x) => new TNode(() => {
    const v0 = arr(e0), v1 = arr(e1), vx = arr(x);
    const n = Math.max(v0.length, v1.length, vx.length);
    return Array.from({ length: n }, (_, i) => smoothstepScalar(v0[i % v0.length], v1[i % v1.length], vx[i % vx.length]));
  }),
  dot: (a, b) => new TNode(() => {
    const va = arr(a), vb = arr(b);
    let s = 0;
    for (let i = 0; i < va.length; i++) s += va[i] * vb[i];
    return [s];
  }),
  length: (v) => new TNode(() => [Math.hypot(...arr(v))]),
  normalize: (v) => new TNode(() => {
    const va = arr(v), len = Math.hypot(...va) || 1;
    return va.map((x) => x / len);
  }),
  reflect: (iNode, nNode) => new TNode(() => {
    const iv = arr(iNode), nv = arr(nNode);
    const d2 = 2 * (iv[0] * nv[0] + iv[1] * nv[1] + iv[2] * nv[2]);
    return [iv[0] - d2 * nv[0], iv[1] - d2 * nv[1], iv[2] - d2 * nv[2]];
  }),
  pow: (a, b) => new TNode(() => broadcast(a, b, Math.pow)),
  fwidth: (v) => new TNode(() => {
    env.fwidthRuns++;
    if (env.nonUniformBranchDepth > 0) env.fwidthInsideBranch++;
    return arr(v).map(() => 0.02);
  }),
  texture: (_texture, uv) => {
    env.waveSamples?.push(arr(uv));
    return wrap([0.04, -0.03, 0.015, 0.2]);
  }
};

const noiseStart = source.indexOf('const hash2D = Fn(');
const noiseEnd = source.indexOf('const filteredPulse = Fn(');
assert.ok(noiseStart >= 0 && noiseEnd > noiseStart);
const helpersSrc = source.slice(noiseStart, noiseEnd) + '\n' + pulseAndBox;
const createWaterMaterial = vm.runInNewContext(`${helpersSrc}\n${waterFnSrc}\ncreateWaterMaterial;`, sandbox);
const waterMat = createWaterMaterial();

test('wind strengthens water ripples and advects the texture downwind', () => {
  env.posWorld = [20, -2.2, 10];
  const sample = (wind, travel) => {
    env.wind = wind;
    env.waterTravel = travel;
    env.waveSamples = [];
    const [x, , z] = waterMat.normalNode.eval();
    const [uv] = env.waveSamples;
    env.waveSamples = null;
    return { tilt: Math.hypot(x, z), uv };
  };
  const calm = sample([0, 0, 0], [0, 0]);
  const strong = sample([1, 0, 1], [0, 0]);
  assert.ok(strong.tilt > calm.tilt * 10);
  assert.deepEqual(strong.uv, calm.uv, 'a wind change leaves phase where it was');
  const east = sample([1, 0, 1], [3, 0]);
  const west = sample([-1, 0, 1], [-3, 0]);
  const north = sample([0, -1, 1], [0, -3]);
  assert.ok(east.uv[0] < calm.uv[0] && west.uv[0] > calm.uv[0]);
  assert.ok(north.uv[1] > calm.uv[1] && north.uv[0] === calm.uv[0]);
  assert.deepEqual(sample([0, 0, 0], [0, 0]), calm);
});

test('water emissiveNode skips skyline raycast in midday and golden hour presets', () => {
  env.posWorld = [-1200, -2.2, 500];
  env.camPos = [-1380, 14, 500];
  for (const glow of [0.24, 0.48, 0.55]) {
    env.interiorGlow = glow;
    env.skylineRaycastRuns = 0;
    env.fwidthRuns = 0;
    env.fwidthInsideBranch = 0;
    const out = waterMat.emissiveNode.eval();
    assert.deepEqual(out, [0, 0, 0], `expected zero emissive at uInteriorGlow=${glow}`);
    assert.equal(env.skylineRaycastRuns, 0, `skyline raycast must not run at uInteriorGlow=${glow}`);
    assert.equal(env.fwidthRuns, 0, `derivatives skipped via uniform night gate at uInteriorGlow=${glow}`);
    assert.equal(env.fwidthInsideBranch, 0);
  }
});

test('water emissiveNode skips skyline raycast in outer harbor and upper Hudson at night', () => {
  env.interiorGlow = 1.38; // midnight
  for (const z of [-6200, 7200, 18000]) {
    env.posWorld = [-1200, -2.2, z];
    env.camPos = [-1380, 14, z];
    env.skylineRaycastRuns = 0;
    env.fwidthInsideBranch = 0;
    const out = waterMat.emissiveNode.eval();
    assert.deepEqual(out, [0, 0, 0], `expected zero emissive outside Manhattan region at z=${z}`);
    assert.equal(env.skylineRaycastRuns, 0, `skyline raycast must not run at z=${z}`);
    assert.equal(env.fwidthInsideBranch, 0);
  }
});

test('water emissiveNode evaluates skyline reflections at twilight/midnight in uniform-safe control flow', () => {
  // Hudson River looking east toward Midtown Manhattan
  env.posWorld = [-1150, -2.2, 0];
  env.camPos = [-1350, 12, 0];
  env.fwidthInsideBranch = 0;

  env.interiorGlow = 0.95; // twilight
  env.skylineRaycastRuns = 0;
  const twilight = waterMat.emissiveNode.eval();
  assert.ok(env.skylineRaycastRuns > 0, 'skyline raycast should run at twilight on Hudson River');
  assert.equal(env.fwidthInsideBranch, 0, 'fwidth must stay outside non-uniform If() for WGSL uniformity');
  assert.ok(twilight[0] > 0 && twilight[1] > 0 && twilight[2] > 0, `expected lit reflection at twilight: ${twilight}`);

  env.interiorGlow = 1.38; // midnight
  const midnight = waterMat.emissiveNode.eval();
  assert.equal(env.fwidthInsideBranch, 0);
  assert.ok(midnight[0] > twilight[0], 'midnight reflection is brighter than twilight');

  env.waterIce = 1;
  try {
    assert.ok(waterMat.emissiveNode.eval().every(channel => channel > 0), 'bare ice reflects bank lights at night');
    assert.equal(env.fwidthInsideBranch, 0);
  } finally {
    env.waterIce = 0;
  }
});

test('bare Ede ice is darker and smoother than liquid water and retains its own snow cover', () => {
  env.posWorld = [20, -2.2, 10];
  env.camPos = [80, 14, 90];
  env.wind = [1, 0, 1];
  sandbox.EDE_DATA = {};
  const edeWater = createWaterMaterial();
  sandbox.EDE_DATA = null;
  env.waterIce = 0;
  assert.notEqual(edeWater.normalNode.eval()[0], 0);
  const liquid = edeWater.colorNode.eval();
  const liquidRoughness = edeWater.roughnessNode.eval()[0];
  env.waterIce = 1;
  try {
    const [x, y, z] = edeWater.normalNode.eval();
    assert.ok(Math.abs(x) < 1e-8 && y === 1 && Math.abs(z) < 1e-8);
    assert.ok(edeWater.roughnessNode.eval()[0] < Math.min(0.1, liquidRoughness));
    assert.equal(edeWater.metalnessNode.eval()[0], 0);
    assert.equal(edeWater.snowOptions.cover, sandbox.waterSnowCover);
    assert.equal(edeWater.snowOptions.retention, iceSnowMask);
    assert.equal(edeWater.snowOptions.exposure, edeWater.iceCoverageNode);
    const frozen = edeWater.colorNode.eval();
    assert.ok(frozen.every((channel, i) => channel < liquid[i] * 0.5));
  } finally {
    env.waterIce = 0;
  }
});
