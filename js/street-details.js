import * as THREE from 'three/webgpu';
import { Fn, float, color, positionGeometry, uniform, mod, fract, step, smoothstep, mix } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  AVENUES,
  STREETS,
  ALL_AVENUES,
  ALL_STREETS,
  streetZ,
  SIGNAL_TIMING,
  blockAt,
  fromOldFrame,
  CENTRAL_PARK_BOUNDS as CPB,
  BLOCKS,
  EDE_DATA,
  waterAt
} from './city-config.js';
import { cityUniforms, createTreeGrateMaterial, createGodRayMaterial } from './tsl-materials.js';
import { createTreeField } from './trees.js';
import { pavedPlazaRects, centralParkClearings, parkTreeSites, sidewalkBlocks, parkLampSites, edeStreetSites } from './city-grid.js';
import { bryantParkLawn } from './landmarks.js';
import { nearestEdeRoad } from './ede-geometry.js';
import { terrainHeightAt } from './terrain.js';

// Instanced street furniture, traffic signals, trees and nearby light pools.

function createStreetSignBladeTexture(label) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = EDE_DATA ? '#164780' : '#0d6b3f';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = EDE_DATA ? 3 : 5;
  if (EDE_DATA) {
    ctx.beginPath();
    ctx.roundRect(5, 5, 246, 54, 8);
    ctx.stroke();
  } else {
    ctx.strokeRect(4, 4, 248, 56);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = EDE_DATA ? '600 34px Arial, sans-serif'
    : `800 ${label.length > 22 ? 19 : label.length > 16 ? 23 : 30}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 34, 228);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Use the same signal clock and phase boundaries as the traffic simulation.
function createTrafficSignalLensMaterial(isAvenueHead, clock) {
  const { cycle, avenueAmber, avenueRed, streetAmber } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    const y = positionGeometry.y;
    const split = EDE_DATA ? 0.125 : 0.18;
    const isTopRed = step(split, y);
    const isBottomGreen = float(1).sub(step(-split, y));
    const isMidAmber = float(1.0).sub(isTopRed).mul(float(1.0).sub(isBottomGreen));

    // Avenue phase: Green, then Amber from avenueAmber, Red from avenueRed
    // Street phase: Red until avenueRed, then Green, Amber from streetAmber
    const greenActive = isAvenueHead
      ? float(1.0).sub(step(avenueAmber, t))
      : step(avenueRed, t).mul(float(1.0).sub(step(streetAmber, t)));
    const amberActive = isAvenueHead
      ? step(avenueAmber, t).mul(float(1.0).sub(step(avenueRed, t)))
      : step(streetAmber, t);
    const redActive = isAvenueHead
      ? step(avenueRed, t)
      : float(1.0).sub(step(avenueRed, t));

    const activeMask = isTopRed.mul(redActive)
      .add(isMidAmber.mul(amberActive))
      .add(isBottomGreen.mul(greenActive));

    const lensHue = mix(
      mix(color(0x18ff68), color(0xffaa10), isMidAmber),
      color(0xff2424),
      isTopRed
    );
    return mix(color(0x14181e), lensHue.mul(1.35), activeMask);
  })();
  return mat;
}

// Render the existing walk, clearance and stop intervals as pedestrian indications.
function createWalkSignalMaterial(clock) {
  const { cycle, avenueAmber, walk } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    const isWalk = float(1.0).sub(step(walk, t));
    const isFlashing = step(walk, t).mul(float(1.0).sub(step(avenueAmber, t)));
    if (EDE_DATA) {
      const isRed = step(0, positionGeometry.y);
      const greenLit = isWalk.add(isFlashing.mul(float(1).sub(step(0.5, fract(t)))));
      const active = mix(greenLit, step(avenueAmber, t), isRed);
      return mix(color(0x1d2120), mix(color(0x29ff72), color(0xff3131), isRed).mul(1.35), active);
    }
    const handLit = float(1.0).sub(isFlashing.mul(step(0.5, fract(t))));
    const hand = mix(color(0x14181e), color(0xff5518), handLit);
    return mix(hand, color(0xf4f9ff), isWalk);
  })();
  return mat;
}

function pedestrianFigure(walking) {
  const limbs = walking ? [
    [0, 0.036, -0.012, -0.012], [-0.012, -0.012, -0.048, -0.059], [-0.012, -0.012, 0.045, -0.054],
    [-0.003, 0.027, 0.043, 0.005], [-0.003, 0.027, -0.044, 0.009]
  ] : [
    [0, 0.036, 0, -0.011], [0, -0.011, -0.017, -0.059], [0, -0.011, 0.017, -0.059],
    [0, 0.029, 0.032, -0.011], [0, 0.029, -0.032, -0.011]
  ];
  return mergeGeometries([
    new THREE.CircleGeometry(0.016, 8).translate(walking ? 0.006 : 0, 0.052, 0),
    ...limbs.map(([ax, ay, bx, by], i) => new THREE.PlaneGeometry(Math.hypot(bx - ax, by - ay) + 0.014, i === 0 ? 0.03 : 0.017)
      .rotateZ(Math.atan2(by - ay, bx - ax)).translate((ax + bx) / 2, (ay + by) / 2, 0))
  ]);
}

function buildStreetDetails(scene, colliders = [], mappedLamps = null, gantryLampMounts, treeOptions) {
  const group = new THREE.Group();
  group.name = EDE_DATA ? 'EdeStreetDetails' : 'ManhattanStreetDetails';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);

  // Ground footprints of street furniture that traffic and pedestrians must keep clear of
  const footprints = [];
  const addFootprint = (x, z, w, d, pedestrianOnly = false, layer) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, pedestrianOnly, layer });

  // Signal clock (seconds), set every frame by main.js
  const signalClock = uniform(0);

  // Shared materials
  const poleMetalMat = new THREE.MeshStandardNodeMaterial({
    color: 0x3b4046,
    roughness: 0.45,
    metalness: 0.78
  });
  const signalHousingMat = new THREE.MeshStandardNodeMaterial({
    color: EDE_DATA ? 0x222627 : 0xe6a817,
    roughness: 0.38,
    metalness: 0.35,
    side: THREE.DoubleSide // the tunnel visors are open half-tubes
  });
  const aveSignalLensMat = createTrafficSignalLensMaterial(true, signalClock);
  const streetSignalLensMat = createTrafficSignalLensMaterial(false, signalClock);
  const walkSignalGlow = createWalkSignalMaterial(signalClock);
  // Cobra-head LED streetlight lens & pedestrian post-top globe: pale diffuser by day, warm white after dusk
  const lampBulbGlow = new THREE.MeshBasicNodeMaterial();
  lampBulbGlow.colorNode = mix(color(0x8f918c), color(0xfff1d6).mul(2.1), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const pedGlobeGlow = new THREE.MeshBasicNodeMaterial();
  pedGlobeGlow.colorNode = mix(color(0xd4d2c8), color(0xffe4b0).mul(1.95), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const streetBladeMat = new THREE.MeshStandardNodeMaterial({
    map: createStreetSignBladeTexture(EDE_DATA ? 'EDE · CENTRUM' : '5TH AVE · 42 ST'),
    roughness: 0.32
  });

  const HEAD_W = EDE_DATA ? 0.29 : 0.4;
  const HEAD_H = EDE_DATA ? 0.83 : 1.12;
  const HEAD_D = EDE_DATA ? 0.22 : 0.28;
  const LENS_R = EDE_DATA ? 0.10 : 0.145;
  const spacing = EDE_DATA ? 0.25 : 0.36;
  const visorDepth = EDE_DATA ? 0.16 : 0.24;
  const LENS_Y = [spacing, 0, -spacing];
  const bothFaces = (geo) => [geo, geo.clone().rotateY(Math.PI)];
  const visor = (r, y, face, depth) => bothFaces(
    new THREE.CylinderGeometry(r, r, depth, 14, 1, true, Math.PI / 2, Math.PI)
      .rotateX(Math.PI / 2).translate(0, y, face + depth / 2));
  const signalHousingGeo = mergeGeometries([
    new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D),
    EDE_DATA ? new THREE.BoxGeometry(0.47, 1.02, 0.035)
      : new THREE.BoxGeometry(0.07, 0.2, 0.07).translate(0, HEAD_H / 2 + 0.1, 0),
    ...LENS_Y.flatMap(y => visor(LENS_R + 0.023, y, HEAD_D / 2, visorDepth))
  ]);
  const signalLensGeo = mergeGeometries(LENS_Y.flatMap(y =>
    bothFaces(new THREE.CircleGeometry(LENS_R, 18).translate(0, y, HEAD_D / 2 + 0.004))));
  const signalBorderGeo = EDE_DATA ? mergeGeometries([
    ...[-0.51, 0.51].map(y => new THREE.BoxGeometry(0.49, 0.016, 0.042).translate(0, y, 0)),
    ...[-0.237, 0.237].map(x => new THREE.BoxGeometry(0.016, 1.005, 0.042).translate(x, 0, 0)),
  ]) : null;
  const walkHousingGeo = EDE_DATA ? mergeGeometries([
    new THREE.BoxGeometry(0.24, 0.475, 0.18),
    ...[-0.118, 0.118].flatMap(y => visor(0.096, y, 0.09, 0.10))
  ]) : new THREE.BoxGeometry(0.34, 0.4, 0.24);
  const walkPanelGeo = EDE_DATA ? mergeGeometries([
    ...bothFaces(pedestrianFigure(false).translate(0, 0.118, 0.093)),
    ...bothFaces(pedestrianFigure(true).translate(0, -0.118, 0.093))
  ]) : mergeGeometries(bothFaces(new THREE.PlaneGeometry(0.27, 0.31).translate(0, 0, 0.125)));
  // Cobra-head luminaire on the end of the arm: flattened grey housing, flat lens underneath
  const lampHousingGeo = new THREE.SphereGeometry(1, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.7, 0.2, 0.3);
  const lampLensGeo = new THREE.CircleGeometry(1, 16).rotateX(Math.PI / 2).scale(0.6, 1, 0.24).translate(0, -0.005, 0);
  // Classic NYC cast-iron pedestrian post-top globe lightpole (fluted base + shaft + decorative capital + opal globe)
  const pedLampPostGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.11, 0.16, 0.85, 10).translate(0, 0.425, 0),
    new THREE.CylinderGeometry(0.065, 0.085, 2.75, 10).translate(0, 2.22, 0),
    new THREE.CylinderGeometry(0.14, 0.07, 0.16, 10).translate(0, 3.62, 0)
  ]);
  const pedGlobeGeo = new THREE.SphereGeometry(0.23, 8, 6).translate(0, 3.84, 0);

  // =========================================================================
  // 1. NYC CANTILEVERED TRAFFIC SIGNALS, STREET BLADES & WALK SIGNALS
  // =========================================================================
  const poleMatrices = [];
  const armMatrices = [];
  const signalHousingMatrices = [];
  const dutchMastMatrices = [];
  const callButtonMatrices = [];
  const aveLensMatrices = [];
  const streetLensMatrices = [];
  const streetBladeMatrices = [];
  const walkBoxMatrices = [];
  const audioSignals = [];
  const signalIntersections = [];
  const lampHeadMatrices = [];
  const pedPostMatrices = [];
  const cobraLampSites = [];
  const streetPointSites = [];
  // Only nearby poles can conflict, even with street furniture across the whole island.
  const POLE_CELL = 8;
  const poleCells = new Map();
  function addPole(x, z, width, layer) {
    const key = Math.floor(x / POLE_CELL) + ',' + Math.floor(z / POLE_CELL);
    let cell = poleCells.get(key);
    if (!cell) poleCells.set(key, cell = []);
    cell.push({ x, z });
    // Poles stand on curbs: pedestrians avoid them, but they must not narrow the inferred road gaps.
    addFootprint(x, z, width, width, true, layer);
  }

  const plazaRects = pavedPlazaRects || [];
  const inPlaza = (x, z, m = 1.0) =>
    plazaRects.some((r) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m);

  // True only when (x, z) and its surrounding pad-meter footprint sit on a real curb island (never in a road or median)
  const isOnCurbIsland = (x, z, pad = 0.55) => {
    const b = blockAt(x, z);
    if (!b || b.median) return false;
    if (pad <= 0) return true;
    const b1 = blockAt(x - pad, z);
    const b2 = blockAt(x + pad, z);
    const b3 = blockAt(x, z - pad);
    const b4 = blockAt(x, z + pad);
    return !!(b1 && !b1.median && b2 && !b2.median && b3 && !b3.median && b4 && !b4.median);
  };

  // True only when (x, z) is on a non-park, non-median, non-plaza sidewalk with `pad` clearance from all curbs
  const isOnSidewalk = (x, z, pad = 0.55) => {
    if (!isOnCurbIsland(x, z, pad)) return false;
    const b = blockAt(x, z);
    return !(b.park > 0.6) && !inPlaza(x, z, 1.0);
  };

  const isClearOfPoles = (x, z, minDist = 6.0) => {
    const md2 = minDist * minDist;
    for (let ix = Math.floor((x - minDist) / POLE_CELL); ix <= Math.floor((x + minDist) / POLE_CELL); ix++) {
      for (let iz = Math.floor((z - minDist) / POLE_CELL); iz <= Math.floor((z + minDist) / POLE_CELL); iz++) {
        for (const p of poleCells.get(ix + ',' + iz) || []) {
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < md2) return false;
        }
      }
    }
    return true;
  };

  // Use each avenue's local width and the street's real runs, including gaps at Central Park and road ends.
  for (const ave of ALL_AVENUES) {
    if (ave.isHighway) continue;
    for (const st of ALL_STREETS) {
      const avenueRun = ave.segs?.find((s) => st.z >= s.z0 && st.z <= s.z1);
      const streetRun = st.runs?.find((s) => ave.x >= s[0] && ave.x <= s[1]);
      if (!avenueRun || !streetRun) continue;
      // A median avenue spans both carriageways and the planted mall between them.
      const cornerOffsetX = (ave.hasMedian ? 33 : avenueRun.w) * 0.5 + 1.25;
      const cornerOffsetZ = streetRun[3] * 0.5 + 1.25;
      let placedSignal = false;

      // Place diagonal pair of traffic signal masts at NE and SW corners of every intersection
      const corners = [
        { sx: 1, sz: -1, armDir: -1 },
        { sx: -1, sz: 1, armDir: 1 }
      ];

      for (const c of corners) {
        let px = ave.x + c.sx * cornerOffsetX;
        let pz = st.z + c.sz * cornerOffsetZ;
        if (!isOnCurbIsland(px, pz, 0.55) || inPlaza(px, pz, 1.0)) {
          // Try nudging slightly deeper into the block corner if clipped near the curb
          const altX = ave.x + c.sx * (cornerOffsetX + 0.85);
          const altZ = st.z + c.sz * (cornerOffsetZ + 0.85);
          if (isOnCurbIsland(altX, altZ, 0.55) && !inPlaza(altX, altZ, 1.0)) {
            px = altX;
            pz = altZ;
          } else {
            continue;
          }
        }
        // Ensure the cantilevered mast arm actually overhangs the avenue roadway
        if (blockAt(px + c.armDir * 3.1, pz) || !isClearOfPoles(px, pz, 6.0)) continue;
        addPole(px, pz, 0.5);
        if (!placedSignal) {
          signalIntersections.push({ x: ave.x, z: st.z });
          placedSignal = true;
        }

        // Vertical pole (6.4m tall)
        dummy.position.set(px, 3.3, pz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.14, 6.4, 0.14);
        dummy.updateMatrix();
        poleMatrices.push(dummy.matrix.clone());

        // NYC DOT Green Street Name Sign Blade mounted on pole (y = 4.65m)
        dummy.position.set(px + c.armDir * 0.68, 4.65, pz);
        dummy.scale.set(1.38, 0.34, 0.08);
        dummy.updateMatrix();
        streetBladeMatrices.push(dummy.matrix.clone());

        // Pedestrian "WALK / DON'T WALK" signal on the pole at crosswalk level (y = 3.15m), facing across the street
        dummy.position.set(px + c.armDir * 0.24, 3.15, pz);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        walkBoxMatrices.push(dummy.matrix.clone());
        // These panels share the avenue WALK phase; rejected/unplaced poles never become sound sources.
        audioSignals.push({ x: dummy.position.x, y: dummy.position.y, z: dummy.position.z, isAvenue: true });

        // Cantilever horizontal mast arm reaching 6.5m over the avenue
        const armX = px + c.armDir * 3.25;
        dummy.position.set(armX, 6.1, pz);
        dummy.scale.set(6.5, 0.11, 0.11);
        dummy.updateMatrix();
        armMatrices.push(dummy.matrix.clone());

        // Intersection corner cobra-head luminaire overhanging the crosswalk & corner sidewalk
        const cornerLampX = px + c.armDir * 1.85;
        dummy.position.set(cornerLampX, 6.22, pz);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        lampHeadMatrices.push(dummy.matrix.clone());
        cobraLampSites.push({
          x: cornerLampX,
          y: 6.18,
          z: pz,
          tx: px + c.armDir * 2.8,
          tz: pz - c.sz * 1.4
        });

        // Two NYC yellow signal heads hanging from the mast arm: the avenue's (3.1 m out, facing up & down the avenue)
        // and the cross street's (5.5 m out, turned to face along the street)
        for (const armDist of [3.1, 5.5]) {
          dummy.position.set(px + c.armDir * armDist, 5.42, pz);
          dummy.rotation.set(0, armDist < 4.0 ? 0 : Math.PI / 2, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          signalHousingMatrices.push(dummy.matrix.clone());
          (armDist < 4.0 ? aveLensMatrices : streetLensMatrices).push(dummy.matrix.clone());
        }
        dummy.rotation.set(0, 0, 0);
      }
    }
  }

  // =========================================================================
  // 2. MID-BLOCK AVENUE & STREET ORNAMENTAL ACORN & COBRA STREETLIGHTS
  //    Placed directly along the true curb edges of every city block (BLOCKS)
  //    and verified with blockAt(x, z) so no pole ever stands in any roadway.
  // =========================================================================
  const allBlocks = EDE_DATA ? [] : BLOCKS || [];
  const detailZMin = streetZ(61);
  const detailZMax = streetZ(14);

  for (const b of allBlocks) {
    if (!b || !b.poly || b.poly.length < 3 || b.median || b.park > 0.6) continue;

    const poly = b.poly;
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 24) continue;

      const ux = dx / len;
      const uz = dz / len;
      const mx = (p0.x + p1.x) * 0.5;
      const mz = (p0.z + p1.z) * 0.5;

      // Determine inward normal (into the sidewalk block) and outward normal (into the street roadway)
      let inx = -uz;
      let inz = ux;
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) {
        inx = uz;
        inz = -ux;
      }
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) continue;
      const outX = -inx;
      const outZ = -inz;
      // Confirm this curb edge fronts an open roadway
      if (blockAt(mx + outX * 2.5, mz + outZ * 2.5)) continue;

      const isAvenueEdge = Math.abs(uz) > 0.65;
      if (isAvenueEdge) {
        const armYaw = Math.atan2(-outZ, outX);
        const cobraFracs = inx > 0 ? [0.26, 0.72] : [0.32, 0.78];
        for (const f of cobraFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const lx = cx + inx * 1.08;
          const lz = cz + inz * 1.08;
          const headX = lx + outX * 2.6;
          const headZ = lz + outZ * 2.6;
          if (
            !isOnSidewalk(lx, lz, 0.55) ||
            blockAt(cx + outX * 2.5, cz + outZ * 2.5) ||
            blockAt(headX, headZ) ||
            !isClearOfPoles(lx, lz, 6.5)
          ) {
            continue;
          }
          addPole(lx, lz, 0.45);

          // Tall ornamental streetlight pole
          dummy.position.set(lx, 4.3, lz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.12, 8.4, 0.12);
          dummy.updateMatrix();
          poleMatrices.push(dummy.matrix.clone());

          // Upper luminaire bracket arm overhanging the street
          dummy.position.set(lx + outX * 1.15, 8.2, lz + outZ * 1.15);
          dummy.rotation.set(0, armYaw, 0);
          dummy.scale.set(2.3, 0.09, 0.09);
          dummy.updateMatrix();
          armMatrices.push(dummy.matrix.clone());

          // NYC DOT cobra-head LED luminaire on the end of the arm, lens facing the street
          dummy.position.set(headX, 8.08, headZ);
          dummy.rotation.set(0, armYaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          lampHeadMatrices.push(dummy.matrix.clone());
          dummy.rotation.set(0, 0, 0);

          cobraLampSites.push({
            x: headX,
            y: 8.02,
            z: headZ,
            tx: lx + outX * 3.4,
            tz: lz + outZ * 3.4
          });
        }

        // Historic NYC cast-iron pedestrian post-top globe lightpoles along avenue sidewalks (with PointLights)
        const pedFracs = len >= 48 ? [0.16, 0.50, 0.84] : [0.24, 0.76];
        for (const f of pedFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const px = cx + inx * 1.42;
          const pz = cz + inz * 1.42;
          if (
            !isOnSidewalk(px, pz, 0.55) ||
            blockAt(cx + outX * 2.2, cz + outZ * 2.2) ||
            !isClearOfPoles(px, pz, 5.2)
          ) {
            continue;
          }
          addPole(px, pz, 0.4);

          dummy.position.set(px, 0.18, pz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          pedPostMatrices.push(dummy.matrix.clone());
          streetPointSites.push({
            x: px,
            y: 4.02,
            z: pz,
            color: 0xffe0aa,
            intensity: 30,
            dist: 14.5
          });
        }
      } else if (len >= 36) {
        // Cross-street cast-iron pedestrian post-top globe lightpoles along north and south block curbs
        const crossFracs = len >= 115 ? [0.20, 0.40, 0.60, 0.80] : [0.24, 0.50, 0.76];
        for (const f of crossFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const px = cx + inx * 1.22;
          const pz = cz + inz * 1.22;
          if (
            !isOnSidewalk(px, pz, 0.55) ||
            blockAt(cx + outX * 2.2, cz + outZ * 2.2) ||
            !isClearOfPoles(px, pz, 5.5)
          ) {
            continue;
          }
          addPole(px, pz, 0.4);

          dummy.position.set(px, 0.18, pz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          pedPostMatrices.push(dummy.matrix.clone());
          streetPointSites.push({
            x: px,
            y: 4.02,
            z: pz,
            color: 0xffe0aa,
            intensity: 28,
            dist: 14.0
          });
        }
      }
    }
  }

  const edeSignMatrices = new Map();
  if (EDE_DATA) {
    const centreStreetSigns = new Set(['Grotestraat', 'Molenstraat', 'Marktstraat', 'Telefoonweg', 'Amsterdamseweg',
      'Stationsweg', 'Bergstraat', 'Raadhuisstraat', 'Klinkenbergerweg', 'Driehoek']);
    const setMatrix = (list, x, y, z, sx, sy, sz, yaw = 0) => {
      dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix(); list.push(dummy.matrix.clone());
    };
    const poleRadius = 0.11;
    const lampSites = mappedLamps ?? edeStreetSites;
    for (let i = 0; i < lampSites.length; i++) {
      const s = lampSites[i];
      const { x, z } = s;
      let { nx, nz, ux, uz, name } = s;
      if (mappedLamps) {
        const road = s.baseY === undefined || i % 4 === 0 ? nearestEdeRoad(x, z, 25, undefined, s.layer) : null;
        name = road?.road.name;
        if (s.baseY === undefined) {
          ux = road?.ux ?? 0;
          uz = road?.uz ?? 1;
          const side = road && ((road.x - x) * -uz + (road.z - z) * ux) < 0 ? -1 : 1;
          nx = -uz * side;
          nz = ux * side;
        } else if (road) {
          ux = road.ux;
          uz = road.uz;
        }
      } else {
        if (waterAt(x, z) && !s.road.bridge) continue;
        const block = blockAt(x, z);
        if (block && !block.sidewalk && !block.id?.toString().startsWith('sidewalk') && block.source && !block.park) continue;
      }
      const ground = s.baseY ?? terrainHeightAt(x, z);
      const headY = ground + (s.height ?? 8.2);
      const mount = gantryLampMounts?.get(s);
      const lampX = mount?.x ?? x, lampZ = mount?.z ?? z;
      const poleBase = mount?.top ?? ground;
      const poleHeight = headY - poleBase;
      if (poleHeight > 0) setMatrix(poleMatrices, lampX, poleBase + poleHeight / 2, lampZ, poleRadius, poleHeight, poleRadius);
      const armCount = s.doubleArm ? 2 : 1;
      for (let arm = 0; arm < armCount; arm++) {
        const ax = arm === 0 ? nx : -nx, az = arm === 0 ? nz : -nz;
        const yaw = Math.atan2(-az, ax);
        setMatrix(armMatrices, lampX + ax * 1.1, headY - 0.12, lampZ + az * 1.1, 2.2, 0.085, 0.085, yaw);
        setMatrix(lampHeadMatrices, lampX + ax * 2.1, headY - 0.10, lampZ + az * 2.1, 1, s.led ? 0.55 : 1, 1, yaw);
        cobraLampSites.push({ x: lampX + ax * 2.1, y: headY - 0.16, z: lampZ + az * 2.1,
          tx: lampX + ax * 3.5, ty: s.targetY, tz: lampZ + az * 3.5, layer: s.layer, color: s.led ? 0xfff3e0 : 0xffe8c2 });
      }
      addPole(lampX, lampZ, poleRadius, s.layer);
      if (name && !mount && poleHeight >= 2.9 && i % 4 === 0 &&
          (edeSignMatrices.has(name) || edeSignMatrices.size < 70 || centreStreetSigns.has(name))) {
        if (!edeSignMatrices.has(name)) edeSignMatrices.set(name, []);
        const width = Math.min(1.45, Math.max(0.72, 0.24 + name.length * 0.051));
        const end = poleRadius + 0.04;
        const offset = end + width / 2;
        const y = poleBase + 2.55, yaw = -Math.atan2(uz, ux);
        setMatrix(armMatrices, lampX + ux * end / 2, y, lampZ + uz * end / 2, end + 0.036, 0.056, 0.038, yaw);
        setMatrix(edeSignMatrices.get(name), lampX + ux * offset, y, lampZ + uz * offset, width, 0.23, 0.028, yaw);
      }
    }
    const signalKeys = new Set();
    for (const signal of EDE_DATA.signals || []) {
      const road = nearestEdeRoad(signal.x, signal.z, 28);
      if (!road) continue;
      const nx = -road.uz, nz = road.ux;
      const side = ((signal.x - road.x) * nx + (signal.z - road.z) * nz) < 0 ? -1 : 1;
      const x = road.x + nx * side * (road.width / 2 + 0.7), z = road.z + nz * side * (road.width / 2 + 0.7);
      const key = `${Math.round(x / 7)}/${Math.round(z / 7)}`;
      if (signalKeys.has(key)) continue;
      signalKeys.add(key);
      const yaw = Math.atan2(road.ux, road.uz), isAvenue = Math.abs(road.uz) >= Math.abs(road.ux);
      const ground = terrainHeightAt(x, z);
      const motorY = ground + 2.77;
      setMatrix(dutchMastMatrices, x, ground + 1.21, z, 0.063, 2.42, 0.063);
      setMatrix(signalHousingMatrices, x, motorY, z, 1, 1, 1, yaw);
      setMatrix(isAvenue ? aveLensMatrices : streetLensMatrices, x, motorY, z, 1, 1, 1, yaw);

      const px = x - road.ux * 0.78, pz = z - road.uz * 0.78;
      const pedestrianGround = terrainHeightAt(px, pz);
      const pedestrianY = pedestrianGround + 2.44;
      setMatrix(dutchMastMatrices, px, pedestrianGround + 1.12, pz, 0.055, 2.24, 0.055);
      setMatrix(walkBoxMatrices, px, pedestrianY, pz, 1, 1, 1, yaw + Math.PI / 2);
      setMatrix(callButtonMatrices, px + nx * side * 0.065, pedestrianGround + 1.08, pz + nz * side * 0.065,
        0.085, 0.15, 0.075, yaw + Math.PI / 2);
      audioSignals.push({ x: px, y: pedestrianY, z: pz, isAvenue });
    }
  }

  function addMatrixArrayInstanced(geo, mat, matrices, castShadow = true) {
    if (matrices.length === 0) return;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    if (castShadow && !mat.isMeshBasicNodeMaterial && mat.type !== 'MeshBasicNodeMaterial' && !mat.transparent) {
      inst.castShadow = true;
      inst.receiveShadow = true;
    }
    for (let i = 0; i < matrices.length; i++) {
      inst.setMatrixAt(i, matrices[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    return inst;
  }

  const poles = addMatrixArrayInstanced(unitCyl, poleMetalMat, poleMatrices);
  const arms = addMatrixArrayInstanced(unitBox, poleMetalMat, armMatrices);
  if (EDE_DATA) {
    if (poles) poles.name = 'EdeLampPoles';
    if (arms) arms.name = 'EdeLampArmsAndSignBrackets';
  }
  const motorSignals = addMatrixArrayInstanced(signalHousingGeo, signalHousingMat, signalHousingMatrices);
  if (motorSignals && EDE_DATA) {
    motorSignals.name = 'EdeMotorSignals';
    const stripe = step(0.5, fract(positionGeometry.y.add(0.5).mul(4)));
    const striped = new THREE.MeshStandardNodeMaterial({ roughness: 0.72 });
    striped.colorNode = mix(color(0x202327), color(0xe0e0db), stripe);
    addMatrixArrayInstanced(unitCyl, striped, dutchMastMatrices).name = 'EdeStripedSignalMasts';
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xe6e6dc, roughness: 0.75 });
    addMatrixArrayInstanced(signalBorderGeo, white, signalHousingMatrices);
    const button = new THREE.MeshStandardNodeMaterial({ color: 0xe1b83a, roughness: 0.72 });
    addMatrixArrayInstanced(unitBox, button, callButtonMatrices, false);
  }
  addMatrixArrayInstanced(signalLensGeo, aveSignalLensMat, aveLensMatrices, false);
  addMatrixArrayInstanced(signalLensGeo, streetSignalLensMat, streetLensMatrices, false);
  addMatrixArrayInstanced(unitBox, streetBladeMat, streetBladeMatrices);
  const pedestrianSignals = addMatrixArrayInstanced(walkHousingGeo, signalHousingMat, walkBoxMatrices);
  const pedestrianFigures = addMatrixArrayInstanced(walkPanelGeo, walkSignalGlow, walkBoxMatrices, false);
  if (pedestrianSignals && EDE_DATA) {
    pedestrianSignals.name = 'EdePedestrianSignals';
    pedestrianFigures.name = 'EdePedestrianSignalFigures';
  }
  const housings = addMatrixArrayInstanced(lampHousingGeo, poleMetalMat, lampHeadMatrices);
  if (housings && EDE_DATA) housings.name = 'EdeLampHousings';
  addMatrixArrayInstanced(lampLensGeo, lampBulbGlow, lampHeadMatrices, false);
  const pedPosts = addMatrixArrayInstanced(pedLampPostGeo, poleMetalMat, pedPostMatrices);
  // ~28k posts: they cast as 4-sided base + shaft (16 triangles instead of 120; scene-culling.js shadow stand-ins)
  if (pedPosts) {
    pedPosts.userData.shadowStandIn = mergeGeometries([
      new THREE.CylinderGeometry(0.12, 0.18, 0.85, 4, 1, true).translate(0, 0.425, 0),
      new THREE.CylinderGeometry(0.072, 0.094, 2.85, 4, 1, true).translate(0, 2.275, 0)
    ]);
  }
  addMatrixArrayInstanced(pedGlobeGeo, pedGlobeGlow, pedPostMatrices, false);
  if (edeSignMatrices.size) {
    const blade = unitBox.clone();
    const uv = blade.getAttribute('uv');
    for (let i = 0; i < 16; i++) uv.setXY(i, 1 / 256, 1 / 64);
    for (const [name, matrices] of edeSignMatrices) {
      const mat = new THREE.MeshStandardNodeMaterial({ map: createStreetSignBladeTexture(name), roughness: 0.6 });
      addMatrixArrayInstanced(blade, mat, matrices).name = `EdeStreetName:${name}`;
    }
  }

  // =========================================================================
  // 2B. VOLUMETRIC GOLDEN-HOUR CANYON SUN SHAFTS (GOD RAYS)
  // =========================================================================
  const godRayMat = createGodRayMaterial();
  const godRayGeo = new THREE.PlaneGeometry(54, 92);
  const canyonShafts = EDE_DATA ? edeStreetSites.filter(s => /Grotestraat|Molenstraat|Marktstraat|Telefoonweg/.test(s.name)).filter((s, i) => i % 9 === 0).slice(0, 8).map(s => ({ x: s.x, y: 24, z: s.z, rotY: Math.atan2(s.ux, s.uz), rotZ: -0.44 })) : [
    { x: 0,    y: 42, z: 180,  rotY: 0.32,  rotZ: -0.46 }, // 34th St & 5th Ave (Empire State Canyon)
    { x: 0,    y: 44, z: 0,    rotY: 0.28,  rotZ: -0.44 }, // 42nd St & 5th Ave (NYPL / Bryant Park)
    { x: 165,  y: 46, z: 0,    rotY: 0.25,  rotZ: -0.45 }, // 42nd St & Park/Lexington (Grand Central & Chrysler)
    { x: -110, y: 42, z: -90,  rotY: 0.30,  rotZ: -0.44 }, // 47th St & 6th Ave (Rockefeller Center)
    { x: -215, y: 40, z: -45,  rotY: 0.35,  rotZ: -0.42 }, // Times Square / Broadway Canyon
    { x: -55,  y: 48, z: -360, rotY: 0.28,  rotZ: -0.46 }  // 59th St / Central Park South Canyon
  ];
  for (const cs of canyonShafts) {
    const shaft = new THREE.Mesh(godRayGeo, godRayMat);
    const at = fromOldFrame(cs.x, cs.z); // (authored on the former compressed grid)
    shaft.position.set(at.x, terrainHeightAt(at.x, at.z) + cs.y, at.z);
    shaft.rotation.set(0.12, cs.rotY, cs.rotZ);
    group.add(shaft);
  }

  // =========================================================================
  // 6. FIRE HYDRANTS ALONG CURBS (INSTANCED)
  // =========================================================================
  const hydrantPositions = [];
  for (const ave of AVENUES) {
    for (let row = 0; row < STREETS.length - 1; row++) {
      const zMid = (STREETS[row].z + STREETS[row + 1].z) * 0.5;
      const h1 = [ave.x - ave.width * 0.5 - 0.8, zMid - 16];
      const h2 = [ave.x + ave.width * 0.5 + 0.8, zMid + 16];
      if (isOnSidewalk(h1[0], h1[1], 0.45)) hydrantPositions.push(h1);
      if (isOnSidewalk(h2[0], h2[1], 0.45)) hydrantPositions.push(h2);
    }
  }

  const hydrantMat = new THREE.MeshStandardNodeMaterial({ color: 0xb8241e, roughness: 0.5, metalness: 0.4 });
  const hydrantInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, 0.85, 8), hydrantMat, Math.max(1, hydrantPositions.length));
  hydrantInst.count = hydrantPositions.length;
  hydrantPositions.forEach(([hx, hz], i) => {
    dummy.position.set(hx, 0.64, hz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    hydrantInst.setMatrixAt(i, dummy.matrix);
  });
  hydrantInst.instanceMatrix.needsUpdate = true;
  if (hydrantPositions.length) group.add(hydrantInst);

  // =========================================================================
  // 7. LUSH TREES: PARKS & PLAZAS, CENTRAL PARK WOODLANDS, AVENUE & CROSS-STREET TREES
  //    London planes, honey locusts & American elms (one unified trunk + crown instanced mesh per species & band)
  // =========================================================================
  const treePositions = []; // { x, y, z, scale, species (0 plane, 1 honey locust, 2 elm / oak) }
  const CP_LAWN_Y = 1.19;
  const mixSpecies = (r, plane, locust) => (r < plane ? 0 : (r < plane + locust ? 1 : 2));


  // A. Bryant Park: double allées of London planes on the raised terraces along the Great Lawn's north & south sides
  //    and its west end, framing the lawn the library's terrace looks out over (the lawn as fitted by landmarks.js)
  const bpl = EDE_DATA ? null : bryantParkLawn;
  if (bpl) {
    const ty = bpl.top - 0.2;
    for (let tx = bpl.minX - 6; tx <= bpl.maxX + 6; tx += 6.5) {
      for (const tz of [bpl.minZ - 5, bpl.minZ - 11.5, bpl.maxZ + 5, bpl.maxZ + 11.5]) {
        treePositions.push({ x: tx, y: ty, z: tz, scale: 0.8, species: 0 });
      }
    }
    for (let tz = bpl.minZ; tz <= bpl.maxZ; tz += 6.5) {
      treePositions.push({ x: bpl.minX - 6, y: ty, z: tz, scale: 0.82, species: 0 });
      treePositions.push({ x: bpl.minX - 12.5, y: ty, z: tz, scale: 0.76, species: 0 });
    }
  }

  // B. Central Park (59th to 110th St, 5th Ave to Central Park West; city-config.js CENTRAL_PARK_BOUNDS), on the lawn
  const cp = EDE_DATA ? { minX: 1, maxX: -1, minZ: 1, maxZ: -1 } : CPB;
  // B1. Central Park South (59th St) dense woodland border
  for (let tx = cp.minX + 8; tx <= cp.maxX - 8; tx += 9.5) {
    treePositions.push({ x: tx, y: CP_LAWN_Y, z: cp.maxZ - 5, scale: 0.95, species: 0 });
    treePositions.push({ x: tx + 3.5, y: CP_LAWN_Y, z: cp.maxZ - 16, scale: 1.0, species: mixSpecies(hashPos(tx, 1, 2), 0.5, 0.1) });
    if (hashPos(tx, 7, 3) > 0.35) {
      treePositions.push({ x: tx - 2.5, y: CP_LAWN_Y, z: cp.maxZ - 31, scale: 1.05, species: mixSpecies(hashPos(tx, 3, 4), 0.4, 0.15) });
    }
  }

  // B2. 5th Avenue & Central Park West perimeter rows inside the park wall
  for (let tz = cp.maxZ - 10; tz >= cp.minZ + 10; tz -= 14) {
    treePositions.push({ x: cp.maxX - 5, y: CP_LAWN_Y, z: tz, scale: 0.92, species: mixSpecies(hashPos(tz, 1, 1), 0.55, 0.1) });
    treePositions.push({ x: cp.maxX - 15, y: CP_LAWN_Y, z: tz - 6, scale: 0.98, species: mixSpecies(hashPos(tz, 2, 1), 0.3, 0.1) });
    treePositions.push({ x: cp.minX + 5, y: CP_LAWN_Y, z: tz, scale: 0.92, species: mixSpecies(hashPos(tz, 3, 1), 0.55, 0.1) });
    treePositions.push({ x: cp.minX + 15, y: CP_LAWN_Y, z: tz - 6, scale: 0.98, species: mixSpecies(hashPos(tz, 4, 1), 0.3, 0.1) });
  }

  // B3. The Mall & Literary Walk quadruple row of towering American Elms (66th to 72nd St)
  const cpClear = centralParkClearings;
  const mall = cpClear && cpClear.mall;
  if (mall) {
    for (let tz = mall.z0 + 4; tz <= mall.z1 - 4; tz += 9.5) {
      for (const [dx, sc] of [[-16, 1.08], [-9, 1.0], [9, 1.0], [16, 1.08]]) treePositions.push({ x: mall.x + dx, y: CP_LAWN_Y, z: tz, scale: sc, species: 2 });
    }
  }

  // B4. Woodlands: a jittered grid over the park kept clear of the meadows, water, drives, transverses, rock outcrops
  //     & terraces (laid out by city-grid.js), densest in the Ramble (between the Lake & the 79th St transverse) & the
  //     North Woods (north of 102nd St), with glades
  if (cpClear) {
    const withBox = (pts) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      return { pts, x0: x0 - 4, x1: x1 + 4, z0: z0 - 4, z1: z1 + 4 };
    };
    const polys = cpClear.polygons.map(withBox);
    const drives = cpClear.drives.map((wp) => {
      const b = withBox(wp.map(([x, z]) => ({ x, z })));
      return { wp, x0: b.x0 - 4, x1: b.x1 + 4, z0: b.z0 - 4, z1: b.z1 + 4 };
    });
    const inPoly = (x, z, pts) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
      return inside;
    };
    const segDist = (px, pz, [ax, az], [bx, bz]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(px - ax - dx * t, pz - az - dz * t);
    };
    const blocked = (x, z) => {
      for (const P of polys) {
        if (x < P.x0 || x > P.x1 || z < P.z0 || z > P.z1) continue;
        for (const [ox, oz] of [[0, 0], [3.5, 0], [-3.5, 0], [0, 3.5], [0, -3.5]]) if (inPoly(x + ox, z + oz, P.pts)) return true;
      }
      for (const D of drives) {
        if (x < D.x0 || x > D.x1 || z < D.z0 || z > D.z1) continue;
        for (let i = 0; i < D.wp.length - 1; i++) if (segDist(x, z, D.wp[i], D.wp[i + 1]) < 7.5) return true;
      }
      for (const r of cpClear.rects) if (x > r.minX - 2.5 && x < r.maxX + 2.5 && z > r.minZ - 2.5 && z < r.maxZ + 2.5) return true;
      for (const c of cpClear.circles) if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
      return false;
    };
    const SP = 13;
    const z79 = streetZ(79);
    const z102 = streetZ(102);
    for (let gz = cp.maxZ - 24; gz >= cp.minZ + 12; gz -= SP) {
      for (let gx = cp.minX + 22; gx <= cp.maxX - 22; gx += SP) {
        const tx = gx + (hashPos(gx, 2.1, gz) - 0.5) * SP * 0.95;
        const tz = gz + (hashPos(gz, 5.7, gx) - 0.5) * SP * 0.95;
        const woods = (tz > z79 && tz < z79 + 300 && tx > cp.minX + 120 && tx < cp.minX + 480) || (tz < z102 && tx < cp.minX + 520);
        const glade = Math.sin(tx * 0.019 + 1.3) * Math.sin(tz * 0.016 + 0.4) > 0.6;
        const grove = Math.sin(tx * 0.009 + tz * 0.004) + Math.sin(tz * 0.011 - tx * 0.006 + 2.0); // dense groves vs open scatter
        const skip = grove > 0.6 ? 0.05 : (grove < -0.8 ? 0.55 : 0.2);
        if (!woods && (glade || hashPos(tx, 9.1, tz) < skip)) continue;
        if (blocked(tx, tz)) continue;
        const r = hashPos(tz, 6.6, tx);
        const scale = r < 0.18 ? 0.55 + r * 0.8 : 0.72 + Math.pow(r, 0.8) * 0.72; // some young understory trees
        treePositions.push({ x: tx, y: CP_LAWN_Y, z: tz, scale, species: mixSpecies(hashPos(tx, 4.4, tz), 0.4, 0.15) });
      }
    }
  }

  // B5. The squares, the other parks & the plazas (sites laid out by city-grid.js)
  for (const s of parkTreeSites || []) treePositions.push(s);

  // C & D. Street trees on the raised sidewalks of every real block (city-config.js BLOCKS via the slabs city-grid.js
  //        laid): along the avenue fronts (w / e edges) and, in the residential neighbourhoods, both curbs of the side
  //        streets (n / s edges) — honey locusts on the narrow streets, planes, locusts & elms on the wider ones, with
  //        random missing trees & the odd unplanted block. Never in plazas or parks.
  let sidewalkTreePositions = [];
  const SIDEWALK_Y = 0.22;
  const swBlocks = sidewalkBlocks || [];
  const onSidewalk = (x, z) => {
    const b = blockAt(x, z);
    return !!b && !(b.park > 0.6) && !b.median;
  };
  // Street trees turn in 90° steps with the crown squeezed across the sidewalk, away from the facades
  function addStreetTree(x, z, scale, species, acrossX, extra = {}) {
    if (!onSidewalk(x, z) || inPlaza(x, z, 1.5) || !isClearOfPoles(x, z, 2.2)) return;
    const q = Math.floor(hashPos(x, 8.8, z) * 3.999);
    const t = { x, y: SIDEWALK_Y, z, scale, species, yaw: q * Math.PI * 0.5, tier: acrossX ? 1 : 2, ...extra };
    if (acrossX === (q % 2 === 0)) t.sx = extra.squeeze || 0.82;
    else t.sz = extra.squeeze || 0.82;
    treePositions.push(t);
    sidewalkTreePositions.push(t);
  }
  const RESIDENTIAL = new Set(['uws', 'ues', 'harlem', 'morningside', 'east_harlem', 'chelsea', 'west_chelsea', 'gramercy', 'murray_hill',
    'west_village', 'village', 'east_village', 'lower_east_side', 'turtle_bay', 'hells_kitchen', 'stuy_town', 'tribeca', 'battery_park_city',
    'little_italy', 'chinatown', 'soho', 'hudson_square']);
  const COMMERCIAL = new Set(['midtown', 'billionaires_row', 'garment', 'fidi', 'civic_center', 'hudson_yards', 'flatiron', 'nomad']);
  const AVE_SP = 17;
  const CROSS_SP = 14;
  for (const s of swBlocks) {
    const b = s.block;
    if (!b || b.median || b.park > 0.6) continue;
    const res = RESIDENTIAL.has(b.district);
    const x0 = s.cx - s.w * 0.5;
    const x1 = s.cx + s.w * 0.5;
    const z0 = s.cz - s.d * 0.5;
    const z1 = s.cz + s.d * 0.5;
    // C. avenue fronts (the slab's short w / e edges on a grid block)
    if (s.d >= 20) {
      const thin = COMMERCIAL.has(b.district) ? 0.55 : 0.3;
      for (const [x, side] of [[x0 + 1.3, -1], [x1 - 1.3, 1]]) {
        const n = Math.floor((s.d - 10) / AVE_SP) + 1;
        const zs = z0 + (s.d - (n - 1) * AVE_SP) * 0.5;
        for (let i = 0; i < n; i++) {
          const tz = zs + i * AVE_SP;
          if (hashPos(x, 3.1, tz) < thin) continue;
          addStreetTree(x, tz, 0.66 + hashPos(tz, 3.1, x) * 0.14, mixSpecies(hashPos(x, side, tz), 0.4, 0.35), true);
        }
      }
    }
    // D. side-street curbs (residential neighbourhoods)
    if (!res || s.w < 24 || hashPos(s.cx, 4.2, s.cz) < 0.22) continue;
    for (const side of [-1, 1]) {
      const edge = side < 0 ? z0 : z1;
      const narrow = !!blockAt(s.cx, edge + side * 14); // a block across within ~14 m: a narrow side street
      const z = edge - side * (narrow ? 0.9 : 1.25);
      const n = Math.floor((s.w - 7) / CROSS_SP) + 1;
      const xs = s.cx - ((n - 1) * CROSS_SP) * 0.5;
      for (let i = 0; i < n; i++) {
        const x = xs + i * CROSS_SP + (hashPos(i, s.cz, side) - 0.5) * 1.6;
        const r = hashPos(x, 6.1, z);
        if (r < 0.32) continue;
        const species = narrow ? 1 : mixSpecies(hashPos(z, 2.9, x), 0.4, 0.35);
        const scale = narrow ? 0.54 + r * 0.1 : 0.6 + r * 0.24;
        addStreetTree(x, z, scale, species, false, { pitRot: Math.PI / 2, grate: false, pitS: narrow ? 0.7 : 1, squeeze: narrow ? 0.7 : 0.82 });
      }
    }
  }
  const treeField = createTreeField(scene, treePositions, colliders, treeOptions);
  group.add(treeField.group);
  sidewalkTreePositions = sidewalkTreePositions.filter((t) => treeField.sites.has(t));
  console.info(`[streetDetails] ${treeField.stats.trees} trees (${sidewalkTreePositions.length} street trees)`);

  const grateMat = createTreeGrateMaterial();
  const pitCurbMat = new THREE.MeshStandardNodeMaterial({ color: 0x484642, roughness: 0.88 });
  const pitSoilMat = new THREE.MeshStandardNodeMaterial({ color: 0x241c14, roughness: 0.96 });

  // Curbside tree pit surrounds & dark soil beds, with concentric cast-iron grates on the Midtown avenues
  // (pits run along the curb: t.pitRot = PI/2 on cross streets)
  const pitCurbGeo = new THREE.BoxGeometry(1.7, 0.22, 2.6);
  const pitSoilGeo = new THREE.BoxGeometry(1.35, 0.23, 2.25);
  const pitGrateGeo = new THREE.RingGeometry(0.24, 0.82, 12, 1).rotateX(-Math.PI / 2);
  const gratedTrees = sidewalkTreePositions.filter((t) => t.grate !== false);

  const pitCurbInst = new THREE.InstancedMesh(pitCurbGeo, pitCurbMat, Math.max(1, sidewalkTreePositions.length));
  const pitSoilInst = new THREE.InstancedMesh(pitSoilGeo, pitSoilMat, Math.max(1, sidewalkTreePositions.length));
  pitCurbInst.count = sidewalkTreePositions.length;
  pitSoilInst.count = sidewalkTreePositions.length;
  const pitGrateInst = new THREE.InstancedMesh(pitGrateGeo, grateMat, Math.max(1, gratedTrees.length));
  pitCurbInst.receiveShadow = true;
  pitSoilInst.receiveShadow = true;
  pitGrateInst.receiveShadow = true;
  pitGrateInst.count = gratedTrees.length;

  sidewalkTreePositions.forEach((t, i) => {
    dummy.rotation.set(0, t.pitRot || 0, 0);
    dummy.scale.set(t.pitS || 1, 1, 1);
    dummy.position.set(t.x, 0.19, t.z);
    dummy.updateMatrix();
    pitCurbInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(t.x, 0.20, t.z);
    dummy.updateMatrix();
    pitSoilInst.setMatrixAt(i, dummy.matrix);
  });
  gratedTrees.forEach((t, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(t.x, 0.225, t.z);
    dummy.updateMatrix();
    pitGrateInst.setMatrixAt(i, dummy.matrix);
  });
  pitCurbInst.instanceMatrix.needsUpdate = true;
  pitSoilInst.instanceMatrix.needsUpdate = true;
  pitGrateInst.instanceMatrix.needsUpdate = true;
  // Their footprint would keep these 20 cm boxes drawn at any distance (scene-culling.js): culled with the cross-street
  // trees over them instead (trees.js MAX_DIST)
  for (const pit of [pitCurbInst, pitSoilInst, pitGrateInst]) {
    pit.computeBoundingSphere();
    pit.userData.cullDistance = 950;
  }
  if (sidewalkTreePositions.length) group.add(pitCurbInst, pitSoilInst);
  if (gratedTrees.length) group.add(pitGrateInst);

  function hashPos(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }

  // =========================================================================
  // 8. CLUSTERED STREETLIGHTS & STREET FURNITURE LIGHT POOLS
  // =========================================================================
  for (const s of parkLampSites || []) {
    streetPointSites.push({ x: s.x, y: s.y, z: s.z, color: 0xffe4b4, intensity: 32, dist: 14.0 });
  }

  const STREETLIGHT_SPOT_POOL = 36;
  const STREET_POINT_POOL = 48;
  const STREETLIGHT_DIST = 115;
  const STREET_POINT_DIST = 110;

  const streetLightsGroup = new THREE.Group();
  streetLightsGroup.name = 'StreetClusteredLights';
  scene.add(streetLightsGroup);

  const streetlightSpotPool = [];
  for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
    // Cobra-head LED luminaire: wide downward spread (0.96 rad half-angle) illuminating both road and sidewalk
    const spot = new THREE.SpotLight(0xffe8c2, 0, 25, 0.96, 0.82, 1.25);
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    streetLightsGroup.add(spot, spot.target);
    streetlightSpotPool.push(spot);
  }

  const streetPointPool = [];
  for (let i = 0; i < STREET_POINT_POOL; i++) {
    const pt = new THREE.PointLight(0xffe4b4, 0, 12, 1.35);
    pt.position.set(0, -1000, 0);
    streetLightsGroup.add(pt);
    streetPointPool.push(pt);
  }

  // Source positions are static. Query nearby cells instead of scanning the island every frame.
  const LIGHT_CELL = 128;
  function indexLights(sites) {
    const cells = new Map();
    for (const s of sites) {
      const key = Math.floor(s.x / LIGHT_CELL) + ',' + Math.floor(s.z / LIGHT_CELL);
      let cell = cells.get(key);
      if (!cell) cells.set(key, cell = []);
      cell.push(s);
    }
    return cells;
  }
  const cobraCells = indexLights(cobraLampSites);
  const pointCells = indexLights(streetPointSites);

  function nearbyLights(cells, camera, range, active) {
    const { x: cx, y: cy, z: cz } = camera.position;
    const me = camera.matrixWorld.elements;
    const fwdX = -me[8], fwdZ = -me[10];
    let count = 0;
    for (let ix = Math.floor((cx - range) / LIGHT_CELL); ix <= Math.floor((cx + range) / LIGHT_CELL); ix++) {
      for (let iz = Math.floor((cz - range) / LIGHT_CELL); iz <= Math.floor((cz + range) / LIGHT_CELL); iz++) {
        for (const s of cells.get(ix + ',' + iz) || []) {
          const dx = s.x - cx, dz = s.z - cz;
          const vertical = s.layer && Number.isFinite(s.ty) ? 2 * (cy - s.ty) : cy;
          const d2 = dx * dx + dz * dz + vertical * vertical;
          if (d2 > range * range) continue;
          const effDist = Math.sqrt(d2) + Math.max(0, 6.0 - dx * fwdX - dz * fwdZ) * 2.8;
          if (effDist >= range) continue;
          s._effDist = effDist;
          active[count++] = s;
        }
      }
    }
    active.length = count;
    if (count > 1) active.sort((a, b) => a._effDist - b._effDist);
    return count;
  }

  const activeCobras = [];
  const activePoints = [];

  function smoothFade(d, start, end) {
    const t = Math.min(1, Math.max(0, (end - d) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function update(camera) {
    if (!camera) return;
    const glow = cityUniforms.uInteriorGlow.value;
    // Increase streetlight intensity toward dusk.
    const lampScale = Math.min(1.25, Math.max(0.0, (glow - 0.36) * 1.15));
    if (lampScale <= 0.001) {
      for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
        streetlightSpotPool[i].intensity = 0;
        streetlightSpotPool[i].position.set(0, -1000, 0);
      }
      for (let i = 0; i < STREET_POINT_POOL; i++) {
        streetPointPool[i].intensity = 0;
        streetPointPool[i].position.set(0, -1000, 0);
      }
      return;
    }

    const cobraCount = nearbyLights(cobraCells, camera, STREETLIGHT_DIST, activeCobras);

    const cobraCutoff = cobraCount > STREETLIGHT_SPOT_POOL
      ? Math.min(STREETLIGHT_DIST, activeCobras[STREETLIGHT_SPOT_POOL]._effDist)
      : STREETLIGHT_DIST;
    const spotUsed = Math.min(cobraCount, STREETLIGHT_SPOT_POOL);
    for (let i = 0; i < spotUsed; i++) {
      const s = activeCobras[i];
      const fade = smoothFade(s._effDist, cobraCutoff * 0.62, cobraCutoff);
      const spot = streetlightSpotPool[i];
      const targetY = s.ty ?? terrainHeightAt(s.tx, s.tz);
      spot.position.set(s.x, s.y, s.z);
      spot.target.position.set(s.tx, targetY, s.tz);
      spot.target.updateMatrixWorld();
      spot.color.setHex(s.color ?? 0xffe8c2);
      spot.distance = s.layer > 0 ? Math.min(25, Math.hypot(s.tx - s.x, targetY - s.y, s.tz - s.z) + 2.6) : 25;
      spot.intensity = 88.0 * lampScale * fade;
    }
    for (let i = spotUsed; i < STREETLIGHT_SPOT_POOL; i++) {
      streetlightSpotPool[i].intensity = 0;
      streetlightSpotPool[i].position.set(0, -1000, 0);
    }

    const ptCount = nearbyLights(pointCells, camera, STREET_POINT_DIST, activePoints);

    const ptCutoff = ptCount > STREET_POINT_POOL
      ? Math.min(STREET_POINT_DIST, activePoints[STREET_POINT_POOL]._effDist)
      : STREET_POINT_DIST;
    const ptUsed = Math.min(ptCount, STREET_POINT_POOL);
    for (let i = 0; i < ptUsed; i++) {
      const s = activePoints[i];
      const fade = smoothFade(s._effDist, ptCutoff * 0.62, ptCutoff);
      const pt = streetPointPool[i];
      pt.color.setHex(s.color);
      pt.position.set(s.x, s.y, s.z);
      pt.distance = s.dist;
      pt.intensity = s.intensity * lampScale * fade;
    }
    for (let i = ptUsed; i < STREET_POINT_POOL; i++) {
      streetPointPool[i].intensity = 0;
      streetPointPool[i].position.set(0, -1000, 0);
    }
  }

  scene.add(group);
  return { group, footprints, signalClock, signalIntersections, audioSignals, treeField, update };
}

export { buildStreetDetails };
