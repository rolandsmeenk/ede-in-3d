import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, float,
  length, max, screenSize, smoothstep, uv, varying, vec2, vec4 } from 'three/tsl';
import { cityUniforms, transparentEffectMRT } from './tsl-materials.js';

const RANGE = 1500;
const REFRESH_DISTANCE = 128;
const GLOW_ON = 0.72;

export function createEdeLampHalos(cells, cellSize, capacity) {
  if (!capacity) return null;

  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry());
  const positions = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  geometry.setAttribute('haloPosition', positions);
  geometry.setAttribute('haloColor', colors);
  // A black instance lets the normal scene warmup compile the night pipeline in daylight.
  geometry.instanceCount = 1;

  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });
  material.mrtNode = transparentEffectMRT;
  const center = attribute('haloPosition', 'vec4').xyz;
  const depth = cameraViewMatrix.mul(vec4(center, 1)).z.negate();
  const focal = cameraProjectionMatrix.element(1).element(1).mul(screenSize.y).mul(0.5);
  const diameter = max(0.48, max(depth, 0).div(max(focal, 1)).mul(5));
  const distance = length(cameraPosition.sub(center));
  const rangeFade = smoothstep(45, 140, distance).mul(smoothstep(780, RANGE, distance).oneMinus());
  const night = smoothstep(GLOW_ON, 1.45, cityUniforms.uInteriorGlow);
  // Fade the emitted light itself so additive blending never adds the fog's colour.
  const edge = smoothstep(0, 1, length(uv().sub(0.5)).mul(2)).oneMinus();
  material.positionNode = center;
  material.scaleNode = vec2(diameter);
  material.colorNode = attribute('haloColor', 'vec4').rgb.mul(edge.mul(edge).mul(2.6)).mul(varying(rangeFade)).mul(night);
  material.opacityNode = float(1);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'EdeLampHalos';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const tint = new THREE.Color();
  let lastX = Infinity;
  let lastZ = Infinity;

  function update({ x, z }) {
    if (cityUniforms.uInteriorGlow.value <= GLOW_ON) {
      mesh.visible = false;
      return;
    }

    if ((x - lastX) ** 2 + (z - lastZ) ** 2 >= REFRESH_DISTANCE ** 2) {
      lastX = x;
      lastZ = z;
      // Keep a margin so visible lamps cannot cross the draw list boundary between updates.
      const reach = RANGE + REFRESH_DISTANCE;
      let count = 0;
      for (let ix = Math.floor((x - reach) / cellSize); ix <= Math.floor((x + reach) / cellSize); ix++) {
        for (let iz = Math.floor((z - reach) / cellSize); iz <= Math.floor((z + reach) / cellSize); iz++) {
          const lamps = cells.get(ix + ',' + iz);
          if (!lamps) continue;
          for (const lamp of lamps) {
            if ((lamp.x - x) ** 2 + (lamp.z - z) ** 2 > reach ** 2) continue;
            tint.setHex(lamp.color ?? 0xffe8c2);
            positions.setXYZW(count, lamp.x, lamp.y, lamp.z, 0);
            colors.setXYZW(count, tint.r, tint.g, tint.b, 0);
            count++;
          }
        }
      }
      geometry.instanceCount = count;
      if (count > 0) {
        for (const buffer of [positions, colors]) {
          buffer.clearUpdateRanges();
          buffer.addUpdateRange(0, count * buffer.itemSize);
          buffer.needsUpdate = true;
        }
      }
    }
    mesh.visible = geometry.instanceCount > 0;
  }

  return { mesh, update };
}
