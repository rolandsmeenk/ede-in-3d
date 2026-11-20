import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CivicBatch } from './ede-civic-landmarks.js';
import { terrainHeightAt } from './terrain.js';

// Lim Dong-Lak's sculpture. The HvA catalogue gives a 1.70 m diameter and a 5 m overall height.
const RADIUS = 0.85;
const stem = [
  [0.07, 1.81, -0.01, 0.165],
  [0.11, 2.12, 0.05, 0.132],
  [0.09, 2.31, 0.08, 0.126],
  [-0.21, 2.53, 0.055, 0.124],
  [-0.145, 2.75, 0.015, 0.096],
  [0.14, 3.20, 0.025, 0.124],
  [-0.25, 3.36, -0.02, 0.078],
  [-0.30, 3.56, 0.005, 0.068],
  [-0.29, 4.12, 0.03, 0.039],
  [-0.25, 4.53, 0.035, 0.022],
];

function taperedBronze(knots) {
  const curve = new THREE.CatmullRomCurve3(knots.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const steps = 24, sides = 10;
  const tube = new THREE.TubeGeometry(curve, steps, 1, sides, false);
  const positions = tube.getAttribute('position');
  for (let ring = 0; ring <= steps; ring++) {
    const center = curve.getPointAt(ring / steps);
    const upper = knots.findIndex((point, i) => i > 0 && point[1] >= center.y);
    const j = upper < 0 ? knots.length - 1 : upper;
    const a = knots[j - 1], b = knots[j];
    const t = THREE.MathUtils.clamp((center.y - a[1]) / (b[1] - a[1]), 0, 1);
    const radius = THREE.MathUtils.lerp(a[3], b[3], t);
    for (let i = ring * (sides + 1); i < (ring + 1) * (sides + 1); i++) {
      positions.setXYZ(i, center.x + (positions.getX(i) - center.x) * radius,
        center.y + (positions.getY(i) - center.y) * radius,
        center.z + (positions.getZ(i) - center.z) * radius);
    }
  }
  tube.computeVertexNormals();
  return tube;
}

function leaf(batch, root, end, width, turn) {
  const a = new THREE.Vector3(...root), axis = new THREE.Vector3(...end).sub(a);
  const across = new THREE.Vector3(-axis.y, axis.x, 0).normalize();
  across.applyAxisAngle(axis.clone().normalize(), turn);
  const normal = axis.clone().cross(across).normalize();
  const outline = [[0,0], [0.14,0.57], [0.24,0.88], [0.31,0.68], [0.42,1],
    [0.50,0.75], [0.61,0.91], [0.69,0.65], [0.77,0.77], [0.85,0.48], [0.93,0.32], [1,0]];
  let previous;
  for (let i = 0; i < outline.length; i++) {
    const [t, spread] = outline[i];
    const base = a.clone().addScaledVector(axis, t).addScaledVector(normal, Math.sin(Math.PI * t) * 0.055);
    const mid = base.clone().addScaledVector(normal, spread * 0.026).toArray();
    const left = base.clone().addScaledVector(across, -spread * width).toArray();
    const right = base.addScaledVector(across, spread * width * 0.94).toArray();
    if (previous) {
      const [pl, pm, pr] = previous;
      batch.quad(pl, left, mid, pm, i % 2 ? 0x3b6560 : 0x416b66, 0.56);
      batch.quad(pm, mid, right, pr, i % 2 ? 0x456d68 : 0x4a7470, 0.56);
    }
    previous = [left, mid, right];
  }
}

export function createPointGrowth(_footprints, site) {
  const group = new THREE.Group();
  const mesh = (geometry, material, x = 0, y = 0, z = 0) => {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
  };
  mesh(new THREE.CylinderGeometry(1.41, 1.43, 0.105, 48),
    new THREE.MeshStandardNodeMaterial({ color: 0x272628, metalness: 0.17, roughness: 0.24 }), 0, 0.043);
  const chrome = new THREE.MeshStandardNodeMaterial({ color: 0xe9edf1, metalness: 1, roughness: 0.055 });
  if (typeof document !== 'undefined') {
    const url = new URL('../assets/ede-point-growth-reflection.webp', import.meta.url);
    // A small in-game capture supplies the street in the mirror on every graphics preset.
    new THREE.TextureLoader().load(url.href, map => {
      map.mapping = THREE.EquirectangularReflectionMapping;
      map.colorSpace = THREE.SRGBColorSpace;
      chrome.envNode = texture(map);
      chrome.needsUpdate = true;
    });
  }
  mesh(new THREE.SphereGeometry(RADIUS, 40, 28), chrome, 0, 0.937);

  const branches = [
    taperedBronze(stem),
    taperedBronze([[-0.29, 4.13, 0.035, 0.034], [-0.11, 4.33, 0.02, 0.026], [0.08, 4.42, 0.045, 0.019]]),
    taperedBronze([[-0.30, 3.93, 0.03, 0.034], [-0.53, 4.10, 0.095, 0.024], [-0.62, 4.19, 0.13, 0.014]]),
  ];
  mesh(mergeGeometries(branches), new THREE.MeshStandardNodeMaterial({
    color: 0xb4874c, metalness: 0.82, roughness: 0.31,
  }));
  for (const geometry of branches) geometry.dispose();

  const leaves = new CivicBatch();
  leaf(leaves, [-0.25,4.50,0.035],[-0.04,5.0,0.063],0.136,-0.19);
  leaf(leaves, [0.035,4.385,0.036],[0.65,4.62,-0.088],0.119,0.46);
  leaf(leaves, [-0.59,4.155,0.127],[-0.87,4.36,0.35],0.112,-0.64);
  const foliage = leaves.mesh();
  foliage.material.side = THREE.DoubleSide;
  group.add(foliage);

  const base = terrainHeightAt(site.x, site.z);
  const outer = Array.from({ length: 16 }, (_, i) => {
    const angle = i * Math.PI / 8;
    return { x: site.x + Math.cos(angle) * RADIUS, z: site.z + Math.sin(angle) * RADIUS };
  });
  group.userData.colliders = [{ minX: site.x - RADIUS, maxX: site.x + RADIUS,
    minZ: site.z - RADIUS, maxZ: site.z + RADIUS, minY: base, maxY: base + 1.787,
    polygon: { outer, holes: [] } }];
  return group;
}
