import * as THREE from 'three/webgpu';

// PDOK 2026 orthophoto and native AHN DSM. Scene Y is relative to 22.54 m NAP.
export const RIEDEL_TANKS = [
  { id: 'frog', x: -1572.80, z: 1590.49, radius: 2.03, base: -4.90, top: 10.13 },
  { id: 'hand', x: -1577.22, z: 1591.00, radius: 2.03, base: -4.90, top: 10.13 },
  { id: 'rainbow', x: -1599.42, z: 1580.43, radius: 2.03, base: -8.35, top: 8.75 },
  { id: 'owl', x: -1609.37, z: 1578.74, radius: 2.13, base: -8.41, top: 8.62 },
];
export const SILO_SIDES = 96;
export const KAPPA_PLAN = [[42.40, 1927.37], [43.86, 1953.17], [49.46, 1952.85], [48.00, 1927.05]];
export const KAPPA_FRONT = { base: -2.06, roof: 1.68, fascia: 1.22, openings: [
  [0.005, 0.093, -0.752, 1.024],
  [0.378, 0.535, 0.624, 1.092],
  [0.666, 0.743, -1.895, 1.077],
  [0.864, 0.998, -0.990, 0.997],
] };

const SHELL = 0xc0c2b3;
const RIM = 0x969e8e;
const METAL = 0x878779;
const BLOCK = 0xb5b5aa;
const BRICK = 0x333c42;
const WINDOW = 0x40525b;
const FRAME = 0xaaa79b;
const FASCIA = 0xc2a047;

