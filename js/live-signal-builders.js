import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  MSI_UV_RECTS,
  VRI_UV_RECTS,
  createMsiSignalAtlas,
  createVriSignalAtlas,
} from './live-signal-atlas.js';
import {
  createLiveSignalUniforms,
  createMsiLedMaterial,
  createVriLedMaterial,
  updateLiveSignalUniforms,
} from './live-led-signal-material.js';
import { SPAT_STATES, isAmberSpatState, isGreenSpatState } from './live-signal-feed.js';

// Standard Rijkswaterstaat MTM signaalgever housing dimensions (~0.90 m x 0.85 m x 0.35 m).
const MSI_WIDTH = 0.90;
const MSI_HEIGHT = 0.85;
const MSI_DEPTH = 0.35;
const MSI_CHORD_GAP = 0.14;
const RWS_MIN_CLEARANCE = 4.50; // Official Rijkswaterstaat minimum motorway clearance (4.50 m).
const VRI_POLE_HEIGHT = 3.2;
const VRI_CANTILEVER_HEIGHT = 5.5;
const DEFAULT_UPLOAD_HZ = 15; // 10–20 Hz state buffer update cadence

/**
 * Build black aluminum MSI matrix head housing (~0.90 m x 0.85 m x 0.35 m) with sun visors
 * and top steel mounting bracket to the gantry lower chord. Faces local +Z.
 */
