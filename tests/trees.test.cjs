const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const treesSource = readFileSync(join(__dirname, '../js/trees.js'), 'utf8');
const buildingCollision = loadModule(readFileSync(join(__dirname, '../js/building-collision.js'), 'utf8'));

// Minimal 2D canvas + Three.js math/mesh stubs so createTreeField runs unchanged in Node.
function makeStubDocument() {
  const noop = () => {};
  const buf = new Uint8ClampedArray(1024 * 1024 * 4);
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineCap: 'round',
    lineJoin: 'round',
    lineWidth: 1,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    closePath: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    getImageData: () => ({ data: buf })
  };
  return {
    createElement() {
      return { width: 0, height: 0, getContext: () => ctx };
    }
  };
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  divide(v) { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  lerp(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }
  max(v) {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    return this;
  }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) { return this.crossVectors(this.clone(), v); }
  crossVectors(a, b) {
    this.x = a.y * b.z - a.z * b.y;
    this.y = a.z * b.x - a.x * b.z;
    this.z = a.x * b.y - a.y * b.x;
    return this;
  }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  distanceToSquared(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  normalize() {
    const l = this.length() || 1;
    this.x /= l; this.y /= l; this.z /= l;
    return this;
  }
  applyAxisAngle(axis, angle) {
    const q = new Quaternion().setFromAxisAngle(axis, angle);
    return this.applyQuaternion(q);
  }
  applyQuaternion(q) {
    const { x, y, z } = this;
    const { x: qx, y: qy, z: qz, w: qw } = q;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
  setFromMatrixPosition(m) {
    this.x = m.elements[12];
    this.y = m.elements[13];
    this.z = m.elements[14];
    return this;
  }
}

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  setFromAxisAngle(axis, angle) {
    const half = angle * 0.5, s = Math.sin(half);
    this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s; this.w = Math.cos(half);
    return this;
  }
  setFromUnitVectors(vFrom, vTo) {
    let r = vFrom.dot(vTo) + 1;
    if (r < 1e-6) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this.x = -vFrom.y; this.y = vFrom.x; this.z = 0; this.w = r;
      } else {
        this.x = 0; this.y = -vFrom.z; this.z = vFrom.y; this.w = r;
      }
    } else {
      this.x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this.y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this.z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this.w = r;
    }
    const len = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= len; this.y /= len; this.z /= len; this.w /= len;
    return this;
  }
}

class Matrix4 {
  constructor() {
    this.elements = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  toArray(target, offset = 0) {
    target.set(this.elements, offset);
    return target;
  }
}

class Box3 {
  constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min;
    this.max = max;
  }
  copy(b) { this.min.copy(b.min); this.max.copy(b.max); return this; }
  union(b) {
    this.min.x = Math.min(this.min.x, b.min.x);
    this.min.y = Math.min(this.min.y, b.min.y);
    this.min.z = Math.min(this.min.z, b.min.z);
    this.max.x = Math.max(this.max.x, b.max.x);
    this.max.y = Math.max(this.max.y, b.max.y);
    this.max.z = Math.max(this.max.z, b.max.z);
    return this;
  }
  setFromPoints(pts) {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    for (const p of pts) {
      if (p.x < this.min.x) this.min.x = p.x;
      if (p.y < this.min.y) this.min.y = p.y;
      if (p.z < this.min.z) this.min.z = p.z;
      if (p.x > this.max.x) this.max.x = p.x;
      if (p.y > this.max.y) this.max.y = p.y;
      if (p.z > this.max.z) this.max.z = p.z;
    }
    return this;
  }
  getCenter(out) {
    return out.set((this.min.x + this.max.x) * 0.5, (this.min.y + this.max.y) * 0.5, (this.min.z + this.max.z) * 0.5);
  }
  getSize(out) {
    return out.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z);
  }
  applyMatrix4(m) {
    const e = m.elements;
    const xs = [this.min.x, this.max.x], ys = [this.min.y, this.max.y], zs = [this.min.z, this.max.z];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const x of xs) for (const y of ys) for (const z of zs) {
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
    }
    this.min.set(minX, minY, minZ);
    this.max.set(maxX, maxY, maxZ);
    return this;
  }
  expandByScalar(s) {
    this.min.x -= s; this.min.y -= s; this.min.z -= s;
    this.max.x += s; this.max.y += s; this.max.z += s;
    return this;
  }
}

