import * as THREE from '../vendor/three/build/three.core.js';
import { mergeGeometries } from '../vendor/three/examples/jsm/utils/BufferGeometryUtils.js?v=20261124-workers';
import { createTerrainSampler } from './terrain.js?v=20261124-workers';
import { drapeSurface, edeGeometryGroups, edePoints, polygonGeometry } from './ede-surface-geometry.js?v=20261127-terrain-normals';
import { curbFaceGeometry, curbTopGeometry } from './ede-curb-geometry.js?v=20261127-curb-concrete';
import { clipEdeGround, nearestEdeSpan } from './ede-grade-query.js';
import { nearestRoadInCells } from './ede-road-cell-query.js';
import { applyAsphaltLanes } from './ede-asphalt-attributes.js';
import { samplePavingGround } from './ede-aerial-sampling.js';

const CHUNK_BYTES = 4 * 1024 * 1024;

function pavingGeometry(job, terrain, roads, ground) {
  const { rise, material, style, angle, layer, segment, cuts, local, roadColor, groundColor } = job;
  const ramp = Array.isArray(job.top);
  const surfaces = ramp ? [] : job.outer
    ? [polygonGeometry(THREE, edePoints(job.outer), job.holes.map(edePoints), job.top ?? rise)]
    : job.pieces.map(points => polygonGeometry(THREE, typeof points[0] === 'number' ? edePoints(points) : points, [], rise));
  const joined = ramp ? curbTopGeometry(THREE, job.top) : surfaces.length === 1 ? surfaces[0] : mergeGeometries(surfaces);
  const grade = {
    gradeCuts: () => cuts,
    clipEdeGround,
    localGradeSurface: () => local && {
      ...local, heightAt: (x, z) => nearestEdeSpan(local.spans, x, z, terrain.terrainHeightAt)?.y ?? terrain.terrainHeightAt(x, z),
    },
  };
  let geometry = drapeSurface(THREE, terrain, grade, joined, true, job.wayId, Boolean(job.outer),
    undefined, undefined, ramp, job.smoothGround);
  if (!geometry?.attributes.position.count) return null;
  if (material === 'asphalt') {
    geometry = applyAsphaltLanes(THREE, geometry, segment, layer,
      (x, z, reach, way, roadLayer) => nearestRoadInCells(roads, x, z, reach, way, roadLayer), section => section.band);
  }
  const { position, uv } = geometry.attributes;
  if (material === 'mapped') {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const styles = new Float32Array(position.count).fill(style);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      uv.setXY(i, x * cs + z * sn, z * cs - x * sn);
    }
    geometry.setAttribute('pavingStyle', new THREE.BufferAttribute(styles, 1));
  } else if (material === 'path') {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, style, 0);
  }
  if (ground[0]) {
    const colors = new Uint8Array(position.count * 4);
    const sample = [0, 0, 0];
    for (let i = 0; i < position.count; i++) {
      if (roadColor) [sample[0], sample[1], sample[2]] = roadColor;
      else if (!(groundColor && samplePavingGround(...ground, position.getX(i), position.getZ(i), sample))) continue;
      if (material === 'asphalt') sample[1] = Math.min(sample[1], Math.max(sample[0], sample[2]) * 1.2);
      const offset = i * 4;
      for (let j = 0; j < 3; j++) colors[offset + j] = Math.round(sample[j] * 255);
      colors[offset + 3] = 255;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
  }
  return geometry;
}

function describeBatches(material, geometry, chunks) {
  const bytesPerVertex = Object.values(geometry.attributes).reduce((bytes, attr) => bytes + attr.itemSize * attr.array.BYTES_PER_ELEMENT, 0);
  if (geometry.index && geometry.attributes.position.count * bytesPerVertex + geometry.index.array.byteLength > CHUNK_BYTES) {
    geometry = geometry.toNonIndexed();
  }
  const numVertices = geometry.attributes.position.count;
  const stride = geometry.index ? numVertices : Math.floor(CHUNK_BYTES / bytesPerVertex / 3) * 3;
  for (let start = 0; start < numVertices; start += stride) {
    const end = Math.min(start + stride, numVertices);
    const attributes = Object.entries(geometry.attributes).map(([name, attr]) =>
      [name, attr.array.subarray(start * attr.itemSize, end * attr.itemSize), attr.itemSize, attr.normalized]);
    const index = geometry.index?.array ?? null;
    const bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(attributes.find(([name]) => name === 'position')[1], 3));
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    chunks.push({ material, attributes, index, sphere: [sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius],
      bytes: (index?.byteLength ?? 0) + attributes.reduce((total, [, array]) => total + array.byteLength, 0) });
  }
}

export function buildPavingTile({ context, jobs, roads, ground }) {
  const terrain = createTerrainSampler(context);
  const batches = new Map();
  for (const job of jobs) {
    const geometry = pavingGeometry(job, terrain, roads, ground);
    if (!geometry) continue;
    if (!batches.has(job.material)) batches.set(job.material, []);
    batches.get(job.material).push(geometry);
    if (job.top) {
      const baseHeightAt = (x, z) => ((job.local ? nearestEdeSpan(job.local.spans, x, z, terrain.terrainHeightAt)?.y : undefined)
        ?? terrain.terrainHeightAt(x, z)) + job.rise;
      const wall = curbFaceGeometry(THREE, geometry, job.outer, job.holes, baseHeightAt);
      const tactile = job.tactile && pavingGeometry({ ...job, top: job.tactile, material: 'curb' }, terrain, roads, []);
      if (wall || tactile) {
        if (!batches.has('curb')) batches.set('curb', []);
        if (wall) batches.get('curb').push(wall);
        if (tactile) batches.get('curb').push(tactile);
      }
    }
  }
  const chunks = [];
  for (const [material, geometries] of batches) {
    for (const cell of edeGeometryGroups(geometries)) {
      for (let i = 0; i < cell.length; i += 300) {
        const sources = cell.slice(i, i + 300);
        const input = sources.every(g => g.index) ? sources : sources.map(g => g.index ? g.toNonIndexed() : g);
        const merged = mergeGeometries(input);
        if (merged) describeBatches(material, merged, chunks);
      }
    }
  }
  return chunks;
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = ({ data }) => {
    try {
      const chunks = buildPavingTile(data);
      const buffers = new Set();
      for (const chunk of chunks) {
        if (chunk.index) buffers.add(chunk.index.buffer);
        for (const [, array] of chunk.attributes) buffers.add(array.buffer);
      }
      self.postMessage({ chunks }, [...buffers]);
    } catch (error) {
      self.postMessage({ error: error.message });
    }
  };
}
