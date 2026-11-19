import * as THREE from 'three/webgpu';
import { color, mix, texture } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ISLAND_BOUNDS, blockAt, EDE_DATA, nearestRoads, pointInPoly, waterAt } from './city-config.js';
import {
  createRoadSurfaceMaterial,
  createEdePavingMaterial,
  createSidewalkMaterial,
  createCurbMaterial,
  createWaterMaterial,
  createParkLawnMaterial,
  createEdeGroundMaterial,
  createParkPavingMaterial
} from './tsl-materials.js';
import { LANDMARK_EXCLUSIONS, BERGHAIN_TREE_SITES } from './landmarks.js';
import { edePoints, edeBounds, edePolygonGeometry, edeStrip, edeRailStrip, edeRoadSegments, edeGeometryGroups, edeTerrainGeometries, drapeEdeSurface, drapeEdeVertices } from './ede-geometry.js';
import { getTerrain, terrainHeightAt } from './terrain.js';
import { getRailCorridors, gradeCuts, gradeWayAt, railHeightAt, RAIL_BALLAST_TOP, RAIL_BALLAST_WIDTH, RAIL_SLEEPER_SPACING, RAIL_TOP } from './ede-grade.js';
import { edeTreeSite } from './ede-tree-data.js';
import { getAerialColors, sampleGroundColor, sampleRoadColor } from './aerial-colors.js';
import { EDE_PAVING_STYLE, getEdeRoadSurfaces, hasEdeMappedSurface, osmRoadMaterial } from './ede-road-surfaces.js';

// Live construction data consumed by the building and street-detail builders after buildCityGrid().
let centralParkClearings;
let parkTreeSites;
let parkLampSites;
let pavedPlazaRects;
let sidewalkBlocks;
let edeStreetSites = [];