class Sphere {
  constructor(center = new Vector3(), radius = 0) { this.center = center; this.radius = radius; }
}

class Color {
  constructor() { this.r = 1; this.g = 1; this.b = 1; }
  setHex(hex) {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
}

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
    this.updateRanges = [];
    this.uploads = 0;
  }
  clearUpdateRanges() { this.updateRanges.length = 0; }
  addUpdateRange(start, count) { this.updateRanges.push([start, count]); }
  set needsUpdate(v) { if (v) this.uploads++; }
}

class Float32BufferAttribute extends BufferAttribute {
  constructor(arr, itemSize) { super(arr instanceof Float32Array ? arr : new Float32Array(arr), itemSize); }
}
class Uint16BufferAttribute extends BufferAttribute {
  constructor(arr, itemSize) { super(arr instanceof Uint16Array ? arr : new Uint16Array(arr), itemSize); }
}
class Uint32BufferAttribute extends BufferAttribute {
  constructor(arr, itemSize) { super(arr instanceof Uint32Array ? arr : new Uint32Array(arr), itemSize); }
}
class InstancedBufferAttribute extends BufferAttribute {}
class StorageInstancedBufferAttribute extends InstancedBufferAttribute {}

class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
    this.boundingBox = null;
    this.boundingSphere = null;
    this.userData = {};
  }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  setIndex(idx) { this.index = idx; return this; }
  computeBoundingBox() {
    const pos = this.attributes.position.array;
    const box = new Box3();
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < box.min.x) box.min.x = x; if (x > box.max.x) box.max.x = x;
      if (y < box.min.y) box.min.y = y; if (y > box.max.y) box.max.y = y;
      if (z < box.min.z) box.min.z = z; if (z > box.max.z) box.max.z = z;
    }
    this.boundingBox = box;
  }
  computeBoundingSphere() {
    if (!this.boundingBox) this.computeBoundingBox();
    const c = this.boundingBox.getCenter(new Vector3());
    const { max } = this.boundingBox;
    this.boundingSphere = new Sphere(c, Math.hypot(max.x - c.x, max.y - c.y, max.z - c.z));
  }
}

class Object3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.matrix = new Matrix4();
    this.children = [];
    this.visible = true;
    this.matrixAutoUpdate = true;
    this.matrixWorldAutoUpdate = true;
    this.userData = {};
  }
  add(...kids) { this.children.push(...kids); return this; }
  traverse(fn) {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }
  updateMatrix() {
    const c = Math.cos(this.rotation.y), s = Math.sin(this.rotation.y);
    const sx = this.scale.x, sy = this.scale.y, sz = this.scale.z;
    const e = this.matrix.elements;
    e[0] = c * sx; e[1] = 0; e[2] = -s * sx; e[3] = 0;
    e[4] = 0; e[5] = sy; e[6] = 0; e[7] = 0;
    e[8] = s * sz; e[9] = 0; e[10] = c * sz; e[11] = 0;
    e[12] = this.position.x; e[13] = this.position.y; e[14] = this.position.z; e[15] = 1;
  }
}

class Group extends Object3D {}

class InstancedMesh extends Object3D {
  constructor(geo, mat, count) {
    super();
    this.isInstancedMesh = true;
    this.geometry = geo;
    this.material = mat;
    this.count = count;
    this.instanceMatrix = new InstancedBufferAttribute(new Float32Array(count * 16), 16);
    this.boundingSphere = new Sphere();
  }
  computeBoundingSphere() {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const arr = this.instanceMatrix.array;
    for (let i = 0; i < this.count; i++) {
      const x = arr[i * 16 + 12], y = arr[i * 16 + 13], z = arr[i * 16 + 14];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
    this.boundingSphere = new Sphere(new Vector3(cx, cy, cz), Math.hypot(maxX - cx, maxY - cy, maxZ - cz) + 8);
  }
}

class DataTexture {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; this.mipmaps = []; }
}