export function createMsiHousingGeometry() {
  const parts = [
    // Main rectangular housing box (front face at z = 0, rear at z = -MSI_DEPTH).
    new THREE.BoxGeometry(MSI_WIDTH, MSI_HEIGHT, MSI_DEPTH).translate(0, 0, -MSI_DEPTH * 0.5),
    // Top sun visor hood projecting forward (+Z).
    new THREE.BoxGeometry(MSI_WIDTH + 0.04, 0.035, 0.24).translate(0, MSI_HEIGHT * 0.5 + 0.01, 0.12),
    // Left and right side visors.
    new THREE.BoxGeometry(0.03, MSI_HEIGHT * 0.65, 0.20).translate(-MSI_WIDTH * 0.5 - 0.01, MSI_HEIGHT * 0.17, 0.10),
    new THREE.BoxGeometry(0.03, MSI_HEIGHT * 0.65, 0.20).translate(MSI_WIDTH * 0.5 + 0.01, MSI_HEIGHT * 0.17, 0.10),
    // Twin vertical mounting brackets connecting housing top to lower truss chord above.
    new THREE.BoxGeometry(0.06, MSI_CHORD_GAP + 0.06, 0.06).translate(-0.22, MSI_HEIGHT * 0.5 + MSI_CHORD_GAP * 0.5, -MSI_DEPTH * 0.5),
    new THREE.BoxGeometry(0.06, MSI_CHORD_GAP + 0.06, 0.06).translate(0.22, MSI_HEIGHT * 0.5 + MSI_CHORD_GAP * 0.5, -MSI_DEPTH * 0.5),
  ];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * Build 3-aspect VRI signal head housing with top visors, facing local +Z.
 */
export function createVriHeadHousingGeometry() {
  const parts = [
    new THREE.BoxGeometry(0.30, 0.88, 0.22).translate(0, 0, -0.11),
    // Top visors above Red (+0.26), Amber (0), Green (-0.26) lenses.
    new THREE.BoxGeometry(0.24, 0.028, 0.16).translate(0, 0.26 + 0.115, 0.08),
    new THREE.BoxGeometry(0.24, 0.028, 0.16).translate(0, 0.0 + 0.115, 0.08),
    new THREE.BoxGeometry(0.24, 0.028, 0.16).translate(0, -0.26 + 0.115, 0.08),
  ];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

function attachInstanceAttributes(geometry, count, uvAttrName, flashAttrName) {
  const uvArray = new Float32Array(count * 4);
  const flashArray = new Float32Array(count);
  const brightArray = new Float32Array(count);
  brightArray.fill(1.0);

  const uvAttr = new THREE.InstancedBufferAttribute(uvArray, 4);
  const flashAttr = new THREE.InstancedBufferAttribute(flashArray, 1);
  const brightAttr = new THREE.InstancedBufferAttribute(brightArray, 1);

  uvAttr.setUsage(THREE.DynamicDrawUsage);
  flashAttr.setUsage(THREE.DynamicDrawUsage);
  brightAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute(uvAttrName, uvAttr);
  geometry.setAttribute(flashAttrName, flashAttr);
  geometry.setAttribute('aBrightness', brightAttr);

  return { uvArray, flashArray, brightArray, uvAttr, flashAttr, brightAttr };
}

function resolveGantryBeamY(gantry, gantryMap, groundAt, x, z, wayId) {
  const liveGantry = gantryMap?.get(gantry.id);
  const roadY = groundAt ? groundAt(x, z, wayId) : 0;
  const beam = (liveGantry && Number.isFinite(liveGantry.beam))
    ? liveGantry.beam
    : Number.isFinite(gantry.beamY)
      ? gantry.beamY
      : roadY + 6.0;
  // Hang cleanly beneath the lower truss chord (and beneath any exit sign resting on `beam`),
  // while respecting Rijkswaterstaat's 4.50 m minimum motorway clearance.
  const underChordY = beam - MSI_CHORD_GAP - MSI_HEIGHT * 0.5;
  const minClearanceY = roadY + RWS_MIN_CLEARANCE + MSI_HEIGHT * 0.5;
  return Math.max(underChordY, minClearanceY);
}

/**
 * Build batched WebGPU InstancedMesh pools for:
 *  1. Overhead A12 & A30 Matrix Sign Heads (`Signaalgevers`)
 *  2. Live VRI Traffic Light Poles, Cantilever Mast Arms (`galgmast`), Housings & LED Lenses
 *
 * All per-instance state buffers are pre-allocated once and updated in-place at `uploadHz` (default 15 Hz)
 * without reallocating GPU buffers or adding per-intersection draw calls.
 */
export function buildLiveSignalSystem(scene, controller, {
  gantries = [],
  groundAt = () => 0,
  includeVriHardware = true,
  uploadHz = DEFAULT_UPLOAD_HZ,
  canvasFactory,
} = {}) {
  const group = new THREE.Group();
  group.name = 'EdeLiveSignals';

  const signalUniforms = createLiveSignalUniforms();
  const msiAtlas = createMsiSignalAtlas({ canvasFactory });
  const vriAtlas = createVriSignalAtlas({ canvasFactory });

  const housingMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0x16191d,
    roughness: 0.62,
    metalness: 0.25,
  });
  const poleMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0x8d9398,
    roughness: 0.52,
    metalness: 0.45,
  });

  const msiLedMaterial = createMsiLedMaterial(msiAtlas.texture, signalUniforms);
  const vriLedMaterial = createVriLedMaterial(vriAtlas.texture, signalUniforms);

  const gantryMap = new Map((gantries ?? []).map(g => [g.id, g]));
  const dummy = new THREE.Object3D();

  // --- 1. Overhead A12 & A30 MSI Matrix Sign Heads ---
  const msiHeads = controller.msiHeads ?? [];
  const msiCount = msiHeads.length;
  let msiHousingMesh = null;
  let msiFaceMesh = null;
  let msiBuffers = null;

  if (msiCount > 0) {
    const msiHousingGeo = createMsiHousingGeometry();
    const msiFaceGeo = new THREE.PlaneGeometry(MSI_WIDTH * 0.92, MSI_HEIGHT * 0.92);
    msiBuffers = attachInstanceAttributes(msiFaceGeo, msiCount, 'aLegendUv', 'aFlasherMask');

    msiHousingMesh = new THREE.InstancedMesh(msiHousingGeo, housingMaterial, msiCount);
    msiHousingMesh.name = 'EdeMsiGantryHousings';
    msiHousingMesh.frustumCulled = false;

    msiFaceMesh = new THREE.InstancedMesh(msiFaceGeo, msiLedMaterial, msiCount);
    msiFaceMesh.name = 'EdeMsiGantryLedFaces';
    msiFaceMesh.frustumCulled = false;

    const gantryById = new Map((controller.msiGantries ?? []).map(g => [g.id, g]));
    const syntheticBeamMatrices = [];
    const syntheticLegMatrices = [];

    for (const gantry of controller.msiGantries ?? []) {
      if (!gantry.syntheticGantry || gantryMap.has(gantry.id) || !Array.isArray(gantry.span)) continue;
      const [[ax, az], [bx, bz]] = gantry.span;
      const dx = bx - ax, dz = bz - az;
      const spanLen = Math.hypot(dx, dz);
      if (spanLen < 4) continue;
      const [cx, cz] = gantry.center ?? [(ax + bx) * 0.5, (az + bz) * 0.5];
      const beamY = resolveGantryBeamY(gantry, gantryMap, groundAt, cx, cz, gantry.wayId) + MSI_CHORD_GAP + MSI_HEIGHT * 0.5;
      for (const [lx, lz] of [[ax, az], [bx, bz]]) {
        const gy = groundAt ? groundAt(lx, lz) : 0;
        const h = Math.max(1, beamY - gy);
        dummy.position.set(lx, gy + h * 0.5, lz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.32, h, 0.32);
        dummy.updateMatrix();
        syntheticLegMatrices.push(dummy.matrix.clone());
      }
      dummy.position.set((ax + bx) * 0.5, beamY, (az + bz) * 0.5);
      dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
      dummy.scale.set(spanLen + 0.32, 0.32, 0.32);
      dummy.updateMatrix();
      syntheticBeamMatrices.push(dummy.matrix.clone());
    }

    if (syntheticLegMatrices.length > 0 || syntheticBeamMatrices.length > 0) {
      const portalParts = [...syntheticLegMatrices, ...syntheticBeamMatrices];
      const portalMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), poleMaterial, portalParts.length);
      portalMesh.name = 'EdeSyntheticMsiPortals';
      portalMesh.frustumCulled = false;
      for (let i = 0; i < portalParts.length; i++) portalMesh.setMatrixAt(i, portalParts[i]);
      portalMesh.instanceMatrix.needsUpdate = true;
      group.add(portalMesh);
    }

    for (let i = 0; i < msiCount; i++) {
      const head = msiHeads[i];
      const gantry = gantryById.get(head.gantryId);
      const liveMount = gantryMap.get(head.gantryId);
      const fx = Math.sin(head.yaw);
      const fz = Math.cos(head.yaw);
      const roadY = groundAt ? groundAt(head.x, head.z, head.wayId) : 0;
      const minClearanceY = roadY + RWS_MIN_CLEARANCE + MSI_HEIGHT * 0.5;
      let y = gantry ? resolveGantryBeamY(gantry, gantryMap, groundAt, head.x, head.z, head.wayId) : (roadY + 5.3);

      // Clear any directional portal panels mounted on the same side of the gantry without dropping below 4.50 m.
      if (liveMount?.panels?.length) {
        for (const panel of liveMount.panels) {
          if (Math.sin(panel.angle) * fx + Math.cos(panel.angle) * fz < 0.7) continue;
          const lateral = (panel.x - head.x) * liveMount.ux + (panel.z - head.z) * liveMount.uz;
          const bottom = panel.y - panel.height * 0.5;
          if (Math.abs(lateral) <= panel.width * 0.5 + MSI_WIDTH * 0.5 &&
              y + MSI_HEIGHT * 0.5 > bottom - 0.10 && y - MSI_HEIGHT * 0.5 < panel.y + panel.height * 0.5) {
            y = Math.max(minClearanceY, bottom - MSI_HEIGHT * 0.5 - 0.12);
          }
        }
      }

      // Hang cleanly under the approaching-traffic lower chord with rear face clear of the truss.
      const halfDepth = liveMount?.halfDepth ?? 0.35;
      const sideOffset = liveMount
        ? halfDepth * Math.sign(fx * liveMount.uz - fz * liveMount.ux)
        : 0;
      const forwardFromChord = MSI_DEPTH * 0.5 + 0.04;
      const mx = liveMount
        ? head.x + liveMount.uz * sideOffset + fx * forwardFromChord
        : head.x + fx * (halfDepth + forwardFromChord);
      const mz = liveMount
        ? head.z - liveMount.ux * sideOffset + fz * forwardFromChord
        : head.z + fz * (halfDepth + forwardFromChord);

      dummy.position.set(mx, y, mz);
      dummy.rotation.set(0, head.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      msiHousingMesh.setMatrixAt(i, dummy.matrix);

      // LED face sits 18 mm in front of the housing front plane to avoid distant depth Z-fighting.
      dummy.position.set(mx + fx * 0.018, y, mz + fz * 0.018);
      dummy.updateMatrix();
      msiFaceMesh.setMatrixAt(i, dummy.matrix);

      const rect = head.uvRect ?? MSI_UV_RECTS.BLANK;
      msiBuffers.uvArray[i * 4] = rect[0];
      msiBuffers.uvArray[i * 4 + 1] = rect[1];
      msiBuffers.uvArray[i * 4 + 2] = rect[2];
      msiBuffers.uvArray[i * 4 + 3] = rect[3];
      msiBuffers.flashArray[i] = head.flasherMask ?? 0;
      msiBuffers.brightArray[i] = 1.0;
    }

    msiHousingMesh.instanceMatrix.needsUpdate = true;
    msiFaceMesh.instanceMatrix.needsUpdate = true;
    group.add(msiHousingMesh, msiFaceMesh);
  }

  // --- 2. Live VRI Traffic Light Poles, Cantilevers, Housings & Lenses ---
  const vriLensSlots = []; // { intersectionId, signalGroupId, lensRole: 'red'|'amber'|'green', kind, movement }
  const poleMatrices = [];
  const cantileverMatrices = [];
  const vriHousingMatrices = [];
  const vriLensMatrices = [];

  if (includeVriHardware) {
    const intersections = controller.vriIntersections ?? [];
    const lensOffsets = [
      { role: 'red', dy: 0.26 },
      { role: 'amber', dy: 0.0 },
      { role: 'green', dy: -0.26 },
    ];

    for (let i = 0; i < intersections.length; i++) {
      const inter = intersections[i];
      for (const sg of inter.signalGroups ?? []) {
        if (sg.kind !== 'motor' || !Array.isArray(sg.anchor)) continue;
        const [ax, az] = sg.anchor;
        const heading = Number.isFinite(sg.heading) ? sg.heading : 0;
        const fx = Math.sin(heading);
        const fz = Math.cos(heading);
        const rx = fz;
        const rz = -fx;
        const ground = groundAt(ax, az);

        // Snap roadside pole to verge / traffic-island edge right before stop line.
        const px = ax + rx * 2.1;
        const pz = az + rz * 2.1;
        const isCantilever = sg.mount === 'overhead' || (sg.headCount ?? 1) >= 2;

        if (isCantilever) {
          // Overhead cantilever mast arm (`galgmast`, ~5.5 m clearance) + dual overhead 3-aspect heads.
          dummy.position.set(px, ground + VRI_CANTILEVER_HEIGHT * 0.5, pz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.22, VRI_CANTILEVER_HEIGHT, 0.22);
          dummy.updateMatrix();
          poleMatrices.push(dummy.matrix.clone());

          const armLen = 5.4;
          dummy.position.set(px - rx * (armLen * 0.5), ground + VRI_CANTILEVER_HEIGHT, pz - rz * (armLen * 0.5));
          dummy.rotation.set(0, Math.atan2(-rz, rx), 0);
          dummy.scale.set(armLen, 0.18, 0.18);
          dummy.updateMatrix();
          cantileverMatrices.push(dummy.matrix.clone());

          for (const lateral of [1.8, 4.4]) {
            const hx = px - rx * lateral;
            const hz = pz - rz * lateral;
            const hy = ground + VRI_CANTILEVER_HEIGHT - 0.52;
            dummy.position.set(hx, hy, hz);
            dummy.rotation.set(0, heading, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            vriHousingMatrices.push(dummy.matrix.clone());

            for (const { role, dy } of lensOffsets) {
              dummy.position.set(hx + fx * 0.005, hy + dy, hz + fz * 0.005);
              dummy.rotation.set(0, heading, 0);
              dummy.scale.set(1, 1, 1);
              dummy.updateMatrix();
              vriLensMatrices.push(dummy.matrix.clone());
              vriLensSlots.push({
                intersectionId: inter.id,
                signalGroupId: sg.signalGroupId,
                lensRole: role,
                kind: sg.kind,
                movement: sg.movement ?? 'all',
              });
            }
          }
        }

        // Standard vertical roadside pole (3.2 m height) + low-level repeater head.
        dummy.position.set(px, ground + VRI_POLE_HEIGHT * 0.5, pz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.11, VRI_POLE_HEIGHT, 0.11);
        dummy.updateMatrix();
        poleMatrices.push(dummy.matrix.clone());

        for (const [hy, scale] of [[ground + VRI_POLE_HEIGHT - 0.45, 1.0], [ground + 1.65, 0.58]]) {
          dummy.position.set(px, hy, pz);
          dummy.rotation.set(0, heading, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          vriHousingMatrices.push(dummy.matrix.clone());

          for (const { role, dy } of lensOffsets) {
            dummy.position.set(px + fx * 0.005 * scale, hy + dy * scale, pz + fz * 0.005 * scale);
            dummy.rotation.set(0, heading, 0);
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            vriLensMatrices.push(dummy.matrix.clone());
            vriLensSlots.push({
              intersectionId: inter.id,
              signalGroupId: sg.signalGroupId,
              lensRole: role,
              kind: sg.kind,
              movement: sg.movement ?? 'all',
            });
          }
        }
      }
    }
  }

  let vriPoleMesh = null;
  let vriArmMesh = null;
  let vriHousingMesh = null;
  let vriLensMesh = null;
  let vriBuffers = null;

  if (poleMatrices.length > 0) {
    vriPoleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), poleMaterial, poleMatrices.length);
    vriPoleMesh.name = 'EdeLiveVriPoles';
    vriPoleMesh.frustumCulled = false;
    for (let i = 0; i < poleMatrices.length; i++) vriPoleMesh.setMatrixAt(i, poleMatrices[i]);
    vriPoleMesh.instanceMatrix.needsUpdate = true;
    group.add(vriPoleMesh);
  }
  if (cantileverMatrices.length > 0) {
    vriArmMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), poleMaterial, cantileverMatrices.length);
    vriArmMesh.name = 'EdeLiveVriCantilevers';
    vriArmMesh.frustumCulled = false;
    for (let i = 0; i < cantileverMatrices.length; i++) vriArmMesh.setMatrixAt(i, cantileverMatrices[i]);
    vriArmMesh.instanceMatrix.needsUpdate = true;
    group.add(vriArmMesh);
  }
  if (vriHousingMatrices.length > 0) {
    vriHousingMesh = new THREE.InstancedMesh(createVriHeadHousingGeometry(), housingMaterial, vriHousingMatrices.length);
    vriHousingMesh.name = 'EdeLiveVriHousings';
    vriHousingMesh.frustumCulled = false;
    for (let i = 0; i < vriHousingMatrices.length; i++) vriHousingMesh.setMatrixAt(i, vriHousingMatrices[i]);
    vriHousingMesh.instanceMatrix.needsUpdate = true;
    group.add(vriHousingMesh);
  }
  if (vriLensMatrices.length > 0) {
    const vriLensGeo = new THREE.PlaneGeometry(0.21, 0.21);
    vriBuffers = attachInstanceAttributes(vriLensGeo, vriLensMatrices.length, 'aAspectUv', 'aFlashMask');
    vriLensMesh = new THREE.InstancedMesh(vriLensGeo, vriLedMaterial, vriLensMatrices.length);
    vriLensMesh.name = 'EdeLiveVriLedLenses';
    vriLensMesh.frustumCulled = false;
    for (let i = 0; i < vriLensMatrices.length; i++) {
      vriLensMesh.setMatrixAt(i, vriLensMatrices[i]);
      const rect = VRI_UV_RECTS.DARK;
      vriBuffers.uvArray[i * 4] = rect[0];
      vriBuffers.uvArray[i * 4 + 1] = rect[1];
      vriBuffers.uvArray[i * 4 + 2] = rect[2];
      vriBuffers.uvArray[i * 4 + 3] = rect[3];
    }
    vriLensMesh.instanceMatrix.needsUpdate = true;
    group.add(vriLensMesh);
  }

  scene?.add(group);

  const uploadInterval = 1 / Math.max(10, Math.min(20, uploadHz));
  let uploadAccumulator = uploadInterval; // Force initial sync on first update.
  let syncCount = 0;

  function syncBuffersInPlace() {
    if (msiBuffers) {
      const { uvArray, flashArray, brightArray, uvAttr, flashAttr, brightAttr } = msiBuffers;
      for (let i = 0; i < msiCount; i++) {
        const head = msiHeads[i];
        const rect = head.uvRect ?? MSI_UV_RECTS.BLANK;
        const base = i * 4;
        uvArray[base] = rect[0];
        uvArray[base + 1] = rect[1];
        uvArray[base + 2] = rect[2];
        uvArray[base + 3] = rect[3];
        flashArray[i] = head.flasherMask ?? 0;
        brightArray[i] = head.legend === 'BLANK' ? 0.0 : 1.0;
      }
      uvAttr.needsUpdate = true;
      flashAttr.needsUpdate = true;
      brightAttr.needsUpdate = true;
    }

    if (vriBuffers) {
      const { uvArray, flashArray, brightArray, uvAttr, flashAttr, brightAttr } = vriBuffers;
      for (let i = 0; i < vriLensSlots.length; i++) {
        const slot = vriLensSlots[i];
        const sgState = controller.getVriGroupState(slot.intersectionId, slot.signalGroupId);
        const state = sgState?.state ?? SPAT_STATES.DARK;

        let active = false;
        let flashing = 0;
        if (slot.lensRole === 'red') {
          active = state === SPAT_STATES.STOP_AND_REMAIN;
        } else if (slot.lensRole === 'amber') {
          active = isAmberSpatState(state) || state === SPAT_STATES.FLASHING_AMBER;
          flashing = state === SPAT_STATES.FLASHING_AMBER ? 1 : 0;
        } else if (slot.lensRole === 'green') {
          active = isGreenSpatState(state);
        }

        const rect = active ? (sgState?.uvRect ?? VRI_UV_RECTS.DARK) : VRI_UV_RECTS.DARK;
        const base = i * 4;
        uvArray[base] = rect[0];
        uvArray[base + 1] = rect[1];
        uvArray[base + 2] = rect[2];
        uvArray[base + 3] = rect[3];
        flashArray[i] = flashing;
        brightArray[i] = active ? 1.0 : 0.0;
      }
      uvAttr.needsUpdate = true;
      flashAttr.needsUpdate = true;
      brightAttr.needsUpdate = true;
    }

    syncCount++;
  }

  function update(dt, simTimeSeconds, wallNowMs = Date.now(), {
    sunElevationY = 0.45,
    nightFactor = 0,
    localHour = null,
    trafficDemand = 0.7,
    speedRestrictions = null,
  } = {}) {
    updateLiveSignalUniforms(signalUniforms, simTimeSeconds, sunElevationY);
    uploadAccumulator += dt;
    if (uploadAccumulator >= uploadInterval) {
      uploadAccumulator = 0;
      controller.update(simTimeSeconds, wallNowMs, { nightFactor, localHour, trafficDemand, speedRestrictions });
      syncBuffersInPlace();
    }
  }

  function dispose() {
    msiAtlas.dispose();
    vriAtlas.dispose();
    msiLedMaterial.dispose();
    vriLedMaterial.dispose();
    housingMaterial.dispose();
    poleMaterial.dispose();
    for (const mesh of [msiHousingMesh, msiFaceMesh, vriPoleMesh, vriArmMesh, vriHousingMesh, vriLensMesh]) {
      mesh?.geometry?.dispose();
    }
    group.removeFromParent();
  }

  return {
    group,
    signalUniforms,
    msiHousingMesh,
    msiFaceMesh,
    vriPoleMesh,
    vriArmMesh,
    vriHousingMesh,
    vriLensMesh,
    msiBuffers,
    vriBuffers,
    syncBuffersInPlace,
    update,
    dispose,
    get stats() {
      return {
        msiInstances: msiCount,
        vriPoles: poleMatrices.length,
        vriCantilevers: cantileverMatrices.length,
        vriHousings: vriHousingMatrices.length,
        vriLenses: vriLensMatrices.length,
        syncCount,
      };
    },
  };
}
