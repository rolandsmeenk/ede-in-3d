import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp,
  color,
  float,
  fract,
  fwidth,
  length,
  max,
  mix,
  normalWorld,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

const TWO_PI = Math.PI * 2;

/**
 * Shared live signal optical uniforms (updated per frame at O(1) cost).
 * `uSunElevation` is sin(elevation) in [-1, 1] (matches `cityUniforms.uSkySunDir.y`).
 */
export function createLiveSignalUniforms() {
  return {
    uTime: uniform(0),
    uSunElevation: uniform(0.45),
    uMsiFlashHz: uniform(1.5),
    uVriFlashHz: uniform(1.2),
  };
}

/**
 * Anti-aliased discrete circular LED micro-lens mask in fragment space.
 * Shows crisp individual LED dots up close and smoothly coalesces to average
 * fill coverage at distance using `fwidth` so signs never shimmer or moiré.
 */
const ledDotMatrixMask = Fn(([localUv, gridCount]) => {
  const scaled = vec2(localUv).mul(gridCount).toVar();
  const cell = fract(scaled).sub(0.5);
  const dist = length(cell);
  const fw = max(fwidth(scaled.x), fwidth(scaled.y)).toVar();
  // Close-up: sharp circular LED diode (radius 0.37). Far: smooth fade to mean coverage (~0.68).
  // WGSL requires smoothstep(low, high, x) with low < high, so invert via .oneMinus().
  const aa = clamp(fw.mul(0.85), 0.015, 0.30);
  const dotMask = smoothstep(float(0.34).sub(aa), float(0.40).add(aa), dist).oneMinus();
  const farBlend = smoothstep(0.35, 1.35, fw);
  return mix(dotMask, float(0.68), farBlend);
});

/**
 * Ambient sun-elevation luminance multiplier:
 * - Bright daylight (elevation > 0.15): high-contrast punch (up to ~2.4x) to stay legible in sun.
 * - Dusk / night (elevation <= 0): controlled emissive luminance (~0.85x) so bloom stays crisp
 *   without washing out digits or arrows.
 */
const daylightLuminanceScale = Fn(([sunElevation]) => {
  const dayFactor = smoothstep(-0.08, 0.32, sunElevation);
  return mix(float(0.88), float(2.35), dayFactor);
});

/**
 * Subtle forward viewing cone falloff mimicking recessed LED optics and sun visors.
 */
const forwardOpticalCone = Fn(() => {
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const ndotv = clamp(viewDir.dot(normalWorld), 0.0, 1.0);
  return smoothstep(0.08, 0.62, ndotv).mul(0.75).add(0.25);
});

/**
 * Custom TSL emissive LED material for highway Matrix Signs (MSI / Signaalgevers).
 * Driven by per-instance attributes:
 *  - `aLegendUv` (vec4: u, v, du, dv)
 *  - `aFlasherMask` (float: 0 = off, 1 = 1.5 Hz alternating top-corner amber flashers)
 *  - `aBrightness` (float: 0..1.5 per-sign intensity)
 */
