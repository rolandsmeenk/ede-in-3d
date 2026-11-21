import * as THREE from 'three/webgpu';
import { LANDMARK_SITES, projectLonLat } from './city-config.js';
import { createChicaSculpture, createChicoSculpture, createShermanMonument } from './street-props.js';
import { terrainHeightAt } from './terrain.js';
import { EDE_MODELED_LANDMARKS, modeledLandmarkFootprints } from './ede-landmark-sites.js';
import { createConcordiaComplex } from './ede-concordia-buildings.js';
import { createStingerbol } from './ede-stingerbol.js';
import { createEnkaChimney } from './ede-enka-chimneys.js';
import { createAstrant, createPegasusFlat } from './ede-mural-landmarks.js';
import { createPlantion } from './ede-plantion.js';
import { createFrisoKazerne } from './ede-friso-kazerne.js';
import { createAkoesticumFlags } from './ede-akoesticum-flags.js';
import { createEdeStationLandmark } from './ede-station-landmark.js';
import { createEnkaWesthal, createOudeKerk } from './ede-enka-kerk.js';
import { createMauritskazerne, createVuurvogel } from './ede-heritage-landmarks.js';
import { createEdeCentrumStation, createHuisKernhem } from './ede-historic-landmarks.js';
import { createKeetmolen, createDePeppel } from './ede-north-landmarks.js';
import { createCheCampus } from './ede-campus-landmark.js';
import { createNieuweKerk, createNoorderkerk, createSintAntoniuskerk, createBeatrixkerk, createAdditionalChurch } from './ede-church-landmarks.js';
import { CHURCH_STYLES } from './ede-church-styles.js';
import { createLukkien } from './ede-lukkien.js';
import { createHoekelum, createGasfabriek } from './ede-estate-landmarks.js';
import { createNizoLandmark, createGelderseValleiLandmark } from './ede-research-landmarks.js';
import { createReehorst, createBuitenzorg, createJohannus } from './ede-venue-landmarks.js';
import { createEderKuil, createPallasAthene, createTechnova, createTesqua } from './ede-next-landmarks.js';
import { createCropOffice, createPatheEde, createStadspoort } from './ede-retail-landmarks.js';
import { createRiedelSilos, createKappaDocie } from './ede-riedel-silos.js';
import { buildMuralWalls } from './ede-mural-surfaces.js';
import { createRaadhuis, createCultura } from './ede-civic-landmarks.js';
import { createWaterzuivering } from './ede-waterzuivering.js';
import { createOudeHofstede, createProosdij } from './ede-kinderboerderij.js';
import { createMausoleum } from './ede-mausoleum.js';
import { createPointGrowth } from './ede-point-growth.js';
import { createOnTheRocks } from './ede-on-the-rocks.js';
import { createWorkGarden } from './ede-work-garden.js';
import { buildEdeFuelStations } from './ede-fuel-stations.js';
import { EDE_FUEL_SITES } from './ede-fuel-sites.js';
import { PUBLIC_LANDMARK_FACTORIES } from './ede-public-landmarks.js';
import { SCHOOL_LANDMARK_FACTORIES } from './ede-school-landmarks.js';
import { SPORT_LANDMARK_FACTORIES } from './ede-sport-landmarks.js';
import { AMSTERDAMSEWEG_LANDMARK_FACTORIES } from './ede-amsterdamseweg-landmarks.js';
import { NIJVERHEIDPLEIN_LANDMARK_FACTORIES } from './ede-nijverheidplein-landmarks.js';
import { STATIONSWEG_LANDMARK_FACTORIES } from './ede-stationsweg-landmarks.js';
import { EDE_RESTAURANT_ROW_BUILDERS } from './ede-restaurant-row.js';
import { EDE_RESTAURANT_ESTATE_BUILDERS } from './ede-restaurant-estates.js';
import { EXPANSION_LANDMARK_FACTORIES } from './ede-expansion-landmarks.js';
import { createPomphuis } from './ede-pomphuis.js';
import { createVillaBrutusTerraces } from './ede-villa-brutus.js';
import { createUluCamii } from './ede-ulu-camii.js';
import { MOSQUE_LANDMARK_FACTORIES } from './ede-mosque-landmarks.js';
import { BARRACKS_HERITAGE_FACTORIES } from './ede-barracks-heritage-landmarks.js';
import { VILLA_HERITAGE_FACTORIES } from './ede-villa-heritage-landmarks.js';
import { VELDHUIZEN_LANDMARK_FACTORIES } from './ede-veldhuizen-landmarks.js';
import { createKopParkweg } from './ede-kop-parkweg.js';
import { createHartogshof } from './ede-hartogshof.js';
import { createAkulaanApartments, createParkveste } from './ede-rail-apartments.js';

