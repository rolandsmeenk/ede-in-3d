import * as THREE from 'three/webgpu';
import { attribute, mix } from 'three/tsl';
import { sampleGroundColor } from './aerial-colors.js';
import { createCoverageIndex, edeCoverage } from './ede-coverage.js';
import { playableBoundary, playableBoundsCovered, playableBoundsOverlap } from './ede-playable-boundary.js';
import { cityUniforms, heathBloomColor, sampleEdeLandCover } from './tsl-materials.js';
import { applySnowMaterial } from './ede-snow.js';
import { expansionSeamOffset, getExpansionTerrain, getTerrain, sampleTerrain } from './terrain.js';
import { buildTerrainGeometry, restoreLandscapeGeometry, SIDE } from './ede-landscape-geometry.js';
import { runLandscapeJob } from './ede-landscape-jobs.js';
import { expansionGradeCuts } from './ede-grade.js';

const OVERVIEW_SIDE = 13;
const MAX_LOADS = 4;
const MAX_GEOMETRY_BYTES = 40 * 1024 * 1024;
const MAX_ACTIVE_TILES = 112;
// An overview can be coarser than its baked root. Bound its edge error
// against the 5 m field at both sets of interpolation knots.
function overviewEdgeError(sample, start, end, step) {
  const intervals = OVERVIEW_SIDE - 1;
  const samples = Array.from({ length: OVERVIEW_SIDE }, (_, i) => sample(start + (end - start) * i / intervals));
  let error = 0;
  for (let at = start; at <= end; at += step) {
    const pos = (at - start) * intervals / (end - start);
    const i = Math.min(intervals - 1, Math.floor(pos));
    const height = samples[i] + (samples[i + 1] - samples[i]) * (pos - i);
    error = Math.max(error, Math.abs(sample(at) - height));
  }
  return error;
}

export function sizeTerrainSkirts(nodes, roots, field) {
  const rootSet = new Set(roots);
  const lines = new Map();
  for (const node of nodes) {
    const [west, north, east, south] = node.bounds;
    const borders = [
      [true, north, west, east], [false, east, north, south],
      [true, south, west, east], [false, west, north, south],
    ];
    node.skirts = [3, 3, 3, 3];
    for (const [edge, [horizontal, fixed, start, end]] of borders.entries()) {
      const key = horizontal ? `z/${fixed}` : `x/${fixed}`;
      if (!lines.has(key)) lines.set(key, [[], []]);
      const error = rootSet.has(node) ? Math.max(node.error, node.overviewError ?? overviewEdgeError(
        at => horizontal ? sampleTerrain(field, at, fixed) : sampleTerrain(field, fixed, at),
        start, end, field.step
      )) : node.error;
      lines.get(key)[edge < 2 ? 0 : 1].push({ node, edge, start, end, error });
    }
  }
  for (const [oneSide, otherSide] of lines.values()) {
    for (const a of oneSide) for (const b of otherSide) {
      if (Math.max(a.start, b.start) >= Math.min(a.end, b.end)) continue;
      // Either neighbour can be the higher one. Include the seam adjustment and quantization.
      const depth = a.error + b.error + 3;
      a.node.skirts[a.edge] = Math.max(a.node.skirts[a.edge], depth);
      b.node.skirts[b.edge] = Math.max(b.node.skirts[b.edge], depth);
    }
  }
}

export function triangulateTerrainBoundary(polygons) {
  const edges = [];
  const parts = polygons.flatMap(polygon => {
    const [contour, ...holes] = polygon.map(ring => Array.from({ length: ring.length / 2 }, (_, i) =>
      new THREE.Vector2(ring[i * 2], ring[i * 2 + 1])));
    for (const ring of [contour, ...holes]) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      edges.push([Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]);
    }
    const vertices = contour.concat(...holes);
    return THREE.ShapeUtils.triangulateShape(contour, holes).map(face => {
      const [a, b, c] = face.map(i => vertices[i]);
      const direction = Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      const bounds = [Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y)];
      const planes = [[a, b], [b, c], [c, a]].map(([start, end]) => {
        const x = (start.y - end.y) * direction, z = (end.x - start.x) * direction;
        return [x, z, -(start.x * x + start.y * z)];
      });
      return { bounds, planes };
    });
  });
  return { edges, parts };
}

function overlap(a, b) {
  return a[0] <= b[2] && a[1] <= b[3] && a[2] >= b[0] && a[3] >= b[1];
}