export function createMsiLedMaterial(atlasTexture, signalUniforms = createLiveSignalUniforms()) {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.78,
    metalness: 0.08,
  });
  material.name = 'EdeLiveMsiLedMaterial';
  material.userData.signalUniforms = signalUniforms;

  const legendUv = attribute('aLegendUv', 'vec4');
  const flasherMask = attribute('aFlasherMask', 'float');
  const brightness = attribute('aBrightness', 'float');

  const localUv = uv();
  const atlasUv = legendUv.xy.add(legendUv.zw.mul(localUv));
  const sampled = atlasTexture ? texture(atlasTexture, atlasUv).rgb : vec3(0.04, 0.05, 0.06);

  // Dark non-reflective housing face albedo, lifted slightly on lit LEDs for crisp daytime readability.
  material.colorNode = mix(color(0x0a0c0e), sampled.mul(0.35), brightness.clamp(0.0, 1.0));

  material.emissiveNode = Fn(() => {
    const luma = max(sampled.r, max(sampled.g, sampled.b));
    const litPixel = smoothstep(0.10, 0.30, luma);
    const microLens = ledDotMatrixMask(localUv, float(32.0));
    const legendEmit = sampled.mul(litPixel).mul(microLens).mul(1.35);

    // 1.5 Hz alternating top-left / top-right amber flasher beacons on J33 / F01 / F02.
    const phase = sin(signalUniforms.uTime.mul(signalUniforms.uMsiFlashHz).mul(TWO_PI));
    const leftPulse = step(0.0, phase);
    const rightPulse = float(1.0).sub(leftPulse);

    // Top-left beacon at (0.16, 0.86) and top-right at (0.84, 0.86) in local quad UV.
    const leftDist = length(localUv.sub(vec2(0.16, 0.86)));
    const rightDist = length(localUv.sub(vec2(0.84, 0.86)));
    const leftLens = smoothstep(0.032, 0.072, leftDist).oneMinus().mul(leftPulse);
    const rightLens = smoothstep(0.032, 0.072, rightDist).oneMinus().mul(rightPulse);
    const amberBeacon = color(0xffaa10).mul(leftLens.add(rightLens)).mul(flasherMask).mul(1.85);

    const exposure = daylightLuminanceScale(signalUniforms.uSunElevation);
    const cone = forwardOpticalCone();
    return legendEmit.add(amberBeacon).mul(exposure).mul(cone).mul(brightness);
  })();

  return material;
}

/**
 * Custom TSL emissive LED material for Live Traffic Lights (VRI / Verkeersregelinstallaties).
 * Driven by per-instance attributes:
 *  - `aAspectUv` (vec4: u, v, du, dv)
 *  - `aFlashMask` (float: 0 = steady, 1 = 1.2 Hz flashing amber for night/fault mode)
 *  - `aBrightness` (float: 0..1.5 per-lens intensity)
 */
export function createVriLedMaterial(atlasTexture, signalUniforms = createLiveSignalUniforms()) {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.48,
    metalness: 0.05,
  });
  material.name = 'EdeLiveVriLedMaterial';
  material.userData.signalUniforms = signalUniforms;

  const aspectUv = attribute('aAspectUv', 'vec4');
  const flashMask = attribute('aFlashMask', 'float');
  const brightness = attribute('aBrightness', 'float');

  const localUv = uv();
  const atlasUv = aspectUv.xy.add(aspectUv.zw.mul(localUv));
  const sampled = atlasTexture ? texture(atlasTexture, atlasUv).rgb : vec3(0.08, 0.09, 0.1);

  // Dark polycarbonate unlit lens housing.
  material.colorNode = color(0x141618);

  material.emissiveNode = Fn(() => {
    const luma = max(sampled.r, max(sampled.g, sampled.b));
    const litPixel = smoothstep(0.16, 0.34, luma);

    // 1.2 Hz flashing duty cycle for night/fault amber mode.
    const blinkWave = step(0.0, sin(signalUniforms.uTime.mul(signalUniforms.uVriFlashHz).mul(TWO_PI)));
    const flashGate = mix(float(1.0), blinkWave, clamp(flashMask, 0.0, 1.0));

    // Fine circular LED Fresnel micro-pattern inside the VRI lens.
    const microLens = ledDotMatrixMask(localUv, float(18.0));
    const radial = smoothstep(0.40, 0.49, length(localUv.sub(0.5))).oneMinus();

    const exposure = daylightLuminanceScale(signalUniforms.uSunElevation).mul(0.95);
    const cone = forwardOpticalCone();
    return sampled.mul(litPixel).mul(microLens).mul(radial).mul(flashGate).mul(exposure).mul(cone).mul(brightness);
  })();

  return material;
}

/**
 * Helper to update shared optical uniforms each frame.
 */
export function updateLiveSignalUniforms(signalUniforms, simTimeSeconds, sunElevationY = 0.45) {
  signalUniforms.uTime.value = simTimeSeconds;
  signalUniforms.uSunElevation.value = sunElevationY;
}