// The engine's hand-built New York monuments are removed. Legacy exports keep the upstream controllers working.
export let bryantParkLawn = null;
export const LANDMARKS = [];
export const BERGHAIN_TREE_SITES = [];
export const LANDMARK_SOURCE_EXCLUSIONS = new Set([
  ...EDE_MODELED_LANDMARKS.flatMap(site => [site.osmId, ...(site.annexOsmIds ?? []), ...(site.excludeOsmIds ?? [])]),
  ...EDE_FUEL_SITES.flatMap(site => [site.canopyOsmId, site.shop?.osmId].filter(Boolean)),
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

export function buildLandmarks(scene, { historicUtilities } = {}) {
  const group = new THREE.Group();
  group.name = 'EdeLandmarks';
  const colliders = [], platforms = [], helipads = [], nearDetails = [], windUpdates = [], weatherCovers = [];
  const landmarkLods = [];
  const replacements = { bag: new Set(), osm: new Set() };
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
    concordiamolen: createConcordiaComplex,
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
    'riedel-silos': createRiedelSilos,
    'kappa-docie': createKappaDocie,
    stadspoort: createStadspoort,
    'pathe-ede': createPatheEde,
    'crop-office': createCropOffice,
    lukkien: createLukkien,
    keetmolen: createKeetmolen,
    'de-peppel': createDePeppel,
    'che-campus': createCheCampus,
    'nieuwe-kerk': createNieuweKerk,
    noorderkerk: createNoorderkerk,
    'sint-antoniuskerk': createSintAntoniuskerk,
    beatrixkerk: createBeatrixkerk,
    hoekelum: createHoekelum,
    nizo: createNizoLandmark,
    ziekenhuis: createGelderseValleiLandmark,
    openluchttheater: createEderKuil,
    reehorst: createReehorst,
    buitenzorg: createBuitenzorg,
    'work-garden': createWorkGarden,
    'johannus-orgelbouw': createJohannus,
    technova: createTechnova,
    gasfabriek: createGasfabriek,
    mausoleum: createMausoleum,
    'point-growth': createPointGrowth,
    'on-the-rocks': createOnTheRocks,
    'rwzi-ede': createWaterzuivering,
    'oude-hofstede': createOudeHofstede,
    'de-proosdij': createProosdij,
    'pallas-athene': createPallasAthene,
    tesqua: createTesqua,
    'ulu-camii': createUluCamii,
    ...MOSQUE_LANDMARK_FACTORIES,
    ...BARRACKS_HERITAGE_FACTORIES,
    ...VILLA_HERITAGE_FACTORIES,
    ...VELDHUIZEN_LANDMARK_FACTORIES,
    'kop-van-de-parkweg': createKopParkweg,
    hartogshof: createHartogshof,
    'akulaan-h2-h4': createAkulaanApartments,
    parkveste: createParkveste,
    ...PUBLIC_LANDMARK_FACTORIES,
    ...SCHOOL_LANDMARK_FACTORIES,
    ...SPORT_LANDMARK_FACTORIES,
    ...AMSTERDAMSEWEG_LANDMARK_FACTORIES,
    ...NIJVERHEIDPLEIN_LANDMARK_FACTORIES,
    ...STATIONSWEG_LANDMARK_FACTORIES,
    'het-pomphuis': createPomphuis,
    ...EDE_RESTAURANT_ROW_BUILDERS,
    ...EDE_RESTAURANT_ESTATE_BUILDERS,
    ...EXPANSION_LANDMARK_FACTORIES,
  };
  function registerDetail(detail) {
    const range = detail.userData.nearDetail;
    if (range) {
      detail.updateWorldMatrix(true, false);
      nearDetails.push({ detail, bounds: new THREE.Box3().setFromObject(detail),
        distance: typeof range === 'number' ? range : 175 });
    }
    const wind = detail.userData.updateWind;
    if (wind) windUpdates.push((dt, reading) => {
      if (detail.visible) wind(dt, reading);
    });
  }
  for (const site of EDE_MODELED_LANDMARKS) {
    const footprints = modeledLandmarkFootprints(site);
    const model = site.churchSurvey ? createAdditionalChurch(site, site.churchSurvey, CHURCH_STYLES[site.id])
      : models[site.id](footprints, site);
    model.name = site.name;
    platforms.push(...(model.userData.platforms ?? []));
    helipads.push(...(model.userData.helipads ?? []));
    place(model, site.modelOrigin ?? site, site.heading, footprints, site.baseY, site.colliderHeights, site.worldSpace);
    model.traverse(registerDetail);
    if (model.userData.landmarkLod) {
      const lod = model.userData.landmarkLod;
      landmarkLods.push({ ...lod, bounds: new THREE.Box3().setFromObject(model), far: false });
    }
  }
  const brutus = createVillaBrutusTerraces();
  group.add(brutus);
  colliders.push(...brutus.userData.colliders);
  brutus.traverse(registerDetail);
  for (const site of historicUtilities?.EDE_HISTORIC_UTILITIES ?? []) {
    try {
      const model = historicUtilities.createHistoricUtility(site);
      if (!model?.children.length || !model.userData.colliders?.length) throw new Error('missing exterior or collision footprint');
      model.name = site.name;
      place(model, site, 0, [], undefined, [], true);
      model.traverse(registerDetail);
      if (site.bagId) replacements.bag.add(site.bagId);
      if (site.osmId) replacements.osm.add(site.osmId);
    } catch (error) {
      console.warn(`[electricity landmark] ${site.name}: ${error.message}`);
    }
  }
  const flags = createAkoesticumFlags();
  group.add(flags);
  flags.traverse(registerDetail);
  for (const model of buildEdeFuelStations()) {
    group.add(model);
    colliders.push(...model.userData.colliders);
    weatherCovers.push(...model.userData.weatherCovers);
    model.traverse(detail => {
      if (detail.userData.nearDetail) nearDetails.push({ detail, bounds: new THREE.Box3().setFromObject(detail) });
    });
  }
  for (const model of buildMuralWalls()) {
    group.add(model);
    colliders.push(...model.userData.colliders);
  }
  const station = createEdeStationLandmark();
  group.add(station);
  colliders.push(...station.userData.colliders);
  const last = new THREE.Vector3(Infinity, Infinity, Infinity);
  function update(position) {
    if (last.distanceToSquared(position) < 4) return;
    last.copy(position);
    for (const { detail, bounds, distance = 175 } of nearDetails) {
      const hysteresis = detail.visible ? Math.min(30, distance * 0.20) : 0;
      detail.visible = bounds.distanceToPoint(position) < distance + hysteresis;
    }
    for (const lod of landmarkLods) {
      const distance = lod.bounds.distanceToPoint(position);
      lod.far = distance > lod.distance + (lod.far ? -12 : 12);
      lod.silhouette.visible = lod.far;
      lod.detailedModel.visible = !lod.far;
    }
  }
  function updateWind(dt, reading) {
    for (const update of windUpdates) update(dt, reading);
  }
  return { group, colliders, platforms, helipads, weatherCovers, replacements, exclusions: LANDMARK_EXCLUSIONS, update, updateWind };
}
