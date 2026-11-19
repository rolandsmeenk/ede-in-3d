import * as THREE from 'three/webgpu';
import { buildingPassageSideSpans, getEdeGrade, getEdeBuildingPassages, getRailCorridors, gradeDeckAt, gradeSections, RAIL_BALLAST_TOP, RAIL_BALLAST_WIDTH } from './ede-grade.js';
import { terrainHeightAt } from './terrain.js';
import { sampleGroundColor } from './aerial-colors.js';
import { addAsphaltLanes } from './ede-asphalt-lanes.js';
import { EDE_PAVING_STYLE, gradePavement, osmRoadMaterial } from './ede-road-surfaces.js';
import { createEdePavingMaterial, createRoadSurfaceMaterial } from './tsl-materials.js';

const CELL = 160;

export function buildEdeGradeWorld(scene) {
  const group = new THREE.Group();
  group.name = 'EdeGradeWorld';
  scene.add(group);
  const { sites, railHeights } = getEdeGrade();
  const colliders = [];
  const batches = new Map();
  const material = (color, extra) => new THREE.MeshStandardNodeMaterial({
    color, roughness: 0.86, side: THREE.DoubleSide, ...extra
  });
  const road = material(0xffffff, { vertexColors: true });
  const bike = material(0xffffff, { vertexColors: true });
  const foot = material(0xffffff, { vertexColors: true });
  const mappedAsphalt = createRoadSurfaceMaterial(true, true, true);
  const mappedPaving = createEdePavingMaterial(true, true);
  mappedAsphalt.side = mappedPaving.side = THREE.DoubleSide;
  mappedAsphalt.name = 'Ede fitted asphalt';
  mappedPaving.name = 'Ede fitted paving';
  const bank = material(0x8d8e86);
  const ballast = material(0x6c6054);
  const roof = material(0x9b9d96);
  const asphaltTint = new THREE.Color(0x4c4e4b);
  const cycleTint = new THREE.Color(0x8f534c);
  const footTint = new THREE.Color(0x8a8680);

  function batch(mat, x, z, trackLayer) {
    const key = `${mat.id}/${Math.floor(x / CELL)}/${Math.floor(z / CELL)}/${trackLayer ?? ''}`;
    if (!batches.has(key)) batches.set(key, { mat, trackLayer, positions: [], colors: [], exposure: [], uv: [], styles: [] });
    return batches.get(key);
  }

  function quad(mat, vertices, tint, exposed = false, paving, trackLayer) {
    const { positions, colors, exposure, uv, styles } = batch(mat, vertices[0].x, vertices[0].z, trackLayer);
    const sample = [0, 0, 0];
    const cs = Math.cos(paving?.angle ?? 0), sn = Math.sin(paving?.angle ?? 0);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const { x, y, z } = vertices[i];
      positions.push(x, y, z);
      if (!tint) continue;
      if (exposed && sampleGroundColor(x, z, sample)) {
        colors.push(tint.r * 0.6 + sample[0] * 0.4, tint.g * 0.6 + sample[1] * 0.4, tint.b * 0.6 + sample[2] * 0.4);
      } else colors.push(tint.r, tint.g, tint.b);
      if (!paving) continue;
      colors.push(1);
      exposure.push(Number(exposed));
      if (mat === mappedPaving) {
        uv.push(x * cs + z * sn, z * cs - x * sn);
        styles.push(EDE_PAVING_STYLE[paving.material]);
      }
    }
  }

  const height = (p, y) => ({ x: p.x, z: p.z, y });
  function strip(section, material, offset, tint, exposed, paving, trackLayer) {
    const { a, b } = section;
    const points = [a.left, a.right, b.right, b.left].map(p => height(p, p.y + offset));
    quad(material, points, tint, exposed, paving, trackLayer);
  }

  function lineCollider(a, b, minY, maxY, halfWidth = 0.16) {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.1 || maxY <= minY) return;
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const cs = (b.x - a.x) / length, sn = -(b.z - a.z) / length;
    const hx = length / 2 + 0.02, hz = halfWidth;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY,
      obb: { cx, cz, hx, hz, cs, sn } });
  }

  function sideWall(a, b, aTop, bTop) {
    quad(bank, [a, b, height(b, bTop), height(a, aTop)]);
    lineCollider(a, b, Math.min(a.y, b.y) - 0.1, Math.max(aTop, bTop));
  }

  function addUnderpass(site) {
    if (site.surfacesOnly) return; // Adjacent profiles share one opening beneath the fitted deck.
    const profiles = site.excavation ? [site.excavation] : site.profiles;
    for (const profile of profiles) {
      const clearance = profile.clearance || site.clearance || 3;
      const sections = gradeSections(profile);
      for (const [i, section] of sections.entries()) {
        const { a, b, covered } = section;
        if (site.excavation) strip(section, road, -0.02, asphaltTint);
        const top = p => {
          const roofY = covered ? p.y + clearance : Math.max(p.y + 0.28, terrainHeightAt(p.x, p.z) + 0.22);
          const deckY = gradeDeckAt(p.x, p.z);
          return deckY !== undefined && deckY > p.y + 0.7 ? Math.min(roofY, deckY - 0.25) : roofY;
        };
        for (const side of ['left', 'right']) {
          const p = a[side], q = b[side];
          if (covered || Math.max(terrainHeightAt(p.x, p.z) - p.y, terrainHeightAt(q.x, q.z) - q.y) > 0.4) {
            sideWall(p, q, top(p), top(q));
          }
        }
        if (!covered) continue;
        strip(section, roof, clearance);
        for (const [edge, adjacent] of [[a, sections[i - 1]], [b, sections[i + 1]]]) {
          if (adjacent?.covered) continue;
          const roofY = edge.y + clearance;
          const topLeft = Math.max(roofY + 0.35, terrainHeightAt(edge.left.x, edge.left.z) + 0.06);
          const topRight = Math.max(roofY + 0.35, terrainHeightAt(edge.right.x, edge.right.z) + 0.06);
          quad(bank, [height(edge.left, roofY), height(edge.right, roofY),
            height(edge.right, topRight), height(edge.left, topLeft)]);
        }
      }
    }
  }

  for (const { sections } of getEdeBuildingPassages().values()) {
    for (const section of sections) {
      const { a, b, id, minX, maxX, minZ, maxZ, clearance, roofAt } = section;
      quad(roof, [a.left, a.right, b.right, b.left].map(p => height(p, roofAt(p.x, p.z))));
      for (const side of ['left', 'right']) {
        for (const [p, q] of buildingPassageSideSpans(a[side], b[side], id)) {
          sideWall(height(p, terrainHeightAt(p.x, p.z) - 0.08), height(q, terrainHeightAt(q.x, q.z) - 0.08),
            roofAt(p.x, p.z), roofAt(q.x, q.z));
        }
      }
      colliders.push({ minX, maxX, minZ, maxZ, minY: Math.min(a.y, b.y) + clearance,
        maxY: Math.max(a.y, b.y) + clearance + 0.35, minYAt: roofAt, kind: 'passage-roof',
        polygon: { outer: [a.left, a.right, b.right, b.left], holes: [] } });
    }
  }

  function addRailCut(profile) {
    for (const section of gradeSections(profile)) {
      const { a, b } = section;
      strip(section, bank, -0.025);
      for (const side of ['left', 'right']) {
        const top = p => Math.max(p.y, terrainHeightAt(p.x, p.z));
        sideWall(a[side], b[side], top(a[side]), top(b[side]));
      }
    }
  }

  function connectEdges(section, material, lift, fillOnly = false) {
    for (const side of ['left', 'right']) {
      const a = section.a[side], b = section.b[side];
      const topA = a.y + lift, topB = b.y + lift;
      const groundA = terrainHeightAt(a.x, a.z) - 0.025;
      const groundB = terrainHeightAt(b.x, b.z) - 0.025;
      const bottomA = fillOnly ? Math.min(topA, groundA) : groundA;
      const bottomB = fillOnly ? Math.min(topB, groundB) : groundB;
      if (Math.max(Math.abs(topA - bottomA), Math.abs(topB - bottomB)) < 0.04) continue;
      quad(material, [height(a, topA), height(b, topB), height(b, bottomB), height(a, bottomA)]);
    }
  }

  function addBridgeSide(a, b, fill, side) {
    const baseA = height(a, fill ? terrainHeightAt(a.x, a.z) - 0.15 : a.y - 0.62);
    const baseB = height(b, fill ? terrainHeightAt(b.x, b.z) - 0.15 : b.y - 0.62);
    quad(bank, [baseA, baseB, height(b, b.y + 0.68), height(a, a.y + 0.68)]);
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.1) return;
    // The inside face follows the surveyed deck edge, even on narrow cycle bridges.
    const halfWidth = 0.16;
    const shift = point => ({ x: point.x - dz * side * halfWidth / length,
      z: point.z + dx * side * halfWidth / length });
    lineCollider(shift(a), shift(b), Math.min(baseA.y, baseB.y), Math.max(a.y, b.y) + 0.68, halfWidth);
  }

  const railCorridors = getRailCorridors();
  for (const { bridge, sections } of railCorridors.values()) {
    if (bridge) continue;
    for (const section of sections) connectEdges(section, ballast, RAIL_BALLAST_TOP);
  }
  for (const profile of railHeights || []) {
    if (!profile.fittedBallast || railCorridors.has(profile.wayId)) continue;
    for (const section of gradeSections({ ...profile, width: RAIL_BALLAST_WIDTH })) {
      connectEdges(section, ballast, RAIL_BALLAST_TOP, true);
    }
  }

  let mappedGradeSections = 0, fallbackGradeSections = 0;
  const gradeMaterials = {};
  for (const site of sites) {
    if (site.kind === 'surface') continue; // Local corrections are drawn in the original pavement batch.
    if (site.kind === 'underpass') addUnderpass(site);
    if (site.kind === 'bridge' && site.excavation) addRailCut(site.excavation);
    for (const profile of site.profiles || []) {
      const motor = profile.modes.includes('motor'), cycling = profile.modes.includes('bike');
      const mat = motor ? road : cycling ? bike : foot;
      const tint = motor ? asphaltTint : cycling ? cycleTint : footTint;
      const levelMaterial = site.kind === 'level' && osmRoadMaterial(profile);
      for (const section of gradeSections(profile)) {
        const { a, b } = section;
        const midpoint = (a.distance + b.distance) / 2;
        let gradeLayer = 0;
        if (site.kind === 'bridge') {
          if (midpoint >= profile.span?.[0] && midpoint <= profile.span?.[1]) gradeLayer = 1;
        } else {
          const ground = terrainHeightAt((a.x + b.x) / 2, (a.z + b.z) / 2);
          if (section.covered || (a.y + b.y) / 2 < ground - 0.6) gradeLayer = -1;
        }
        const paving = levelMaterial
          ? { material: levelMaterial, angle: Math.atan2(b.z - a.z, b.x - a.x) }
          : gradeLayer && gradePavement(section, gradeLayer, motor ? 'motor' : cycling ? 'cycle' : 'foot');
        if (paving) {
          const asphalt = paving.material === 'asphalt';
          strip(section, asphalt ? mappedAsphalt : mappedPaving, 0.055, tint, !section.covered, paving,
            asphalt && motor ? gradeLayer : undefined);
          mappedGradeSections++;
          gradeMaterials[paving.material] = (gradeMaterials[paving.material] ?? 0) + 1;
        } else {
          strip(section, mat, 0.055, tint, !section.covered);
          if (gradeLayer) fallbackGradeSections++;
        }
        if (site.kind === 'level') connectEdges(section, bank, 0.055);
        if (site.kind !== 'bridge') continue;
        if (Math.min(a.y - terrainHeightAt(a.x, a.z), b.y - terrainHeightAt(b.x, b.z)) < 0.75) continue;
        const onSpan = midpoint >= profile.span?.[0] && midpoint <= profile.span?.[1];
        const fill = profile.fillApproaches && !onSpan;
        if (!fill) strip(section, bank, -0.61);
        if (!onSpan && !fill) continue;
        addBridgeSide(a.left, b.left, fill, -1);
        addBridgeSide(a.right, b.right, fill, 1);
      }
    }
  }
  const pipelines = new Map();
  for (const { mat, positions, colors, exposure, uv, styles, trackLayer } of batches.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (colors.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, exposure.length ? 4 : 3));
    if (exposure.length) geometry.setAttribute('pavingExposure', new THREE.Float32BufferAttribute(exposure, 1));
    if (styles.length) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.setAttribute('pavingStyle', new THREE.Float32BufferAttribute(styles, 1));
    }
    geometry.computeVertexNormals();
    if (mat === mappedAsphalt) addAsphaltLanes(geometry, undefined, trackLayer);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = mat === bank || mat === roof;
    if (mesh.castShadow) mesh.userData.shadowStandIn = true;
    if (exposure.length) {
      if (pipelines.has(mat)) mesh.userData.sharesPipelineWith = pipelines.get(mat);
      else pipelines.set(mat, mesh);
    }
    group.add(mesh);
  }
  group.userData = { sites: sites.length, colliders: colliders.length, batches: batches.size,
    mappedGradeSections, fallbackGradeSections, gradeMaterials };
  return { group, colliders };
}