const threeStub = {
  Vector3,
  Quaternion,
  Matrix4,
  Box3,
  Sphere,
  Color,
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
  InstancedBufferAttribute,
  StorageInstancedBufferAttribute,
  Object3D,
  Group,
  InstancedMesh,
  DataTexture,
  RGBAFormat: 1023,
  UnsignedByteType: 1009,
  LinearMipmapLinearFilter: 1008,
  LinearFilter: 1006,
  ClampToEdgeWrapping: 1001,
  NoColorSpace: ''
};

let sqrtCalls = 0;
const realSqrt = Math.sqrt;
const countedMath = Object.create(Math);
countedMath.sqrt = (x) => {
  sqrtCalls++;
  return realSqrt(x);
};

const { createTreeField } = loadModule(treesSource, {
  imports: {
    'three/webgpu': threeStub,
    'three/tsl': { uniform: (value) => ({ value }) },
    './tree-seasons.js': { packTreeStyle: (species, random) => species + random },
    './tsl-materials.js': { createTreeMaterial: () => ({ name: 'TreeMat' }) },
    './building-collision.js': buildingCollision
  },
  globals: {
    document: makeStubDocument(),
    Math: countedMath,
    Float32Array,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int32Array,
    Map,
    Set,
    Array,
    Object,
    Infinity,
    Number
  },
  filename: 'js/trees.js'
});

// Brute-force per-tree reference matching pre-#4 HEAD's exact Math.sqrt LOD + hysteresis rules.
function makeBruteForceOracle(sites) {
  const hashPos = (x, y, z) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const MAX_DIST = [3000, 1600, 950];
  const LOW_CUTOFF = 1150;
  const LOD_NEAR = 105;
  const LOD_MID = 420;
  const LOD_HYSTERESIS = 6;
  const N = sites.length;
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  const tier = new Uint8Array(N);
  const spArr = new Uint8Array(N);
  const varArr = new Uint8Array(N);
  const lod = new Uint8Array(N).fill(255);

  sites.forEach((t, i) => {
    const sp = Math.min(2, Math.max(0, t.species || 0));
    const r1 = hashPos(t.x, 1.3, t.z);
    const variant = hashPos(t.x, 5.9, t.z) < 0.5 ? 0 : 1;
    const s = t.scale * (0.9 + r1 * 0.2);
    px[i] = t.x;
    py[i] = (t.y || 0) + 6 * s;
    pz[i] = t.z;
    tier[i] = Math.min(2, t.tier || 0);
    spArr[i] = sp;
    varArr[i] = variant;
  });

  const last = new Vector3(Infinity, Infinity, Infinity);
  function update(pos) {
    const cam = new Vector3().copy(pos);
    if (cam.distanceToSquared(last) < 16) return false;
    last.copy(cam);
    const low = cam.y < 40;
    let changed = false;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cam.x, dy = py[i] - cam.y, dz = pz[i] - cam.z;
      const d = realSqrt(dx * dx + dy * dy + dz * dz);
      const maxD = low ? Math.min(MAX_DIST[tier[i]], LOW_CUTOFF) : MAX_DIST[tier[i]];
      const curL = lod[i] === 255 ? 3 : lod[i];
      let nextL = d < LOD_NEAR ? 0 : d < LOD_MID ? 1 : d < maxD ? 2 : 3;
      if (Math.abs(nextL - curL) === 1) {
        const edge = [LOD_NEAR, LOD_MID, maxD][Math.min(nextL, curL)];
        if (Math.abs(d - edge) < LOD_HYSTERESIS) nextL = curL;
      }
      const next = nextL === 3 ? 255 : nextL;
      if (next !== lod[i]) {
        lod[i] = next;
        changed = true;
      }
    }
    return changed;
  }

  function totalsByLod() {
    const out = [0, 0, 0];
    for (let i = 0; i < N; i++) if (lod[i] !== 255) out[lod[i]]++;
    return out;
  }

  update(new Vector3(0, 10, 140));
  return { update, totalsByLod };
}

