import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec3,
  uniform,
  mix,
  fog,
  pmremTexture,
  positionWorld,
  positionView,
  cameraPosition,
  cameraFar,
  length,
  normalize,
  max,
  exp,
  abs,
  select,
  dot,
  smoothstep,
  sqrt,
  If
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js?v=20261127-photo-scenes';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { cityUniforms, setPhotoFrost } from './tsl-materials.js';
import { snowCover } from './ede-snow.js';
import { directSunFactor, edeSun, livePresetBlend } from './live-sky.js';
import { edeMoon } from './ede-moon.js';
import { createPhotoSky } from './ede-photo-sky.js';
import { liveWindowLights, PRESET_WINDOW_LIGHTS } from './ede-window-lights.js';

// Atmospheric sky, environment lighting, sunlight and time-of-day presets.

const TIME_PRESETS = {
  golden: {
    id: 'golden',
    sunDir: new THREE.Vector3(-0.44, 0.58, -0.68).normalize(),
    sunColor: 0xffca92,
    sunIntensity: 5.8,
    hemiSky: 0x9abbe6,
    hemiGround: 0xc88a62, // Warm terracotta / limestone upward canyon bounce
    hemiIntensity: 1.48,
    skyTop: 0x2c568c,
    skyHorizon: 0xebd1b5,
    fogColor: 0xdcc5ae,
    fogDensity: 0.00024,
    interiorGlow: 0.48,
    envIntensity: 0.54,
    canyonBounce: 0.52,
    turbidity: 8.0,
    rayleigh: 2.8,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.88,
    cloudCoverage: 0.36,
    cloudDensity: 0.38,
    skyExposure: 0.148,
    nightFactor: 0.0
  },
  midday: {
    id: 'midday',
    sunDir: new THREE.Vector3(-0.34, 0.82, -0.46).normalize(),
    sunColor: 0xfff5e8,
    sunIntensity: 6.6,
    hemiSky: 0xaad2ff,
    hemiGround: 0xb89678, // Warm sunlit masonry & pavement bounce
    hemiIntensity: 1.58,
    skyTop: 0x225ea8,
    skyHorizon: 0xc8dff5,
    fogColor: 0xc6dcf2,
    fogDensity: 0.00018,
    interiorGlow: 0.24,
    envIntensity: 0.58,
    canyonBounce: 0.58,
    turbidity: 6.5,
    rayleigh: 2.4,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.86,
    cloudCoverage: 0.32,
    cloudDensity: 0.35,
    skyExposure: 0.142,
    nightFactor: 0.0
  },
  twilight: {
    id: 'twilight',
    sunDir: new THREE.Vector3(-0.52, 0.36, -0.77).normalize(),
    sunColor: 0xff9466,
    sunIntensity: 3.1,
    hemiSky: 0x4c6ca8,
    hemiGround: 0x6e5048,
    hemiIntensity: 0.85,
    skyTop: 0x102248,
    skyHorizon: 0xb86b6c,
    fogColor: 0x353c58,
    fogDensity: 0.00032,
    interiorGlow: 1.25,
    envIntensity: 0.36,
    canyonBounce: 0.32,
    turbidity: 9.5,
    rayleigh: 3.4,
    mieCoefficient: 0.010,
    mieDirectionalG: 0.90,
    cloudCoverage: 0.40,
    cloudDensity: 0.42,
    skyExposure: 0.115,
    nightFactor: 0.28
  },
  midnight: {
    id: 'midnight',
    sunDir: new THREE.Vector3(0.42, 0.68, -0.60).normalize(),
    skySunDir: new THREE.Vector3(0, -1, 0),
    showSunDisc: 0,
    sunColor: 0x8cb0e8,
    sunIntensity: 1.45,
    hemiSky: 0x263a62,
    hemiGround: 0x382e36,
    hemiIntensity: 0.72,
    skyTop: 0x060c1a,
    skyHorizon: 0x182640,
    fogColor: 0x0c1424,
    fogDensity: 0.00036,
    interiorGlow: 1.55,
    envIntensity: 0.30,
    canyonBounce: 0.18,
    turbidity: 4.0,
    rayleigh: 1.5,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.80,
    cloudCoverage: 0.22,
    cloudDensity: 0.25,
    skyExposure: 0.022,
    nightFactor: 0.86
  }
};

