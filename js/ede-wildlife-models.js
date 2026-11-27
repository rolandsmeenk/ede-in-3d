import * as THREE from 'three/webgpu';
import { CivicBatch } from './ede-civic-landmarks.js';
import { sheepFleeceInfluences } from './tree-seasons.js';

function oval(batch, color, x, y, z, sx, sy, sz, pitch = 0, roll = 0) {
  batch.solid(new THREE.SphereGeometry(1, 10, 6).scale(sx, sy, sz)
    .rotateX(pitch).rotateZ(roll).translate(x, y, z), color, true);
}

function rod(batch, color, a, b, radiusA, radiusB) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  batch.solid(new THREE.CylinderGeometry(radiusB, radiusA, delta.length(), 6)
    .applyQuaternion(rotation).translate(...start.lerp(end, .5).toArray()), color, true);
}

const FLEECE = 0xf0e6d1;
const FACE = 0xd7cbb2;
const HOOF = 0x50483c;

function sheepBody() {
  const batch = new CivicBatch();
  oval(batch, FLEECE, 0, .71, -.05, .24, .22, .53);
  oval(batch, FLEECE, 0, .7, -.38, .21, .20, .245);
  oval(batch, FLEECE, 0, .74, .28, .21, .22, .265);
  oval(batch, FLEECE, 0, .42, -.59, .052, .26, .065, .18);
  return batch.mesh();
}

function sheepHead() {
  const batch = new CivicBatch();
  oval(batch, FLEECE, 0, .105, .19, .135, .235, .14, .62);
  oval(batch, FACE, 0, .28, .33, .103, .15, .12, .52);
  oval(batch, 0xb1a58c, 0, .188, .392, .073, .064, .092);
  oval(batch, HOOF, 0, .185, .473, .050, .026, .017);
  for (const side of [-1, 1]) {
    oval(batch, FACE, side * .135, .328, .284, .10, .025, .042, 0, -side * .23);
    oval(batch, 0x32281e, side * .083, .313, .393, .019, .02, .021);
  }
  return batch.mesh();
}

const LEGS = [[-.17, -.41], [.17, -.41], [-.17, .33], [.17, .33]];
const COATS = [0xe4d9c2, 0xffffff, 0xc3b394, 0xe8dfcc];