test('createTreeField leaves scene.onBeforeRender untouched and matches per-tree oracle across trajectories', () => {
  const sites = [];
  for (let i = 0; i < 2400; i++) {
    const gx = (i % 15) - 7;
    const gz = Math.floor(i / 15) - 80;
    sites.push({
      x: gx * 165 + ((i * 37) % 29),
      y: (i % 7 === 0) ? 3.5 : 0.2,
      z: gz * 72 + ((i * 53) % 31),
      scale: 0.85 + (i % 5) * 0.08,
      species: i % 3,
      tier: i % 3
    });
  }

  const sentinelHook = () => {};
  const scene = { onBeforeRender: sentinelHook };
  const field = createTreeField(scene, sites, []);
  const oracle = makeBruteForceOracle(sites);

  assert.equal(scene.onBeforeRender, sentinelHook, 'must not monkey-patch scene.onBeforeRender');
  assert.equal(field.stats.trees, sites.length);

  // Swap instanceMatrix to StorageInstancedBufferAttribute like main.js on WebGPU
  for (const m of field.meshes) {
    m.instanceMatrix = new StorageInstancedBufferAttribute(m.instanceMatrix.array, 16);
    assert.equal(m.matrixAutoUpdate, false);
    assert.equal(m.matrixWorldAutoUpdate, false);
  }

  const fieldTotalsByLod = () => {
    const out = [0, 0, 0];
    for (const m of field.meshes) {
      if (!m.visible) {
        assert.equal(m.count, 0);
        continue;
      }
      const match = /_lod([012])_/.exec(m.name);
      out[Number(match[1])] += m.count;
    }
    return out;
  };

  assert.deepEqual(fieldTotalsByLod(), oracle.totalsByLod(), 'initial Midtown warmup view matches oracle');

  // Exercise micro-steps (<4m), street walks across hysteresis bands, altitude climbs (y<40 <-> y>=40), and teleports
  const trajectory = [
    new Vector3(1, 10, 141), // <4m move: must skip
    new Vector3(0, 3.2, 130),
    new Vector3(0, 3.2, 100),
    new Vector3(0, 3.2, 94),
    new Vector3(0, 3.2, 104), // reverse inside hysteresis band
    new Vector3(0, 3.2, 112), // cross hysteresis band outward
    new Vector3(180, 3.2, -320),
    new Vector3(180, 38.0, -320), // just below y=40 low cutoff
    new Vector3(180, 44.0, -320), // cross y=40 to aloft MAX_DIST
    new Vector3(180, 210.0, -320),
    new Vector3(-750, 2.5, 4200), // teleport to Financial District
    new Vector3(-4000, 120.0, 14000), // far over Upper Bay: all cells hidden (uniformLod = 255)
    new Vector3(-4020, 120.0, 14020), // move while all cells hidden: 100% O(cells) fast-skip
    new Vector3(0, 12.0, -2400) // teleport back into Central Park
  ];
  for (let step = 0; step < 30; step++) {
    trajectory.push(new Vector3(Math.sin(step * 0.4) * 350, step % 9 === 0 ? 65 : 3.5, -2400 + step * 85));
  }

  for (const pos of trajectory) {
    const gotChanged = field.update(pos);
    const wantChanged = oracle.update(pos);
    assert.equal(gotChanged, wantChanged, `changed flag mismatch at (${pos.x}, ${pos.y}, ${pos.z})`);
    assert.deepEqual(fieldTotalsByLod(), oracle.totalsByLod(), `LOD counts mismatch at (${pos.x}, ${pos.y}, ${pos.z})`);
  }

  // Verify cell-hierarchical culling executes only O(cells) Math.sqrt calls instead of O(trees)
  const cellCount = field.group.children.length;
  sqrtCalls = 0;
  field.update(new Vector3(12, 3.5, 190));
  assert.equal(
    sqrtCalls,
    cellCount,
    `expected exactly 1 Math.sqrt per cell (${cellCount}, 0 per-tree Math.sqrt), got ${sqrtCalls}`
  );
});

