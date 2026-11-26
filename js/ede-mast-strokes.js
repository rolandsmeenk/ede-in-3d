import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, color, fwidth, length, max, mix,
  positionGeometry, screenSize, sqrt, transformNormalToView, varying, vec4 } from 'three/tsl';
import { transparentEffectMRT } from './tsl-materials.js';

const paintColor = new THREE.Color();
const endpoint = new THREE.Vector3();

export function createMemberStrokes() {
  return { start: [], end: [], colors: [], bounds: new THREE.Box3() };
}

export function addMemberStroke(strokes, start, end, radius, paint) {
  if (Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) < 0.02) return;
  strokes.start.push(...start, radius);
  strokes.end.push(...end, radius);
  paintColor.setHex(paint).toArray(strokes.colors, strokes.colors.length);
  strokes.bounds.expandByPoint(endpoint.fromArray(start));
  strokes.bounds.expandByPoint(endpoint.fromArray(end));
}

function strokeMesh(strokes, material) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, -1, 0, 1, -1, 0, 0, 1, 0,
    0, 1, 0, 1, -1, 0, 1, 1, 0,
  ], 3));
  geometry.setAttribute('mastStart', new THREE.InstancedBufferAttribute(new Float32Array(strokes.start), 4));
  geometry.setAttribute('mastEnd', new THREE.InstancedBufferAttribute(new Float32Array(strokes.end), 4));
  if (strokes.centre) geometry.setAttribute('mastCentre', new THREE.InstancedBufferAttribute(new Float32Array(strokes.centre), 3));
  if (strokes.colors) geometry.setAttribute('memberPaint', new THREE.InstancedBufferAttribute(new Float32Array(strokes.colors), 3));
  geometry.instanceCount = strokes.start.length / 4;
  geometry.boundingBox = strokes.bounds.clone().expandByScalar(10);
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  return new THREE.Mesh(geometry, material);
}

function strokeMaterial({ cutoff, night, opacity } = {}) {
  const options = { transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true };
  const mat = cutoff ? new THREE.MeshBasicNodeMaterial(options)
    : new THREE.MeshStandardNodeMaterial({ ...options, roughness: 0.72, metalness: 0.12 });
  // Widen the rasterization footprint and integrate each member's physical width.

  const startAndRadius = attribute('mastStart', 'vec4'), endAndRadius = attribute('mastEnd', 'vec4');
  const start = startAndRadius.xyz, end = endAndRadius.xyz;
  const line = end.sub(start);
  const beamLength = length(line);
  const axis = line.div(beamLength);
  const across = axis.cross(cameraPosition.sub(start.add(end).mul(0.5)));
  const right = across.div(max(length(across), 0.00001));
  const endpoint = mix(start, end, positionGeometry.x);
  const viewDepth = cameraViewMatrix.mul(vec4(endpoint, 1.0)).z.negate();
  const focal = cameraProjectionMatrix.element(1).element(1).mul(screenSize.y).mul(0.5);
  const pixel = max(viewDepth, 0.1).div(max(focal, 1));
  const offset = positionGeometry.y.mul(max(startAndRadius.w, endAndRadius.w).add(pixel));
  const cap = positionGeometry.x.mul(2).sub(1).mul(pixel);
  const position = endpoint.add(right.mul(offset)).add(axis.mul(cap));
  if (cutoff) {
    const centre = attribute('mastCentre', 'vec3');
    mat.positionNode = cameraPosition.distance(centre).greaterThanEqual(cutoff).select(position, centre);
  } else {
    mat.positionNode = position;
  }

  const lateral = varying(offset);
  const along = varying(positionGeometry.x.mul(beamLength).add(cap));
  const radius = mix(startAndRadius.w, endAndRadius.w, along.div(beamLength).clamp());
  const footprint = max(fwidth(lateral), 0.00001);
  const edge = footprint.mul(0.5).sub(lateral);
  const alpha = edge.add(radius).div(footprint).clamp().sub(edge.sub(radius).div(footprint).clamp());
  const capDistance = max(along.negate(), along.sub(beamLength));
  const endCoverage = capDistance.div(max(fwidth(along), 0.00001)).negate().add(0.5).clamp();
  if (cutoff) {
    mat.colorNode = color(0x7d8180).mul(mix(1, 0.36, night));
  } else {
    mat.colorNode = attribute('memberPaint', 'vec3');
    const lateralNormal = lateral.div(max(radius, 0.00001)).clamp(-1, 1);
    const towardCamera = right.cross(axis);
    const radial = sqrt(max(lateralNormal.mul(lateralNormal).oneMinus(), 0.0));
    mat.normalNode = transformNormalToView(right.mul(lateralNormal).add(towardCamera.mul(radial)));
  }
  mat.opacityNode = alpha.mul(endCoverage).mul(opacity ?? 1);
  mat.mrtNode = transparentEffectMRT;
  return mat;
}

export function memberStrokeMaterial(opacity) {
  return strokeMaterial({ opacity });
}

export function memberStrokeMesh(strokes, material) {
  const mesh = strokeMesh(strokes, material);
  mesh.receiveShadow = true;
  return mesh;
}

export function mastStrokeMesh(strokes, cutoff, night) {
  return strokeMesh(strokes, strokeMaterial({ cutoff, night }));
}
