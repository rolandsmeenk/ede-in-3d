import * as THREE from 'three/webgpu';
import { LANDMARK_SITES, projectLonLat } from './city-config.js';
import { createChicaSculpture, createChicoSculpture, createShermanMonument } from './street-props.js';
import { terrainHeightAt } from './terrain.js';

// The engine's hand-built New York monuments are removed. Legacy exports keep the upstream controllers working.
export let bryantParkLawn = null;
export const LANDMARKS = [];
export const BERGHAIN_TREE_SITES = [];
export const LANDMARK_SOURCE_EXCLUSIONS = new Set();
const shermanSite = LANDMARK_SITES['Sherman Tank'];
// The individual bases are visible in the PDOK 2025 orthophoto.
const chicoSite = projectLonLat(5.67364625, 52.0456085);
const chicaSite = projectLonLat(5.67356375, 52.04564305);
export const LANDMARK_EXCLUSIONS = [
  { minX: shermanSite.x - 3.5, maxX: shermanSite.x + 3.5, minZ: shermanSite.z - 2, maxZ: shermanSite.z + 2 },
  ...[chicoSite, chicaSite].map(({ x, z }) => ({ minX: x - 1.8, maxX: x + 1.8, minZ: z - 1.8, maxZ: z + 1.8 }))
];

export function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'EdeLandmarks';
  const colliders = [];
  scene.add(group);

  function place(model, { x, z }, heading) {
    model.position.set(x, terrainHeightAt(x, z), z);
    model.rotation.y = heading;
    group.add(model);
    const { min, max } = new THREE.Box3().setFromObject(model, true);
    colliders.push({ minX: min.x, maxX: max.x, minY: min.y, maxY: max.y, minZ: min.z, maxZ: max.z });
  }
  // The Sherman faces west along the liberation route.
  place(createShermanMonument(), shermanSite, -Math.PI / 2);
  place(createChicoSculpture(), chicoSite, 1.18);
  place(createChicaSculpture(), chicaSite, 1.32);
  return { group, colliders, exclusions: LANDMARK_EXCLUSIONS, update() {} };
}