test('measured trees preserve ground, height, and crown width across LODs', () => {
  const sites = [
    { x: 0, y: 6, z: 140, species: 0, yaw: 0, height: 20, scale: 0.5 },
    { x: 2, y: 4, z: 140, species: 0, yaw: 0, height: 20, trunkDiameter: 0.18 },
    { x: 4, y: 3, z: 140, species: 0, yaw: 0, height: 20, trunkDiameter: 1.4 },
    { x: 6, y: 9, z: 140, species: 3, yaw: 0, height: 25, trunkDiameter: 0 }
  ];
  const field = createTreeField({}, sites);
  const widths = new Map();
  for (const [level, cameraZ] of [[0, 140], [1, -50], [2, -450]]) {
    field.update(new Vector3(0, 10, cameraZ));
    const visible = field.meshes.filter((m) => m.visible);
    assert.equal(visible.filter((m) => m.name.startsWith('Trees_plane')).length, level === 2 ? 1 : 2);
    let count = 0;
    for (const mesh of visible) {
      assert.match(mesh.name, new RegExp(`_lod${level}_`));
      for (let i = 0; i < mesh.count; i++) {
        const matrix = new Matrix4();
        matrix.elements.set(mesh.instanceMatrix.array.subarray(16 * i, 16 * (i + 1)));
        const site = sites.find((t) => t.x === matrix.elements[12]);
        const box = new Box3().copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
        const size = box.getSize(new Vector3());
        const width = Math.max(size.x, size.z);
        assert.ok(Math.abs(box.min.y - site.y) < 1e-5, 'tree is seated at the mapped elevation');
        assert.ok(Math.abs(size.y - site.height) < 1e-5, 'tree uses its mapped height at each level');
        if (level === 0) widths.set(site, width);
        else assert.ok(Math.abs(width - widths.get(site)) < 1e-5, 'crown width stays stable');
        count++;
      }
    }
    assert.equal(count, sites.length);
  }
  assert.ok(widths.get(sites[1]) < widths.get(sites[0]), 'a thin trunk narrows the estimated crown');
  assert.ok(widths.get(sites[2]) > widths.get(sites[0]), 'a thick trunk broadens the estimated crown');
  assert.ok(widths.get(sites[3]) < widths.get(sites[0]), 'conifers retain a narrower form');
});

test('measured sites check stem clearance while legacy sites also check crowns', () => {
  const adjacent = { x: -1, z: 145, height: 20, species: 0, trunkDiameter: 0.5 };
  const legacy = { x: -1, z: 145, scale: 1, species: 0, yaw: 0 };
  const indoors = { x: 2, z: 145, height: 20, species: 0 };
  const underDeck = { x: 11, z: 145, height: 5, species: 0 };
  const hitsDeck = { x: 12, z: 145, height: 12, species: 0 };
  const colliders = [
    { minX: 0, maxX: 8, minZ: 140, maxZ: 150, maxY: 16 },
    { minX: 10, maxX: 14, minZ: 140, maxZ: 150, minY: 8, maxY: 10 }
  ];
  const field = createTreeField({}, [adjacent, legacy, indoors, underDeck, hitsDeck], colliders);
  assert.deepEqual([...field.sites], [adjacent, underDeck]);
});

test('measured medium LOD uses dense clumps with fewer triangles than legacy medium LOD', () => {
  const field = createTreeField({}, [
    { x: 2, z: 140, species: 0, height: 20 },
    { x: 4, z: 140, species: 0, scale: 1 }
  ]);
  field.update(new Vector3(0, 10, -50));
  const [measured, legacy] = field.meshes.filter((m) => m.visible);
  assert.match(measured.name, /_v0_measured_lod1_/);
  assert.match(legacy.name, /_v0_lod1_/);
  const clumpCards = ({ attributes: { aTree, uv } }) => {
    let vertices = 0;
    for (let i = 0; i < aTree.count; i++) {
      if (aTree.array[i * 4] && uv.array[i * 2] > 0.5 && uv.array[i * 2 + 1] > 0.5) vertices++;
    }
    return vertices / 4;
  };
  assert.equal(clumpCards(measured.geometry), 18);
  assert.equal(clumpCards(legacy.geometry), 0);
  assert.ok(measured.geometry.index.count < legacy.geometry.index.count);
});

