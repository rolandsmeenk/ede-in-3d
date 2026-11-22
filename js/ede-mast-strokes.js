import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, color, fwidth, length, max, mix,
  positionGeometry, screenSize, varying, vec4 } from 'three/tsl';
import { transparentEffectMRT } from './tsl-materials.js';

export function mastStrokeMesh(strokes, cutoff, night) {
  // All distant masts share one draw. Expand each beam's screen footprint,
  // then integrate its physical width instead of snapping it to pixel centres.
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, -1, 0, 1, -1, 0, 0, 1, 0,
    0, 1, 0, 1, -1, 0, 1, 1, 0,
  ], 3));
  geometry.setAttribute('mastStart', new THREE.InstancedBufferAttribute(new Float32Array(strokes.start), 4));
  geometry.setAttribute('mastEnd', new THREE.InstancedBufferAttribute(new Float32Array(strokes.end), 4));
  geometry.setAttribute('mastCentre', new THREE.InstancedBufferAttribute(new Float32Array(strokes.centre), 3));
  geometry.instanceCount = strokes.start.length / 4;
  geometry.boundingBox = strokes.bounds.expandByScalar(10);
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  const startAndRadius = attribute('mastStart', 'vec4'), endAndRadius = attribute('mastEnd', 'vec4');
  const start = startAndRadius.xyz, end = endAndRadius.xyz;
  const centre = attribute('mastCentre', 'vec3');
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
  const distant = cameraPosition.distance(centre).greaterThanEqual(cutoff);
  mat.positionNode = distant.select(endpoint.add(right.mul(offset)).add(axis.mul(cap)), centre);

  const lateral = varying(offset);
  const along = varying(positionGeometry.x.mul(beamLength).add(cap));
  const radius = mix(startAndRadius.w, endAndRadius.w, along.div(beamLength).clamp());
  const footprint = max(fwidth(lateral), 0.00001);
  const edge = footprint.mul(0.5).sub(lateral);
  const alpha = edge.add(radius).div(footprint).clamp().sub(edge.sub(radius).div(footprint).clamp());
  const capDistance = max(along.negate(), along.sub(beamLength));
  const endCoverage = capDistance.div(max(fwidth(along), 0.00001)).negate().add(0.5).clamp();
  mat.colorNode = color(0x7d8180).mul(mix(1, 0.36, night));
  mat.opacityNode = alpha.mul(endCoverage);
  mat.mrtNode = transparentEffectMRT;
  const mesh = new THREE.Mesh(geometry, mat);
  return mesh;
}
