import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, attribute, cameraPosition, float, frontFacing, interleavedGradientNoise,
  normalWorld, positionWorld, screenCoordinate, smoothstep, texture, uniform, uniformArray, userData, uv, vec2
} from 'three/tsl';

const LIGHT_LIMIT = 6;
export const SIGN_FOIL = Object.freeze({ R1: 0.8, R2: 1.18 });

export function roadFurnitureVisibility() {
  return float(interleavedGradientNoise(screenCoordinate.xy).lessThan(userData('spawnAlpha', 'float')));
}

export function createSignRetroreflection() {
  const positions = Array.from({ length: LIGHT_LIMIT }, () => new THREE.Vector4());
  const beams = Array.from({ length: LIGHT_LIMIT }, () => new THREE.Vector4());
  const lampPositions = uniformArray(positions, 'vec4');
  const lampBeams = uniformArray(beams, 'vec4');
  const count = uniform(0, 'int');
  const night = uniform(0);
  const origin = new THREE.Vector3(), direction = new THREE.Vector3();

  const response = Fn(() => {
    const reflection = float(0).toVar();
    If(count.greaterThan(0), () => {
      const viewDir = cameraPosition.sub(positionWorld).normalize().toVar();
      const viewAngle = smoothstep(0.08, 0.75, viewDir.dot(normalWorld));
      Loop(count, ({ i }) => {
        const lamp = lampPositions.element(i);
        const beam = lampBeams.element(i);
        const toLamp = lamp.xyz.sub(positionWorld).toVar();
        const distance = toLamp.length().max(0.01).toVar();
        const lampDir = toLamp.div(distance).toVar();
        const angle = beam.xyz.dot(lampDir.negate()).toVar();
        // Low-beam spill reaches tall signs, while the main cone dominates at headlight height.
        const cone = smoothstep(0.91, 0.99, angle).mul(0.22).add(smoothstep(0.986, 0.999, angle).mul(0.78));
        const near = smoothstep(lamp.w.mul(0.28), lamp.w, distance).oneMinus();
        const incidence = smoothstep(0.04, 0.65, normalWorld.dot(lampDir));
        const observation = smoothstep(0.89, 0.999, viewDir.dot(lampDir));
        reflection.addAssign(cone.mul(near).mul(incidence).mul(observation).mul(beam.w));
      });
      reflection.assign(reflection.min(1.2).mul(viewAngle).mul(night));
    });
    return reflection;
  })();

  return {
    response,
    update(nightFactor, playerLights, trafficLights) {
      night.value = THREE.MathUtils.smoothstep(nightFactor, 0.02, 0.55);
      let used = 0;
      function add(spot) {
        if (!spot || spot.intensity <= 0.1 || used >= LIGHT_LIMIT || !spot.visible) return;
        origin.setFromMatrixPosition(spot.matrixWorld);
        direction.setFromMatrixPosition(spot.target.matrixWorld).sub(origin).normalize();
        positions[used].set(origin.x, origin.y, origin.z, spot.distance * 1.6);
        beams[used].set(direction.x, direction.y, direction.z, Math.min(1, spot.intensity / 700));
        used++;
      }
      if (night.value > 0) {
        for (const spot of playerLights ?? []) add(spot);
        for (let i = 0; i < (trafficLights?.length ?? 0) && used < LIGHT_LIMIT; i += 2) {
          if (trafficLights[i].intensity <= 0.1) break;
          add(trafficLights[i]);
        }
      }
      count.value = used;
    }
  };
}

function signEmission(sample, reflection, strength) {
  return sample.rgb.mul(sample.r.max(sample.g).max(sample.b).mul(0.7).add(0.3))
    .mul(reflection.response).mul(strength).mul(3.6);
}

export function createSurveyedSignMaterial(map, reflection) {
  const material = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.65 });
  material.name = 'Ede surveyed retroreflective directional signs';
  material.emissiveNode = signEmission(texture(map), reflection, SIGN_FOIL.R2);
  return material;
}

export function createRetroreflectiveSignMaterial(map, reflection) {
  const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.42, roughness: 0.65 });
  material.name = 'Ede retroreflective road furniture';
  const rect = attribute('signAtlasRect', 'vec4');
  const foil = attribute('signFoil', 'vec2');
  const reverseArtwork = frontFacing.not().and(foil.y.greaterThan(0.5));
  const coords = uv();
  const sample = texture(map, rect.xy.add(rect.zw.mul(vec2(reverseArtwork.select(coords.x.oneMinus(), coords.x), coords.y))));
  const printed = frontFacing.or(foil.y.greaterThan(0.5));
  material.colorNode = printed.select(sample.rgb, new THREE.Color(0x7b858a));
  material.metalnessNode = printed.select(0.02, 0.3);
  material.opacityNode = sample.a.mul(roadFurnitureVisibility());
  material.emissiveNode = signEmission(sample, reflection, foil.x.mul(float(printed)));
  return material;
}
