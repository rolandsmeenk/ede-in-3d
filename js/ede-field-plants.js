import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function leaf(length, width, rise, arch, coarse = false) {
  const vertices = [], indices = [];
  for (const t of coarse ? [0, 0.43, 1] : [0, 0.22, 0.45, 0.72, 1]) {
    const spread = width * Math.max(0.035, Math.sin(Math.PI * t ** 0.7));
    const y = t * rise + Math.sin(Math.PI * t) * arch;
    vertices.push(t * length, y - spread * 0.25, -spread, t * length, y, 0, t * length, y - spread * 0.25, spread);
  }
  for (let i = 0; i < vertices.length / 3 - 3; i += 3) {
    indices.push(i, i + 3, i + 1, i + 1, i + 3, i + 4, i + 1, i + 4, i + 2, i + 2, i + 4, i + 5);
  }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  blade.setIndex(indices);
  blade.computeVertexNormals();
  return blade;
}

export function fieldPlantGeometry(kind) {
  const pieces = [];
  const stem = new THREE.CylinderGeometry(0.65, 1, 1, 4);
  const rounded = new THREE.SphereGeometry(1, 5, 3);

  function add(source, x, y, z, sx, sy, sz, tint, angle = 0, lean = 0) {
    const part = source.clone().scale(sx, sy, sz).rotateZ(lean).rotateY(angle).translate(x, y, z);
    part.deleteAttribute('uv');
    const color = new THREE.Color(tint);
    const colors = new Float32Array(part.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pieces.push(part);
  }

  if (kind.startsWith('maize')) {
    const coarse = kind === 'maize distant';
    for (const [x, h, angle] of [[-0.29, 1, 0.9], [0.28, 0.88, -0.18]]) {
      if (kind === 'maize tassels') {
        for (let i = 0; i < 5; i++) {
          add(stem, x + (i - 2) * 0.03, h + 0.043, 0, 0.007, 0.12 - Math.abs(i - 2) * 0.015, 0.006,
            0xffffdc, angle, (2 - i) * 0.32);
        }
        continue;
      }
      add(stem, x, h / 2, 0, 0.018, h, 0.017, 0xc5c793);
      if (kind === 'maize stalks') continue;
      for (let i = 0; i < 6; i += coarse ? 2 : 1) {
        const blade = leaf(0.43 - i * 0.025, 0.044 - i * 0.003, 0.14 + i * 0.014, 0.067, coarse);
        add(blade, x, h * (0.26 + i * 0.114), 0, 1, h, 1, i % 2 ? 0xaabc86 : 0xdce7b9, angle + i * 2.41);
        blade.dispose();
      }
    }
  } else if (kind.startsWith('flower ')) {
    const shape = kind.slice(7);
    if (shape === 'spike') {
      for (let i = 0; i < 4; i++) {
        const r = 0.037 - i * 0.006;
        add(rounded, 0, 0.92 + i * 0.04, 0, r, 0.031, r, 0xffffff);
      }
    } else {
      const spread = shape === 'umbel' ? 0.045 : 0.036;
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 0.4;
        add(rounded, Math.cos(angle) * spread, 1 + (shape === 'poppy' ? 0.02 : 0), -Math.sin(angle) * spread,
          0.039, shape === 'poppy' ? 0.025 : 0.009, 0.022, 0xffffff, angle);
      }
      add(rounded, 0, 1.009, 0, 0.028, 0.013, 0.028, shape === 'poppy' ? 0x302424 : 0xffffad);
    }
  } else if (kind === 'woody dormant') {
    add(stem, 0, 0.41, 0, 0.039, 0.82, 0.039, 0xdad0c0);
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.4;
      add(stem, Math.cos(angle) * 0.12, 0.66 + (i % 2) * 0.12, -Math.sin(angle) * 0.12,
        0.016, 0.48, 0.016, 0xd8c3a2, angle, -0.62);
    }
  } else if (kind === 'woody') {
    add(stem, 0, 0.38, 0, 0.035, 0.76, 0.036, 0x9b8564);
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.4;
      add(rounded, Math.cos(angle) * 0.23, 0.54 + i * 0.067, Math.sin(angle) * 0.24,
        0.3, 0.2, 0.28, i % 2 ? 0xc5db99 : 0x90aa78);
    }
  } else if (kind === 'broadleaf') {
    for (let i = 0; i < 7; i++) {
      const blade = leaf(0.41 - (i % 3) * 0.08, 0.10, 0.42 + (i % 3) * 0.1, 0.18);
      add(blade, 0, 0.05 + i * 0.04, 0, 1, 1, 1, i % 2 ? 0xb0c595 : 0xe4e9c0, i * 2.4);
      blade.dispose();
    }
  } else if (kind === 'flower stem') {
    add(stem, 0, 0.49, 0, 0.012, 0.98, 0.012, 0xe2e3b3);
    add(rounded, 0.06, 0.44, 0.02, 0.083, 0.024, 0.041, 0xc1cb97, 1, 0.35);
    add(rounded, -0.04, 0.66, 0, 0.065, 0.024, 0.034, 0xd3dfab, 0.49, -0.32);
  } else {
    const heads = kind === 'cereal', tall = heads || kind === 'tall' || kind === 'narrowleaf';
    for (let i = 0; i < 6; i++) {
      const angle = i * 2.4;
      const h = 0.56 + (i % 4) * 0.115;
      const x = Math.cos(angle) * 0.17, z = Math.sin(angle) * 0.17;
      const blade = leaf(tall ? 0.10 : 0.20, tall ? 0.022 : 0.035, h, 0.102);
      add(blade, x, 0, z, 1, 1, 1, i % 2 ? 0xc5d793 : 0xe1deb8, angle);
      blade.dispose();
      if (heads) add(rounded, x + Math.cos(angle) * 0.10, h - 0.02, z - Math.sin(angle) * 0.10,
        0.017, 0.074, 0.018, 0xf7e5a8, angle, -0.07);
    }
  }
  const geometry = mergeGeometries(pieces);
  for (const part of pieces) part.dispose();
  stem.dispose();
  rounded.dispose();
  return geometry;
}
