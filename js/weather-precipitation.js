import * as THREE from 'three/webgpu';
import {
  atan, cameraPosition, cameraViewMatrix, float, fract, hash, instanceIndex, mix,
  smoothstep, uniform, uv, varying, vec2, vec3, vec4
} from 'three/tsl';
import { isUnderEdeRoof } from './ede-grade.js';
import { transparentEffectMRT } from './tsl-materials.js';

const WIDTH = 32, HEIGHT = 22;
const MAX_PARTICLES = 1200;
const RAIN_SPEED = 9, SNOW_SPEED = 1.2;
const wrap = (value, period) => value - Math.floor(value / period) * period;

export function createWeatherPrecipitation(scene) {
  const wind = uniform(new THREE.Vector2());
  const drift = uniform(new THREE.Vector2());
  const rainFall = uniform(0), snowFall = uniform(0), flutter = uniform(0);
  const snowFraction = uniform(0);
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.mrtNode = transparentEffectMRT;

  // The camera picks a nearby volume from a moving, world-aligned tile of particles.
  const id = float(instanceIndex);
  const seed = vec3(hash(id), hash(id.add(17)), hash(id.add(41)));
  const snow = hash(id.add(73)).lessThan(snowFraction);
  const box = vec3(WIDTH, HEIGHT, WIDTH);
  const sway = vec2(seed.x.mul(40).add(flutter).sin(), seed.z.mul(40).add(flutter).cos()).mul(0.35);
  const horizontal = drift.add(snow.select(sway, vec2(0)));
  const travel = vec3(horizontal.x, snow.select(snowFall, rainFall).negate(), horizontal.y);
  const local = fract(seed.add(travel.sub(cameraPosition).div(box))).sub(0.5).mul(box);
  material.positionNode = cameraPosition.add(local);

  const streak = cameraViewMatrix.mul(vec4(wind.x, -RAIN_SPEED, wind.y, 0)).xy;
  const flakeSize = mix(0.065, 0.15, seed.y);
  material.scaleNode = snow.select(vec2(flakeSize), vec2(mix(0.016, 0.028, seed.y), streak.length().mul(0.095).max(0.08)));
  material.rotationNode = snow.select(0, atan(streak.x.negate(), streak.y.add(0.0001)));

  const isSnow = varying(snow.select(1, 0));
  const near = varying(smoothstep(1.6, 3.4, local.length()));
  const normalized = local.div(box).abs();
  const edge = varying(smoothstep(0.4, 0.5, normalized.x.max(normalized.y).max(normalized.z)).oneMinus());
  const sprite = uv().sub(0.5);
  const line = smoothstep(0.1, 0.5, sprite.x.abs()).oneMinus().mul(smoothstep(0.13, 0.5, sprite.y.abs()).oneMinus());
  const flake = smoothstep(0.12, 0.5, sprite.length()).oneMinus();
  material.colorNode = mix(vec3(0.53, 0.62, 0.73), vec3(0.83, 0.89, 0.97), isSnow);
  material.opacityNode = mix(line.mul(0.38), flake.mul(0.84), isSnow).mul(near).mul(edge);

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  mesh.name = 'WeatherPrecipitation';
  mesh.visible = false;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);

  const position = new THREE.Vector3();
  function update(dt, camera, weather) {
    const rain = Math.max(0, weather.rain);
    const snow = Math.max(0, weather.snow);
    const count = Math.min(MAX_PARTICLES, Math.round(MAX_PARTICLES * (rain + 0.72 * snow)));
    mesh.count = 0;
    mesh.visible = false;
    if (!count) return;
    camera.getWorldPosition(position);
    if (isUnderEdeRoof(position.x, position.y, position.z)) return;

    mesh.count = count;
    mesh.visible = true;
    snowFraction.value = 0.72 * snow / (rain + 0.72 * snow);
    wind.value.set(weather.windX * 0.6, weather.windZ * 0.6);
    drift.value.set(wrap(drift.value.x + wind.value.x * dt, WIDTH), wrap(drift.value.y + wind.value.y * dt, WIDTH));
    rainFall.value = wrap(rainFall.value + RAIN_SPEED * dt, HEIGHT);
    snowFall.value = wrap(snowFall.value + SNOW_SPEED * dt, HEIGHT);
    flutter.value = wrap(flutter.value + 1.5 * dt, Math.PI * 2);
  }

  return { update };
}