test('conifer geometry stays tapered and uses separately culled 200 m cells', () => {
  const field = createTreeField({}, [
    { x: 0, z: 140, height: 20, species: 3 },
    { x: 240, z: 140, height: 20, species: 3 },
    { x: 1800, z: 140, height: 20, species: 3 }
  ]);
  const [near, next, distant] = field.group.children;
  assert.match(near.name, /TreeCell_0,0/);
  assert.match(next.name, /TreeCell_1,0/);
  assert.match(distant.name, /TreeCell_9,0/);
  assert.ok(near.visible && next.visible && !distant.visible);
  for (const mesh of near.children) {
    const { geometry } = mesh;
    const { position, aTree } = geometry.attributes;
    const { min, max } = geometry.boundingBox;
    let lower = 0;
    let upper = 0;
    for (let i = 0; i < position.count; i++) {
      if (!aTree.array[i * 4]) continue;
      const [x, y, z] = position.array.subarray(i * 3, i * 3 + 3);
      const h = (y - min.y) / (max.y - min.y);
      const radius = Math.hypot(x, z);
      if (h < 0.55) lower = Math.max(lower, radius);
      if (h > 0.75) upper = Math.max(upper, radius);
    }
    assert.ok(upper > 0 && upper < lower * 0.65, 'the upper foliage is narrower at every level');
    if (mesh.name.includes('_lod2_')) assert.ok(geometry.index.count / 3 <= 60, 'the far silhouette uses few triangles');
  }
  field.update(new Vector3(1800, 10, 140));
  assert.ok(!near.visible && !next.visible && distant.visible);
  assert.equal(distant.children.find((m) => m.visible).count, 1);
});

test('adaptive trees show coarse crowns first, dither LOD replacements and preserve planted dimensions', () => {
  const site = { x: 2800, y: 12, z: 2900, height: 21, crownWidth: 12, species: 2, yaw: 0, priority: true };
  const field = createTreeField({}, [site], [], { quality: 'high' });
  const position = new Vector3(site.x + 4, 15, site.z);
  const render = () => field.update(position, { deltaMs: 16.67, groundHeight: 12, viewportHeight: 720 });
  const active = () => field.group.children.filter(c => c.visible).flatMap(c => c.children.filter(m => m.visible));
  render();
  assert.match(active()[0].name, /_lod2_/);
  assert.equal(field.stats.transitions, 0);
  render();
  const pair = active();
  assert.equal(pair.length, 2, 'the outgoing coarse crown stays available during the paired fade');
  const [a, b] = pair.map(mesh => mesh.geometry.attributes.aTreeFade.array[0]);
  assert.notEqual(a, 0);
  assert.equal(a, -b, 'the shader receives opposite signs for the same transition start');
  for (const mesh of pair) {
    const matrix = new Matrix4();
    matrix.elements.set(mesh.instanceMatrix.array.subarray(0, 16));
    const bounds = new Box3().copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
    const size = bounds.getSize(new Vector3());
    assert.ok(Math.abs(bounds.min.y - site.y) < 1e-5);
    assert.ok(Math.abs(size.y - site.height) < 1e-5);
    assert.ok(Math.abs(Math.max(size.x, size.z) - site.crownWidth) < 1e-5);
  }
  const upload = field.stats.uploadBytes;
  for (let i = 0; i < 18; i++) render();
  assert.match(active()[0].name, /_lod0_/);
  assert.equal(active().length, 1);
  assert.equal(field.stats.transitions, 0);
  assert.ok(field.stats.uploadBytes > upload, 'upload counts are cumulative');
});

