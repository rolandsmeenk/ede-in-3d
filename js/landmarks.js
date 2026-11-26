import * as THREE from 'three/webgpu';
import { LANDMARK_SITES, EDE_DATA, projectLonLat } from './city-config.js';
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
import { createHoekelum, createTheehuisHoekelum, createGasfabriek } from './ede-estate-landmarks.js';
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
import { containsPlayablePoint } from './ede-playable-boundary.js';
import { PUBLIC_LANDMARK_FACTORIES } from './ede-public-landmarks.js';
import { createMarnixCollege } from './ede-marnix-landmark.js';
import { SCHOOL_LANDMARK_FACTORIES } from './ede-school-landmarks.js';
import { SPORT_LANDMARK_FACTORIES } from './ede-sport-landmarks.js';
import { AMSTERDAMSEWEG_LANDMARK_FACTORIES } from './ede-amsterdamseweg-landmarks.js';
import { NIJVERHEIDPLEIN_LANDMARK_FACTORIES } from './ede-nijverheidplein-landmarks.js';
import { STATIONSWEG_LANDMARK_FACTORIES } from './ede-stationsweg-landmarks.js';
import { EDE_RESTAURANT_ROW_BUILDERS } from './ede-restaurant-row.js';
import { EDE_RESTAURANT_ESTATE_BUILDERS } from './ede-restaurant-estates.js';
import { EXPANSION_LANDMARK_FACTORIES } from './ede-expansion-landmarks.js';
import { EDE_AMADEUS_LANDMARK_FACTORIES } from './ede-amadeus-landmark.js';
import { REEMST_LANDMARK_FACTORIES } from './ede-reemst-landmarks.js';
import { WEST_EXPANSION_LANDMARK_FACTORIES } from './ede-west-expansion-landmarks.js';
import { GINKEL_LANDMARK_FACTORIES } from './ede-ginkel-landmarks.js';
import { ZONNEOORD_LANDMARK_FACTORIES } from './ede-zonneoord-landmarks.js';
import { LUNTEREN_LANDMARK_FACTORIES } from './ede-lunteren-landmarks.js';
import { createWesthoffhuis } from './ede-westhoffhuis.js';
import { createLunterenFireStation } from './ede-lunteren-fire.js';
import { createKulturhus } from './ede-kulturhus.js';
import { LUNTEREN_SCHOOL_LANDMARK_FACTORIES } from './ede-lunteren-school-models.js';
import { LUNTEREN_CHURCH_STYLES } from './ede-lunteren-church-models.js';
import { EDE_NORTH_LOOKOUT_FACTORIES } from './ede-north-lookouts.js';
import { EDE_LUNTEREN_ART_LANDMARK_FACTORIES } from './ede-lunteren-art.js';
import { EDE_SKYLINE_LANDMARK_FACTORIES } from './ede-skyline-landmarks.js';
import { EDE_CENTRE_SKYLINE_LANDMARK_FACTORIES } from './ede-centre-skyline-landmarks.js';
import { EDE_VILLAGE_SKYLINE_LANDMARK_FACTORIES } from './ede-village-skyline-landmarks.js';
import { createZendmastLod, EDE_MAST_FACTORIES } from './ede-mast-models.js';
import { EDE_INDUSTRIAL_SKYLINE_LANDMARK_FACTORIES } from './ede-industrial-skyline-landmarks.js';
import { EDE_PAASBERG_MEMORIAL_FACTORIES } from './ede-paasberg-memorials.js';
import { EDE_TOWN_MEMORIAL_FACTORIES } from './ede-town-memorials.js';
import { EDE_OUTER_MEMORIAL_FACTORIES } from './ede-outer-memorials.js';
import { EDE_OUTER_CULTURAL_FACTORIES } from './ede-outer-cultural-models.js';
import { EDE_FARM_LANDMARK_FACTORIES } from './ede-farm-building.js';
import { RURAL_LANDMARK_FACTORIES } from './ede-rural-landmarks.js';
import { createPomphuis } from './ede-pomphuis.js';
import { createVillaBrutusTerraces } from './ede-villa-brutus.js';
import { createUluCamii } from './ede-ulu-camii.js';
import { MOSQUE_LANDMARK_FACTORIES } from './ede-mosque-landmarks.js';
import { BARRACKS_HERITAGE_FACTORIES } from './ede-barracks-heritage-landmarks.js';
import { VILLA_HERITAGE_FACTORIES } from './ede-villa-heritage-landmarks.js';
import { createZuiderpoort } from './ede-zuiderpoort-landmark.js';
import { INDUSTRIAL_HERITAGE_FACTORIES } from './ede-industrial-heritage-landmarks.js';
import { STREET_HERITAGE_FACTORIES } from './ede-street-heritage-landmarks.js';
import { MODERN_NEIGHBORHOOD_FACTORIES } from './ede-modern-neighborhood-landmarks.js';
import { VELDHUIZEN_LANDMARK_FACTORIES } from './ede-veldhuizen-landmarks.js';
import { HORAPARK_OFFICE_FACTORIES } from './ede-horapark-offices.js';
import { HORA_SANATORIUM_FACTORIES } from './ede-hora-sanatorium.js';
import { HORAPARK_NAK_FACTORIES } from './ede-horapark-nak.js';
import { HORAPARK_VILLA_FACTORIES } from './ede-horapark-villa.js';
import { buildEdeLangeWeideLandmark } from './ede-lange-weide-landmark.js';
import { buildEdeKernhemNeighborhoodLandmark } from './ede-kernhem-neighborhood-landmarks.js';
import { buildEdePBosLandmark } from './ede-p-bos-landmark.js';
import { buildRembrandtlaanLandmark } from './ede-rembrandtlaan-landmark.js';
import { createKopParkweg } from './ede-kop-parkweg.js';
import { createHartogshof } from './ede-hartogshof.js';
import { createAkulaanApartments, createParkveste } from './ede-rail-apartments.js';

