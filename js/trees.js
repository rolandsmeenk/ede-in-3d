import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { packTreeStyle } from './tree-seasons.js';
import { createTreeMaterial } from './tsl-materials.js';
import { polygonBoxOverlaps } from './building-collision.js';

// Seeded street and park trees with three geometry levels, regrouped by spatial cell as the camera moves.
// Bark tubes and leaf cards share a material; atlas mipmaps preserve leaf coverage at a distance.
// Crown normals, occlusion and wind weights are baked into the geometry (see createTreeMaterial).

const V3 = THREE.Vector3;

// Seeded PRNG (mulberry32): every species, variant and level grows the same tree on every load
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// =====================================================================================================================
// 1. LEAF ATLAS: 2x2 tiles of leaf sprays drawn in metres and fitted to their tile (tileMeters = the card's world size)
//    0 London plane · 1 honey locust · 2 American elm · 3 dense far-canopy clump (whole-crown cards of the far level)
//    Texels: r = leaf brightness, g = per-leaf hue jitter, b = twig / stalk mask, a = coverage
// =====================================================================================================================
const ATLAS_SIZE = 1024;
const TILE = ATLAS_SIZE / 2;
const GUTTER = 8; // px kept clear round every tile, so mip levels don't bleed between tiles
const TILE_FAR = 3;
const tileOrigin = (k) => [(k % 2) * TILE, (k >> 1) * TILE];

// Spray primitives in metres (x right, y up from the card's attachment point): twigs (polylines) & leaves
function buildSprays(rng) {
  const R = (a, b) => a + (b - a) * rng();

  // Curving twig from (x, y) at angle a off vertical, len m long, curling by `curl` rad over its length
  const twig = (x, y, a, len, curl, segs = 12) => {
    const pts = [[x, y]];
    let ang = a;
    for (let i = 1; i <= segs; i++) {
      ang += curl / segs + R(-0.035, 0.035);
      const p = pts[i - 1];
      pts.push([p[0] + Math.sin(ang) * len / segs, p[1] + Math.cos(ang) * len / segs]);
    }
    return pts;
  };
  // Point & direction angle at arc fraction t of a polyline
  const at = (pts, t) => {
    const f = Math.min(pts.length - 1.001, t * (pts.length - 1));
    const i = Math.floor(f);
    const k = f - i;
    const a = pts[i];
    const b = pts[i + 1];
    return { p: [lerp(a[0], b[0], k), lerp(a[1], b[1], k)], a: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  };

  const sprays = [];

  // 0. London plane: four or five twigs fanning out, big palmate leaves on long stalks, alternating along them
  {
    const prims = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(f * 0.08, 0, f * 1.55 + R(-0.1, 0.1), R(0.62, 0.8) * (1 - Math.abs(f) * 0.32), f * 0.6);
      prims.push({ type: 'twig', pts, w0: 0.016, w1: 0.006 });
      let side = rng() < 0.5 ? 1 : -1;
      for (let t = R(0.18, 0.26); t < 0.97; t += R(0.15, 0.19)) {
        const { p, a } = at(pts, t);
        side = -side;
        const la = a + side * R(0.55, 1.05);
        const len = R(0.17, 0.23) * (1 - t * 0.25);
        const stalk = len * 0.32;
        const q = [p[0] + Math.sin(la) * stalk, p[1] + Math.cos(la) * stalk];
        prims.push({ type: 'stalk', a: p, b: q, w: 0.006 });
        prims.push({ type: 'palmate', p: q, a: la + R(-0.25, 0.25), len, t });
      }
      const tip = at(pts, 1);
      prims.push({ type: 'palmate', p: tip.p, a: tip.a + R(-0.2, 0.2), len: R(0.15, 0.19), t: 1 });
    }
    sprays.push(prims);
  }

  // 1. Honey locust: slender twigs bearing feathery compound fronds of tiny paired leaflets (lacy, light-dappled)
  {
    const prims = [];
    const n = 3;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(0, 0, f * 1.3 + R(-0.1, 0.1), R(0.5, 0.62), f * 0.5);
      prims.push({ type: 'twig', pts, w0: 0.012, w1: 0.005 });
      let side = rng() < 0.5 ? 1 : -1;
      for (let t = R(0.12, 0.2); t <= 1.0; t += R(0.2, 0.26)) {
        const { p, a } = at(pts, Math.min(t, 1));
        side = -side;
        const fa = a + side * R(0.35, 0.8);
        const flen = R(0.26, 0.36);
        const rachis = twig(p[0], p[1], fa, flen, side * R(-0.3, 0.1), 8);
        prims.push({ type: 'stalk', pts: rachis, w: 0.004 });
        for (let s = 0.12; s < 0.98; s += 0.07) {
          const r = at(rachis, s);
          for (const sd of [-1, 1]) {
            prims.push({ type: 'oval', p: r.p, a: r.a + sd * R(1.0, 1.35), len: R(0.032, 0.042), wid: 0.38, t: Math.min(1, t + s * 0.3) });
          }
        }
        const end = at(rachis, 1);
        prims.push({ type: 'oval', p: end.p, a: end.a, len: 0.036, wid: 0.38, t: 1 });
      }
    }
    sprays.push(prims);
  }

  // 2. American elm: zigzag twigs, drooping a little, with two ranks of oval, pointed, lopsided leaves
  {
    const prims = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n - 0.5;
      const pts = twig(f * 0.06, 0, f * 1.6 + R(-0.1, 0.1), R(0.5, 0.66) * (1 - Math.abs(f) * 0.25), f * 0.9, 14);
      prims.push({ type: 'twig', pts, w0: 0.012, w1: 0.004 });
      let side = rng() < 0.5 ? 1 : -1;
      for (let t = R(0.1, 0.16); t < 0.97; t += R(0.085, 0.11)) {
        const { p, a } = at(pts, t);
        side = -side;
        prims.push({ type: 'oval', p, a: a + side * R(0.6, 1.0), len: R(0.1, 0.13) * (1 - t * 0.2), wid: 0.5, skew: side * 0.12, t });
      }
      const tip = at(pts, 1);
      prims.push({ type: 'oval', p: tip.p, a: tip.a, len: 0.09, wid: 0.48, t: 1 });
    }
    sprays.push(prims);
  }

  // 3. Far-canopy clump: a ragged, roundish mass of leaves (one card stands for a whole section of a distant crown)
  {
    const prims = [];
    const lobes = Array.from({ length: 7 }, () => ({ a: R(0, Math.PI * 2), r: R(0.75, 1.0), w: R(0.5, 0.9) }));
    const edge = (ang) => 1.25 * lobes.reduce((m, l) => Math.max(m, l.r * Math.cos(Math.min(Math.PI / 2, Math.abs(((ang - l.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / l.w))), 0.6);
    for (let k = 0; k < 520; k++) {
      const ang = R(0, Math.PI * 2);
      const rr = Math.sqrt(rng()) * edge(ang);
      const p = [Math.cos(ang) * rr, 1.3 + Math.sin(ang) * rr];
      prims.push({ type: 'oval', p, a: R(-Math.PI, Math.PI), len: R(0.16, 0.22), wid: 0.55, t: Math.min(1, Math.max(0, (p[1] - 0.2) / 2.2)) });
    }
    sprays.push(prims);
  }
  return sprays;
}

// Bounding box of a spray (metres), with leaves treated as discs round their centre
function sprayBounds(prims) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const add = (x, y, r = 0) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };
  for (const q of prims) {
    if (q.type === 'twig' || (q.type === 'stalk' && q.pts)) for (const p of q.pts) add(p[0], p[1]);
    else if (q.type === 'stalk') {
      add(q.a[0], q.a[1]);
      add(q.b[0], q.b[1]);
    } else {
      add(q.p[0] + Math.sin(q.a) * q.len * 0.5, q.p[1] + Math.cos(q.a) * q.len * 0.5, q.len * 0.62);
    }
  }
  return { minX, maxX, minY, maxY };
}