function batch(name, colliders, build) {
  const vertices = [], colors = [];
  const tint = new THREE.Color();

  function geometry(source, color) {
    const positions = source.attributes.position;
    const index = source.index;
    tint.setHex(color);
    for (let i = 0, length = index?.count ?? positions.count; i < length; i++) {
      const j = index ? index.getX(i) : i;
      vertices.push(positions.getX(j), positions.getY(j), positions.getZ(j));
      colors.push(tint.r, tint.g, tint.b);
    }
    source.dispose();
  }

  function quad(a, b, c, d, color) {
    tint.setHex(color);
    for (const p of [a, b, c, a, c, d]) {
      vertices.push(...p);
      colors.push(tint.r, tint.g, tint.b);
    }
  }

  function box(x, y, z, w, h, d, color) {
    geometry(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
  }

  function cylinder(x, z, radius, minY, maxY, color, n = 32, taperedRadius = radius) {
    geometry(new THREE.CylinderGeometry(taperedRadius, radius, maxY - minY, n)
      .translate(x, (minY + maxY) / 2, z), color);
  }

  const group = new THREE.Group();
  group.name = name;
  group.userData.colliders = colliders;
  build({ box, cylinder, quad });
  const meshGeometry = new THREE.BufferGeometry();
  meshGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  meshGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  meshGeometry.computeVertexNormals();
  meshGeometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(meshGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.83 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

function footprintCollider(ring, minY, maxY) {
  return {
    minX: Math.min(...ring.map(([x]) => x)), maxX: Math.max(...ring.map(([x]) => x)),
    minZ: Math.min(...ring.map(([, z]) => z)), maxZ: Math.max(...ring.map(([, z]) => z)),
    minY, maxY, polygon: { outer: ring.map(([x, z]) => ({ x, z })), holes: [] },
  };
}

function extrudedRing(ring, y0, y1, color, quad, skipSide = -1, roofColor = color) {
  ring.forEach(([x, z], i) => {
    if (i === skipSide) return;
    const [u, v] = ring[(i + 1) % ring.length];
    quad([x, y0, z], [u, y0, v], [u, y1, v], [x, y1, z], color);
  });
  const [[ax, az], [bx, bz], [cx, cz], [dx, dz]] = ring;
  quad([ax, y1, az], [bx, y1, bz], [cx, y1, cz], [dx, y1, dz], roofColor);
}

function radialPoint(tank, i, radius, y) {
  const angle = 2 * Math.PI * i / SILO_SIDES;
  return [tank.x + radius * Math.cos(angle), y, tank.z + radius * Math.sin(angle)];
}

export function createRiedelSilos() {
  const colliders = [];
  return batch('Riedel painted silos', colliders, ({ box, cylinder, quad }) => {
    const plinth = [[-1579.66, 1589.38], [-1579.16, 1593.44], [-1570.74, 1592.40], [-1571.24, 1588.34]];
    extrudedRing(plinth, -8.42, -4.9, BLOCK, quad);
    colliders.push(footprintCollider(plinth, -8.42, -4.9));

    for (const tank of RIEDEL_TANKS) {
      const { x, z, radius, base, top } = tank;
      for (let i = 0; i < SILO_SIDES; i++) {
        quad(radialPoint(tank, i + 1, radius, base), radialPoint(tank, i, radius, base),
          radialPoint(tank, i, radius, top), radialPoint(tank, i + 1, radius, top), i % 2 ? SHELL : 0xb9bcae);
      }
      cylinder(x, z, radius + 0.045, top - 0.15, top + 0.01, RIM, 48);
      cylinder(x, z, radius, top, top + 0.19, SHELL, 48, radius * 0.94);
      cylinder(x + radius * 0.29, z + radius * 0.14, 0.39, top + 0.18, top + 0.54, METAL, 10, 0.34);
      cylinder(x - radius * 0.52, z + radius * 0.2, 0.11, top + 0.17, top + 0.77, METAL, 7);

      const railRadius = radius * 0.92;
      for (let i = 0; i < 16; i++) {
        const side = i * SILO_SIDES / 16;
        const from = radialPoint(tank, side, railRadius, top + 0.81);
        const to = radialPoint(tank, side + SILO_SIDES / 16, railRadius, top + 0.81);
        box(from[0], top + 0.48, from[2], 0.038, 0.7, 0.038, METAL);
        quad([from[0], from[1] - 0.025, from[2]], [to[0], to[1] - 0.025, to[2]], to, from, METAL);
        quad(to, [to[0], to[1] - 0.025, to[2]], [from[0], from[1] - 0.025, from[2]], from, METAL);
      }
      const ring = Array.from({ length: 16 }, (_, i) => {
        const [x, , z] = radialPoint(tank, i * SILO_SIDES / 16, radius, base);
        return [x, z];
      });
      colliders.push(footprintCollider(ring, base, top + 0.19));
    }
  });
}

// West wall, openings and painted areas share the same wall-local coordinates.
export function kappaWallPoint(u, y, offset = 0) {
  const [[ax, az], [bx, bz]] = KAPPA_PLAN;
  const dx = bx - ax, dz = bz - az;
  const length = Math.hypot(dx, dz);
  return [ax + dx * u - dz / length * offset, y, az + dz * u + dx / length * offset];
}

export function createKappaDocie() {
  const { base, roof, fascia, openings } = KAPPA_FRONT;
  return batch('Kappa Docie', [footprintCollider(KAPPA_PLAN, base, roof)], ({ quad }) => {
    extrudedRing(KAPPA_PLAN, base - 0.13, roof, BRICK, quad, 0, 0x868583);

    function west(u0, u1, y0, y1, color, offset = 0) {
      quad(kappaWallPoint(u0, y0, offset), kappaWallPoint(u1, y0, offset),
        kappaWallPoint(u1, y1, offset), kappaWallPoint(u0, y1, offset), color);
    }

    let previous = 0;
    for (const [u0, u1, low, high] of openings) {
      if (u0 > previous) west(previous, u0, base - 0.13, fascia, BRICK);
      west(u0, u1, base - 0.13, low, BRICK);
      west(u0, u1, high, fascia, BRICK);
      west(u0, u1, low, high, WINDOW, -0.08);
      quad(kappaWallPoint(u0, low, -0.08), kappaWallPoint(u0, low),
        kappaWallPoint(u0, high), kappaWallPoint(u0, high, -0.08), BRICK);
      quad(kappaWallPoint(u1, low), kappaWallPoint(u1, low, -0.08),
        kappaWallPoint(u1, high, -0.08), kappaWallPoint(u1, high), BRICK);
      quad(kappaWallPoint(u0, low), kappaWallPoint(u0, low, -0.08),
        kappaWallPoint(u1, low, -0.08), kappaWallPoint(u1, low), BRICK);
      quad(kappaWallPoint(u0, high, -0.08), kappaWallPoint(u0, high),
        kappaWallPoint(u1, high), kappaWallPoint(u1, high, -0.08), BRICK);
      // Frame strips and mullions sit ahead of the glazing.
      const divisions = u1 - u0 > 0.1 ? 4 : 2;
      const inset = Math.min(0.0021, (u1 - u0) * 0.1);
      west(u0, u1, low, low + 0.07, FRAME, 0.025);
      west(u0, u1, high - 0.075, high, FRAME, 0.025);
      for (let i = 0; i <= divisions; i++) {
        const u = u0 + (u1 - u0) * i / divisions;
        west(Math.max(u0, u - inset), Math.min(u1, u + inset), low, high, FRAME, 0.025);
      }
      if (low < base + 0.15) west(u0, u1, low + 1.76, low + 1.83, FRAME, 0.025);
      previous = u1;
    }
    west(previous, 1, base - 0.13, fascia, BRICK);
    west(0, 1, fascia, roof, FASCIA, 0.026);
  });
}