// The engine's hand-built New York monuments are removed. Legacy exports keep the upstream controllers working.
export let bryantParkLawn = null;
export const LANDMARKS = [];
export const BERGHAIN_TREE_SITES = [];
export const LANDMARK_SOURCE_EXCLUSIONS = new Set([
  ...EDE_MODELED_LANDMARKS.flatMap(site => [site.osmId, ...(site.annexOsmIds ?? []), ...(site.excludeOsmIds ?? [])]).filter(Boolean),
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
  const colliders = [], platforms = [], helipads = [], nearDetails = [], windUpdates = [], weatherCovers = [], forecourtLights = [];
  const landmarkLods = [], treeClearance = [], masts = [], clockUpdates = [];
  const replacements = { bag: new Set(), osm: new Set(), parcelSources: new Set() };
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
    'theehuis-hoekelum': createTheehuisHoekelum,
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
    'de-zuiderpoort': createZuiderpoort,
    ...INDUSTRIAL_HERITAGE_FACTORIES,
    ...STREET_HERITAGE_FACTORIES,
    ...MODERN_NEIGHBORHOOD_FACTORIES,
    ...VELDHUIZEN_LANDMARK_FACTORIES,
    ...HORAPARK_OFFICE_FACTORIES,
    ...HORA_SANATORIUM_FACTORIES,
    ...HORAPARK_NAK_FACTORIES,
    ...HORAPARK_VILLA_FACTORIES,
    'de-lange-weide': (_, site) => buildEdeLangeWeideLandmark(site),
    'waterzoom-kernhem': (_, site) => buildEdeKernhemNeighborhoodLandmark(site),
    'winkelcentrum-parkweide': (_, site) => buildEdeKernhemNeighborhoodLandmark(site),
    'p-bos-veevoeders': (_, site) => buildEdePBosLandmark(site),
    'rembrandtlaan-hat': (_, site) => buildRembrandtlaanLandmark(site),
    'kop-van-de-parkweg': createKopParkweg,
    hartogshof: createHartogshof,
    'akulaan-h2-h4': createAkulaanApartments,
    parkveste: createParkveste,
    ...PUBLIC_LANDMARK_FACTORIES,
    'marnix-college': createMarnixCollege,
    ...SCHOOL_LANDMARK_FACTORIES,
    ...SPORT_LANDMARK_FACTORIES,
    ...AMSTERDAMSEWEG_LANDMARK_FACTORIES,
    ...NIJVERHEIDPLEIN_LANDMARK_FACTORIES,
    ...STATIONSWEG_LANDMARK_FACTORIES,
    'het-pomphuis': createPomphuis,
    ...EDE_RESTAURANT_ROW_BUILDERS,
    ...EDE_RESTAURANT_ESTATE_BUILDERS,
    ...EXPANSION_LANDMARK_FACTORIES,
    ...EDE_AMADEUS_LANDMARK_FACTORIES,
    ...REEMST_LANDMARK_FACTORIES,
    ...WEST_EXPANSION_LANDMARK_FACTORIES,
    ...GINKEL_LANDMARK_FACTORIES,
    ...ZONNEOORD_LANDMARK_FACTORIES,
    ...LUNTEREN_LANDMARK_FACTORIES,
    westhoffhuis: createWesthoffhuis,
    'brandweerkazerne-lunteren': createLunterenFireStation,
    'kulturhus-wekerom': createKulturhus,
    ...LUNTEREN_SCHOOL_LANDMARK_FACTORIES,
    ...EDE_NORTH_LOOKOUT_FACTORIES,
    ...EDE_LUNTEREN_ART_LANDMARK_FACTORIES,
    ...EDE_SKYLINE_LANDMARK_FACTORIES,
    ...EDE_CENTRE_SKYLINE_LANDMARK_FACTORIES,
    ...EDE_VILLAGE_SKYLINE_LANDMARK_FACTORIES,
    ...EDE_INDUSTRIAL_SKYLINE_LANDMARK_FACTORIES,
    ...EDE_MAST_FACTORIES,
    ...EDE_PAASBERG_MEMORIAL_FACTORIES,
    ...EDE_TOWN_MEMORIAL_FACTORIES,
    ...EDE_OUTER_MEMORIAL_FACTORIES,
    ...EDE_OUTER_CULTURAL_FACTORIES,
    ...EDE_FARM_LANDMARK_FACTORIES,
    ...RURAL_LANDMARK_FACTORIES,
  };
  function registerDetail(detail) {
    if (detail.userData.setClockMinutes) clockUpdates.push(detail.userData.setClockMinutes);
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
    const model = site.churchSurvey
      ? createAdditionalChurch(site, site.churchSurvey, LUNTEREN_CHURCH_STYLES[site.id] ?? CHURCH_STYLES[site.id])
      : models[site.id](footprints, site);
    model.name = site.name;
    platforms.push(...(model.userData.platforms ?? []));
    treeClearance.push(...(model.userData.treeClearance ?? []));
    for (const source of site.replaceParcelSources ?? []) replacements.parcelSources.add(source);
    helipads.push(...(model.userData.helipads ?? []));
    place(model, site.modelOrigin ?? site, site.heading, footprints, site.baseY, site.colliderHeights, site.worldSpace);
    if (model.userData.mast) masts.push(model.userData.mast);
    model.traverse(registerDetail);
    if (model.userData.landmarkLod) {
      const lod = model.userData.landmarkLod;
      landmarkLods.push({ ...lod, bounds: new THREE.Box3().setFromObject(model), far: false });
    }
  }
  const mastLod = createZendmastLod(masts);
  group.add(mastLod.mesh);
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
  const [west, north, east, south] = EDE_DATA.meta.bounds;
  const fuelSites = EDE_FUEL_SITES.filter(({ x, z }) =>
    x >= west && x <= east && z >= north && z <= south && containsPlayablePoint(x, z));
  for (const model of buildEdeFuelStations(fuelSites, { live: true })) {
    group.add(model);
    colliders.push(...model.userData.colliders);
    weatherCovers.push(...model.userData.weatherCovers);
    forecourtLights.push(...model.userData.forecourtLights);
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
  station.traverse(registerDetail);
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
  function setClockMinutes(minutes) {
    for (const update of clockUpdates) update(minutes);
  }
  return { group, colliders, platforms, helipads, weatherCovers, forecourtLights, treeClearance, replacements,
    exclusions: LANDMARK_EXCLUSIONS, update, updateWind, setClockMinutes, updateMastLod: mastLod.update };
}