function createLeafAtlas() {
  const ctx2d = () => {
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS_SIZE;
    return c.getContext('2d', { willReadFrequently: true });
  };
  const col = ctx2d(); // r leaf brightness, g hue jitter, b twig mask
  const cov = ctx2d(); // coverage
  // Mean leaf value under the empty texels, so filtering never pulls black (or twig brown) into the leaf edges
  col.fillStyle = 'rgb(170, 128, 0)';
  col.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const c of [col, cov]) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  const rng = mulberry32(20261015);
  const R = (a, b) => a + (b - a) * rng();
  const sprays = buildSprays(rng);
  const tileMeters = [];

  sprays.forEach((prims, k) => {
    // Fit: attachment point at the bottom centre of the tile (the far clump: centred), widest extent to the gutter
    const b = sprayBounds(prims);
    const [ox, oy] = tileOrigin(k);
    const room = TILE - 2 * GUTTER;
    let s;
    let cx;
    let by;
    if (k === TILE_FAR) {
      s = room / Math.max(b.maxX - b.minX, b.maxY - b.minY);
      cx = ox + TILE / 2 - ((b.minX + b.maxX) / 2) * s;
      by = oy + TILE / 2 + ((b.minY + b.maxY) / 2) * s;
    } else {
      s = Math.min((room / 2) / Math.max(-b.minX, b.maxX), room / Math.max(b.maxY, 0.01));
      cx = ox + TILE / 2;
      by = oy + TILE - GUTTER;
    }
    tileMeters[k] = room / s;
    const X = (p) => cx + p[0] * s;
    const Y = (p) => by - p[1] * s;
    // Point (u along, v across) of a leaf from P at angle a, L long & W wide (canvas space)
    const frame = (P, a, L, W) => {
      const d = [Math.sin(a), -Math.cos(a)];
      const x0 = X(P);
      const y0 = Y(P);
      return (u, v) => [x0 + d[0] * u * L * s - d[1] * v * W * s, y0 + d[1] * u * L * s + d[0] * v * W * s];
    };
    const ovalPath = (c, f, skew = 0) => {
      c.moveTo(...f(0, 0));
      c.bezierCurveTo(...f(0.05, 0.6 + skew), ...f(0.6, 0.62), ...f(1, 0));
      c.bezierCurveTo(...f(0.6, -0.62), ...f(0.05, -0.6 + skew), ...f(0, 0));
    };
    const halfPath = (c, f, skew = 0) => {
      c.moveTo(...f(0, 0));
      c.bezierCurveTo(...f(0.05, 0.6 + skew), ...f(0.6, 0.62), ...f(1, 0));
      c.closePath();
    };
    // Same path on both canvases: data colour on one, white coverage on the other
    const fill = (path, rgb) => {
      for (const [c, style] of [[col, rgb], [cov, '#fff']]) {
        c.beginPath();
        path(c);
        c.fillStyle = style;
        c.fill();
      }
    };
    const stroke = (pts, w0, w1, rgb) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const w = Math.max(0.8, lerp(w0, w1, i / (pts.length - 1)) * s);
        for (const [c, style] of [[col, rgb], [cov, '#fff']]) {
          c.beginPath();
          c.moveTo(X(pts[i]), Y(pts[i]));
          c.lineTo(X(pts[i + 1]), Y(pts[i + 1]));
          c.lineWidth = w;
          c.strokeStyle = style;
          c.stroke();
        }
      }
    };
    const leafRGB = (t) => {
      // brighter towards the sunlit outer end of the spray, a few darker or older leaves
      const r = Math.min(255, Math.round(255 * R(0.6, 0.9) * (0.8 + 0.2 * t)));
      return [r, Math.round(255 * rng())];
    };
    const rgb = (r, g, bl = 0) => `rgb(${r}, ${g}, ${bl})`;

    for (const q of prims) {
      if (q.type === 'twig') stroke(q.pts, q.w0, q.w1, rgb(110, 128, 255));
      else if (q.type === 'stalk') stroke(q.pts || [q.a, q.b], q.w, q.w * 0.7, rgb(120, 128, 150));
      else if (q.type === 'oval') {
        const [r, g] = leafRGB(q.t);
        const f = frame(q.p, q.a, q.len, q.len * q.wid);
        fill((c) => ovalPath(c, f, q.skew || 0), rgb(r, g));
        if (q.len * s > 9) {
          // one half of the blade a little darker (folded along the midrib) and the midrib itself
          col.beginPath();
          halfPath(col, f, q.skew || 0);
          col.fillStyle = rgb(Math.round(r * 0.84), g);
          col.fill();
        }
      } else if (q.type === 'palmate') {
        // Five pointed lobes radiating from the blade centre: main, two side & two small basal ones
        const [r, g] = leafRGB(q.t);
        const L = q.len;
        const cP = [q.p[0] + Math.sin(q.a) * L * 0.22, q.p[1] + Math.cos(q.a) * L * 0.22];
        const lobes = [[0, 0.78, 0.36], [0.85, 0.62, 0.34], [-0.85, 0.62, 0.34], [1.65, 0.34, 0.36], [-1.65, 0.34, 0.36]];
        lobes.forEach(([da, ll, ww], li) => {
          const f = frame(cP, q.a + da + R(-0.08, 0.08), L * ll, L * ll * ww);
          const shade = li === 0 ? 1 : (da > 0 ? 0.88 : 0.95);
          fill((c) => ovalPath(c, f), rgb(Math.round(r * shade), g));
        });
        fill((c) => c.arc(X(cP), Y(cP), L * 0.24 * s, 0, Math.PI * 2), rgb(Math.round(r * 0.96), g));
      }
    }
  });

  // Colour data + coverage -> level 0, then a mip chain whose alpha keeps each tile's coverage
  const data = col.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;
  const mask = cov.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;
  const level0 = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  for (let i = 0; i < level0.length; i += 4) {
    level0[i] = data[i];
    level0[i + 1] = data[i + 1];
    level0[i + 2] = data[i + 2];
    level0[i + 3] = mask[i + 3];
  }
  const tex = new THREE.DataTexture(level0, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = coverageMips(level0, ATLAS_SIZE, 2);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.name = 'TreeLeafAtlas';
  return { texture: tex, tileMeters };
}

// Box-filtered mip chain whose alpha is rescaled per tile so the share of texels above the alpha-test cutoff stays as
// it is at level 0 (otherwise alpha-tested foliage thins out and vanishes at distance)
function coverageMips(level0, size, tiles, cutoff = 128) {
  const levels = [{ data: level0, width: size, height: size }];
  const target = [];
  const tilePx = size / tiles;
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      let n = 0;
      for (let y = ty * tilePx; y < (ty + 1) * tilePx; y++) {
        for (let x = tx * tilePx; x < (tx + 1) * tilePx; x++) if (level0[(y * size + x) * 4 + 3] >= cutoff) n++;
      }
      target.push(n / (tilePx * tilePx));
    }
  }
  const meanTarget = target.reduce((a, b) => a + b, 0) / target.length;
  let src = level0;
  let w = size;
  const hist = new Uint32Array(256);
  while (w > 1) {
    const h = w >> 1;
    const dst = new Uint8Array(h * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        const i0 = ((2 * y) * w + 2 * x) * 4;
        const i1 = i0 + w * 4;
        const o = (y * h + x) * 4;
        for (let c = 0; c < 4; c++) dst[o + c] = (src[i0 + c] + src[i0 + 4 + c] + src[i1 + c] + src[i1 + 4 + c] + 2) >> 2;
      }
    }
    const nt = h >= tiles ? tiles : 1;
    const tp = h / nt;
    for (let ty = 0; ty < nt; ty++) {
      for (let tx = 0; tx < nt; tx++) {
        const want = (nt === tiles ? target[ty * tiles + tx] : meanTarget) * tp * tp;
        hist.fill(0);
        for (let y = ty * tp; y < (ty + 1) * tp; y++) for (let x = tx * tp; x < (tx + 1) * tp; x++) hist[dst[(y * h + x) * 4 + 3]]++;
        let acc = 0;
        let aStar = 255;
        for (let a = 255; a >= 1; a--) {
          acc += hist[a];
          if (acc >= want) {
            aStar = a;
            break;
          }
        }
        const scale = cutoff / Math.max(aStar, 1);
        if (Math.abs(scale - 1) < 0.01) continue;
        for (let y = ty * tp; y < (ty + 1) * tp; y++) {
          for (let x = tx * tp; x < (tx + 1) * tp; x++) {
            const i = (y * h + x) * 4 + 3;
            dst[i] = Math.min(255, Math.round(dst[i] * scale));
          }
        }
      }
    }
    levels.push({ data: dst, width: h, height: h });
    src = dst;
    w = h;
  }
  return levels;
}

// =====================================================================================================================
// 2. SPECIES: trunk / leader (radius, top, lean), scaffold limbs (count, heights up the leader, tilt off vertical and
//    length blended from the lowest to the highest limb), branches & twigs (count, span along the parent, angle off it,
//    length as a share of the parent or in metres), bending per metre (up: toward the sky, out: away from the trunk,
//    droop: down, growing toward the tips), leaf cards per twig (scale, droop) and the per-tree foliage tints (sRGB).
//    Scale 1 is a mature park tree; street trees are planted smaller.
// =====================================================================================================================
const SPECIES = [
  { // 0: London plane: tall clear trunk and leader with heavy ascending limbs, a broad rounded crown of big leaves
    name: 'plane', tile: 0, crownRatio: 0.7,
    trunk: { r: 0.3, top: 8.6, lean: 0.04, segs: 8 },
    limbs: { n: 6, y: [3.4, 7.4], tilt: [1.0, 0.36], len: [4.6, 2.8], r: 0.62, up: 0.07, out: 0, droop: 0, jitter: 0.07, segs: 6 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.55, 0.95], len: [0.62, 0.42], up: 0.06, out: 0.02, droop: 0, jitter: 0.1, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.6, 1.05], len: [1.15, 0.75], up: 0.02, out: 0, droop: 0.04, jitter: 0.12, segs: 2 },
    cards: { perTwig: 2, scale: [0.85, 1.1], droop: 0.05 },
    tints: [0x4b6a29, 0x5a7a2f, 0x3f5e25]
  },
  { // 1: Honey locust: slim trunk forking into spreading, zigzag limbs, an open layered crown of feathery fronds
    name: 'locust', tile: 1, crownRatio: 0.75,
    trunk: { r: 0.19, top: 5.4, lean: 0.07, segs: 7 },
    limbs: { n: 5, y: [2.6, 5.0], tilt: [1.12, 0.55], len: [4.2, 2.8], r: 0.68, up: 0.04, out: 0, droop: 0, jitter: 0.16, segs: 6 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.6, 1.05], len: [0.6, 0.42], up: 0.03, out: 0.03, droop: 0.02, jitter: 0.16, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.55, 1.0], len: [1.0, 0.65], up: 0, out: 0, droop: 0.06, jitter: 0.14, segs: 2 },
    cards: { perTwig: 2, scale: [0.85, 1.1], droop: 0.1 },
    tints: [0x7b8c33, 0x8d9b3d, 0x6c7f2d]
  },
  { // 2: American elm: trunk forking low into upright limbs that arch outward, a tall vase with drooping twigs
    name: 'elm', tile: 2, crownRatio: 0.57,
    trunk: { r: 0.28, top: 4.3, lean: 0.03, segs: 6 },
    limbs: { n: 5, y: [3.3, 4.1], tilt: [0.36, 0.22], len: [7.4, 7.0], r: 0.6, up: 0, out: 0.075, droop: 0, jitter: 0.06, segs: 7 },
    branches: { n: 5, t: [0.35, 1.0], angle: [0.5, 0.85], len: [0.44, 0.3], up: 0, out: 0.05, droop: 0.07, jitter: 0.1, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.5, 0.95], len: [1.3, 0.85], up: 0, out: 0, droop: 0.16, jitter: 0.12, segs: 2 },
    cards: { perTwig: 2, scale: [0.85, 1.1], droop: 0.4 },
    tints: [0x44622a, 0x53702e, 0x3a5724]
  },
  { // 3: Conifer: single slender leader with progressively shorter, nearly horizontal boughs
    name: 'conifer', tile: 1, crownRatio: 0.38,
    trunk: { r: 0.24, top: 11.4, tip: 0.04, lean: 0.012, segs: 10 },
    limbs: { n: 14, y: [2.45, 10.7], tilt: [1.43, 1.1], len: [1.95, 0.28], r: 0.35, up: 0.08, out: 0, droop: 0, jitter: 0.08, segs: 4 },
    branches: { n: 2, t: [0.25, 0.98], angle: [0.4, 0.68], len: [0.4, 0.27], up: 0.04, out: 0.02, droop: 0.025, jitter: 0.08, segs: 2 },
    twigs: { n: 1, t: [0.4, 1.0], angle: [0.35, 0.8], len: [0.35, 0.17], up: 0.02, out: 0, droop: 0.08, jitter: 0.12, segs: 2 },
    cards: { perTwig: 2, scale: [0.75, 0.95], droop: 0.15, tipScale: 0.27 },
    tints: [0x354e33, 0x3e5739, 0x315049]
  }
];

// =====================================================================================================================
// 3. SKELETON
// =====================================================================================================================

// Unit vector `angle` off `dir`, turned `azimuth` round it
function deflect(dir, angle, azimuth) {
  const ref = Math.abs(dir.y) < 0.95 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  const u = new V3().crossVectors(dir, ref).normalize();
  const w = new V3().crossVectors(dir, u);
  return dir.clone().multiplyScalar(Math.cos(angle))
    .addScaledVector(u, Math.sin(angle) * Math.cos(azimuth))
    .addScaledVector(w, Math.sin(angle) * Math.sin(azimuth))
    .normalize();
}