export function tileGeometry(bytes, tile, legacy, field, side = SIDE) {
  return buildTerrainGeometry(bytes, tile, legacy, field, expansionSeamOffset, side);
}

export function createTerrainTiles(scene, heath, fringeLandCover, shorelineCuts,
  { maxBytes = MAX_GEOMETRY_BYTES, maxActiveTiles = MAX_ACTIVE_TILES } = {}) {
  const data = getExpansionTerrain();
  if (!data) return null;
  const { manifest, field, directory, detail, overviewField, rootSamples } = data;
  const legacy = getTerrain();
  const terrainBoundary = manifest.version === 2 ? edeCoverage?.terrainBoundary : null;
  const terrainIndex = terrainBoundary && createCoverageIndex(terrainBoundary);
  const overlapsBounds = terrainIndex?.overlapsBounds ?? playableBoundsOverlap;
  const coversBounds = terrainIndex?.coversBounds ?? playableBoundsCovered;
  const nodes = new Map(Object.entries(manifest.tiles).filter(([, tile]) => overlapsBounds(...tile.bounds))
    .map(([id, tile]) => [id, { ...tile, id }]));
  const boundary = triangulateTerrainBoundary(terrainBoundary ?? playableBoundary);
  for (const tile of nodes.values()) {
    if (!coversBounds(...tile.bounds)) tile.boundary = {
      parts: boundary.parts.filter(part => overlap(tile.bounds, part.bounds)),
      edges: boundary.edges.filter(edge => overlap(tile.bounds, edge)),
    };
    const [minX, minZ, maxX, maxZ] = tile.bounds;
    const bounds = { minX, minZ, maxX, maxZ };
    const outsideTown = minX < legacy.minX || minZ < legacy.minZ || maxX > legacy.maxX || maxZ > legacy.maxZ;
    const cuts = expansionGradeCuts(bounds).concat(outsideTown ? shorelineCuts?.(bounds) ?? [] : []);
    if (cuts.length) tile.gradeCuts = cuts;
    if (tile.children) tile.children = tile.children.filter(id => nodes.has(id));
  }
  if (detail) {
    for (const tile of nodes.values()) {
      const [w, n, e, s] = tile.bounds;
      if (e - w === 250 && w >= detail.minX && n >= detail.minZ && e <= detail.maxX && s <= detail.maxZ) {
        tile.detail = detail;
      }
    }
  }
  const rootHeights = rootSamples ? new DataView(rootSamples) : null;
  const roots = manifest.roots.map((id, i) => {
    const node = nodes.get(id);
    if (node) node.rootOffset = i * OVERVIEW_SIDE ** 2 * 2;
    return node;
  }).filter(Boolean);
  sizeTerrainSkirts(nodes.values(), roots, field);
  const group = new THREE.Group();
  group.name = 'EdeTerrainQuadtree';
  scene.add(group);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.93 });
  material.colorNode = heathBloomColor(attribute('color', 'vec4').rgb, heath).mul(mix(1, 0.78, cityUniforms.uRoadWetness));
  material.name = 'PDOK terrain tiles';
  applySnowMaterial(material, { shelter: true });
  const official = fringeLandCover && edeCoverage && createCoverageIndex(edeCoverage.playableBoundary);
  const fringe = official && createCoverageIndex(edeCoverage.buildingBoundary);
  const fringeMaterial = fringe && new THREE.MeshStandardNodeMaterial({ roughness: 0.93 });
  if (fringeMaterial) {
    const mapped = sampleEdeLandCover(fringeLandCover);
    const color = attribute('color', 'vec4').rgb.mul(mapped.a.mul(0.4).oneMinus()).add(mapped.rgb.mul(0.4));
    fringeMaterial.colorNode = heathBloomColor(color, heath).mul(mix(1, 0.78, cityUniforms.uRoadWetness));
    fringeMaterial.name = 'PDOK terrain with BGT fringe land cover';
    applySnowMaterial(fringeMaterial, { shelter: true });
  }
  const tileMaterial = node => fringeMaterial && fringe.overlapsBounds(...node.bounds)
    && !official.coversBounds(...node.bounds) ? fringeMaterial : material;
  const cameraMatrix = new THREE.Matrix4(), frustum = new THREE.Frustum();
  const box = new THREE.Box3();
  const lastCamera = new THREE.Vector3();
  const stats = { residentBytes: 0, peakResidentBytes: 0, visible: 0, loading: 0, drawCalls: 0, triangles: 0,
    collisionBytes: field.heights.byteLength + (detail?.heights.byteLength ?? 0),
    overviewBytes: (overviewField?.heights.byteLength ?? 0) + (rootSamples?.byteLength ?? 0) };
  const resident = new Set(), shown = new Set(), ready = [], loading = new Map();
  let pending = 0, stamp = 0;
  function countDraw(_renderer, _scene, _camera, geometry) {
    stats.drawCalls++;
    stats.triangles += geometry.index.count / 3;
  }
  function finish(node) {
    loading.delete(node);
    node.loading = false;
    pending--;
  }

  function queue(node, now) {
    if (node.mesh || node.loading || node.retry > now || pending >= MAX_LOADS) return;
    const controller = new AbortController();
    const { signal } = controller;
    loading.set(node, controller);
    node.loading = true;
    pending++;
    fetch(new URL(`${node.id}.bin?v=20261123-municipal`, directory), { signal }).then(response => {
      if (!response.ok) throw new Error(`AHN tile HTTP ${response.status}`);
      return response.arrayBuffer();
    }).then(async buffer => {
      if (signal.aborted) return;
      const { bounds, skirts, boundary, gradeCuts } = node;
      const result = typeof Worker === 'undefined' ? null : await runLandscapeJob('terrain', buffer,
        { bounds, skirts, boundary, gradeCuts, detail: Boolean(node.detail) }, bounds, signal);
      if (!signal.aborted) ready.push({ node, buffer: result ? null : buffer, result, signal });
    }).catch(error => {
      if (signal.aborted) return;
      node.retry = performance.now() + 4000;
      finish(node);
      console.warn('[AHN terrain tile]', node.id, error);
    });
  }

  function overview(node) {
    if (node.mesh || node.overview) return;
    const [west, north, east, south] = node.bounds;
    const buffer = new ArrayBuffer(OVERVIEW_SIDE ** 2 * 5);
    const view = new DataView(buffer);
    const rgb = [0.14, 0.18, 0.10];
    for (let z = 0, offset = 0; z < OVERVIEW_SIDE; z++) for (let x = 0; x < OVERVIEW_SIDE; x++, offset += 5) {
      const px = west + x * (east - west) / (OVERVIEW_SIDE - 1);
      const pz = north + z * (south - north) / (OVERVIEW_SIDE - 1);
      const height = rootHeights ? rootHeights.getInt16(node.rootOffset + (z * OVERVIEW_SIDE + x) * 2, true)
        : Math.round((sampleTerrain(field, px, pz) + field.napOrigin) * 100);
      view.setInt16(offset, height, true);
      sampleGroundColor(px, pz, rgb);
      for (let j = 0; j < 3; j++) view.setUint8(offset + 2 + j, Math.round(rgb[j] * 255));
    }
    node.overview = new THREE.Mesh(tileGeometry(buffer, node, legacy, field, OVERVIEW_SIDE), tileMaterial(node));
    node.overview.visible = false;
    node.overview.receiveShadow = true;
    node.overview.onBeforeRender = countDraw;
    group.add(node.overview);
  }
  function upload() {
    while (ready[0]?.signal.aborted) ready.shift();
    const job = ready.shift();
    if (!job) return;
    const { node, buffer, result } = job;
    try {
      const geometry = result ? restoreLandscapeGeometry(result.mesh) : tileGeometry(buffer, node, legacy, field);
      const mesh = new THREE.Mesh(geometry, tileMaterial(node));
      mesh.receiveShadow = true;
      mesh.onBeforeRender = countDraw;
      mesh.visible = false;
      group.add(mesh);
      node.mesh = mesh;
      if (node.overview) {
        node.overview.visible = false;
        if (!rootHeights) {
          group.remove(node.overview);
          node.overview.geometry.dispose();
          node.overview = null;
        }
      }
      node.bytesResident = geometry.index.array.byteLength + Object.values(geometry.attributes)
        .reduce((sum, attr) => sum + attr.array.byteLength, 0);
      resident.add(node);
      stats.residentBytes += node.bytesResident;
      stats.peakResidentBytes = Math.max(stats.peakResidentBytes, stats.residentBytes);
    } catch (error) {
      node.retry = performance.now() + 4000;
      console.warn('[AHN terrain tile]', node.id, error);
    } finally {
      finish(node);
    }
  }

  const distanceTo = (bounds, x, z) => Math.hypot(Math.max(bounds[0] - x, 0, x - bounds[2]),
    Math.max(bounds[1] - z, 0, z - bounds[3]));
  function update(camera, { focal, aerialDetail }) {
    stats.drawCalls = stats.triangles = 0;
    stamp++;
    camera.updateMatrixWorld();
    cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(cameraMatrix, camera.coordinateSystem, camera.reversedDepth);
    const { x, y, z } = camera.position;
    if (Math.hypot(x - lastCamera.x, z - lastCamera.z) < 500) upload();
    const advanceX = THREE.MathUtils.clamp((x - lastCamera.x) * 14, -150, 150);
    const advanceZ = THREE.MathUtils.clamp((z - lastCamera.z) * 14, -150, 150);
    lastCamera.copy(camera.position);
    const near = 300 * (1 - aerialDetail);
    const pixelBudget = THREE.MathUtils.lerp(5, 9, aerialDetail);
    const now = performance.now();
    const next = new Set(), wanted = new Map();
    const score = node => distanceTo(node.bounds, x + advanceX, z + advanceZ);
    const desire = (node, priority) => wanted.set(node, Math.min(wanted.get(node) ?? Infinity, priority));
    let createOverview = true;
    function visit(node, root = false) {
      const [west, north, east, south] = node.bounds;
      const horizontal = distanceTo(node.bounds, x, z);
      const minY = node.range ? node.range[0] / 100 - field.napOrigin : field.minY;
      const maxY = node.range ? node.range[1] / 100 - field.napOrigin : field.maxY;
      const localMin = Math.min(minY, node.detail?.minY ?? Infinity);
      const localMax = Math.max(maxY, node.detail?.maxY ?? -Infinity);
      box.min.set(west, localMin - Math.max(...node.skirts) - 1, north);
      box.max.set(east, localMax + 1, south);
      const visible = frustum.intersectsBox(box);
      if (!visible && (near === 0 || score(node) > near)) return;
      node.used = stamp;
      if (!node.mesh) {
        desire(node, horizontal);
        if (root && visible) {
          // Buffered roots can draw immediately after camera jumps and survive detail eviction.
          if ((rootHeights || createOverview) && !node.overview) {
            overview(node);
            createOverview = false;
          }
          if (node.overview) next.add(node);
        }
        return;
      }
      const vertical = Math.max(localMin - y, 0, y - localMax);
      const pixels = node.error * focal / Math.max(1, Math.hypot(horizontal, vertical));
      const threshold = pixelBudget * (node.refining ? 0.9 : 1.1);
      node.refining = Boolean(node.children?.length && (horizontal < near || pixels > threshold));
      if (node.refining && next.size < maxActiveTiles) {
        const children = node.children.map(id => nodes.get(id)).sort((a, b) => score(a) - score(b));
        for (const child of children) {
          child.used = stamp;
          if (!child.mesh) desire(child, score(child));
        }
        if (children.every(child => child.mesh)) {
          for (const child of children) visit(child);
          return;
        }
      }
      if (visible) next.add(node);
    }
    for (const root of [...roots].sort((a, b) => score(a) - score(b))) visit(root, true);
    for (const [node, controller] of loading) {
      if (node.used === stamp) continue;
      controller.abort();
      finish(node);
    }
    for (const [node] of [...wanted].sort((a, b) => a[1] - b[1])) {
      if (pending >= MAX_LOADS) break;
      queue(node, now);
    }
    for (const node of shown) {
      if (!next.has(node)) (node.mesh ?? node.overview).visible = false;
    }
    shown.clear();
    for (const node of next) {
      (node.mesh ?? node.overview).visible = true;
      shown.add(node);
    }
    if (stats.residentBytes > maxBytes) {
      const oldest = [...resident].filter(node => !next.has(node) && node.used < stamp - 2).sort((a, b) => a.used - b.used);
      for (const node of oldest) {
        if (stats.residentBytes <= maxBytes) break;
        group.remove(node.mesh);
        node.mesh.geometry.dispose();
        node.mesh = null;
        resident.delete(node);
        stats.residentBytes -= node.bytesResident;
      }
    }
    stats.visible = next.size;
    stats.loading = pending;
  }
  return { update, stats };
}