function setAerialSurfaceColors(geometry, segment, asphalt) {
  const position = geometry.getAttribute('position');
  const colors = new Uint8Array(position.count * 4);
  const sample = [0, 0, 0];
  const hasRoadColor = segment && sampleRoadColor(segment.road.id, segment.segmentIndex, sample);
  for (let i = 0; i < position.count; i++) {
    if (!(segment ? hasRoadColor : sampleGroundColor(position.getX(i), position.getZ(i), sample))) continue;
    // Suppress green reflected from trees while retaining red cycleway paving.
    if (asphalt) sample[1] = Math.min(sample[1], Math.max(sample[0], sample[2]) * 1.2);
    const offset = i * 4;
    colors[offset] = Math.round(sample[0] * 255);
    colors[offset + 1] = Math.round(sample[1] * 255);
    colors[offset + 2] = Math.round(sample[2] * 255);
    colors[offset + 3] = 255;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
}

function buildCityGrid(scene, treeInventory, landCover) {
  const group = new THREE.Group();
  group.name = 'EdeCityGrid';
  const terrain = getTerrain();
  const aerial = !!getAerialColors();
  const roadMat = createRoadSurfaceMaterial(aerial);
  roadMat.name = 'Ede asphalt';
  const sidewalkMat = createSidewalkMaterial(aerial ? 0.4 : 0);
  const terrainMat = terrain && landCover ? createEdeGroundMaterial(aerial, landCover)
    : aerial && terrain ? createSidewalkMaterial(0.85) : sidewalkMat;
  const curbMat = createCurbMaterial();
  const waterMat = createWaterMaterial();
  const lawnMat = createParkLawnMaterial(false, aerial, landCover);
  const pavingMat = createParkPavingMaterial(aerial);
  const mappedPavingMat = createEdePavingMaterial(aerial);
  const aerialMaterials = new Set([roadMat, terrainMat, sidewalkMat, lawnMat, pavingMat, mappedPavingMat]);
  const polygon = (ring, holes, y, wayId) => drapeEdeSurface(edePolygonGeometry(ring, holes, y), true, wayId);
  const strip = (a, b, half, y, offset, wayId) => drapeEdeSurface(edeStrip(a, b, half, y, offset), true, wayId);
  const collections = new Map();
  const collect = (geometry, material, segment) => {
    if (!geometry?.getAttribute('position')?.count) return;
    if (aerial && aerialMaterials.has(material)) setAerialSurfaceColors(geometry, segment, material === roadMat);
    if (!collections.has(material)) collections.set(material, []);
    collections.get(material).push(geometry);
  };
  function collectPaving(geometry, material, angle, segment) {
    if (material === 'asphalt') {
      collect(geometry, roadMat, segment);
      return;
    }
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    const styles = new Float32Array(position.count).fill(EDE_PAVING_STYLE[material]);
    const cs = Math.cos(angle), sn = Math.sin(angle);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      uv.setXY(i, x * cs + z * sn, z * cs - x * sn);
    }
    geometry.setAttribute('pavingStyle', new THREE.BufferAttribute(styles, 1));
    collect(geometry, mappedPavingMat, segment);
  }
  const footprints = [], sidewalks = [], colliders = [];
  parkTreeSites = []; parkLampSites = []; pavedPlazaRects = []; sidewalkBlocks = [];
  centralParkClearings = null; edeStreetSites = [];

  const water = (EDE_DATA.water || []).filter(w => w.ring?.length >= 6);
  if (terrain) {
    for (const geometry of edeTerrainGeometries(-0.025)) collect(geometry, terrainMat);
    for (const feature of water) {
      collect(polygon(edePoints(feature.ring), (feature.holes || []).map(edePoints), 0.005), waterMat);
    }
  } else {
    const waterY = ISLAND_BOUNDS.waterLevel;
    const bankTop = 0.19, bankBottom = waterY - 0.03;
    const land = [{ x: -16000, z: -16000 }, { x: 16000, z: -16000 }, { x: 16000, z: 16000 }, { x: -16000, z: 16000 }];
    collect(edePolygonGeometry(land, water.map(w => edePoints(w.ring)), -0.025), sidewalkMat);
    for (const feature of water) {
      const ring = edePoints(feature.ring), holes = (feature.holes || []).map(edePoints);
      collect(edePolygonGeometry(ring, holes, waterY), waterMat);
      for (const hole of holes) collect(edePolygonGeometry(hole, [], -0.025), sidewalkMat);
      for (const edge of [ring, ...holes]) for (let i = 0; i < edge.length; i++) {
        const a = edge[i], b = edge[(i + 1) % edge.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.4) continue;
        const wall = new THREE.BoxGeometry(len + 0.05, bankTop - bankBottom, 0.38);
        wall.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
        wall.translate((a.x + b.x) / 2, (bankTop + bankBottom) / 2, (a.z + b.z) / 2);
        collect(wall, curbMat);
      }
    }
  }
  for (const park of [...(EDE_DATA.parks || []), ...(EDE_DATA.squares || [])]) {
    if (!park.ring || park.ring.length < 6) continue;
    const ring = edePoints(park.ring), holes = (park.holes || []).map(edePoints);
    const paved = ['square', 'pedestrian', 'plaza'].includes(park.kind);
    const geometry = polygon(ring, holes, paved ? 0.05 : 0.045);
    if (paved) setPavingStyle(geometry, 2);
    collect(geometry, paved ? pavingMat : lawnMat);
    if (paved) pavedPlazaRects.push(edeBounds(ring));
  }

  // Tempelhofer Feld retains the former airport's mapped runway and apron
  // surfaces. These are park ground geometry, not new traffic corridors.
  for (const feature of EDE_DATA.aeroways || []) {
    if (feature.ring?.length >= 6) {
      collect(polygon(edePoints(feature.ring), (feature.holes || []).map(edePoints), 0.065), roadMat);
    } else if (feature.pts?.length >= 4) {
      const points = edePoints(feature.pts);
      const halfWidth = Math.max(2, feature.width || (feature.kind === 'runway' ? 45 : 15)) / 2;
      for (let i = 1; i < points.length; i++) collect(strip(points[i - 1], points[i], halfWidth, 0.065), roadMat);
    }
  }

  let mappedPavingCount = 0;
  for (const { layer, material, angle, polygons } of getEdeRoadSurfaces().surfaces) {
    if (layer !== 0) continue;
    for (const [outer, ...holes] of polygons) {
      const geometry = drapeEdeSurface(edePolygonGeometry(edePoints(outer), holes.map(edePoints), 0.065), true, undefined, true);
      collectPaving(geometry, material, angle);
      mappedPavingCount++;
    }
  }

  const roadSegments = edeRoadSegments();
  const carriagewayKinds = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'service', 'living_street']);
  const curbedKinds = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
    'tertiary', 'tertiary_link', 'residential', 'unclassified']);
  const isSharedSurface = s => s.road.kind === 'living_street' || (s.road.kind === 'service' && /platz/i.test(s.road.name || ''));
  const isCarriageway = s => carriagewayKinds.has(s.road.kind) && !isSharedSurface(s);
  const indexCell = 48;
  const pavementIndex = new Map();
  const pavementBySegment = new Map();
  const sameGrade = (a, b) => a.bridge === b.bridge && (a.road.layer ?? 0) === (b.road.layer ?? 0);
  function* pavementCells({ minX, maxX, minZ, maxZ }, pad = 0) {
    for (let x = Math.floor((minX - pad) / indexCell); x <= Math.floor((maxX + pad) / indexCell); x++) {
      for (let z = Math.floor((minZ - pad) / indexCell); z <= Math.floor((maxZ + pad) / indexCell); z++) yield `${x}/${z}`;
    }
  }

  function addPavement(segment, kind, half, offset = 0) {
    const { a, b, ux, uz, len, road } = segment;
    const nx = -uz, nz = ux;
    const ring = [
      { x: a.x + nx * (offset - half), z: a.z + nz * (offset - half) },
      { x: b.x + nx * (offset - half), z: b.z + nz * (offset - half) },
      { x: b.x + nx * (offset + half), z: b.z + nz * (offset + half) },
      { x: a.x + nx * (offset + half), z: a.z + nz * (offset + half) }
    ];
    // Four half-planes of this rectangle, with the inside on the positive side.
    const along = a.x * ux + a.z * uz, across = a.x * nx + a.z * nz + offset;
    const planes = [[ux, uz, along], [-ux, -uz, -along - len],
      [nx, nz, across - half], [-nx, -nz, -across - half]];
    const bounds = edeBounds(ring);
    const priority = kind === 'path' ? Number(road.kind === 'cycleway') : segment.width;
    const pavement = { segment, kind, ring, planes, bounds, priority };
    for (const key of pavementCells(bounds)) {
      if (!pavementIndex.has(key)) pavementIndex.set(key, new Set());
      pavementIndex.get(key).add(pavement);
    }
    return pavement;
  }

  for (const [order, segment] of roadSegments.entries()) {
    const { width, road } = segment;
    const carriageway = isCarriageway(segment);
    const surfaces = [carriageway
      ? addPavement(segment, 'road', width / 2)
      : addPavement(segment, 'path', Math.max(0.75, width / 2))];
    if (carriageway && curbedKinds.has(road.kind)) {
      for (const side of [-1, 1]) surfaces.push(addPavement(segment, 'sidewalk', 1.4, side * (width / 2 + 1.4)));
    }
    for (const surface of surfaces) surface.order = order;
    pavementBySegment.set(segment, surfaces);
  }

  function nearbyPavement(bounds, pad = 0) {
    const found = new Set();
    for (const key of pavementCells(bounds, pad)) {
      for (const surface of pavementIndex.get(key) || []) {
        const b = surface.bounds;
        if (b.maxX + pad < bounds.minX || b.minX - pad > bounds.maxX
            || b.maxZ + pad < bounds.minZ || b.minZ - pad > bounds.maxZ) continue;
        found.add(surface);
      }
    }
    return found;
  }

  const polygonArea = pts => Math.abs(pts.reduce((sum, a, i) => {
    const b = pts[(i + 1) % pts.length];
    return sum + a.x * b.z - b.x * a.z;
  }, 0)) * 0.5;

  function visiblePavement(surface) {
    let fragments = [surface.ring];
    for (const other of nearbyPavement(surface.bounds, 0.03)) {
      if (other.segment === surface.segment || !sameGrade(surface.segment, other.segment)) continue;
      const roadAbove = surface.kind !== 'road' && other.kind === 'road';
      // Prefer wider roads and cycle paths at junctions. Input order breaks ties.
      const overlapsPeer = surface.kind === other.kind && (other.priority > surface.priority
        || (other.priority === surface.priority && other.order < surface.order));
      if (!roadAbove && !overlapsPeer) continue;
      const pad = roadAbove ? 0.03 : 0;
      const minArea = roadAbove ? 0.015 : 0.00001;
      const outside = [];
      for (let fragment of fragments) {
        let intersection = fragment;
        for (const [nx, nz, c] of other.planes) {
          intersection = clipPolygonHalfPlane(intersection, nx, nz, c - pad);
          if (intersection.length < 3) break;
        }
        // An unrelated rectangle's infinite planes should never split another surface.
        if (intersection.length < 3 || polygonArea(intersection) < minArea) { outside.push(fragment); continue; }
        for (const [nx, nz, c] of other.planes) {
          const piece = clipPolygonHalfPlane(fragment, -nx, -nz, pad - c);
          if (piece.length >= 3 && polygonArea(piece) > minArea) outside.push(piece);
          fragment = clipPolygonHalfPlane(fragment, nx, nz, c - pad);
          if (fragment.length < 3) break;
        }
      }
      fragments = outside;
      if (!fragments.length) break;
    }
    return fragments;
  }

  // Clip a curb's centreline out of every other carriageway. Unlike a fixed
  // inset per OSM segment, this opens actual junctions and preserves continuous
  // curb runs along simple bends and arbitrarily split street centre lines.
  const curbIntervals = (a, b, source, roads) => {
    let intervals = [[0, 1]];
    const dx = b.x - a.x, dz = b.z - a.z;
    for (const { segment, kind, planes } of roads) {
      if (kind !== 'road' || segment === source || !sameGrade(segment, source)) continue;
      let lo = 0, hi = 1;
      for (const [nx, nz, c] of planes) {
        const start = nx * a.x + nz * a.z - c + 0.24, rate = nx * dx + nz * dz;
        if (Math.abs(rate) < 1e-9) { if (start < 0) { lo = 1; hi = 0; break; } }
        else if (rate > 0) lo = Math.max(lo, -start / rate);
        else hi = Math.min(hi, -start / rate);
      }
      if (lo >= hi || hi <= 0 || lo >= 1) continue;
      const next = [];
      for (const [start, end] of intervals) {
        if (hi <= start || lo >= end) next.push([start, end]);
        else {
          if (lo > start) next.push([start, Math.min(end, lo)]);
          if (hi < end) next.push([Math.max(start, hi), end]);
        }
      }
      intervals = next;
      if (!intervals.length) break;
    }
    return intervals;
  };
  let clippedPedestrianPieces = 0, clippedSidewalkPieces = 0, curbRuns = 0;
  const pavementHeight = { road: 0.06, path: 0.055, sidewalk: 0.025 };
  const streetSiteKeys = new Set();
  for (const s of roadSegments) {
    const width = s.width;
    const mapped = hasEdeMappedSurface(s);
    for (const surface of mapped ? [] : pavementBySegment.get(s)) {
      const pieces = visiblePavement(surface);
      if (!pieces.length) continue;
      const geometries = pieces.map(piece => edePolygonGeometry(piece, [], pavementHeight[surface.kind]));
      // Keep each segment batched even when clipping splits it into several fragments.
      const joined = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
      if (geometries.length > 1) geometries.forEach(geometry => geometry.dispose());
      const geometry = drapeEdeSurface(joined, true, s.road.id);
      const material = surface.kind !== 'sidewalk' && osmRoadMaterial(s.road);
      if (material) collectPaving(geometry, material, Math.atan2(s.uz, s.ux), s);
      else if (surface.kind === 'road') collect(geometry, roadMat, s);
      else if (surface.kind === 'sidewalk') {
        collect(geometry, sidewalkMat);
        clippedSidewalkPieces += pieces.length;
      } else {
        const cycleway = s.road.kind === 'cycleway';
        setPavingStyle(geometry, cycleway ? 0 : 2);
        collect(geometry, pavingMat, cycleway ? s : null);
        clippedPedestrianPieces += pieces.length;
      }
    }
    if (!isCarriageway(s)) continue;
    const nx = -s.uz, nz = s.ux;
    if (!mapped && curbedKinds.has(s.road.kind)) for (const side of [-1, 1]) {
      const offset = side * (width / 2 + 0.08);
      const a = { x: s.a.x + nx * offset, z: s.a.z + nz * offset };
      const b = { x: s.b.x + nx * offset, z: s.b.z + nz * offset };
      for (const [start, end] of curbIntervals(a, b, s, nearbyPavement(edeBounds([a, b]), 0.24))) {
        const length = s.len * (end - start);
        if (length < 2.5) continue;
        const mid = (start + end) / 2;
        const x = a.x + (b.x - a.x) * mid, z = a.z + (b.z - a.z) * mid;
        if (gradeWayAt(s.road.id, x, z, 2) || gradeCuts({ minX: x - 0.12, maxX: x + 0.12, minZ: z - 0.12, maxZ: z + 0.12 }).length) continue;
        const geometry = new THREE.BoxGeometry(length, 0.18, 0.16, terrain ? Math.ceil(length / terrain.step) : 1);
        geometry.rotateY(-Math.atan2(s.uz, s.ux));
        geometry.translate(x, 0.08, z);
        collect(drapeEdeVertices(geometry), curbMat);
        curbRuns++;
      }
    }
    if (s.len >= 12 && s.road.kind !== 'service') {
      const count = Math.max(1, Math.floor(s.len / 34));
      for (let k = 0; k < count; k++) for (const side of [-1, 1]) {
        const t = (k + 0.5) / count, x = s.a.x + s.ux * s.len * t + nx * side * (width / 2 + 1.3),
          z = s.a.z + s.uz * s.len * t + nz * side * (width / 2 + 1.3);
        const key = `${Math.round(x / 14)}/${Math.round(z / 14)}`;
        if (streetSiteKeys.has(key)) continue;
        streetSiteKeys.add(key);
        edeStreetSites.push({ x, z, nx: -nx * side, nz: -nz * side, ux: s.ux, uz: s.uz, name: s.road.name || '', road: s.road });
      }
    }
  }
  const ballastWidth = RAIL_BALLAST_WIDTH;
  const maskSize = 64;
  const mask = new Uint8Array(maskSize ** 2);
  const { smoothstep } = THREE.MathUtils;
  for (let y = 0; y < maskSize; y++) {
    const phase = Math.abs((y + 0.5) / maskSize - 0.5);
    const sleeper = 1 - smoothstep(phase, 0.12, 0.23);
    for (let x = 0; x < maskSize; x++) {
      const across = Math.abs(((x + 0.5) / maskSize - 0.5) * ballastWidth);
      mask[y * maskSize + x] = Math.round(255 * sleeper * (1 - smoothstep(across, 1.18, 1.28)));
    }
  }
  // Repeat along the track without wrapping the ballast edges across its width.
  const sleeperMask = new THREE.DataTexture(mask, maskSize, maskSize, THREE.RedFormat);
  sleeperMask.wrapT = THREE.RepeatWrapping;
  sleeperMask.magFilter = THREE.LinearFilter;
  sleeperMask.minFilter = THREE.LinearMipmapLinearFilter;
  sleeperMask.generateMipmaps = true;
  sleeperMask.anisotropy = 8;
  sleeperMask.needsUpdate = true;
  const ballastMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.94 });
  ballastMat.colorNode = mix(color(0x6c6054), color(0x3f3730), texture(sleeperMask).r);
  const railMat = new THREE.MeshStandardNodeMaterial({ color: 0xb5ada0, metalness: 0.35, roughness: 0.47 });
  let railWays = 0;
  const railCorridors = getRailCorridors();
  for (const railway of EDE_DATA.railways || []) {
    if (railway.tunnel || railway.pts.length < 4) continue;
    const fitted = railCorridors.get(railway.id);
    if (fitted) {
      for (let i = 0; i < fitted.sections.length; i += 48) {
        const sections = fitted.sections.slice(i, i + 48);
        collect(edeRailStrip(sections, ballastWidth / 2, RAIL_BALLAST_TOP), ballastMat);
        for (const side of [-1, 1]) collect(edeRailStrip(sections, 0.045, RAIL_TOP, side * 1.435 / 2), railMat);
      }
      railWays++;
      continue;
    }
    const points = edePoints(railway.pts);
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.1) continue;
      const ux = (b.x - a.x) / length, uz = (b.z - a.z) / length;
      // shortcut: bridge approach heights define an estimated profile until surveyed decks are available.
      const startY = railway.bridge ? terrainHeightAt(a.x, a.z) : 0;
      const rise = railway.bridge ? terrainHeightAt(b.x, b.z) - startY : 0;
      const trackStrip = (halfWidth, y, offset = 0) => {
        const geometry = railway.bridge
          ? edeStrip(a, b, halfWidth, y, offset) : drapeEdeSurface(edeStrip(a, b, halfWidth, y, offset));
        const position = geometry.getAttribute('position');
        let changed = false;
        for (let j = 0; j < position.count; j++) {
          const x = position.getX(j), z = position.getZ(j);
          const along = (x - a.x) * ux + (z - a.z) * uz;
          const fitted = railHeightAt(railway.id, a.x + ux * along, a.z + uz * along);
          if (fitted === undefined && !railway.bridge) continue;
          position.setY(j, y + (fitted ?? startY + rise * along / length));
          changed = true;
        }
        if (changed) geometry.computeVertexNormals();
        return geometry;
      };

      // The ballast sits below the road surface at level crossings.
      const bed = trackStrip(ballastWidth / 2, RAIL_BALLAST_TOP);
      const positions = bed.getAttribute('position'), coordinates = bed.getAttribute('uv');
      for (let j = 0; j < positions.count; j++) {
        const dx = positions.getX(j) - a.x, dz = positions.getZ(j) - a.z;
        coordinates.setXY(j, (-dx * uz + dz * ux) / ballastWidth + 0.5,
          (distance + dx * ux + dz * uz) / RAIL_SLEEPER_SPACING + 0.5);
      }
      collect(bed, ballastMat);
      for (const side of [-1, 1]) collect(trackStrip(0.045, RAIL_TOP, side * 1.435 / 2), railMat);
      distance += length;
    }
    if (distance > 0) railWays++;
  }

  if (treeInventory) {
    for (const tree of treeInventory) {
      const { x, z } = tree;
      if (waterAt(x, z)) continue;
      const block = blockAt(x, z);
      if (block && !block.park && !block.sidewalk) continue;
      parkTreeSites.push(edeTreeSite(tree, terrainHeightAt(x, z)));
    }
  } else {
    for (const tree of EDE_DATA.trees || []) {
      if (waterAt(tree.x, tree.z)) continue;
      const h = Math.abs(Math.sin(tree.x * 1.9 + tree.z * 8.1));
      parkTreeSites.push({ x: tree.x, z: tree.z, y: terrainHeightAt(tree.x, tree.z) + 0.09, scale: tree.h ? Math.max(0.45, Math.min(1.8, tree.h / 13)) : 0.66 + h * 0.62,
        species: h < 0.42 ? 0 : h < 0.65 ? 1 : 2, yaw: h * Math.PI * 2 });
    }
  }
  // OSM often maps a wooded area without mapping each individual tree. Fill
  // those patches procedurally, preserving mapped trees and clear paths.
  const mappedTreeCount = parkTreeSites.length;
  const treeCells = new Map();
  const indexTree = tree => {
    const key = `${Math.floor(tree.x / 8)}/${Math.floor(tree.z / 8)}`;
    if (!treeCells.has(key)) treeCells.set(key, []);
    treeCells.get(key).push(tree);
  };
  parkTreeSites.forEach(indexTree);
  const nearbyTree = (x, z, radius = 7) => {
    const ix = Math.floor(x / 8), iz = Math.floor(z / 8);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if ((treeCells.get(`${ix + dx}/${iz + dz}`) || []).some(t => Math.hypot(t.x - x, t.z - z) < radius)) return true;
    }
    return false;
  };
  // Photo-referenced trees and undergrowth around Berghain use the original
  // tree geometry, instancing and LOD. Keep mapped trees in preference to extras.
  for (const tree of BERGHAIN_TREE_SITES) {
    if (waterAt(tree.x, tree.z) || nearbyTree(tree.x, tree.z, tree.isShrub ? 1.25 : 5)) continue;
    parkTreeSites.push(tree); indexTree(tree);
  }
  const landmarkTrees = parkTreeSites.length - mappedTreeCount;
  const hash = (x, z, seed) => { const n = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453; return n - Math.floor(n); };
  for (const park of EDE_DATA.parks || []) {
    if (!['wood', 'forest'].includes(park.kind)) continue;
    const ring = edePoints(park.ring), holes = (park.holes || []).map(edePoints), bounds = edeBounds(ring);
    for (let gx = Math.ceil(Math.max(bounds.minX, ISLAND_BOUNDS.minX) / 14); gx <= Math.floor(Math.min(bounds.maxX, ISLAND_BOUNDS.maxX) / 14); gx++) {
      for (let gz = Math.ceil(Math.max(bounds.minZ, ISLAND_BOUNDS.minZ) / 14); gz <= Math.floor(Math.min(bounds.maxZ, ISLAND_BOUNDS.maxZ) / 14); gz++) {
        const x = gx * 14 + (hash(gx, gz, 1) - 0.5) * 10, z = gz * 14 + (hash(gx, gz, 2) - 0.5) * 10;
        if (!pointInPoly(ring, x, z) || holes.some(h => pointInPoly(h, x, z)) || nearbyTree(x, z) || waterAt(x, z)) continue;
        if (LANDMARK_EXCLUSIONS.some(b => x > b.minX - 4 && x < b.maxX + 4 && z > b.minZ - 4 && z < b.maxZ + 4)) continue;
        if (nearestRoads(x, z, 20).some(q => q.dist < q.road.w / 2 + 3)) continue;
        const block = blockAt(x, z); if (block && !block.park && !block.sidewalk) continue;
        const h = hash(gx, gz, 3), tree = { x, z, y: terrainHeightAt(x, z) + 0.09, scale: 0.7 + h * 0.5, species: h < 0.5 ? 0 : h < 0.8 ? 1 : 2, yaw: h * Math.PI * 2 };
        parkTreeSites.push(tree); indexTree(tree);
      }
    }
  }
  // Merge in spatially modest batches, retaining the original TSL node materials
  // including wet asphalt and animated water.
  for (const [material, geometries] of collections) {
    let firstMesh;
    for (const cell of edeGeometryGroups(geometries)) for (let i = 0; i < cell.length; i += 300) {
      const sources = cell.slice(i, i + 300);
      // Keep shared terrain and curb vertices when all inputs already have indices.
      const chunk = sources.every(g => g.index) ? sources : sources.map(g => {
        if (!g.index) return g;
        const expanded = g.toNonIndexed(); g.dispose(); return expanded;
      });
      const merged = mergeGeometries(chunk, false);
      chunk.forEach(g => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.receiveShadow = material !== waterMat; mesh.castShadow = material === curbMat;
      if (material === railMat) mesh.name = 'Ede rails';
      if (material === ballastMat) mesh.name = 'Ede rail ballast';
      if (firstMesh) mesh.userData.sharesPipelineWith = firstMesh;
      else firstMesh = mesh;
      group.add(mesh);
    }
  }
  group.userData = { city: 'Ede', source: 'OpenStreetMap', terrain: terrain ? 'PDOK AHN' : null, roads: roadSegments.length, railways: railWays, treeInventory: treeInventory?.length || 0, mappedTrees: mappedTreeCount, landmarkTrees, proceduralWoodlandTrees: parkTreeSites.length - mappedTreeCount - landmarkTrees,
    mappedPavingCount, clippedPedestrianPieces, clippedSidewalkPieces, curbRuns, junctionClippedCurbs: true, junctionClippedSidewalks: true };
  scene.add(group);
  return { group, sidewalks, footprints, highwayLanes: [], colliders };
}

/**
 * Sutherland-Hodgman clip of polygon [{x, z}] to the half-plane nx * x + nz * z >= c.
 */
function clipPolygonHalfPlane(pts, nx, nz, c) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const da = nx * a.x + nz * a.z - c;
    const db = nx * b.x + nz * b.z - c;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function setPavingStyle(geo, style) {
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, style, 0);
  uvAttr.needsUpdate = true;
  return geo;
}

export {
  buildCityGrid,
  centralParkClearings,
  parkTreeSites,
  parkLampSites,
  pavedPlazaRects,
  sidewalkBlocks,
  edeStreetSites
};