const COLOR_KEYS = ['sunColor', 'hemiSky', 'hemiGround', 'skyTop', 'skyHorizon', 'fogColor'];
const NUMBER_KEYS = ['sunIntensity', 'hemiIntensity', 'fogDensity', 'interiorGlow', 'envIntensity',
  'canyonBounce', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity',
  'skyExposure', 'nightFactor'];

function lerpHex(a, b, weight) {
  const channel = (shift) => Math.round(THREE.MathUtils.lerp((a >> shift) & 255, (b >> shift) & 255, weight));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

class LightingSystem {
  constructor(scene, renderer = null) {
    this.scene = scene;
    this.activePresetId = 'golden';
    this.live = false;
    this.weather = null;
    this.hadWeather = false;
    this.weatherBakeTimer = null;

    // Register SunLight with either supported Three.js light-node API.
    if (SunLight.registerNode) {
      SunLight.registerNode(SunLightNode);
    } else if (renderer && renderer.library) {
      renderer.library.addLight(SunLightNode, SunLight);
    }

    this.scene.fog = new THREE.FogExp2(0xdcc5ae, 0.00024);
    // Leave scene.background = null because SkyMesh renders the 360° sky dome, and setting
    // a THREE.Color on scene.background sets forceClear=true in WebGPURenderer's Background.update,
    // which would otherwise clear Cascade 0 when rendering Cascade 1 in SunShadowNode!
    this.scene.background = null;

    // Physical Preetham SkyMesh + Beer-Powder Clouds (from three/addons/objects/SkyMesh.js). Its unit box must contain
    // the camera wherever it flies over the 1:1 harbour (Manhattan alone is 13.6 km long; it renders at the far plane
    // whatever its size)
    // Calibrate raw sky radiance and composite the Moon behind the existing cloud layer.
    this.uSkyExposure = uniform(0.148);
    this.uNightFactor = uniform(0.0);
    this.uNightSkyColor = uniform(new THREE.Color(0x0b1528));
    this.uShowMoon = uniform(0.0);
    this.uMoonDirection = uniform(new THREE.Vector3());
    this.uMoonSun = uniform(new THREE.Vector3());
    this.uMoonRadius = uniform(0.0045);
    this.uMoonVisibility = uniform(1.0);
    this.photoSky = createPhotoSky();
    this.uPhotoSkyEnabled = uniform(1);
    this.sky = new SkyMesh((raw, ray, cloudTransmission, extinction, sampleCloudTransmission) => {
      const sky = mix(raw.mul(this.uSkyExposure), this.uNightSkyColor, this.uNightFactor).toVar();
      const alignment = dot(ray, this.uMoonDirection);
      If(this.uShowMoon.greaterThan(0).and(ray.y.greaterThan(0)).and(alignment.greaterThan(0.99995)), () => {
        const offset = ray.sub(this.uMoonDirection.mul(alignment)).div(this.uMoonRadius);
        const radiusSquared = dot(offset, offset);
        const edge = smoothstep(0.82, 1, radiusSquared).oneMinus();
        // Reconstruct the visible sphere and shade its sun-facing hemisphere.
        const normal = offset.sub(this.uMoonDirection.mul(sqrt(radiusSquared.oneMinus().max(0))));
        const incidence = dot(normal, this.uMoonSun);
        const lit = smoothstep(0, 0.08, incidence).mul(incidence.max(0.25));
        sky.addAssign(extinction.mul(lit.mul(edge).mul(cloudTransmission).mul(this.uMoonVisibility)));
      });
      If(this.uPhotoSkyEnabled.greaterThan(0), () => {
        const composite = this.photoSky.composite(sky, ray, cloudTransmission, extinction,
          this.sky.sunPosition, this.uNightFactor, sampleCloudTransmission);
        if (composite !== sky) sky.assign(composite);
      });
      return sky;
    });
    this.sky.scale.setScalar(200000);
    this.sky.turbidity.value = 8.0;
    this.sky.rayleigh.value = 2.8;
    this.sky.mieCoefficient.value = 0.008;
    this.sky.mieDirectionalG.value = 0.88;
    this.sky.cloudScale.value = 0.00018;
    this.sky.cloudSpeed.value = 0.000015;
    this.sky.cloudCoverage.value = 0.36;
    this.sky.cloudDensity.value = 0.38;
    this.sky.cloudElevation.value = 0.52;

    // In reversedDepthBuffer mode ([1..0]), camera.far is z = 0.0 (whereas SkyMesh defaults to z = w)
    if (renderer && renderer.reversedDepthBuffer) {
      const rawSkyVertexNode = this.sky.material.vertexNode;
      this.sky.material.vertexNode = Fn(() => {
        const pos = rawSkyVertexNode.toVar();
        pos.z.assign(0.0);
        return pos;
      })();
    }

    this.scene.add(this.sky);

    // Reuse the environment scene and PMREM generator when the lighting preset changes.
    this.pmremGenerator = renderer ? new THREE.PMREMGenerator(renderer) : null;
    this.envScene = new THREE.Scene();
    this.envRenderTarget = null;

    // Two-cascade sunlight points from its position toward the origin; no target object is needed.
    this.sunLight = new SunLight(0xffca92, 5.8);
    this.sunLight.position.copy(TIME_PRESETS.golden.sunDir);
    this.sunLight.castShadow = true;
    // Two cascades share an atlas: use 3072px tiles when a 6144px texture fits, otherwise 2048px tiles.
    const maxTex = (renderer && renderer.backend && renderer.backend.device && renderer.backend.device.limits.maxTextureDimension2D) || 4096;
    const tile = maxTex >= 6144 ? 3072 : 2048;
    this.sunLight.shadow.mapSize.set(tile, tile);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 300;
    // Suppress shadow acne along the surface normal in world units
    // so short casters like cars, curbs, tree trunks, and pedestrians keep crisp contact shadows
    this.sunLight.shadow.normalBias = 0.05;
    this.scene.add(this.sunLight);

    // Subtle Hemisphere Sky + Warm Terracotta/Limestone Ground Bounce Fill
    // (Kept intentionally lower than sunLight so urban canyon shadows remain deep and crisp)
    this.hemiLight = new THREE.HemisphereLight(0x9abbe6, 0xc88a62, 1.05);
    this.hemiLight.position.set(0, 300, 0);
    this.scene.add(this.hemiLight);

    this.applyPreset('golden');

    // Sky-matched aerial perspective (replaces the flat FogExp2 colour): distant surfaces fade into the baked sky
    // radiance just above the horizon in their view direction (sun glow included), through an exponential haze layer
    // so helicopter / observatory views stay clearer than the horizon.
    this.uFogDensity = uniform(TIME_PRESETS.golden.fogDensity);
    this.uFogHeight = uniform(900.0);
    if (this.envRenderTarget) this.scene.fogNode = this.createAerialFogNode();
  }

  createAerialFogNode() {
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag);
    const dir = toFrag.div(max(dist, 0.001));
    const horizonDir = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
    const skyColor = pmremTexture(this.envRenderTarget.texture, horizonDir, float(0.0)).rgb;
    // Mean haze density exp(-y / H) along the ray between the fragment and the camera
    const H = this.uFogHeight;
    const ya = max(positionWorld.y, 0.0);
    const yb = max(cameraPosition.y, 0.0);
    const dy = yb.sub(ya);
    const ea = exp(ya.div(H).negate());
    const eb = exp(yb.div(H).negate());
    const meanDensity = select(abs(dy).greaterThan(1.0), ea.sub(eb).mul(H).div(dy), ea);
    const tau = this.uFogDensity.mul(dist).mul(meanDensity);
    // Blend to the horizon before the moving far plane clips the landscape.
    const rangeFade = smoothstep(cameraFar.mul(0.7), cameraFar, positionView.z.negate());
    return fog(skyColor, mix(float(1.0).sub(exp(tau.mul(tau).negate())), 1, rangeFade));
  }

  bakeEnvironmentMap() {
    if (!this.pmremGenerator) return;
    // Keep sharp and transient highlights out of the environment map.
    // Reuses a single RenderTarget so texture identity never changes.
    const showDisc = this.sky.showSunDisc.value;
    const showMoon = this.uShowMoon.value;
    this.sky.showSunDisc.value = 0;
    this.uShowMoon.value = 0;
    this.uPhotoSkyEnabled.value = 0;
    this.envScene.add(this.sky);
    this.envRenderTarget = this.pmremGenerator.fromScene(this.envScene, 0, 0.1, 100, {
      renderTarget: this.envRenderTarget
    });
    this.scene.environment = this.envRenderTarget.texture;
    this.bakedCloudCoverage = this.sky.cloudCoverage.value;
    this.bakedCloudDensity = this.sky.cloudDensity.value;
    this.sky.showSunDisc.value = showDisc;
    this.uShowMoon.value = showMoon;
    this.uPhotoSkyEnabled.value = 1;
    this.scene.add(this.sky);
  }

  applyPreset(presetId, force = false, sunElevation) {
    const base = TIME_PRESETS[presetId] || TIME_PRESETS.golden;
    if (!force && !this.live && this.activePresetId === base.id &&
        this.presetSunElevation === sunElevation && this.envRenderTarget !== null) return;

    let p = base;
    if (sunElevation !== undefined) {
      const sunDir = base.sunDir.clone();
      const horizontal = Math.hypot(sunDir.x, sunDir.z);
      sunDir.setY(horizontal * Math.tan(THREE.MathUtils.degToRad(sunElevation))).normalize();
      p = { ...base, sunDir, mieDirectionalG: Math.min(base.mieDirectionalG, 0.78) };
    }
    this.presetSunElevation = sunElevation;
    this.live = false;
    this.uShowMoon.value = 0;
    cityUniforms.uWindowLights.value.set(...PRESET_WINDOW_LIGHTS[p.id]);
    this.applyValues(p);
  }

  applyLive(date) {
    const { elevation, direction } = edeSun(date);
    const moon = edeMoon(date);
    this.uMoonDirection.value.set(...moon.direction);
    this.uMoonSun.value.set(...direction);
    this.uMoonRadius.value = Math.sin(moon.angularRadius);
    this.uShowMoon.value = Number(moon.direction[1] > -this.uMoonRadius.value);
    cityUniforms.uWindowLights.value.set(...liveWindowLights(date, elevation));
    const blend = livePresetBlend(elevation);
    const { from, to, weight } = blend;
    const a = TIME_PRESETS[from];
    const b = TIME_PRESETS[to];
    this.live = true;
    if (from === 'midnight' && weight === 0) {
      if (this.basePreset !== a) this.applyValues(a);
      return blend;
    }
    const skySunDir = new THREE.Vector3(...direction);
    const p = { id: weight < 0.5 ? from : to, skySunDir, sunDir: skySunDir,
      showSunDisc: THREE.MathUtils.smoothstep(elevation, 0, 0.5) };
    for (const key of NUMBER_KEYS) p[key] = THREE.MathUtils.lerp(a[key], b[key], weight);
    for (const key of COLOR_KEYS) p[key] = lerpHex(a[key], b[key], weight);
    // Fade sunlight at the horizon, then bring in the Night preset's cool fill through twilight.
    p.sunIntensity *= directSunFactor(elevation);
    if (from === 'midnight') {
      p.sunDir = a.sunDir;
      p.sunIntensity = a.sunIntensity * (1 - weight);
    }
    this.applyValues(p);
    return blend;
  }

  applyValues(p) {
    this.activePresetId = p.id;
    this.basePreset = p;

    this.sunLight.color.setHex(p.sunColor);
    this.sunLight.position.copy(p.sunDir);
    this.sunLight.updateMatrixWorld();

    this.hemiLight.color.setHex(p.hemiSky);
    this.hemiLight.groundColor.setHex(p.hemiGround);
    this.scene.fog.color.setHex(p.fogColor);

    // Update physical Preetham SkyMesh uniforms
    this.sky.turbidity.value = p.turbidity;
    this.sky.rayleigh.value = p.rayleigh;
    this.sky.mieCoefficient.value = p.mieCoefficient;
    this.sky.mieDirectionalG.value = p.mieDirectionalG;
    this.sky.sunPosition.value.copy(p.skySunDir ?? p.sunDir);
    this.sky.showSunDisc.value = p.showSunDisc ?? 1;
    this.uSkyExposure.value = p.skyExposure;
    this.uNightFactor.value = p.nightFactor;

    cityUniforms.uSunColor.value.setHex(p.sunColor);
    cityUniforms.uSkyTopColor.value.setHex(p.skyTop);
    cityUniforms.uSkyHorizonColor.value.setHex(p.skyHorizon);
    cityUniforms.uSkySunDir.value.copy(this.sky.sunPosition.value);
    cityUniforms.uInteriorGlow.value = p.interiorGlow;
    cityUniforms.uCanyonBounce.value = p.canyonBounce;

    this.applyWeather();
    this.bakeEnvironmentMap();
  }

  applyWeather() {
    const p = this.basePreset;
    const weight = this.weather?.blend ?? 0;
    const cloud = this.weather?.cloud ?? 0;
    const mist = this.weather?.mist ?? 0;
    const storm = this.weather?.storm ?? 0;
    const fog = Math.max((this.weather?.fog ?? 0) * weight, mist);
    const { lerp, smoothstep } = THREE.MathUtils;
    // An overcast weather reading can still leave small gaps in the procedural clouds.
    const overcast = smoothstep(cloud, 0.85, 1) * weight;
    this.uMoonVisibility.value = (1 - fog) * (1 - overcast);

    this.sunLight.intensity = p.sunIntensity * (1 - (0.64 * cloud) * weight - 0.17 * fog) * (1 - 0.48 * storm);
    this.hemiLight.intensity = p.hemiIntensity * lerp(1, 0.96 + 0.10 * cloud, weight) * (1 - 0.35 * storm);
    this.scene.environmentIntensity = p.envIntensity * (1 - 0.28 * storm);
    this.sky.cloudCoverage.value = lerp(p.cloudCoverage, cloud, weight);
    this.sky.cloudDensity.value = lerp(p.cloudDensity, 0.22 + 0.68 * cloud, weight);

    const density = lerp(p.fogDensity, 0.0024, fog);
    this.scene.fog.density = density;
    if (this.uFogDensity) this.uFogDensity.value = density;
    if (this.uFogHeight) this.uFogHeight.value = lerp(900, 135, Math.min(1, mist * 2.5));
    cityUniforms.uRoadWetness.value = (this.weather?.wetness ?? 0) * weight;
    cityUniforms.uRoadPuddles.value = this.weather?.raining ? this.weather.rain * weight : 0;
  }

  queueWeatherBake() {
    if (!this.pmremGenerator || this.weatherBakeTimer !== null) return;
    const changed = () => Math.abs(this.bakedCloudCoverage - this.sky.cloudCoverage.value) > 0.002 ||
      Math.abs(this.bakedCloudDensity - this.sky.cloudDensity.value) > 0.002;
    if (!changed()) return;
    // Refresh sky reflections and aerial fog after a blend without baking at the frame cadence.
    this.weatherBakeTimer = setTimeout(() => {
      this.weatherBakeTimer = null;
      if (changed()) this.bakeEnvironmentMap();
    }, 2400);
  }

  update(focusPos, weather, timeSeconds) {
    this.photoSky.update(weather, timeSeconds);
    setPhotoFrost(weather?.frost ?? 0);
    snowCover.value = weather?.snowCover ?? 0;
    cityUniforms.uWaterIce.value = weather?.waterIce ?? 0;
    if (weather?.blend || this.hadWeather) {
      this.weather = weather;
      this.applyWeather();
      this.queueWeatherBake();
      this.hadWeather = Boolean(weather?.blend);
    }
    // SunLightShadow automatically fits & texel-snaps its 2 cascades to the view camera frustum
    // every frame inside SunShadowNode.renderShadow(), splitting [near, far] halfway between a uniform and a
    // logarithmic split (the near cascade ends at ~far / 4). Keep far at 300 m at street level so the near cascade
    // stays sharp, and expand it with altitude (helicopter / observatory) so shadows reach all the way down to street level.
    const altitude = focusPos && Number.isFinite(focusPos.y) ? Math.max(0, focusPos.y) : 0;
    this.sunLight.shadow.camera.far = Math.max(300, Math.min(720, 260 + altitude * 1.6));
  }
}

export { LightingSystem };