// A branch as a polyline from p0 along dir, len metres in segs steps (or at the given length fractions), bending per
// metre toward the sky (up), away from the trunk axis (out) and downward toward its tip (droop), with some wander
function growBranch(p0, dir, len, r0, r1, segs, bend, rng, level, schedule = null) {
  const ts = schedule || Array.from({ length: segs + 1 }, (_, i) => i / segs);
  const pts = [p0.clone()];
  const rad = [r0];
  const d = dir.clone();
  const p = p0.clone();
  const out = new V3();
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i];
    const step = (t - ts[i - 1]) * len;
    out.set(p.x, 0, p.z);
    if (out.lengthSq() > 1e-6) out.normalize();
    d.x += out.x * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.y += (bend.up - bend.droop * t * 2.0) * step + (rng() - 0.5) * bend.jitter * 0.6;
    d.z += out.z * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
    rad.push(r0 + (r1 - r0) * Math.pow(t, 0.8));
  }
  return { pts, rad, len, level, ts };
}

// Point, direction & radius at length fraction t of a branch
function along(b, t) {
  const ts = b.ts;
  let i = 0;
  while (i < ts.length - 2 && ts[i + 1] < t) i++;
  const k = Math.min(1, Math.max(0, (t - ts[i]) / (ts[i + 1] - ts[i])));
  return {
    p: b.pts[i].clone().lerp(b.pts[i + 1], k),
    d: b.pts[i + 1].clone().sub(b.pts[i]).normalize(),
    r: lerp(b.rad[i], b.rad[i + 1], k)
  };
}

function growTree(sp, seed) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rng();
  const branches = [];
  const still = { up: 0, out: 0, droop: 0, jitter: 0.025 };

  // Trunk & leader: leaning a little, flaring at the root (dense rings at the base), tapering to a slim top
  const T = sp.trunk;
  const lean = R(0, Math.PI * 2);
  const trunkDir = new V3(Math.cos(lean) * T.lean, 1, Math.sin(lean) * T.lean).normalize();
  const schedule = [0, 0.03, 0.08];
  for (let i = 1; i <= T.segs; i++) schedule.push(0.08 + (0.92 * i) / T.segs);
  const trunk = growBranch(new V3(0, 0, 0), trunkDir, T.top, T.r, T.r * (T.tip ?? 0.3), T.segs, still, rng, 0, schedule);
  trunk.rad = trunk.rad.map((r, i) => r * (1 + 0.75 * Math.exp(-(trunk.ts[i] * T.top) / 0.28)));
  branches.push(trunk);

  // Scaffold limbs spiralling up the leader by the golden angle; branches along each limb; twigs along each branch
  const L = sp.limbs;
  const B = sp.branches;
  const W = sp.twigs;
  let az = R(0, Math.PI * 2);
  for (let i = 0; i < L.n; i++) {
    const f = L.n > 1 ? i / (L.n - 1) : 0;
    const y = lerp(L.y[0], L.y[1], f) + R(-0.25, 0.25);
    const base = along(trunk, Math.min(0.98, y / T.top));
    az += 2.39996 + R(-0.35, 0.35);
    const tilt = lerp(L.tilt[0], L.tilt[1], f) + R(-0.08, 0.08);
    const dir = new V3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const len = lerp(L.len[0], L.len[1], f) * R(0.88, 1.1);
    const limb = growBranch(base.p, dir, len, base.r * L.r, 0.035, L.segs, L, rng, 1);
    branches.push(limb);

    const nb = B.n + (rng() < 0.5 ? 1 : 0);
    let baz = R(0, Math.PI * 2);
    for (let j = 0; j < nb; j++) {
      const bt = lerp(B.t[0], B.t[1], (j + R(0.15, 0.85)) / nb);
      const a = along(limb, bt);
      baz += 2.39996 + R(-0.4, 0.4);
      const bdir = deflect(a.d, R(B.angle[0], B.angle[1]), baz);
      const outw = new V3(a.p.x, 0, a.p.z).normalize();
      if (bdir.dot(outw) < -0.15) bdir.addScaledVector(outw, 0.7).normalize(); // keep out of the crown core
      const blen = len * lerp(B.len[0], B.len[1], bt) * R(0.85, 1.12);
      const br = growBranch(a.p, bdir, blen, Math.max(0.022, a.r * 0.62), 0.014, B.segs, B, rng, 2);
      br.parentT = bt;
      branches.push(br);

      const nw = W.n + (rng() < 0.4 ? 1 : 0);
      let taz = R(0, Math.PI * 2);
      for (let k = 0; k < nw; k++) {
        const tt = lerp(W.t[0], W.t[1], (k + R(0.2, 0.8)) / nw);
        const ta = along(br, tt);
        taz += 2.39996 + R(-0.5, 0.5);
        const tdir = deflect(ta.d, R(W.angle[0], W.angle[1]), taz);
        const tw = growBranch(ta.p, tdir, lerp(W.len[0], W.len[1], tt) * R(0.8, 1.2), Math.max(0.012, ta.r * 0.7), 0.006, W.segs, W, rng, 3);
        tw.parentT = tt;
        branches.push(tw);
      }
    }
  }
  return branches;
}

// =====================================================================================================================
// 4. GEOMETRY: bark tubes & leaf cards of one species / variant at one level of detail
// =====================================================================================================================
class TreeGeometryBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.attr = [];
    this.idx = [];
  }

  vertex(p, n, u, v, leaf, ao, sway, rnd) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.attr.push(leaf, ao, sway, rnd);
    return this.pos.length / 3 - 1;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.attr, 4));
    const vCount = this.pos.length / 3;
    g.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Tapered tube along a branch with parallel-transported rings (every `stride`-th skeleton point); uv in metres
function addTube(gb, b, radial, stride, aoAt, swayAt) {
  const n = b.pts.length;
  const keep = [];
  for (let i = 0; i < n; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  const tangent = (i) => {
    const a = b.pts[Math.max(0, i - 1)];
    const c = b.pts[Math.min(n - 1, i + 1)];
    return c.clone().sub(a).normalize();
  };
  let T = tangent(keep[0]);
  let N = Math.abs(T.y) < 0.9 ? new V3(0, 1, 0).cross(T).normalize() : new V3(1, 0, 0).cross(T).normalize();
  const q = new THREE.Quaternion();
  const around = 2 * Math.PI * Math.max(b.rad[0], 0.02);
  let vLen = 0;
  const base = gb.pos.length / 3;
  const dir = new V3();
  const p = new V3();
  keep.forEach((i, ki) => {
    if (ki > 0) {
      const T2 = tangent(i);
      q.setFromUnitVectors(T, T2);
      N.applyQuaternion(q).normalize();
      T = T2;
      vLen += b.pts[i].distanceTo(b.pts[keep[ki - 1]]);
    }
    const Bn = new V3().crossVectors(T, N);
    const t = b.ts[i];
    const ao = aoAt(b.pts[i]);
    const sway = swayAt(b, t);
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      dir.copy(N).multiplyScalar(Math.cos(ang)).addScaledVector(Bn, Math.sin(ang));
      p.copy(b.pts[i]).addScaledVector(dir, b.rad[i]);
      gb.vertex(p, dir, (j / radial) * around, vLen, 0, ao, sway, 0);
    }
  });
  // Rings run counter-clockwise round the tangent, so (a, a + 1, c) is counter-clockwise seen from outside: the front
  // faces point out along the normals (the material drops the bark's back faces)
  for (let k = 0; k < keep.length - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const a = base + k * (radial + 1) + j;
      const c = a + radial + 1;
      gb.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
}

// Leaf card: bottom edge centred on `at`, rising along `up`, facing `face`; uv over atlas tile `tile` (mirrored or not)
function addCard(gb, at, up, face, size, tile, mirror, rnd, crown, height = size) {
  const side = new V3().crossVectors(up, face).normalize();
  const nrm = new V3().crossVectors(side, up).normalize();
  const [ox, oy] = tileOrigin(tile);
  let u0 = (ox + GUTTER) / ATLAS_SIZE;
  let u1 = (ox + TILE - GUTTER) / ATLAS_SIZE;
  if (mirror) [u0, u1] = [u1, u0];
  const vTop = (oy + GUTTER) / ATLAS_SIZE;
  const vBot = (oy + TILE - GUTTER) / ATLAS_SIZE;
  const corners = [
    [-0.5, 0, u0, vBot],
    [0.5, 0, u1, vBot],
    [0.5, 1, u1, vTop],
    [-0.5, 1, u0, vTop]
  ];
  const base = gb.pos.length / 3;
  const p = new V3();
  for (const [sx, sy, u, v] of corners) {
    p.copy(at).addScaledVector(side, sx * size).addScaledVector(up, sy * height);
    const { n, ao } = crown.shade(p, nrm);
    gb.vertex(p, n, u, v, 1, ao, lerp(0.8, 1.0, sy), rnd);
  }
  gb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Crown ellipsoid (from the foliage) for shell normals & interior occlusion
function makeCrown(points) {
  const box = new THREE.Box3().setFromPoints(points);
  const C = box.getCenter(new V3());
  const Rr = box.getSize(new V3()).multiplyScalar(0.5).max(new V3(0.5, 0.5, 0.5));
  const tmp = new V3();
  const sn = new V3();
  return {
    C,
    R: Rr,
    bottom: box.min.y,
    // Shell normal (out from the centre, a little skyward) blended with the card face (turned to agree with it)
    shade(p, face) {
      tmp.copy(p).sub(C).divide(Rr);
      const e = tmp.length();
      sn.copy(tmp).normalize();
      sn.y += 0.22;
      sn.normalize();
      const f = face.dot(sn) < 0 ? face.clone().negate() : face.clone();
      const n = sn.clone().multiplyScalar(0.72).addScaledVector(f, 0.28).normalize();
      const top = Math.min(1, Math.max(-1, (p.y - C.y) / Rr.y));
      const ao = (0.22 + 0.78 * smooth(0.15, 1.0, e)) * (0.86 + 0.14 * top);
      return { n, ao };
    },
    // Bark: open below the crown, darker the deeper inside it
    barkAO(p) {
      if (p.y < box.min.y) return 0.9;
      tmp.copy(p).sub(C).divide(Rr);
      return lerp(0.32, 0.8, smooth(0.2, 1.0, tmp.length()));
    }
  };
}

// Sway weight along the hierarchy: 0 on the trunk (whole-tree bend is height based), rising to 1 at the twig tips
function swayWeight(b, t) {
  switch (b.level) {
    case 0: return 0;
    case 1: return 0.18 * t;
    case 2: return 0.18 + 0.4 * t;
    default: return 0.58 + 0.4 * t;
  }
}

// Fine twig cards (lod 0), larger branch cards (lod 1), and a canopy shell shared by all levels (lod 2).
function placeCards(sp, branches, lod, tileMeters, rng, crown, compact = false) {
  const R = (a, b) => a + (b - a) * rng();
  const cards = [];
  const outward = (p) => new V3(p.x - crown.C.x, (p.y - crown.C.y) * 0.6, p.z - crown.C.z).normalize();
  const orient = (p, d, droop) => {
    const o = outward(p);
    const up = d.clone().multiplyScalar(0.55).addScaledVector(o, 0.45)
      .add(new V3(R(-0.3, 0.3), R(-0.2, 0.3), R(-0.3, 0.3)));
    up.y -= droop;
    up.normalize();
    let face = o.clone().add(new V3(R(-0.9, 0.9), R(-0.6, 0.9), R(-0.9, 0.9))).normalize();
    face.addScaledVector(up, -face.dot(up));
    if (face.lengthSq() < 1e-4) face = new V3(0, 1, 0).cross(up);
    return { up, face: face.normalize() };
  };
  const size = tileMeters[sp.tile];
  const sizeAt = (p) => sp.cards.tipScale
    ? size * lerp(1, sp.cards.tipScale, smooth(sp.limbs.y[0], sp.limbs.y[1], p.y))
    : size;
  if (lod === 0) {
    for (const b of branches) {
      if (b.level !== 3) continue;
      const n = sp.cards.perTwig;
      for (let k = 0; k < n; k++) {
        const t = lerp(0.4, 1.0, (k + R(0.3, 0.9)) / n);
        const a = along(b, t);
        const { up, face } = orient(a.p, a.d, sp.cards.droop);
        cards.push({ at: a.p, up, face, size: sizeAt(a.p) * R(sp.cards.scale[0], sp.cards.scale[1]), tile: sp.tile });
      }
    }
    // a card at the end of every branch fills the gap between its twigs
    for (const b of branches) {
      if (b.level !== 2) continue;
      const a = along(b, 1);
      const { up, face } = orient(a.p, a.d, sp.cards.droop);
      cards.push({ at: a.p, up, face, size: sizeAt(a.p) * R(0.9, 1.1), tile: sp.tile });
    }
  } else if (lod === 1) {
    const samples = compact ? [0.85] : [0.42, 0.72, 1.0];
    for (const b of branches) {
      if (b.level !== 2) continue;
      for (const t of samples) {
        const a = along(b, Math.min(1, t + R(-0.06, 0.04)));
        const { up, face } = orient(a.p, a.d, sp.cards.droop);
        const at = a.p.clone().addScaledVector(outward(a.p), 0.35);
        cards.push({ at, up, face, size: sizeAt(a.p) * R(1.35, 1.6), tile: sp.tile });
      }
    }
  } else if (sp.name === 'conifer') {
    // Crossed foliage cards in overlapping tiers keep the tapered silhouette from every azimuth.
    const yaw = R(0, Math.PI);
    for (let i = 0; i < 6; i++) {
      const f = i / 5;
      const center = along(branches[0], lerp(0.23, 0.94, f)).p;
      const size = lerp(5.1, 0.83, f);
      const height = lerp(3.65, 1.75, f);
      for (let j = 0; j < 3; j++) {
        const angle = yaw + i * 0.37 + j * Math.PI / 3;
        const face = new V3(Math.cos(angle), R(-0.45, 0.45), Math.sin(angle)).normalize();
        const up = new V3(0, 1, 0).addScaledVector(face, -face.y).normalize();
        const at = center.clone().addScaledVector(up, -height * 0.5);
        cards.push({ at, up, face, size, height, tile: TILE_FAR });
      }
    }
  } else {
    // Fibonacci directions over the crown, fewer underneath; cards centred just inside the shell, facing out
    const n = 18;
    const meanR = (crown.R.x + crown.R.y + crown.R.z) / 3;
    const s = Math.max(meanR * 1.25, 2.4);
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + 0.5) / n * 1.55; // 1 .. -0.55
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ph = i * 2.39996 + R(-0.2, 0.2);
      const dir = new V3(Math.cos(ph) * r, y, Math.sin(ph) * r);
      const center = crown.C.clone().add(dir.clone().multiply(crown.R).multiplyScalar(0.58));
      const face = dir.clone().add(new V3(R(-0.25, 0.25), R(-0.25, 0.25), R(-0.25, 0.25))).normalize();
      let up = new V3(0, 1, 0).addScaledVector(face, -face.y);
      if (up.lengthSq() < 1e-3) up = new V3(1, 0, 0);
      up.normalize().applyAxisAngle(face, R(-0.5, 0.5));
      const at = center.clone().addScaledVector(up, -s * 0.5);
      cards.push({ at, up, face, size: s, tile: TILE_FAR });
    }
  }
  return cards;
}

