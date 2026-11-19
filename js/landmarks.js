import * as THREE from 'three/webgpu';
import { LANDMARK_SITES, projectLonLat } from './city-config.js';
import { createChicaSculpture, createChicoSculpture, createShermanMonument } from './street-props.js';
import { terrainHeightAt } from './terrain.js';
import { EDE_MODELED_LANDMARKS, modeledLandmarkFootprints } from './ede-landmark-sites.js';
import { createConcordiamolen } from './ede-concordiamolen.js';
import { createStingerbol } from './ede-stingerbol.js';
import { createEnkaChimney } from './ede-enka-chimneys.js';
import { createAstrant, createPegasusFlat } from './ede-mural-landmarks.js';
import { createPlantion } from './ede-plantion.js';
import { createFrisoKazerne } from './ede-friso-kazerne.js';
import { createEdeStationLandmark } from './ede-station-landmark.js';
import { createEnkaWesthal, createOudeKerk } from './ede-enka-kerk.js';
import { createMauritskazerne, createVuurvogel } from './ede-heritage-landmarks.js';
import { createEdeCentrumStation, createHuisKernhem } from './ede-historic-landmarks.js';
import { createRaadhuis, createCultura } from './ede-civic-landmarks.js';

// The engine's hand-built New York monuments are removed. Legacy exports keep the upstream controllers working.
export let bryantParkLawn = null;
export const LANDMARKS = [];
export const BERGHAIN_TREE_SITES = [];
export const LANDMARK_SOURCE_EXCLUSIONS = new Set([
  ...EDE_MODELED_LANDMARKS.flatMap(site => [site.osmId, ...(site.annexOsmIds ?? []), ...(site.excludeOsmIds ?? [])]),
  // The second outline is over the real station steps and bicycle parking.
  'w1156797030', 'w1156797029',
]);
const shermanSite = LANDMARK_SITES['Sherman Tank'];
// The individual bases are visible in the PDOK 2025 orthophoto.
const chicoSite = projectLonLat(5.67364625, 52.0456085);
const chicaSite = projectLonLat(5.67356375, 52.04564305);
function footprintBounds({ outer }) {
  return { minX: Math.min(...outer.map(p => p.x)), maxX: Math.max(...outer.map(p => p.x)),
    minZ: Math.min(...outer.map(p => p.z)), maxZ: Math.max(...outer.map(p => p.z)) };
}

export const LANDMARK_EXCLUSIONS = [
  { minX: shermanSite.x - 3.5, maxX: shermanSite.x + 3.5, minZ: shermanSite.z - 2, maxZ: shermanSite.z + 2 },
  ...[chicoSite, chicaSite].map(({ x, z }) => ({ minX: x - 1.8, maxX: x + 1.8, minZ: z - 1.8, maxZ: z + 1.8 })),
];

export function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'EdeLandmarks';
  const colliders = [];
  scene.add(group);

  function place(model, { x, z }, heading, footprints = [], baseY, colliderHeights = [], worldSpace = false) {
    const ground = baseY ?? terrainHeightAt(x, z);
    if (!worldSpace) {
      model.position.set(x, ground, z);
      model.rotation.y = heading;
    }
    group.add(model);
    if (model.userData.colliders) {
      colliders.push(...model.userData.colliders);
      return;
    }
    const { min, max } = new THREE.Box3().setFromObject(model, !footprints.length);
    if (!footprints.length) {
      colliders.push({ minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z, minY: min.y, maxY: max.y });
      return;
    }
    footprints.forEach((polygon, index) => colliders.push({
      ...footprintBounds(polygon), polygon, minY: min.y,
      maxY: colliderHeights[index] === undefined ? max.y : ground + colliderHeights[index],
    }));
  }
  // The Sherman faces west along the liberation route.
  place(createShermanMonument(), shermanSite, -Math.PI / 2);
  place(createChicoSculpture(), chicoSite, 1.18);
  place(createChicaSculpture(), chicaSite, 1.32);
  const models = {
    concordiamolen: createConcordiamolen,
    stingerbol: createStingerbol,
    'grote-enka-schoorsteen': () => createEnkaChimney('grote'),
    'kleine-enka-schoorsteen': () => createEnkaChimney('kleine'),
    astrant: createAstrant,
    'pegasus-flat': createPegasusFlat,
    plantion: createPlantion,
    'johan-willem-friso': createFrisoKazerne,
    'enka-westhal': createEnkaWesthal,
    mauritskazerne: createMauritskazerne,
    oudekerk: createOudeKerk,
    edecentrum: createEdeCentrumStation,
    'huis-kernhem': createHuisKernhem,
    'de-vuurvogel': createVuurvogel,
    raadhuis: createRaadhuis,
    cultura: createCultura,
  };
  for (const site of EDE_MODELED_LANDMARKS) {
    const footprints = modeledLandmarkFootprints(site);
    const model = models[site.id](footprints);
    model.name = site.name;
    place(model, site.modelOrigin ?? site, site.heading, footprints, site.baseY, site.colliderHeights, site.worldSpace);
  }
  const station = createEdeStationLandmark();
  group.add(station);
  colliders.push(...station.userData.colliders);
  return { group, colliders, exclusions: LANDMARK_EXCLUSIONS, update() {} };
}