export function createFlockMesh(name, count) {
  const group = new THREE.Group();
  group.name = name;
  const wool = sheepBody();
  const head = sheepHead();
  const legBatch = new CivicBatch();
  rod(legBatch, FACE, [0, 0, 0], [0, -.63, 0], .042, .027);
  rod(legBatch, HOOF, [0, -.575, 0], [0, -.63, 0], .043, .039);
  const leg = legBatch.mesh();
  const add = (model, capacity) => {
    const mesh = new THREE.InstancedMesh(model.geometry, model.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const bodies = add(wool, count), heads = add(head, count), legs = add(leg, count * 4);
  bodies.name = 'Seasonal fleece';
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) bodies.setColorAt(i, color.set(COATS[i % COATS.length]));
  const root = new THREE.Object3D();
  const part = new THREE.Object3D();
  const worldMatrix = new THREE.Matrix4();
  return {
    group,
    setPose(index, { x, y, z, yaw, scale, walking, grazing }, time, terrainHeightAt) {
      const cycle = time * 8 + index * 2.1;
      const moved = walking ? Math.cos(cycle) * .026 : 0;
      root.rotation.y = yaw;
      root.position.set(x, y + moved, z);
      root.scale.setScalar(scale);
      root.updateMatrix();
      const coat = sheepFleeceInfluences[0];
      part.position.set(0, -.71 * coat * .53, 0);
      part.scale.set(1 + .55 * coat, 1 + .53 * coat, 1 + .10 * coat);
      part.rotation.x = 0;
      part.updateMatrix();
      bodies.setMatrixAt(index, worldMatrix.multiplyMatrices(root.matrix, part.matrix));
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      part.position.set(0, .72, .26);
      part.scale.setScalar(1);
      part.rotation.x = grazing ? 1.02 + Math.sin(time * 1.35 + index) * .13 : moved;
      part.updateMatrix();
      heads.setMatrixAt(index, worldMatrix.multiplyMatrices(root.matrix, part.matrix));
      for (const [i, [lx, lz]] of LEGS.entries()) {
        const foot = terrainHeightAt(x + scale * (lx * cos + lz * sin), z + scale * (lz * cos - lx * sin));
        part.position.set(lx, .63, lz);
        part.scale.y = Math.max(.24, (.63 + (y + moved - foot) / scale) / .63);
        part.rotation.x = walking ? Math.sin(cycle + i * 1.57) * .37 : 0;
        part.updateMatrix();
        legs.setMatrixAt(index * 4 + i, worldMatrix.multiplyMatrices(root.matrix, part.matrix));
      }
    },
    commit() {
      for (const mesh of [bodies, heads, legs]) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function wingPanels(panels, flip) {
  const batch = new CivicBatch();
  for (const [color, ...outline] of panels) {
    const [first, ...rest] = outline.map(([x, y, z]) => [x * flip, y, z]);
    for (let i = 1; i < rest.length; i++) {
      batch.triangle(first, rest[i - 1], rest[i], color);
      batch.triangle(first, rest[i], rest[i - 1], color);
    }
  }
  return batch.mesh();
}

const WINGS = {
  skylark: [
    [0x826b55, [0, .012, .026], [.09, .013, .04], [.175, 0, -.028], [.11, -.008, -.071], [.025, -.005, -.048]],
    [0x635445, [.052, .014, -.021], [.175, .001, -.028], [.11, -.007, -.072], [.059, -.004, -.051]],
  ],
  nightjar: [
    [0x62594b, [0, .013, .036], [.135, .015, .048], [.293, 0, -.057], [.167, -.006, -.066], [.065, -.01, -.067]],
    [0x463e3b, [.126, .015, .035], [.293, .001, -.057], [.167, -.005, -.067], [.117, -.004, -.047]],
    [0xc0ae8c, [.164, .007, -.026], [.203, .005, -.035], [.181, .001, -.050], [.154, .004, -.044]],
  ],
  butterfly: [
    [0x514135, [0, .001, .010], [.024, .003, .021], [.033, .001, .014], [.024, -.001, -.005],
      [.023, -.002, -.022], [.010, 0, -.027], [0, 0, -.013]],
    [0xb7834e, [.014, .003, .016], [.022, .003, .019], [.028, .002, .014], [.020, .001, -.005],
      [.021, .001, -.018], [.014, .002, -.022], [.010, .002, -.015], [.014, .002, -.002]],
    [0x362820, [.021, .004, .013], [.026, .003, .014], [.026, .003, .010], [.022, .003, .008], [.020, .004, .010]],
    [0xf7ebcb, [.022, .005, .011], [.024, .005, .011], [.023, .005, .009]],
  ],
};

export function createFlyingAnimal(kind) {
  const insect = kind === 'butterfly', nightjar = kind === 'nightjar';
  const group = new THREE.Group();
  const batch = new CivicBatch();
  const color = insect ? 0x41382d : nightjar ? 0x5c554a : 0x8b7255;
  if (insect) {
    oval(batch, color, 0, 0, 0, .0036, .003, .019);
    for (const side of [-1, 1]) {
      rod(batch, color, [0, .001, .013], [side * .008, .006, .025], .001, .00045);
    }
  } else {
    const scale = nightjar ? 1.38 : 1;
    oval(batch, color, 0, 0, 0, .035 * scale, .030 * scale, .072 * scale);
    oval(batch, nightjar ? 0x897f6c : 0xc8b79b, 0, -.014, .025, .029 * scale, .023 * scale, .043 * scale);
    oval(batch, color, 0, .018 * scale, .065 * scale, .026 * scale, .024 * scale, .034 * scale);
    oval(batch, 0x5e5042, 0, .012 * scale, .097 * scale, .010 * scale, .007 * scale, .019 * scale);
    oval(batch, color, 0, -.010, -.093 * scale, .026 * scale, .008, .062 * scale, -.10);
  }
  const body = batch.mesh();
  const wings = [-1, 1].map(side => wingPanels(WINGS[kind], side));
  group.add(body, ...wings);
  return {
    group,
    flap(lift) {
      wings[0].rotation.z = -lift;
      wings[1].rotation.z = lift;
    },
  };
}

export function createMammal(kind) {
  const deer = kind === 'red-deer';
  const group = new THREE.Group();
  const batch = new CivicBatch();
  const coat = deer ? 0x815640 : 0x41382e;
  const dark = deer ? 0x563b2a : 0x302822;
  let antlers;
  if (deer) {
    oval(batch, coat, 0, 1.10, -.07, .255, .30, .69);
    oval(batch, coat, 0, 1.13, .40, .267, .325, .30);
    oval(batch, 0xb08d66, 0, 1.08, -.57, .23, .18, .23);
    oval(batch, dark, 0, 1.12, -.76, .058, .123, .081, -.4);
    oval(batch, dark, 0, 1.49, .61, .135, .38, .19, .57);
    oval(batch, coat, 0, 1.77, .80, .115, .145, .23, -.31);
    oval(batch, dark, 0, 1.72, .98, .085, .10, .109);
    oval(batch, 0x242421, 0, 1.69, 1.052, .058, .047, .032);
    const rack = new CivicBatch();
    for (const side of [-1, 1]) {
      oval(batch, coat, side * .15, 1.88, .68, .115, .039, .052, 0, side * .53);
      oval(batch, 0x251e19, side * .105, 1.81, .875, .018, .018, .018);
      const root = [side * .07, 1.89, .77], middle = [side * .18, 2.14, .64], outer = [side * .31, 2.36, .43];
      rod(rack, 0x8b7766, root, middle, .023, .018);
      rod(rack, 0x91836c, middle, outer, .018, .009);
      rod(rack, 0x91836c, middle, [side * .23, 2.25, .83], .013, .002);
      rod(rack, 0xa6987d, outer, [side * .36, 2.50, .48], .009, .002);
      rod(rack, 0xa6987d, outer, [side * .28, 2.46, .32], .009, .002);
    }
    antlers = rack.mesh();
    group.add(antlers);
  } else {
    oval(batch, coat, 0, .63, -.11, .28, .263, .56);
    oval(batch, dark, 0, .68, .23, .266, .317, .355);
    oval(batch, coat, 0, .59, .49, .184, .185, .337, .24);
    oval(batch, dark, 0, .48, .76, .112, .086, .143, .31);
    oval(batch, 0x615341, 0, .445, .872, .092, .055, .038);
    rod(batch, dark, [0, .71, -.60], [0, .52, -.77], .024, .011);
    for (const side of [-1, 1]) {
      oval(batch, dark, side * .12, .81, .37, .047, .129, .051, -.16, -side * .39);
      oval(batch, 0x251e19, side * .142, .627, .628, .020, .020, .020);
      rod(batch, 0x9a896d, [side * .094, .415, .68], [side * .118, .47, .73], .014, .003);
    }
  }
  group.add(batch.mesh());
  const legs = LEGS.map(([x, z]) => {
    const length = deer ? 1.04 : .56;
    const limb = new CivicBatch();
    const knee = [0, -length * .5, z < 0 && deer ? -.1 : .03];
    rod(limb, coat, [0, 0, 0], knee, deer ? .074 : .089, .043);
    rod(limb, dark, knee, [0, -length, 0], .042, .035);
    const leg = limb.mesh();
    leg.position.set(x * 1.2, length, z * (deer ? 1.2 : 1));
    group.add(leg);
    return leg;
  });
  return {
    group,
    walk(time, hasAntlers) {
      if (antlers) antlers.visible = hasAntlers;
      for (let i = 0; i < legs.length; i++) legs[i].rotation.x = Math.sin(time * 6 + i * 1.57) * .38;
    },
  };
}