// One species / variant: [lod0, lod1, lod2] geometries.
function buildTreeGeometries(speciesIndex, variant, tileMeters, includeMeasuredMiddle = false) {
  const sp = SPECIES[speciesIndex];
  const seed = 7919 * (speciesIndex + 1) + 104729 * (variant + 1);
  const branches = growTree(sp, seed);

  // Crown from the full-detail foliage: card anchors pushed out by half a card
  const rngC = mulberry32(seed ^ 0x5bd1e995);
  const tips = [];
  for (const b of branches) if (b.level === 3) tips.push(b.pts[b.pts.length - 1]);
  const roughCrown = makeCrown(tips);
  const cards0 = placeCards(sp, branches, 0, tileMeters, rngC, roughCrown);
  const pts = [];
  for (const c of cards0) {
    pts.push(c.at.clone().addScaledVector(c.up, c.size * 0.5));
    pts.push(c.at.clone().addScaledVector(c.up, c.size));
  }
  const crown = makeCrown(pts);

  const buildLevel = (lod, measuredMiddle = false) => {
    const gb = new TreeGeometryBuilder();
    const rng = mulberry32(seed + lod * 31337);
    const aoAt = (p) => crown.barkAO(p);
    // Small twigs are drawn in the leaf cards; simplify the remaining bark with distance.
    for (const b of branches) {
      if (lod === 0 && b.level <= 2) {
        addTube(gb, b, [5, 3, 3][b.level], [2, 3, 4][b.level], aoAt, swayWeight);
      } else if (lod === 1 && b.level <= 1) {
        addTube(gb, b, 3, b.level === 0 ? 4 : 8, aoAt, swayWeight);
      } else if (lod === 2 && (b.level === 0 || (b.level === 1 && sp.name !== 'conifer'))) {
        const stride = sp.name === 'conifer' ? 5 : b.pts.length - 1;
        addTube(gb, b, 3, stride, aoAt, swayWeight);
      }
    }
    // Close trees add the coarse branch cards and the whole-crown shell on top of the twig cards, so a crown seen
    // from above (helicopter) stays as full as the distant levels
    const cards = [];
    if (lod === 0) cards.push(...cards0);
    if (lod < 2) cards.push(...placeCards(sp, branches, 1, tileMeters, rng, crown, measuredMiddle));
    // Dense clumps preserve medium crowns when individual leaf sprays get small on screen.
    if (lod !== 1 || measuredMiddle) cards.push(...placeCards(sp, branches, 2, tileMeters, rng, crown));
    for (const c of cards) addCard(gb, c.at, c.up, c.face, c.size, c.tile, rng() < 0.5, rng(), crown, c.height);
    const g = gb.build();
    g.userData = { species: sp.name, variant, lod, cards: cards.length, triangles: gb.idx.length / 3 };
    return g;
  };
  const levels = [0, 1, 2].map((lod) => buildLevel(lod));
  if (includeMeasuredMiddle) levels.measuredMiddle = buildLevel(1, true);
  return levels;
}

// =====================================================================================================================
// 5. TREE FIELD: per-tree level of detail, with spatial cells culled separately in the view and shadow passes
// =====================================================================================================================
const TREE_CELL_SIZE = 200;
const LOD_NEAR = 105; // full detail within (m)
const LOD_MID = 420; // coarse cards & branches within; whole-crown cards beyond
const LOD_HYSTERESIS = 6;
// Draw distance per tier (0 park & plaza, 1 avenue & esplanade, 2 cross-street); at street level everything beyond
// LOW_CUTOFF is behind the buildings anyway
const MAX_DIST = [3000, 1600, 950];
const LOW_CUTOFF = 1150;

const ADAPTIVE_LEVELS = [
  { near: 76, mid: 23, reach: 1, density: 1, shadows: 390 },
  { near: 89, mid: 31, reach: 0.91, density: 0.78, shadows: 280 },
  { near: 104, mid: 40, reach: 0.81, density: 0.55, shadows: 180 }
];
const ADAPTIVE_NAMES = ['high', 'medium', 'low'];
const MAX_CELL_UPLOADS = 8;
const MAX_FADING_CELLS = 5;
const MAX_FADING_TREES = 750;
const FADE_SECONDS = 0.22;
const INSTANCE_BYTES = 84;

// Slop Singapore samples consecutive one-second windows and restores quality more slowly than it drops it.
function createAutoCanopy() {
  let level = 0, seconds = 0, frames = 0, late = 0;
  let slow = 0, fast = 0, clock = 0, quietUntil = 3;
  const retry = [0, 0, 0], failures = [0, 0, 0];
  return {
    get level() { return level; },
    update(deltaMs, triangleLoad) {
      if (!(deltaMs > 0 && deltaMs < 500)) return false;
      const dt = deltaMs * 0.001;
      clock += dt;
      seconds += dt;
      frames++;
      if (deltaMs > 35) late++;
      if (seconds < 1) return false;
      const fps = frames / seconds, lateShare = late / frames;
      seconds = frames = late = 0;
      if (clock < quietUntil) return false;
      const belowBudget = fps < 29 || lateShare > 0.18;
      slow = belowBudget && triangleLoad > 100000 ? slow + 1 : 0;
      fast = fps >= 34 && lateShare < 0.06 ? fast + 1 : 0;
      if (slow >= 3 && level < ADAPTIVE_LEVELS.length - 1) {
        retry[level] = clock + Math.min(90, 15 * 2 ** failures[level]++);
        level++;
      } else if (fast >= 12 && level > 0 && clock >= retry[level - 1]) {
        level--;
      } else {
        return false;
      }
      slow = fast = 0;
      quietUntil = clock + 3;
      return true;
    }
  };
}