test('adaptive flight uses ground-relative altitude, smooth reach and a bounded coarse-first jump', () => {
  const sites = Array.from({ length: 16 }, (_, i) => ({
    x: 3500 + (i % 4) * 205, y: 36, z: 2400 + Math.floor(i / 4) * 205,
    species: i % 4, height: 13, tier: 0
  }));
  const treeline = { x: 5070, y: 36, z: 2400, species: 0, height: 22, tier: 0 };
  const field = createTreeField({}, [...sites, treeline], [], { quality: 'high' });
  const pos = new Vector3(3500, 38, 2400);
  const render = () => {
    field.update(pos, { deltaMs: 16.67, groundHeight: 36, viewportHeight: 680 });
    assert.ok(field.stats.frameUploadedCells <= 8);
    assert.ok(field.stats.frameUploadBytes <= field.stats.uploadBudget);
    assert.ok(field.stats.transitions <= field.stats.maxFadingTrees);
  };
  render();
  assert.equal(field.stats.visibleTrees, 8);
  assert.equal(field.stats.visibleByLod[0], 0);
  for (let i = 0; i < 40; i++) render();
  const groundCount = field.stats.visibleTrees;
  assert.equal(groundCount, sites.length);
  pos.y = 44;
  for (let i = 0; i < 26; i++) render();
  assert.equal(field.stats.visibleTrees, groundCount, 'crossing absolute Y=40 leaves nearby woodland stable');
  pos.y = 140;
  for (let i = 0; i < 40; i++) render();
  assert.equal(field.stats.visibleTrees, groundCount + 1);
});

test('one-second camera prediction prepares a side cell without drawing it early', () => {
  const field = createTreeField({}, [{ x: 330, y: 0, z: 380, species: 2, height: 15 }]);
  field.setQuality('high');
  const view = {
    position: new Vector3(0, 10, 140),
    fov: 50, aspect: 1.4,
    getWorldDirection(v) { return v.set(0, 0, 1); }
  };
  const updates = [];
  const renderer = { backend: { isWebGPUBackend: true }, _attributes: { update(attr, type) { updates.push([attr, type]); } } };
  const render = () => field.update(view, { deltaMs: 60, groundHeight: 0, viewportHeight: 680, renderer });
  render();
  const [cell] = field.group.children;
  assert.equal(cell.visible, false);
  assert.equal(updates.length, 0);
  view.position.x = 22;
  render();
  assert.equal(cell.visible, false, 'the physical camera cannot see the predicted cell yet');
  assert.equal(updates.length, 3, 'matrix, tint and dither data were prepared ahead');
  assert.ok(field.stats.uploadedCells >= 1);
  view.position.x = 180;
  render();
  assert.equal(cell.visible, true);
});