function hashPos(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

const hasMeasuredHeight = (t) => Number.isFinite(t.height) && t.height > 0;

// Placement checks run once, against nearby buildings and bridge structures.
function createTreeClearance(colliders) {
  const cellSize = 64;
  const cells = new Map();
  for (const c of colliders) {
    for (let x = Math.floor(c.minX / cellSize); x <= Math.floor(c.maxX / cellSize); x++) {
      for (let z = Math.floor(c.minZ / cellSize); z <= Math.floor(c.maxZ / cellSize); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(c);
      }
    }
  }
  return (bounds) => {
    const { min, max } = bounds;
    for (let x = Math.floor(min.x / cellSize); x <= Math.floor(max.x / cellSize); x++) {
      for (let z = Math.floor(min.z / cellSize); z <= Math.floor(max.z / cellSize); z++) {
        for (const c of cells.get(`${x},${z}`) || []) {
          if (min.y >= c.maxY || max.y <= (c.minY ?? 0)
            || min.x >= c.maxX || max.x <= c.minX || min.z >= c.maxZ || max.z <= c.minZ) continue;
          if (c.polygon && !polygonBoxOverlaps(c.polygon, (min.x + max.x) / 2, (min.z + max.z) / 2,
            (max.x - min.x) / 2, (max.z - min.z) / 2)) continue;
          if (c.obb) {
            const o = c.obb;
            const dx = (min.x + max.x) * 0.5 - o.cx, dz = (min.z + max.z) * 0.5 - o.cz;
            const hx = (max.x - min.x) * 0.5, hz = (max.z - min.z) * 0.5;
            // Also test the building's axes, so its enclosing box doesn't block an angled sidewalk.
            if (Math.abs(dx * o.cs - dz * o.sn) >= o.hx + hx * Math.abs(o.cs) + hz * Math.abs(o.sn)
              || Math.abs(dx * o.sn + dz * o.cs) >= o.hz + hx * Math.abs(o.sn) + hz * Math.abs(o.cs)) continue;
          }
          return false;
        }
      }
    }
    return true;
  };
}

/**
 * Builds the instanced tree field for sites with x, y, z, species, and either height (metres) or scale.
 * Sites may also have trunkDiameter (metres, when known), yaw, sx, sz, and tier.
 * Call update(camera, { deltaMs, viewportHeight, groundHeight, renderer }) from the frame loop.
 * The benchmark can also use the original update(cameraPosition) interface in legacy mode.
 */
function createTreeField(_scene, sites, colliders = [], { quality = 'legacy', season = false, canopyCovers } = {}) {
  const group = new THREE.Group();
  group.name = 'Trees';
  const atlas = createLeafAtlas();
  const material = createTreeMaterial(atlas.texture, { seasons: season });
  let mode = 'legacy';
  let fadeClock, adaptiveMaterial;
  let previousLod, fadeStart;
  let qualityControl = createAutoCanopy();
  const stats = {
    trees: 0, qualityLevel: 'legacy', visibleTrees: 0, visibleByLod: [0, 0, 0],
    visibleTriangles: 0, shadowBatches: 0, transitions: 0,
    uploadBytes: 0, uploadedCells: 0, frameUploadBytes: 0, frameUploadedCells: 0, farBatches: 0
  };

  // Geometries: [species][variant][lod]
  const includeMeasuredMiddle = sites.some(hasMeasuredHeight);
  const geos = SPECIES.map((_, s) => [0, 1].map((v) => buildTreeGeometries(s, v, atlas.tileMeters, includeMeasuredMiddle)));
  const clearOfBuildings = createTreeClearance(colliders);
  const treeBounds = geos.map((variants) => variants.map((levels) => {
    const bounds = new THREE.Box3();
    for (const g of levels) bounds.union(g.boundingBox);
    const height = Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y));
    // Maximum wind sway, with clearance for flutter and facade trim.
    const margin = Math.hypot(0.2, 0.06) * Math.hypot(0.86, 0.51) * (height / 11) ** 2 + 0.5;
    return { bounds, margin };
  }));
  const worldBounds = new THREE.Box3();
  const plantedSites = new Set();

  // Allocate for candidate sites; N counts only trees clear of buildings.
  const capacity = sites.length;
  let N = 0;
  const mats = new Float32Array(capacity * 16);
  const data = new Float32Array(capacity * 4);
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const hasHeight = new Uint8Array(capacity);
  const meshOf = new Int32Array(capacity * 3); // mesh index per level
  const tier = new Uint8Array(capacity);
  const lod = new Uint8Array(capacity).fill(255);
  const crownWidth = new Float32Array(capacity);
  const keep = new Float32Array(capacity);
  const priority = new Uint8Array(capacity);

  // Shared geometry types per species, variant and level.
  const types = [];
  const makeType = (geo, name) => {
    const { min, max } = geo.boundingBox;
    const height = Math.max(Math.abs(min.y), Math.abs(max.y));
    // The material adds wind after the instance transform: height-squared lean/rock, plus bob and flutter.
    const windPadding = Math.hypot(0.2, 0.06) * Math.hypot(0.86, 0.51) * (height / 11) ** 2 + 2;
    const type = {
      geo, name, windPadding, meshes: [],
      inverseHeight: 1 / (max.y - min.y),
      inverseWidth: 1 / Math.max(max.x - min.x, max.z - min.z),
      lod: geo.userData.lod, triangles: geo.userData.triangles
    };
    types.push(type);
    return type;
  };
  const meshIndex = SPECIES.map((sp, s) => ({
    l0: [0, 1].map((v) => makeType(geos[s][v][0], `Trees_${sp.name}_v${v}_lod0`)),
    l1: [0, 1].map((v) => makeType(geos[s][v][1], `Trees_${sp.name}_v${v}_lod1`)),
    measuredMiddle: includeMeasuredMiddle
      ? [0, 1].map((v) => makeType(geos[s][v].measuredMiddle, `Trees_${sp.name}_v${v}_measured_lod1`))
      : [],
    l2: [0, 1].map((v) => makeType(geos[s][v][2], `Trees_${sp.name}_v${v}_lod2`))
  }));
  const cells = new Map();
  const meshes = [];
  const counts = [];

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  sites.forEach((t) => {
    const sp = Math.min(SPECIES.length - 1, Math.max(0, t.species || 0));
    const r1 = hashPos(t.x, 1.3, t.z);
    const r2 = hashPos(t.z, 7.1, t.x);
    const r3 = hashPos(t.x + t.z, 3.3, 0.7);
    const variant = hashPos(t.x, 5.9, t.z) < 0.5 ? 0 : 1;
    const groundY = t.y || 0;
    const sized = hasMeasuredHeight(t);
    const s = (t.scale ?? 1) * (0.9 + r1 * 0.2);
    dummy.position.set(t.x, groundY, t.z);
    dummy.rotation.set(0, t.yaw ?? r2 * Math.PI * 2, 0);
    if (sized) {
      const diameter = Number.isFinite(t.trunkDiameter) && t.trunkDiameter > 0 ? t.trunkDiameter : 0;
      const expectedDiameter = 2 * SPECIES[sp].trunk.r * t.height * meshIndex[sp].l0[variant].inverseHeight;
      const breadth = diameter ? Math.max(0.72, Math.min(1.25, (diameter / expectedDiameter) ** 0.25)) : 1;
      const width = t.crownWidth || t.height * SPECIES[sp].crownRatio * breadth;
      dummy.scale.set(width * (t.sx || 1), t.height, width * (t.sz || 1));
      dummy.updateMatrix();
      // Check the mapped stem against the footprint, including elevated obstacles.
      const radius = Math.min(2, Math.max(0.05, (diameter || expectedDiameter) * 0.5));
      worldBounds.min.set(t.x - radius, groundY, t.z - radius);
      worldBounds.max.set(t.x + radius, groundY + t.height, t.z + radius);
    } else {
      dummy.scale.set(s * (0.9 + r3 * 0.2) * (t.sx || 1), s * (0.88 + r1 * 0.24), s * (0.9 + r2 * 0.2) * (t.sz || 1));
      dummy.updateMatrix();
      const tree = treeBounds[sp][variant];
      worldBounds.copy(tree.bounds).applyMatrix4(dummy.matrix).expandByScalar(tree.margin);
    }
    if (!clearOfBuildings(worldBounds)) return;
    const i = N++;
    plantedSites.add(t);
    dummy.matrix.toArray(mats, i * 16);
    tint.setHex(SPECIES[sp].tints[Math.floor(r3 * 2.999)]).multiplyScalar(0.82 + r1 * 0.36);
    data.set([tint.r, tint.g, tint.b, season ? packTreeStyle(sp, r2, t.seasonGroup) : sp + r2 * 0.999], i * 4);
    keep[i] = hashPos(t.x, 11.1, t.z);
    priority[i] = Number(Boolean(t.priority));
    px[i] = t.x;
    py[i] = groundY + (sized ? t.height * 0.5 : 6 * s);
    pz[i] = t.z;
    hasHeight[i] = sized;
    tier[i] = Math.min(2, t.tier || 0);
    const cellX = Math.floor(t.x / TREE_CELL_SIZE);
    const cellZ = Math.floor(t.z / TREE_CELL_SIZE);
    const cellKey = (cellX + 32768) * 65536 + (cellZ + 32768);
    let cell = cells.get(cellKey);
    if (!cell) {
      const label = `${cellX},${cellZ}`;
      const cellGroup = new THREE.Group();
      cellGroup.name = `TreeCell_${label}`;
      cellGroup.visible = false;
      group.add(cellGroup);
      cell = { group: cellGroup, label, cellX, cellZ, trees: [], meshes: new Map(), farBatches: [] };
      cells.set(cellKey, cell);
    }
    cell.trees.push(i);
    cell.priority ||= priority[i] === 1;
    const mi = meshIndex[sp];
    const near = mi.l0[variant];
    const xScale = Math.hypot(dummy.matrix.elements[0], dummy.matrix.elements[2]);
    const zScale = Math.hypot(dummy.matrix.elements[8], dummy.matrix.elements[10]);
    crownWidth[i] = Math.max(xScale, zScale) / (sized ? 1 : near.inverseWidth);
    // Measured trees retain their dimensions with either variant, so distant stands can share a batch per species.
    const treeTypes = sized
      ? [mi.l0[variant], mi.measuredMiddle[variant], mi.l2[0]]
      : [mi.l0[variant], mi.l1[variant], mi.l2[variant]];
    for (let l = 0; l < 3; l++) {
      const type = treeTypes[l];
      let index = cell.meshes.get(type);
      if (index === undefined) {
        index = meshes.length;
        meshes.push({ type, cell, name: `${type.name}_${cell.label}`, capacity: 0 });
        cell.meshes.set(type, index);
      }
      meshOf[i * 3 + l] = index;
      meshes[index].capacity++;
    }
  });

  // Finalize per-cell 3D bounding spheres, tier cutoffs, and typed index arrays for cell-hierarchical LOD checks.
  const cellList = Array.from(cells.values(), (cell) => {
    const trees = Int32Array.from(cell.trees);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let maxCutoffAloft = 0;
    let minCutoffAloft = Infinity;
    for (let k = 0; k < trees.length; k++) {
      const i = trees[k];
      const x = px[i], y = py[i], z = pz[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      const td = MAX_DIST[tier[i]];
      if (td > maxCutoffAloft) maxCutoffAloft = td;
      if (td < minCutoffAloft) minCutoffAloft = td;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    let maxR2 = 0;
    for (let k = 0; k < trees.length; k++) {
      const i = trees[k];
      const dx = px[i] - cx, dy = py[i] - cy, dz = pz[i] - cz;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > maxR2) maxR2 = r2;
    }
    cell.trees = trees;
    cell.meshIndices = Int32Array.from(cell.meshes.values());
    cell.cx = cx;
    cell.cy = cy;
    cell.cz = cz;
    cell.radius = Math.sqrt(maxR2) + 1e-3;
    cell.maxCutoffAloft = maxCutoffAloft;
    cell.maxCutoffLow = Math.min(maxCutoffAloft, LOW_CUTOFF);
    cell.minCutoffAloft = minCutoffAloft;
    cell.minCutoffLow = Math.min(minCutoffAloft, LOW_CUTOFF);
    cell.uniformLod = 255;
    cell.lo = new Uint32Array(3);
    cell.triangles = 0;
    cell.shadowBatches = 0;
    cell.instanceCount = 0;
    cell.revision = -1;
    cell.fadeUntil = 0;
    cell.fadingTrees = 0;
    cell.hasCoverage = false;
    cell.drawable = false;
    cell.shadows = true;
    return cell;
  });

  function batchMesh(type, name, cap, batchMaterial = material) {
    const geo = new THREE.BufferGeometry();
    for (const key of Object.keys(type.geo.attributes)) geo.setAttribute(key, type.geo.attributes[key]);
    geo.setIndex(type.geo.index);
    geo.boundingSphere = type.geo.boundingSphere;
    geo.boundingBox = type.geo.boundingBox;
    // Static usage on purpose: three.js re-uploads a DynamicDrawUsage attribute in every render pass of every frame
    // (both shadow cascades + the scene pass, ~7 MB/frame here). rebuild() uploads just the instances in use, and only
    // when the levels change.
    const treeData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('aTreeData', treeData);
    const mesh = new THREE.InstancedMesh(geo, batchMaterial, cap);
    mesh.name = name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.receiveShadow = true;
    return mesh;
  }

  const instanced = meshes.map((m, index) => {
    const mesh = batchMesh(m.type, m.name, m.capacity);
    mesh.userData.treeBatchIndex = index;
    mesh.castShadow = true;
    m.cell.group.add(mesh);
    m.type.meshes.push(mesh);
    counts.push(0);
    return mesh;
  });

  // Pool identical far crowns in 800 m blocks to keep their silhouettes stable and limit draw calls.
  const pooledBatches = [], dirtyFarBatches = new Set();
  let farGroup;
  function initFarBatches() {
    farGroup = new THREE.Group();
    farGroup.name = 'FarTreeBatches';
    farGroup.matrixAutoUpdate = farGroup.matrixWorldAutoUpdate = false;
    const pending = new Map();
    for (const cell of cellList) {
      if (cell.priority) continue;
      const x = Math.floor(cell.cellX / 4), z = Math.floor(cell.cellZ / 4);
      for (const mi of cell.meshIndices) {
        const { type, capacity } = meshes[mi];
        if (type.lod !== 2) continue;
        const { species, variant } = type.geo.userData;
        const name = `Trees_pooled_lod2_${species}_v${variant}_${x},${z}`;
        if (!pending.has(name)) pending.set(name, { name, sources: [], capacity: 0, type });
        const batch = pending.get(name);
        batch.sources.push(mi);
        batch.capacity += capacity;
      }
    }
    for (const batch of pending.values()) {
      if (batch.sources.length < 2 || batch.capacity * INSTANCE_BYTES > uploadBudget) continue;
      pooledBatches.push(batch);
      for (const mi of batch.sources) {
        const cell = meshes[mi].cell;
        if (!cell.farBatches.includes(batch)) cell.farBatches.push(batch);
      }
    }
    group.add(farGroup);
  }

  function farBatchMesh({ type, name, capacity }) {
    const mesh = batchMesh(type, name, capacity, adaptiveMaterial);
    mesh.geometry.setAttribute('aTreeFade', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    const reference = type.meshes[0];
    if (reference.instanceMatrix.isStorageInstancedBufferAttribute) {
      mesh.instanceMatrix = new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array, 16);
    }
    mesh.userData.sharesPipelineWith = reference.userData.sharesPipelineWith ?? reference;
    mesh.matrixAutoUpdate = mesh.matrixWorldAutoUpdate = false;
    farGroup.add(mesh);
    return mesh;
  }

  function invalidateFarBatches(cell) {
    for (const batch of cell.farBatches) {
      if (dirtyFarBatches.has(batch)) continue;
      if (batch.mesh) batch.mesh.visible = false;
      for (const mi of batch.sources) instanced[mi].visible = instanced[mi].count > 0;
      dirtyFarBatches.add(batch);
    }
  }

  // Repack only changed cells; each fixed-capacity mesh is shared by all its occupants at this level.
  const dirtyCells = new Set();
  const uploaded = new WeakSet();
  let uploadContext;
  function syncAttribute(attr, count, inAdvance) {
    const length = count * attr.itemSize;
    const bytes = (uploaded.has(attr) ? length : attr.array.length) * attr.array.BYTES_PER_ELEMENT;
    uploaded.add(attr);
    stats.uploadBytes += bytes;
    stats.frameUploadBytes += bytes;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, length);
    attr.needsUpdate = true;
    if (inAdvance) {
      // The bundled Three.js attribute cache marks these uploads current before a predicted cell is drawn.
      const type = attr.isStorageInstancedBufferAttribute ? 3 : 1;
      uploadContext.update(attr, type);
    }
  }

  function repackFarBatches(uploadBudget) {
    for (const batch of dirtyFarBatches) {
      const { type } = batch;
      const sources = batch.sources.filter(mi => {
        const cell = meshes[mi].cell, source = instanced[mi];
        return cell.group.visible && cell.fadeUntil === 0 && source.count > 0 && !source.castShadow;
      });
      if (sources.length < 2) {
        dirtyFarBatches.delete(batch);
        continue;
      }
      const count = sources.reduce((sum, mi) => sum + instanced[mi].count, 0);
      const prior = batch.mesh;
      const fadePending = !uploaded.has(prior?.geometry.attributes.aTreeFade);
      const bytes = (uploaded.has(prior?.instanceMatrix) ? count : batch.capacity) *
        (INSTANCE_BYTES - Float32Array.BYTES_PER_ELEMENT) +
        (fadePending ? batch.capacity * Float32Array.BYTES_PER_ELEMENT : 0);
      // Leave the fine batches visible if the compacted upload must wait.
      if (stats.frameUploadBytes + bytes > uploadBudget) continue;
      const mesh = batch.mesh ??= farBatchMesh(batch);
      const { aTreeData, aTreeFade } = mesh.geometry.attributes;
      let offset = 0;
      for (const mi of sources) {
        const source = instanced[mi], n = source.count;
        mesh.instanceMatrix.array.set(source.instanceMatrix.array.subarray(0, n * 16), offset * 16);
        aTreeData.array.set(source.geometry.attributes.aTreeData.array.subarray(0, n * 4), offset * 4);
        offset += n;
        source.visible = false;
      }
      mesh.count = count;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += type.windPadding;
      mesh.visible = true;
      syncAttribute(mesh.instanceMatrix, count, false);
      syncAttribute(aTreeData, count, false);
      if (fadePending) syncAttribute(aTreeFade, count, false);
      dirtyFarBatches.delete(batch);
    }
  }

  function writeTree(i, level, fade, adaptive) {
    const mi = meshOf[i * 3 + level], mesh = instanced[mi], type = meshes[mi].type;
    const count = counts[mi]++;
    const dst = mesh.instanceMatrix.array, srcOff = i * 16, dstOff = count * 16;
    for (let j = 0; j < 16; j++) dst[dstOff + j] = mats[srcOff + j];
    if (hasHeight[i] || adaptive) {
      const near = meshes[meshOf[i * 3]].type;
      const width = type.inverseWidth / (hasHeight[i] ? 1 : near.inverseWidth);
      const height = type.inverseHeight / (hasHeight[i] ? 1 : near.inverseHeight);
      dst[dstOff] *= width;
      dst[dstOff + 2] *= width;
      dst[dstOff + 5] *= height;
      dst[dstOff + 8] *= width;
      dst[dstOff + 10] *= width;
      dst[dstOff + 13] -= type.geo.boundingBox.min.y * dst[dstOff + 5];
    }
    const dstData = mesh.geometry.attributes.aTreeData.array, srcData = i * 4, offset = count * 4;
    for (let j = 0; j < 4; j++) dstData[offset + j] = data[srcData + j];
    if (adaptive) mesh.geometry.attributes.aTreeFade.array[count] = fade;
  }

  function rebuild() {
    const adaptive = mode !== 'legacy';
    for (const cell of dirtyCells) {
      const indices = cell.meshIndices;
      const hadFar = cell.lo[2] > 0;
      cell.lo.fill(0);
      cell.triangles = cell.instanceCount = cell.shadowBatches = 0;
      for (const mi of indices) counts[mi] = 0;
      if (adaptive || cell.uniformLod !== 255) {
        for (const i of cell.trees) {
          const l = lod[i], start = adaptive ? fadeStart[i] : 0;
          if (l !== 255) {
            writeTree(i, l, start, adaptive);
            cell.lo[l]++;
          }
          if (start && previousLod[i] !== 255) writeTree(i, previousLod[i], -start, true);
        }
      }
      const inAdvance = Boolean(uploadContext && adaptive && !cell.drawable);
      const beforeBytes = stats.frameUploadBytes;
      for (const mi of indices) {
        const mesh = instanced[mi], n = counts[mi];
        mesh.count = n;
        mesh.visible = n > 0;
        if (!n) continue;
        cell.instanceCount += n;
        cell.triangles += n * meshes[mi].type.triangles;
        if (mesh.castShadow) cell.shadowBatches++;
        const attrs = mesh.geometry.attributes;
        syncAttribute(mesh.instanceMatrix, n, inAdvance);
        syncAttribute(attrs.aTreeData, n, inAdvance);
        if (adaptive) syncAttribute(attrs.aTreeFade, n, inAdvance);
        // The view and shadow passes can cull each species and LOD independently.
        mesh.computeBoundingSphere();
        mesh.boundingSphere.radius += meshes[mi].type.windPadding;
      }
      cell.group.visible = (adaptive ? cell.drawable : true) && beforeBytes < stats.frameUploadBytes;
      if (adaptive && (hadFar || cell.lo[2])) invalidateFarBatches(cell);
      if (beforeBytes < stats.frameUploadBytes) {
        stats.uploadedCells++;
        stats.frameUploadedCells++;
      }
    }
    dirtyCells.clear();
  }

  function measureVisible() {
    const { visibleByLod } = stats;
    visibleByLod.fill(0);
    let triangles = 0, shadowBatches = 0;
    for (const cell of cellList) {
      if (!cell.group.visible) continue;
      for (let l = 0; l < 3; l++) visibleByLod[l] += cell.lo[l];
      triangles += cell.triangles;
      shadowBatches += cell.shadowBatches;
    }
    stats.farBatches = 0;
    if (mode !== 'legacy') {
      for (const batch of pooledBatches) {
        if (!batch.mesh?.visible) continue;
        stats.farBatches++;
      }
    }
    stats.visibleTrees = visibleByLod[0] + visibleByLod[1] + visibleByLod[2];
    stats.visibleTriangles = triangles;
    stats.shadowBatches = shadowBatches;
    stats.transitions = fadingTrees;
  }

  // Squared LOD and hysteresis thresholds eliminate per-tree Math.sqrt and temporary array allocations.
  const NEAR_SQ = LOD_NEAR * LOD_NEAR;
  const NEAR_LO_SQ = (LOD_NEAR - LOD_HYSTERESIS) * (LOD_NEAR - LOD_HYSTERESIS);
  const NEAR_HI_SQ = (LOD_NEAR + LOD_HYSTERESIS) * (LOD_NEAR + LOD_HYSTERESIS);
  const MID_SQ = LOD_MID * LOD_MID;
  const MID_LO_SQ = (LOD_MID - LOD_HYSTERESIS) * (LOD_MID - LOD_HYSTERESIS);
  const MID_HI_SQ = (LOD_MID + LOD_HYSTERESIS) * (LOD_MID + LOD_HYSTERESIS);
  const MAX_DIST_LOW = MAX_DIST.map((d) => Math.min(d, LOW_CUTOFF));
  const MAX_SQ_ALOFT = MAX_DIST.map((d) => d * d);
  const MAX_LO_SQ_ALOFT = MAX_DIST.map((d) => (d - LOD_HYSTERESIS) * (d - LOD_HYSTERESIS));
  const MAX_HI_SQ_ALOFT = MAX_DIST.map((d) => (d + LOD_HYSTERESIS) * (d + LOD_HYSTERESIS));
  const MAX_SQ_LOW = MAX_DIST_LOW.map((d) => d * d);
  const MAX_LO_SQ_LOW = MAX_DIST_LOW.map((d) => (d - LOD_HYSTERESIS) * (d - LOD_HYSTERESIS));
  const MAX_HI_SQ_LOW = MAX_DIST_LOW.map((d) => (d + LOD_HYSTERESIS) * (d + LOD_HYSTERESIS));

  function setCellUniformLod(cell, target) {
    if (cell.uniformLod === target) return false;
    const trees = cell.trees;
    let cellChanged = false;
    for (let k = 0; k < trees.length; k++) {
      const i = trees[k];
      if (lod[i] !== target) {
        lod[i] = target;
        cellChanged = true;
      }
    }
    cell.uniformLod = target;
    if (cellChanged) dirtyCells.add(cell);
    return cellChanged;
  }

  // Cell-hierarchical LOD update (3D distance to mid-crown) with exact hysteresis at every boundary.
  const last = new V3(Infinity, Infinity, Infinity);
  const cam = new V3();
  function updateLegacy(position) {
    cam.copy(position);
    if (cam.distanceToSquared(last) < 16) return false;
    last.copy(cam);
    const camX = cam.x, camY = cam.y, camZ = cam.z;
    const low = camY < 40;
    const maxSq = low ? MAX_SQ_LOW : MAX_SQ_ALOFT;
    const maxLoSq = low ? MAX_LO_SQ_LOW : MAX_LO_SQ_ALOFT;
    const maxHiSq = low ? MAX_HI_SQ_LOW : MAX_HI_SQ_ALOFT;
    let changed = false;

    for (let ci = 0; ci < cellList.length; ci++) {
      const cell = cellList[ci];
      const cdx = cell.cx - camX;
      const cdy = cell.cy - camY;
      const cdz = cell.cz - camZ;
      const centerDist = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
      const minD = centerDist - cell.radius;
      const maxDCell = centerDist + cell.radius;
      const cellMaxCutoff = low ? cell.maxCutoffLow : cell.maxCutoffAloft;

      // Fast-path cells lying wholly outside the cutoff or wholly inside a single interior LOD band.
      if (minD >= cellMaxCutoff + LOD_HYSTERESIS) {
        if (setCellUniformLod(cell, 255)) changed = true;
        continue;
      }
      if (maxDCell < LOD_NEAR - LOD_HYSTERESIS) {
        if (setCellUniformLod(cell, 0)) changed = true;
        continue;
      }
      if (minD >= LOD_NEAR + LOD_HYSTERESIS && maxDCell < LOD_MID - LOD_HYSTERESIS) {
        if (setCellUniformLod(cell, 1)) changed = true;
        continue;
      }
      const cellMinCutoff = low ? cell.minCutoffLow : cell.minCutoffAloft;
      if (minD >= LOD_MID + LOD_HYSTERESIS && maxDCell < cellMinCutoff - LOD_HYSTERESIS) {
        if (setCellUniformLod(cell, 2)) changed = true;
        continue;
      }

      // Only cells straddling an LOD / hysteresis boundary evaluate per-tree squared distances.
      const trees = cell.trees;
      let cellChanged = false;
      let firstLod = 0;
      let allSame = true;
      for (let k = 0; k < trees.length; k++) {
        const i = trees[k];
        const dx = px[i] - camX;
        const dy = py[i] - camY;
        const dz = pz[i] - camZ;
        const d2 = dx * dx + dy * dy + dz * dz;
        const t = tier[i];
        const cur = lod[i];
        const curL = cur === 255 ? 3 : cur;
        let nextL = d2 < NEAR_SQ ? 0 : d2 < MID_SQ ? 1 : d2 < maxSq[t] ? 2 : 3;
        if (nextL - curL === 1) {
          const hiSq = curL === 0 ? NEAR_HI_SQ : curL === 1 ? MID_HI_SQ : maxHiSq[t];
          if (d2 < hiSq) nextL = curL;
        } else if (curL - nextL === 1) {
          const loSq = nextL === 0 ? NEAR_LO_SQ : nextL === 1 ? MID_LO_SQ : maxLoSq[t];
          if (d2 > loSq) nextL = curL;
        }
        const next = nextL === 3 ? 255 : nextL;
        if (next !== cur) {
          lod[i] = next;
          cellChanged = true;
        }
        if (k === 0) firstLod = next;
        else if (next !== firstLod) allSame = false;
      }
      cell.uniformLod = allSame ? firstLod : -1;
      if (cellChanged) {
        dirtyCells.add(cell);
        changed = true;
      }
    }

    if (changed) rebuild();
    return changed;
  }

  const fading = new Set();
  let fadingTrees = 0;
  const candidates = [];
  const travel = new V3(), previousPosition = new V3(Infinity, Infinity, Infinity);
  const direction = new V3(), plannedDirection = new V3();
  const plannedPosition = new V3(Infinity, Infinity, Infinity);
  let plan = 0, planAt = 0, plannedPixelScale = 0, plannedAgl = 0;
  let clock = 1;
  let lastCameraLevel = '', lastCanopyRevision = 0;
  const largestCell = cellList.reduce((max, cell) => Math.max(max, cell.trees.length), 0);
  const uploadBudget = Math.max(256 * 1024, largestCell * INSTANCE_BYTES * 3);
  stats.uploadBudget = uploadBudget;
  stats.maxFadingCells = MAX_FADING_CELLS;
  stats.maxFadingTrees = MAX_FADING_TREES;
  for (const cell of cellList) {
    cell.crownRadius = 0;
    for (const i of cell.trees) cell.crownRadius = Math.max(cell.crownRadius, crownWidth[i] * 0.5);
  }

  function maxRange(t, above, profile) {
    const groundLimit = Math.min(LOW_CUTOFF, MAX_DIST[t]);
    return lerp(groundLimit, MAX_DIST[t], above) * profile.reach;
  }

  function viewDistance(cell, x, y, z, cosHalfAngle, looking) {
    const dx = cell.cx - x, dy = cell.cy - y, dz = cell.cz - z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const radius = cell.radius + cell.crownRadius + 18;
    const near = distance - radius;
    // The diagonal view cone is conservative; Three.js performs exact per-pass frustum culling.
    if (!looking || near < 100 ||
        dx * direction.x + dy * direction.y + dz * direction.z >= distance * cosHalfAngle - 1.5 * radius) return near;
    return Infinity;
  }

  function targetLod(i, x, y, z, focal, above, profile) {
    const dx = px[i] - x, dy = py[i] - y, dz = pz[i] - z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const pixels = focal * crownWidth[i] / Math.max(1, distance);
    const prior = lod[i];
    const range = maxRange(tier[i], above, profile);
    // Spread the distant cutoff over a deterministic band rather than dropping an entire ring at once.
    const edge = range + (keep[i] - 0.5) * 150 + (priority[i] ? 220 : 0);
    const margin = prior === 255 ? -24 : 24;
    const detail = priority[i] ? ADAPTIVE_LEVELS[0] : profile;
    const density = lerp(1, profile.density, smooth(440, 1120, distance));
    if (distance > edge + margin || (!priority[i] && keep[i] > density)) return 255;
    if (pixels > detail.near * (prior === 0 ? 0.87 : 1.08)) return 0;
    if (pixels > detail.mid * (prior <= 1 ? 0.88 : 1.08)) return 1;
    if (!priority[i] && canopyCovers?.(px[i], pz[i])) return 255;
    return 2;
  }

  function retarget(cell, x, y, z, focal, above, profile, fade) {
    let changed = 0;
    const limit = fade ? Math.min(220, MAX_FADING_TREES - fadingTrees) : Infinity;
    for (const i of cell.trees) {
      const next = targetLod(i, x, y, z, focal, above, profile);
      if (next === lod[i]) continue;
      previousLod[i] = lod[i];
      fadeStart[i] = fade ? clock : 0;
      lod[i] = next;
      changed++;
      if (changed >= limit) {
        cell.revision = -1;
        break;
      }
    }
    if (!changed) return;
    cell.uniformLod = -1;
    dirtyCells.add(cell);
    if (fade) {
      cell.fadeUntil = clock + FADE_SECONDS;
      cell.fadingTrees = changed;
      fadingTrees += changed;
      fading.add(cell);
    }
  }

  function updateAdaptive(view, options) {
    const position = view.position ?? view;
    const deltaMs = options.deltaMs ?? 16.67;
    const dt = Math.min(0.1, Math.max(0.001, deltaMs * 0.001));
    clock += dt;
    fadeClock.value = clock;
    if (mode === 'auto') qualityControl.update(deltaMs, stats.visibleTriangles);
    const level = mode === 'high' ? 0 : qualityControl.level;
    const profile = ADAPTIVE_LEVELS[level];
    stats.qualityLevel = ADAPTIVE_NAMES[level];

    const { x, y, z } = position;
    const move2 = position.distanceToSquared(previousPosition);
    const jump = move2 > 180 ** 2;
    if (jump) {
      travel.set(0, 0, 0);
    } else {
      const a = 1 - Math.exp(-dt * 7);
      travel.x = lerp(travel.x, (x - previousPosition.x) / dt, a);
      travel.y = lerp(travel.y, (y - previousPosition.y) / dt, a);
      travel.z = lerp(travel.z, (z - previousPosition.z) / dt, a);
      const v = travel.length();
      if (v > 140) travel.multiplyScalar(140 / v);
    }
    previousPosition.copy(position);
    const predX = x + travel.x, predY = y + travel.y, predZ = z + travel.z;
    const looking = typeof view.getWorldDirection === 'function';
    if (looking) view.getWorldDirection(direction);
    const tangent = Math.tan((view.fov ?? 55) * Math.PI / 360) / (view.zoom ?? 1);
    const focal = (options.viewportHeight ?? 720) / (2 * tangent);
    const diagonal = Math.atan(tangent * Math.hypot(1, view.aspect ?? 1.6)) + 0.08;
    const cosHalfAngle = Math.cos(diagonal);
    const agl = y - (options.groundHeight ?? 0);
    const above = smooth(23, 94, agl);
    const aheadAbove = smooth(23, 94, agl + Math.max(0, travel.y));
    const climbing = aheadAbove - above > 0.04;
    const canopyRevision = options.canopyRevision ?? 0;
    if (jump || clock - planAt > 0.24 && (canopyRevision !== lastCanopyRevision || position.distanceToSquared(plannedPosition) > 16 ||
        direction.dot(plannedDirection) < 0.98 && looking || Math.abs(focal - plannedPixelScale) > 5 ||
        Math.abs(agl - plannedAgl) > 3) || lastCameraLevel !== stats.qualityLevel) {
      plan++;
      planAt = clock;
      plannedPosition.copy(position);
      plannedDirection.copy(direction);
      plannedPixelScale = focal;
      plannedAgl = agl;
      lastCameraLevel = stats.qualityLevel;
      lastCanopyRevision = canopyRevision;
    }

    uploadContext = options.renderer?.backend?.isWebGPUBackend && options.renderer._attributes?.update
      ? options.renderer._attributes : null;
    candidates.length = 0;
    let unprepared = 0;
    const canPredict = travel.lengthSq() > 25;
    for (const cell of cellList) {
      const near = viewDistance(cell, x, y, z, cosHalfAngle, looking);
      const far = lerp(cell.maxCutoffLow, cell.maxCutoffAloft, above) * profile.reach + (cell.priority ? 335 : 115);
      const drawable = near < far;
      if (drawable !== cell.drawable && cell.lo[2]) invalidateFarBatches(cell);
      if (drawable && !cell.drawable) cell.revision = -1;
      cell.drawable = drawable;
      cell.group.visible = drawable && cell.instanceCount > 0;
      const shadows = drawable && near < profile.shadows + (cell.priority ? 45 : 0) + (cell.shadows ? 14 : -14);
      if (cell.shadows !== shadows || cell.shadowLevel !== level) {
        if (cell.lo[2]) invalidateFarBatches(cell);
        cell.shadows = shadows;
        cell.shadowLevel = level;
        cell.shadowBatches = 0;
        for (const mi of cell.meshIndices) {
          const mesh = instanced[mi];
          mesh.castShadow = shadows && (level < 2 || meshes[mi].type.lod < 2);
          if (mesh.castShadow && mesh.count > 0) cell.shadowBatches++;
        }
      }
      let score = near;
      let ahead = false;
      if (canPredict) {
        const predicted = viewDistance(cell, predX, predY, predZ, cosHalfAngle, looking);
        const aheadRange = climbing
          ? lerp(cell.maxCutoffLow, cell.maxCutoffAloft, aheadAbove) * profile.reach + 115
          : far;
        if (predicted < Math.min(aheadRange, climbing ? 1450 : 550)) {
          ahead = !drawable;
          score = Math.min(score, predicted);
        }
      }
      const done = cell.fadeUntil > 0 && clock >= cell.fadeUntil;
      if (done || ((drawable || ahead) && (!cell.hasCoverage || cell.revision !== plan) && cell.fadeUntil === 0)) {
        if (drawable && !cell.hasCoverage) unprepared++;
        cell.ahead = ahead;
        cell.score = score + (ahead ? 350 : 0) - (cell.priority ? 200 : 0) -
          (done ? 1000 : drawable && !cell.hasCoverage ? 600 : 0);
        candidates.push(cell);
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    let evaluated = 0;
    for (const cell of candidates) {
      if (stats.frameUploadedCells >= MAX_CELL_UPLOADS || evaluated >= 28) break;
      const done = cell.fadeUntil > 0;
      const estimated = cell.trees.length * INSTANCE_BYTES * 3;
      if (stats.frameUploadBytes + estimated > uploadBudget) continue;
      if (unprepared && !done && cell.hasCoverage && cell.score > 120) continue;
      evaluated++;
      if (done) {
        for (const i of cell.trees) fadeStart[i] = 0;
        cell.fadeUntil = 0;
        fading.delete(cell);
        fadingTrees -= cell.fadingTrees;
        cell.fadingTrees = 0;
        dirtyCells.add(cell);
      } else if (!cell.hasCoverage) {
        // The affordable silhouette comes first, even when a jump lands in full-detail range.
        cell.hasCoverage = true;
        for (const i of cell.trees) {
          if (targetLod(i, x, y, z, focal, above, profile) !== 255 || cell.ahead) lod[i] = 2;
        }
        cell.uniformLod = 2;
        dirtyCells.add(cell);
      } else {
        const fadingRoom = cell.drawable && !jump && fading.size < MAX_FADING_CELLS && fadingTrees < MAX_FADING_TREES;
        if (cell.drawable && !jump && !fadingRoom) continue;
        cell.revision = plan;
        retarget(cell,
          cell.ahead ? predX : x, cell.ahead ? predY : y, cell.ahead ? predZ : z,
          focal, above, profile, fadingRoom);
      }
      if (dirtyCells.size) rebuild();
    }
    repackFarBatches(uploadBudget);
    measureVisible();
    return stats.frameUploadBytes > 0;
  }

  function setQuality(next) {
    if (!['auto', 'high', 'legacy'].includes(next) || next === mode) return;
    const adaptive = next !== 'legacy';
    if (adaptive && !adaptiveMaterial) {
      previousLod = new Uint8Array(capacity).fill(255);
      fadeStart = new Float32Array(capacity);
      fadeClock = uniform(clock);
      adaptiveMaterial = createTreeMaterial(atlas.texture, { seasons: season, fadeClock });
      for (const mesh of instanced) {
        mesh.geometry.setAttribute('aTreeFade', new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count), 1));
      }
      initFarBatches();
    }
    if (adaptive !== (mode !== 'legacy')) {
      farGroup.visible = adaptive;
      dirtyFarBatches.clear();
      for (const batch of pooledBatches) if (batch.mesh) batch.mesh.visible = false;
      stats.farBatches = 0;
      lod.fill(255);
      fading.clear();
      fadingTrees = 0;
      fadeStart?.fill(0);
      for (const cell of cellList) {
        cell.hasCoverage = cell.drawable = false;
        cell.revision = -1;
        cell.fadeUntil = 0;
        cell.fadingTrees = 0;
        cell.uniformLod = 255;
        cell.instanceCount = 0;
        cell.group.visible = false;
        cell.shadows = false;
        for (const mi of cell.meshIndices) {
          const mesh = instanced[mi];
          mesh.material = adaptive ? adaptiveMaterial : material;
          mesh.castShadow = !adaptive;
          mesh.count = 0;
          mesh.visible = false;
        }
      }
      last.set(Infinity, Infinity, Infinity);
      previousPosition.set(Infinity, Infinity, Infinity);
    }
    mode = next;
    qualityControl = createAutoCanopy();
    lastCameraLevel = '';
    stats.qualityLevel = adaptive ? 'high' : 'legacy';
  }

  function update(view, options = {}) {
    stats.frameUploadBytes = stats.frameUploadedCells = 0;
    if (mode !== 'legacy') return updateAdaptive(view, options);
    const changed = updateLegacy(view.position ?? view);
    if (changed) measureVisible();
    return changed;
  }

  // Put nearby batches in scope for the existing startup compilation and warm-up.
  setQuality(quality);
  update(new V3(0, 10, 140));

  // Precompile one visible representative per geometry; the other cells use exactly the same pipeline.
  for (const type of types) {
    const representative = type.meshes.find((mesh) => mesh.visible) || type.meshes[0];
    for (const mesh of type.meshes) if (mesh !== representative) mesh.userData.sharesPipelineWith = representative;
  }

  for (const { mesh, type } of pooledBatches) {
    if (!mesh) continue;
    const reference = type.meshes[0];
    mesh.userData.sharesPipelineWith = reference.userData.sharesPipelineWith ?? reference;
  }

  // Tree placements are world-space instance matrices; the field, cells and meshes keep identity transforms.
  // Freezing both avoids recomputing thousands of dormant objects in every view and shadow pass.
  group.traverse((object) => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  });

  stats.trees = N;
  stats.triangles = geos.map((v) => v.map((l) => l.map((g) => g && g.userData.triangles)));
  stats.cards = geos.map((v) => v.map((l) => l.map((g) => g && g.userData.cards)));
  const prepareWarmup = () => {
    if (mode === 'legacy') return () => {};
    const restore = [];
    for (const type of types) {
      if (type.meshes.some((mesh) => mesh.visible && meshes[mesh.userData.treeBatchIndex].cell.group.visible)) continue;
      const mesh = type.meshes[0];
      if (!mesh) continue;
      const { cell } = meshes[mesh.userData.treeBatchIndex];
      const old = cell.group.visible, visible = mesh.visible, shadow = mesh.castShadow, count = mesh.count;
      cell.group.visible = mesh.visible = true;
      mesh.castShadow = true;
      if (!count) {
        mesh.count = 1;
        mesh.instanceMatrix.array.fill(0, 0, 16);
        mesh.instanceMatrix.array[0] = mesh.instanceMatrix.array[5] =
          mesh.instanceMatrix.array[10] = mesh.instanceMatrix.array[15] = 1;
        mesh.instanceMatrix.needsUpdate = true;
      }
      restore.push(() => {
        cell.group.visible = old;
        mesh.visible = visible;
        mesh.castShadow = shadow;
        mesh.count = count;
      });
    }
    return () => { for (let i = restore.length - 1; i >= 0; i--) restore[i](); };
  };
  function coveragePending(x, z) {
    const cellX = Math.floor(x / TREE_CELL_SIZE), cellZ = Math.floor(z / TREE_CELL_SIZE);
    const cell = cells.get((cellX + 32768) * 65536 + (cellZ + 32768));
    return mode !== 'legacy' && cell && !cell.hasCoverage;
  }
  return { group, material, atlas, update, setQuality, prepareWarmup, coveragePending, meshes: instanced, stats, sites: plantedSites };
}

export { createTreeField, createLeafAtlas, buildTreeGeometries, SPECIES as TREE_SPECIES };