test('distant tree handoffs preserve the crown mesh, transform, and seasonal style', () => {
  const sites = [
    { x: 810, y: 4, z: 12, species: 0, height: 22, crownWidth: 12, yaw: 0 },
    { x: 1205, y: 8, z: 18, species: 0, height: 16, crownWidth: 10, yaw: 0 },
    { x: 826, y: 3, z: 43, species: 0, scale: 1.2 },
    { x: 1215, y: 5, z: 35, species: 0, scale: 0.8 },
    { x: 832, y: 6, z: 18, species: 2, height: 19, crownWidth: 11, yaw: 0 },
    { x: 1208, y: 9, z: 13, species: 2, height: 18, crownWidth: 9, yaw: 0 },
    { x: 823, y: 2, z: 201, species: 3, height: 23, crownWidth: 7, yaw: 0 },
    { x: 1212, y: 3, z: 209, species: 3, height: 16, crownWidth: 6, yaw: 0 }
  ];
  const field = createTreeField({}, sites, [], { quality: 'high', season: true });
  const position = new Vector3(0, 200, 110);
  const render = () => {
    field.update(position, { deltaMs: 16.7, groundHeight: 0, viewportHeight: 360 });
    assert.ok(field.stats.frameUploadBytes <= field.stats.uploadBudget);
  };
  for (let i = 0; i < 32; i++) render();

  const root = field.group.children.find(group => group.name === 'FarTreeBatches');
  const active = () => root.children.filter(mesh => mesh.visible);
  assert.equal(active().length, 4, 'each crown type is pooled across its two cells');
  assert.equal(field.stats.visibleByLod[2], sites.length);
  assert.ok(field.meshes.every(mesh => !mesh.visible), 'the fine meshes do not duplicate pooled crowns');
  const byX = new Map(sites.map(site => [site.x, site]));
  const localCrowns = new Map(field.meshes.filter(mesh => mesh.count).map(mesh => [mesh.instanceMatrix.array[12], mesh]));
  for (const mesh of active()) {
    assert.equal(mesh.castShadow ?? false, false);
    assert.equal(mesh.count, 2);
    for (let i = 0; i < mesh.count; i++) {
      const matrix = new Matrix4();
      matrix.elements.set(mesh.instanceMatrix.array.subarray(i * 16, (i + 1) * 16));
      const site = byX.get(matrix.elements[12]);
      assert.ok(site);
      const local = localCrowns.get(site.x);
      assert.equal(mesh.geometry.attributes.position, local.geometry.attributes.position);
      assert.equal(mesh.geometry.index, local.geometry.index);
      assert.deepEqual(Array.from(matrix.elements), Array.from(local.instanceMatrix.array));
      assert.deepEqual(mesh.geometry.attributes.aTreeData.array.subarray(i * 4, (i + 1) * 4),
        local.geometry.attributes.aTreeData.array);
      const bounds = new Box3().copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
      const size = bounds.getSize(new Vector3());
      assert.ok(Math.abs(bounds.min.y - site.y) < 1e-5);
      if (site.height) {
        assert.ok(Math.abs(size.y - site.height) < 1e-5);
        assert.ok(Math.abs(Math.max(size.x, size.z) - site.crownWidth) < 1e-5);
      }
      assert.equal(Math.floor(mesh.geometry.attributes.aTreeData.array[i * 4 + 3]), site.species);
    }
  }
  render();
  assert.equal(field.stats.frameUploadBytes, 0);
  position.set(610, 200, 110);
  render();
  assert.equal(active().length, 0, 'cells entering shadow range invalidate their pools');
  assert.equal(field.stats.visibleByLod[2], sites.length);
  assert.ok([...localCrowns.values()].every(mesh => mesh.visible && mesh.count === 1));

  position.set(0, 200, 110);
  for (let i = 0; i < 32; i++) render();
  assert.equal(active().length, 4, 'the same crown types are pooled again after moving away');
  position.set(5500, 200, 5500);
  render();
  assert.equal(active().length, 0, 'a camera jump hides the old distant batches immediately');
  field.setQuality('legacy');
  assert.equal(root.visible, false);
});

test('Auto lowers distant work after sustained misses and recovers more slowly', () => {
  const near = Array.from({ length: 256 }, (_, i) => ({
    x: 1.4 * (i % 16), y: 0, z: 140 + Math.floor(i / 16) * 1.4, height: 13, species: i % 4
  }));
  const far = Array.from({ length: 200 }, (_, i) => ({
    x: 730 + (i % 20) * 5, y: 0, z: 170 + Math.floor(i / 20) * 5,
    height: 18, species: i % 4, tier: 0, priority: i === 0
  }));
  const field = createTreeField({}, [...near, ...far], [], { quality: 'auto' });
  const position = new Vector3(0, 10, 140);
  const render = (dt, n) => {
    for (let i = 0; i < n; i++) field.update(position, { deltaMs: dt, groundHeight: 0, viewportHeight: 680 });
  };
  render(16.67, 300);
  assert.equal(field.stats.qualityLevel, 'high');
  assert.ok(field.stats.visibleTriangles > 100000);
  const before = field.stats.visibleTrees;
  render(50, 28);
  assert.equal(field.stats.qualityLevel, 'high', 'brief contention does not downgrade');
  render(50, 122);
  assert.notEqual(field.stats.qualityLevel, 'high');
  render(16.67, 200);
  assert.notEqual(field.stats.qualityLevel, 'high', 'recovery waits for sustained good frame times');
  assert.ok(field.stats.visibleTrees < before, 'density reduction is confined to distant trees');
  assert.ok(field.stats.visibleByLod[0] >= near.length, 'nearby crowns stay full-quality');
  render(16.67, 2400);
  assert.equal(field.stats.qualityLevel, 'high');
  assert.equal(field.stats.visibleTrees, before, 'deterministic thinning restores the same inventory');
});
