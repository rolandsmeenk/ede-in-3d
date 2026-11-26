import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, vec3, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js?v=20261119-perf';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { getLocationLabel, isTypingInField, containsPlayablePoint, constrainToTravelArea, EDE_DATA, ROADS, NYC_LANDMARKS, TELEPORT_LOCATIONS } from './city-config.js';
import { buildCityGrid } from './city-grid.js';
import { buildLandmarks } from './landmarks.js';
import { createEdeMurals } from './ede-murals.js';
import { buildCityBlocks } from './buildings.js';
import { createBagBuildingStream, loadBagBuildings } from './bag3d.js';
import { buildExteriorBagColliders, createExteriorBagStream, loadExteriorBagFootprints } from './ede-bag-exterior.js';
import { buildStreetDetails } from './street-details.js?v=20261122-forecourt-lights';
import { loadEdeSignalHardware } from './ede-signal-hardware.js?v=20261121-hospital-signals';
import { createTrafficSystem, createHighwayTraffic } from './traffic.js?v=20261126-apeldoornseweg';
import { loadEdeParking } from './ede-parking.js';
import { buildRoadPaint } from './road-paint.js?v=20261126-apeldoornseweg';
import { overlapsEdeTravelPavement } from './ede-geometry.js';
import { ThirdPersonControllerManager } from './controllers.js?v=20261122-municipal-coverage';
import { EDE_BIKE_STYLES } from './ede-bikes.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js?v=20261121-night-lighting';
import { createLiveWeather, formatWeatherTime, presetRinkIce, weatherCondition } from './ede-weather.js?v=20261122-rink-ice';
import { loadEdePondLevels, resolveFrankenengLevels, watchFrankenengLevels } from './ede-water-levels.js';
import { loadEdeWaterWorks, buildEdeWaterWorks } from './ede-water-works-world.js';
import { createWeatherPrecipitation } from './weather-precipitation.js';
import { updateSceneWind } from './tsl-materials.js';
import { createKiteFlyers } from './ede-kites.js';
import { formatEdeTime } from './live-sky.js';
import { NYCMapSystem } from './nyc-map.js?v=20261122-municipal-coverage';
import { createExpansionCulling, setupSceneCulling, updateSceneCulling } from './scene-culling.js?v=20261123-startup-memory';
import { CityAudioSystem } from './audio-system.js?v=20261122-p2000';
import { getExpansionTerrain, loadTerrain, terrainHeightAt } from './terrain.js';
import { createTerrainTiles } from './ede-terrain-tiles.js';
import { createEdeHeathCover } from './ede-heath.js';
import { createForestCanopy, loadForestCanopy } from './ede-forest-canopy.js';
import { loadAerialColors, loadExpansionGroundColors } from './aerial-colors.js';
import { loadEdeTrees } from './ede-tree-data.js?v=20261122-safari-cache';
import { TREE_SEASONS, setTreeSeason, getTreeSeason, seasonPresetFor } from './tree-seasons.js';
import { loadEdeLamps } from './ede-lamp-data.js?v=20261122-safari-cache';
import { buildEdePosters } from './ede-posters.js';
import { buildEdeSeasonalDecorations } from './ede-seasonal-decorations.js';
import { localClock } from './ede-transit-time.js';
import { buildEdeLunterenPlatforms } from './ede-lunteren-platforms.js';
import { gradeDeckAt, gradeProfileAt, gradeWayAt, loadEdeGrade, nearbyRailHeightAt, setEdeHelipads, setEdePlatforms, setEdeStructureRoofs } from './ede-grade.js';
import { buildEdeSports, loadEdeSports, setEdeSportsIceCover } from './ede-sports.js?v=20261122-rink-ice';
import { buildEdeGradeWorld } from './ede-grade-world.js';
import { buildEdeBgtWorld } from './ede-bgt-world.js';
import { loadEdeBusSchedule } from './ede-bus-schedule.js';
import { loadEdeTrainTimetable } from './ede-train-schedule.js';
import { createEdeTrainSystem } from './ede-trains.js?v=20261120-train-models';
import { createEdeLevelCrossings } from './ede-level-crossings.js';
import { BICYCLE, FOOT } from './road-access.js?v=20261122-startup';
import { createEdeRoadTraffic, loadEdePostedSpeeds, watchEdeTraffic } from './ede-road-traffic.js?v=20261122-p2000';
import { loadEdeStreetFeatures } from './ede-street-features.js?v=20261122-startup';
import { buildEdeStreetFeaturesWorld } from './ede-street-features-world.js?v=20261121-shared-sign-posts';
import { buildEdeBusStops } from './ede-bus-stops.js';
import { loadEdeMotorwayLanes } from './ede-motorway-lanes.js';
import { loadEdeRoadSurfaces } from './ede-road-surfaces.js';
import { buildEdeRoadFurniture, loadEdeRoadFurniture, roadFurnitureReplacementIds } from './road-furniture-manager.js';
import { loadEdeFittedLanes } from './ede-lane-geometry.js';
import { loadEdeCorridorFallbacks } from './ede-facades.js';
import { bikeRackGround, buildEdeDetail, loadEdeDetail, streamParcelTiles } from './ede-detail.js?v=20261122-truecolor-signs';

// js/main.js
// Main entry point for Ede in Three.js WebGPURenderer & TSL (three.js dev, see index.html)

export async function initApp() {
  const query = new URLSearchParams(window.location.search);
  const profiling = query.get('perf') === '1';
  const fixedStep = profiling && query.get('bench') === '1';
  const bgtStage = profiling ? query.get('bgtStage') ?? undefined : undefined;
  const standard = query.get('quality') === 'standard';
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const appleBrowser = appleMobile || navigator.vendor === 'Apple Computer, Inc.';
  const compactGraphics = appleMobile && !standard;
  const enabled = (key, fallback = true) => {
    const value = profiling ? query.get(key) : null;
    return value === 'on' ? true : value === 'off' ? false : fallback;
  };
  const scale = profiling ? Number(query.get('scale')) : 0;
  const graphics = {
    quality: standard ? 'standard' : 'fast',
    msaa: enabled('msaa', standard), ssr: enabled('ssr', standard),
    bloom: enabled('bloom', !compactGraphics), shadows: enabled('shadows', !compactGraphics), vegetation: enabled('vegetation'),
    buildingDetail: enabled('buildingDetail', !compactGraphics),
    scale: scale >= 0.5 && scale <= 1 ? scale : compactGraphics ? 0.75 : 1,
  };
  const requestedTreeInventory = profiling ? query.get('treeInventory') : null;
  const treeInventory = requestedTreeInventory === 'baseline' || (compactGraphics && requestedTreeInventory !== 'expanded')
    ? 'baseline' : undefined;
  const requestedTreeQuality = profiling ? query.get('treeQuality') : null;
  const treeQuality = ['legacy', 'high', 'auto'].includes(requestedTreeQuality) ? requestedTreeQuality : 'auto';
  const requestedTreeSeason = profiling ? query.get('treeSeason') : null;
  const treeSeasonsEnabled = requestedTreeSeason !== 'off';
  const initialTreeSeason = TREE_SEASONS[requestedTreeSeason]?.day != null ? requestedTreeSeason : seasonPresetFor(new Date());
  if (treeSeasonsEnabled) setTreeSeason(initialTreeSeason);
  let trafficUpdates = enabled('trafficUpdates');
  const container = document.getElementById('canvas-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingTrack = loadingOverlay ? loadingOverlay.querySelector('.loader-track') : null;
  const loadingFill = document.getElementById('loading-progress');
  // Only shader compilation has measurable progress; other stages use the sweeping bar.
  const setLoadingProgress = (p) => {
    if (!loadingFill) return;
    if (loadingTrack) loadingTrack.classList.remove('is-indeterminate');
    loadingFill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  };

  async function showLoadingStage(message) {
    if (loadingStatus) loadingStatus.textContent = message;
    if (loadingTrack) loadingTrack.classList.add('is-indeterminate');
    if (document.hidden) return;
    // Let the label paint before synchronous work. The timeout also lets hidden tabs keep loading.
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 100);
      requestAnimationFrame(() => {
        clearTimeout(timeout);
        setTimeout(resolve, 0);
      });
    });
  }

  await showLoadingStage('Initializing graphics...');

  // 1. Initialize Three.js WebGPURenderer with 32-bit float reversedDepthBuffer
  const renderer = new THREE.WebGPURenderer({
    antialias: graphics.msaa,
    trackTimestamp: profiling,
    powerPreference: 'high-performance',
    // WebKit can lose its WebGPU device while uploading the first scene and shadow passes.
    forceWebGL: appleMobile,
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(graphics.scale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = graphics.shadows;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // Start-up phase timings (logged once as "[init] ...") to keep load-time regressions traceable
  let initTimings = [];
  let initMark = performance.now();
  const markInit = (label) => {
    const now = performance.now();
    initTimings.push(`${label} ${Math.round(now - initMark)}ms`);
    initMark = now;
  };

  await renderer.init();
  markInit('renderer');
  const profiler = profiling ? (await import('./ede-perf.js')).createEdeProfiler(renderer) : null;
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL fallback';
  console.info(`[renderer] Three.js r${THREE.REVISION}; ${backend}`);
  container.dataset.renderer = backend;
  document.getElementById('hud-renderer').textContent = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  container.dataset.threeRevision = THREE.REVISION;
  container.dataset.quality = graphics.quality;

  // 2. Scene, atmosphere and lighting
  await showLoadingStage('Creating sky and environment lighting...');
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer);
  lightingSystem.sunLight.castShadow = graphics.shadows;
  const precipitation = createWeatherPrecipitation(scene);
  const kiteFlyers = createKiteFlyers(scene, terrainHeightAt);
  markInit('lighting');

  await showLoadingStage('Loading Ede’s map and timetables…');
  const useUtilityDetails = enabled('detail') && enabled('utilityDetail');
  const [terrainResult, aerialResult, treeResult, lampResult, busResult, gradeResult, speedResult, featureResult,
    motorwayResult, roadSurfaceResult, trainResult, parkingResult, detailResult, laneFitResult, sportsResult, corridorFacadesResult, forestCanopyResult, historicUtilitiesResult, signalHardwareResult, waterWorksResult, exteriorFootprintsResult, roadFurnitureResult, pondLevelsResult] = await Promise.allSettled([
    loadTerrain({ expanded: query.get('terrainTiles') !== 'off' }), loadAerialColors(), loadEdeTrees(treeInventory), loadEdeLamps(), loadEdeBusSchedule(), loadEdeGrade(),
    loadEdePostedSpeeds(), loadEdeStreetFeatures(), loadEdeMotorwayLanes(), loadEdeRoadSurfaces({ north: EDE_DATA.meta.north, fringe: Boolean(EDE_DATA.meta.travelBounds) }), loadEdeTrainTimetable(), loadEdeParking(),
    enabled('detail') ? loadEdeDetail({ bgt: enabled('bgtDetail'), bgtStage, municipal: enabled('municipalDetail'),
      motorway: enabled('motorwayDetail'), parcels: enabled('parcelDetail'), utilities: useUtilityDetails,
      directional: enabled('motorwayDetail') && enabled('nbdSigns'), fringe: Boolean(EDE_DATA.meta.travelBounds) }) : null,
    enabled('laneFits') ? loadEdeFittedLanes() : null,
    enabled('sports') ? loadEdeSports() : null,
    loadEdeCorridorFallbacks(),
    enabled('forestCanopy') ? loadForestCanopy() : null,
    useUtilityDetails ? import('./ede-utility-landmarks.js') : null,
    loadEdeSignalHardware(),
    enabled('detail') && enabled('waterWorks') ? loadEdeWaterWorks() : null,
    loadExteriorBagFootprints(),
    enabled('roadFurniture') ? loadEdeRoadFurniture() : null,
    loadEdePondLevels(),
  ]);
  if (terrainResult.status === 'fulfilled') {
    container.dataset.terrain = 'PDOK AHN';
    container.dataset.napOrigin = String(terrainResult.value.napOrigin);
  } else console.warn('[terrain] falling back to level ground:', terrainResult.reason);
  if (aerialResult.status === 'fulfilled') container.dataset.aerialColors = 'PDOK 2025';
  else console.warn('[aerial] using procedural colors:', aerialResult.reason);
  if (treeResult.status === 'rejected') console.warn('[trees] using OpenStreetMap trees:', treeResult.reason);
  if (lampResult.status === 'fulfilled') container.dataset.lampPosts = String(lampResult.value.length);
  else console.warn('[lamps] using generated street lights:', lampResult.reason);
  let busSchedule = null;
  if (busResult.status === 'fulfilled') busSchedule = busResult.value;
  else console.warn('[buses] timetable unavailable:', busResult.reason);
  if (gradeResult.status === 'rejected') console.warn('[grade] using AHN surface heights:', gradeResult.reason);
  if (motorwayResult.status === 'rejected') console.warn('[motorways] using OSM lanes:', motorwayResult.reason);
  if (roadSurfaceResult.status === 'rejected') console.warn('[road surfaces] using OSM surfaces:', roadSurfaceResult.reason);
  const roadTraffic = createEdeRoadTraffic(speedResult.status === 'fulfilled' ? speedResult.value : undefined);
  const streetFeatures = featureResult.status === 'fulfilled' ? featureResult.value : null;
  const detailData = detailResult.value;
  const furnitureCells = roadFurnitureResult.value;
  const furnitureReplacements = roadFurnitureReplacementIds(furnitureCells, detailData?.features);
  if (roadFurnitureResult.status === 'rejected') console.warn('[road furniture] using existing signs:', roadFurnitureResult.reason);
  if (!streetFeatures) console.warn('[street features] using existing road markings:', featureResult.reason);
  if (trainResult.status === 'rejected') console.warn('[trains] timetable unavailable:', trainResult.reason);
  markInit('map assets and timetables');

  // 3. Build the city, buildings, street details and traffic
  await showLoadingStage('Building streets, parks and water…');
  const loadedTrees = treeResult.status === 'fulfilled' ? treeResult.value : null;
  if (loadedTrees?.inventory === 'expanded') {
    const credit = document.getElementById('ede-tree-inventory-credit');
    credit.href = 'https://geo.ede.nl/geoserver/Ede/wfs?service=WFS&request=GetCapabilities';
    credit.textContent = 'MOR trees by Gemeente Ede';
  }
  let replacedPitches;
  try {
    if (sportsResult.status === 'rejected') throw sportsResult.reason;
    if (sportsResult.value) replacedPitches = buildEdeSports(scene, sportsResult.value);
  } catch (error) {
    console.warn('[sports] using basic pitch surfaces:', error);
  }
  markInit('sports fields');
  await loadExpansionGroundColors();
  const heath = treeSeasonsEnabled ? createEdeHeathCover(EDE_DATA.parks, EDE_DATA.meta.bounds, detailData?.landCover) : null;
  const exteriorBag = createExteriorBagStream(scene);
  const forest = getExpansionTerrain() && forestCanopyResult.value;
  if (pondLevelsResult.status === 'rejected') console.warn('[water] using terrain-draped ponds:', pondLevelsResult.reason);
  const cityGrid = buildCityGrid(scene, loadedTrees?.records, detailData?.landCover, loadedTrees?.canopyDensity,
    replacedPitches, forest?.cells, EDE_DATA.meta.north ? forest?.northernTreeSamples : undefined,
    heath, pondLevelsResult.value, { woodlandSpacing: compactGraphics ? 28 : 14 });
  const terrainTiles = createTerrainTiles(scene, heath, detailData?.fringeLandCover, cityGrid.shorelineCuts);
  markInit('cityGrid');
  await showLoadingStage('Building bridges, tunnels and railway platforms…');
  let bgtWorld;
  try {
    bgtWorld = await buildEdeBgtWorld(scene, (x, z, kind) => {
      if (kind === 'rail-under-road') {
        const deck = gradeDeckAt(x, z), rail = nearbyRailHeightAt(x, z, 28);
        return deck !== undefined && rail !== undefined && deck - rail > 3 ? deck - 0.45 : undefined;
      }
      if (kind === 'tunnel') {
        const surface = gradeProfileAt(x, z);
        return surface?.kind === 'underpass' ? surface.y : undefined;
      }
      if (kind === 'road-deck') return gradeDeckAt(x, z);
      if (kind === 'raised-wall') {
        // A parapet sits beside the upper carriageway, outside its travel footprint.
        const deck = gradeDeckAt(x, z, 9);
        if (deck !== undefined) return deck;
        const lower = gradeProfileAt(x, z);
        if (lower?.kind === 'underpass' && Number.isFinite(lower.roof)) return lower.roof + 0.62;
      }
      const railReach = kind === 'deck' || kind === 'rail-deck' ? 3.5 : kind === 'raised-platform' ? 20 : 7;
      const rail = nearbyRailHeightAt(x, z, railReach);
      if (kind === 'rail-deck') return rail;
      if (kind === 'deck') return gradeDeckAt(x, z) ?? rail;
      if (kind === 'raised-wall') return rail;
      return rail === undefined ? undefined : rail + 0.89;
    });
  } catch (error) {
    console.warn('[bgt] structure layer unavailable:', error);
  }
  const gradeWorld = buildEdeGradeWorld(scene, bgtWorld?.bridgeFootprints);
  markInit('grade and BGT structures');
  let waterWorks;
  try {
    if (waterWorksResult.status === 'rejected') throw waterWorksResult.reason;
    if (terrainResult.status === 'fulfilled' && waterWorksResult.value) {
      waterWorks = buildEdeWaterWorks(scene, waterWorksResult.value);
      markInit('water works');
    }
  } catch (error) {
    console.warn('[water works] weirs unavailable:', error);
  }
  await showLoadingStage('Building landmarks...');
  if (historicUtilitiesResult.status === 'rejected') console.warn('[electricity landmarks] using existing buildings:', historicUtilitiesResult.reason);
  const landmarks = buildLandmarks(scene, { historicUtilities: historicUtilitiesResult.value });
  const lunterenPlatforms = buildEdeLunterenPlatforms(scene);
  setEdePlatforms([...(bgtWorld?.platforms ?? []), ...landmarks.platforms, ...lunterenPlatforms]);
  setEdeHelipads(landmarks.helipads);
  markInit('landmarks');
  const mappedLamps = lampResult.status === 'fulfilled' ? lampResult.value : undefined;
  let importedDetail;
  try {
    if (detailResult.status === 'rejected') throw detailResult.reason;
    if (detailData?.features.length || EDE_DATA.northStreetDetail?.length) {
      const replaced = landmarks.replacements.parcelSources;
      const features = (detailData?.features ?? []).filter(feature => !furnitureReplacements.hectometers.has(feature.id)
        && (feature.source !== 'parcel' || !feature.sourceIds?.some(id => replaced.has(id))));
      features.push(...(EDE_DATA.northStreetDetail ?? []));
      importedDetail = buildEdeDetail(scene, features, {
        deckProfiles: bgtWorld?.deckProfiles, mappedLamps, nbdTexture: detailData?.nbdTexture,
        signalSupportIds: new Set(signalHardwareResult.value?.supports.map(support => support.existingId).filter(Boolean)),
      });
      importedDetail.stats.surveyedMarkings = detailData?.markings.length ?? 0;
      document.getElementById('ede-parcel-credit')?.toggleAttribute('hidden', !importedDetail.stats.parcel);
      document.getElementById('ede-utility-credit')?.toggleAttribute('hidden', !importedDetail.stats.utility);
      markInit('imported street and motorway detail');
    }
  } catch (error) {
    console.warn('[detail] street and motorway detail unavailable:', error);
  }
  const parcelTiles = enabled('parcelTiles')
    ? streamParcelTiles(scene, detailData?.parcelTiles, importedDetail?.resources, renderer.backend.isWebGPUBackend) : null;
  // Exclude generic buildings only after their local replacement meshes are ready.
  const replacements = landmarks.replacements;
  const detailReplacements = importedDetail?.group.userData.replacements;
  if (detailReplacements) {
    for (const id of detailReplacements.bag) replacements.bag.add(id);
    for (const id of detailReplacements.osm) replacements.osm.add(id);
  }
  const eagerBag = graphics.buildingDetail && profiling && query.get('bag') === 'eager';
  const streamBag = graphics.buildingDetail && !eagerBag;
  let bagBuildings = null;
  if (eagerBag) {
    await showLoadingStage('Loading 3D BAG buildings...');
    try {
      bagBuildings = await loadBagBuildings(scene, {
        replacementBagIds: replacements?.bag,
        onProgress: (done, total) => { if (loadingStatus) loadingStatus.textContent = `Loading 3D BAG buildings ${done}/${total}…`; }
      });
    } catch (error) {
      console.warn('[bag3d] falling back to OSM buildings:', error);
    }
    markInit('bag3d');
  }
  await showLoadingStage('Generating building facades...');
  if (corridorFacadesResult.status === 'rejected') console.warn('[facades] using basic corridor fallback walls:', corridorFacadesResult.reason);
  const cityBlocks = buildCityBlocks(scene, { bag: !!bagBuildings, streamBag, aerialLod: Boolean(terrainTiles),
    corridorFacades: corridorFacadesResult.value, replacementOsmIds: replacements?.osm });
  const murals = createEdeMurals(scene, { enabled: enabled('murals'), isFallbackVisible: cityBlocks.isFallbackVisible });
  if (streamBag) bagBuildings = createBagBuildingStream(scene, { fallback: cityBlocks, replacementBagIds: replacements?.bag });
  markInit('blocks');
  if (exteriorFootprintsResult.status === 'rejected') console.warn('[exterior BAG collisions]', exteriorFootprintsResult.reason);
  const exteriorColliders = buildExteriorBagColliders(exteriorFootprintsResult.value ?? []);
  const allColliders = [...landmarks.colliders, ...exteriorColliders, ...cityBlocks.colliders, ...(cityGrid.colliders || []),
    ...gradeWorld.colliders, ...(bgtWorld?.colliders || [])];

  await showLoadingStage('Placing trees, streetlights and street furniture...');
  const busStops = buildEdeBusStops(scene, busSchedule, {
    surveyed: importedDetail ? detailData?.features.filter(feature => feature.type === 'shelter') : undefined
  });
  allColliders.push(...busStops.colliders);
  setEdeStructureRoofs([...(bgtWorld?.weatherCovers ?? []), ...landmarks.weatherCovers, ...busStops.covers]);
  const forestCanopy = terrainTiles && createForestCanopy(scene, forest?.cells, treeSeasonsEnabled);
  if (forestCanopy) forestCanopy.group.visible = graphics.vegetation;
  if (signalHardwareResult.status === 'rejected') console.warn('[signals] using generated roadside placements:', signalHardwareResult.reason);
  const streetDetails = buildStreetDetails(scene, allColliders, mappedLamps, importedDetail?.gantryLampMounts,
    { quality: treeQuality, season: treeSeasonsEnabled, canopyCovers: forestCanopy?.covers,
      clearance: landmarks.treeClearance },
    signalHardwareResult.value, importedDetail?.gantries, landmarks.forecourtLights);
  const { treeField } = streetDetails;
  const posters = mappedLamps && buildEdePosters(scene, streetDetails.signSupports);
  const decorations = buildEdeSeasonalDecorations(scene, mappedLamps);
  treeField.group.visible = graphics.vegetation;
  if (importedDetail) allColliders.push(...importedDetail.colliders);
  markInit('streetDetails');
  await showLoadingStage('Creating traffic and pedestrian routes...');
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them.
  // Elevated building sections that clear even a bus don't obstruct ground traffic.
  let trainSystem;
  try {
    trainSystem = createEdeTrainSystem(scene, trainResult.status === 'fulfilled' ? trainResult.value : undefined,
      document.getElementById('hud-rail-status'), { predictionSeconds: Number(container.dataset.trainPredictionSeconds) });
  } catch (error) {
    console.warn('[trains] rail simulation unavailable:', error);
  }
  const trafficPilot=query.get('trafficPilot')!=='off';
  const levelCrossings=trafficPilot && trainSystem ? createEdeLevelCrossings(scene,trainSystem) : null;
  const railStop=levelCrossings && (query=>levelCrossings.stopDistance({
    ...query, mode:query.mode===FOOT?'foot':query.mode===BICYCLE?'bike':'motor'
  }));
  if (laneFitResult.status === 'rejected') console.warn('Ede fitted lanes could not load:', laneFitResult.reason);
  const trafficSystem = createTrafficSystem(scene, cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...allColliders.filter((c) => !c.obb && !c.kind && (c.minY ?? 0) < 3.5),
    ...allColliders.filter(c => c.obb && !c.kind && (c.minY ?? 0) < 2).map(c => ({ ...c, pedestrianOnly: true }))
  ], streetDetails.signalIntersections, busSchedule, roadTraffic,
    parkingResult.status==='fulfilled' ? parkingResult.value : undefined,
    {enabled:trafficPilot,streetFeatures,railStop,profile:profiling,laneFits:laneFitResult.value,
      bikeParking: enabled('bikeParking') && detailData?.features, bikeRackGround});
  if (parkingResult.status==='rejected') console.warn('[parking] inventory unavailable:', parkingResult.reason);
  watchEdeTraffic(roadTraffic, query.get('trafficApi') || container.dataset.trafficEndpoint);
  markInit('traffic');
  const highwayTraffic = createHighwayTraffic(scene, cityGrid.highwayLanes);
  const trafficGroups = [trafficSystem.group, highwayTraffic.group, trainSystem?.group].filter(Boolean);
  function setTrafficDraw(draw) {
    for (const group of trafficGroups) group.visible = draw;
  }
  setTrafficDraw(enabled('trafficDraw'));
  await showLoadingStage('Adding road markings...');
  if (streetFeatures) {
    try {
      const signs = streetFeatures.signs.filter(sign => !furnitureReplacements.ndw.has(sign.id));
      await buildEdeStreetFeaturesWorld(scene, { ...streetFeatures, signs }, roadSurfaceResult.value?.surfaces, importedDetail?.gantries,
        [...streetDetails.signSupports, ...(importedDetail?.signSupports ?? [])]);
    } catch (error) {
      console.warn('[street features] unable to build the feature layer:', error);
    }
  }
  const roadFurniture = buildEdeRoadFurniture(scene, furnitureCells, {
    surfaces: roadSurfaceResult.value?.surfaces, detail: detailData?.features,
    gantries: importedDetail?.gantries, surveyedGroup: importedDetail?.group, nbdTexture: detailData?.nbdTexture,
    webgpu: renderer.backend.isWebGPUBackend,
  });
  markInit('street features');
  buildRoadPaint(scene, trafficSystem.network, cityGrid.roadPaint,
    (x, z, edge) => {
      const fitted = edge?.profileId && gradeProfileAt(x, z, undefined, undefined, undefined, edge.profileId, 5);
      const grade = fitted || gradeWayAt(edge?.wayId, x, z, 1.2);
      // Free-standing surveyed strips and the broad asphalt polygons sample the AHN grid at different intervals.
      return grade ? grade.y + 0.055 : terrainHeightAt(x, z) + (edge?.type === 'marking' ? 0.09 : 0.065);
    }, { surveyed: detailData?.markings, preserveGBuffer: graphics.ssr, pavementAt: overlapsEdeTravelPavement });
  markInit('roadPaint');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  await showLoadingStage('Preparing player, vehicles and controls...');
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders);
  // The old flat-world Y and current saved Y both measure height above local ground.
  try {
    const saved = JSON.parse(localStorage.getItem('slop-ede-player-state'));
    if (saved?.version === 1 || saved?.version === 2) {
      if (saved.bikeStyle) controllerManager.setBikeStyle(saved.bikeStyle);
      for (const mode of Object.keys(controllerManager.entities)) {
        const p = saved.entities?.[mode];
        if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
        controllerManager.setMode(mode);
        const { x, z } = constrainToTravelArea(p.x, p.z);
        controllerManager.teleportActiveTo(x, z, p.heading, terrainHeightAt(x, z) + p.y);
      }
      controllerManager.setMode(Object.hasOwn(controllerManager.entities, saved.activeMode) ? saved.activeMode : 'car');
    }
  } catch { /* Missing or unavailable storage does not prevent playing. */ }

  function savePlayerState() {
    try {
      const entities = Object.fromEntries(Object.entries(controllerManager.entities).map(([mode, entity]) => [mode, {
        x: entity.position.x, z: entity.position.z, heading: entity.heading,
        y: entity.position.y - terrainHeightAt(entity.position.x, entity.position.z)
      }]));
      localStorage.setItem('slop-ede-player-state', JSON.stringify({
        version: 2, activeMode: controllerManager.activeMode, bikeStyle: controllerManager.entities.cyclist.bikeStyle, entities
      }));
    } catch { /* Storage may be disabled or full. */ }
  }

  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  const touchControls = new TouchControls(controllerManager);
  const soundButton = document.getElementById('btn-sound');
  const audioSystem = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails }, {
    onStateChange: updateSoundButton
  });
  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.disabled = !audioSystem.supported;
    soundButton.setAttribute('aria-pressed', String(audioSystem.enabled));
    soundButton.setAttribute('aria-label', audioSystem.enabled ? 'Mute sound' : 'Enable sound');
    soundButton.title = audioSystem.supported ? `${audioSystem.enabled ? 'Mute' : 'Enable'} sound [N]` : 'Web Audio is unavailable';
    soundButton.querySelector('use').setAttribute('href', audioSystem.enabled ? '#i-sound' : '#i-sound-off');
  }
  soundButton?.addEventListener('click', () => audioSystem.setEnabled(!audioSystem.enabled));
  updateSoundButton();
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    savePlayerState();
    if (!event.persisted) {
      bagBuildings?.userData.dispose?.();
      exteriorBag.dispose();
      parcelTiles?.dispose();
      audioSystem.dispose();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
  markInit('controllers');

  // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  await showLoadingStage('Preparing scene visibility and shadows...');
  const cullingRoots = ['EdeCityGrid', 'EdeCityBlocks', 'EdeStreetDetails', 'EdeGradeWorld', 'Ede BGT structures', 'Ede sports fields',
    'EdeLandmarks', 'Ede Lunteren platforms', 'EdeBoundaryContext', 'RoadMarkings', 'EdeStreetFeatures', 'EdeImportedDetail',
    'EdeBusStops', 'Ede Water Works']
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  setupSceneCulling(scene, cullingRoots, graphics.shadows ? lightingSystem.sunLight.shadow : null);

  // Initialize static world matrices once, including the chunks and shadow proxies created above.
  // Crowd, tree and building-detail animation changes instance/pose buffers, not Object3D transforms.
  const dynamicRoots = [
    trafficSystem.group,
    levelCrossings?.group,
    highwayTraffic.group,
    scene.getObjectByName('StoreClusteredLights'),
    scene.getObjectByName('StreetClusteredLights'),
    ...Object.values(controllerManager.entities).map((entity) => entity.mesh),
    controllerManager.entities.cyclist.helmet
  ].filter(Boolean);
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
  const expansionCulling = terrainTiles && createExpansionCulling(
    [...cullingRoots, scene.getObjectByName('EdeLevelCrossings')].filter(Boolean), EDE_DATA.meta.baseBounds, terrainHeightAt);
  markInit('culling');

  // On WebGPU, small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes only upload when needed; WebGL2 needs ordinary instanced attributes for correct transforms.
  if (renderer.backend.isWebGPUBackend) {
    scene.traverse((object) => {
      if (object.isInstancedMesh) {
        object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
      }
    });
  }

  // 5. TSL RenderPipeline with Half-Res Screen Space Reflections (SSRNode), Bloom & Filmic Toning
  //    Fade out distant and matte surfaces so SSR spends its rays on visible glossy reflections.
  await showLoadingStage('Setting up visual effects, map and interface...');
  const scenePass = pass(scene, cameraSystem.camera);
  // The multisampled colour attachments (output, normal, metalRough) only need resolving, never storing: discarding
  // them spares the GPU writing 3 x 4 samples per pixel to memory every frame (transient, memoryless attachments where
  // the browser supports them). The multisampled depth stays stored: SSR reads it.
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  const scenePassColor = scenePass.getTextureNode('output');
  let sceneMRT = null;
  let reflections = vec3(0);
  if (graphics.ssr) {
    const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
    const maxSSRRoughness = 0.75;
    sceneMRT = mrt({
      output, normal: normalView,
      metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
    });
    sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
    sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
    scenePass.setMRT(sceneMRT);
    const surface = scenePass.getTextureNode('metalRough');
    const ssrPass = ssr(scenePassColor, scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), {
      metalnessNode: surface.r, roughnessNode: surface.g, camera: cameraSystem.camera
    });
    ssrPass.resolutionScale = 0.5;
    ssrPass.blurQuality = 1;
    ssrPass.maxDistance.value = 42;
    ssrPass.thickness.value = 0.85;
    ssrPass.quality.value = 0.25;
    ssrPass.binaryRefine = true;
    ssrPass.intensity.value = 0.50;
    ssrPass.screenEdgeFadeBlack = true;
    const mask = surface.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, surface.g), 0);
    reflections = ssrPass.mul(mask);
  }
  const colorGrade = createPostProcessing(renderer, scenePassColor, reflections, { bloomEnabled: graphics.bloom });
  const renderPipeline = new THREE.RenderPipeline(renderer, colorGrade.outputNode);

  // 6. Wire UI Controls (Strictly using safe DOM APIs: textContent, classList, addEventListener)
  const modeButtons = document.querySelectorAll('[data-mode]');
  const modes = Array.from(modeButtons, (button) => button.dataset.mode);
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const treeQualityButtons = document.querySelectorAll('[data-tree-quality]');
  const environmentButtons = document.querySelectorAll('[data-environment]');
  const environmentLabel = document.getElementById('environment-label');
  const presetControls = document.getElementById('environment-presets');
  const liveInfo = document.getElementById('environment-live-info');
  const presetTime = document.getElementById('environment-time');
  const presetSeason = document.getElementById('environment-season');
  const presetWeather = document.getElementById('environment-weather');
  const snowOption = presetWeather.querySelector('[value="snow"]');
  presetSeason.value = initialTreeSeason;
  const liveClock = document.getElementById('time-live-clock');
  const liveDate = document.getElementById('environment-live-date');
  const localDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const presetClockMinutes = { golden: 17 * 60 + 30, midday: 12 * 60, twilight: 20 * 60 + 30, midnight: 0 };
  let environmentMode;
  let liveTimeTimer;
  let stopWaterLevels;
  const waterStatus = document.getElementById('live-water-status');
  const weatherStatus = document.getElementById('live-weather-status');
  const weatherClock = document.getElementById('live-weather-time');
  const liveWeather = createLiveWeather({
    onChange({ status, current }) {
      if (status !== 'off') setEdeSportsIceCover(status === 'fresh' || status === 'stale' ? (current?.rinkIce ?? 0) : 0);
      weatherClock.hidden = !current;
      weatherClock.textContent = current ? formatWeatherTime(current.observedAt) : '';
      if (current) weatherClock.dateTime = new Date(current.observedAt).toISOString();
      else weatherClock.removeAttribute('datetime');

      if (status === 'loading') weatherStatus.textContent = 'Loading weather…';
      else if (status === 'unavailable') weatherStatus.textContent = 'Weather unavailable · using lighting default';
      else if (status === 'expired') weatherStatus.textContent = 'Weather expired · using lighting default';
      else if (current) {
        const wind = `Wind ${Math.round(current.windSpeed)} km/h at 10 m`;
        const hub = current.turbineWind ? ` · Maanderbroek hubs ${Math.round(current.turbineWind.windSpeed)} km/h` : '';
        weatherStatus.textContent = `${weatherCondition(current.code)} · ${Math.round(current.temperature)} °C · ${wind}${hub}${status === 'stale' ? ' · Stale' : ''}`;
      } else weatherStatus.textContent = '';
    }
  });
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const lunterenButton = document.getElementById('tp-lunteren-centrum');
  if (lunterenButton) lunterenButton.hidden = !TELEPORT_LOCATIONS['lunteren-centrum'];
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  const mapAttribution = document.getElementById('map-attribution');
  mapAttribution.open = !touchControls.available;
  touchControls.onAvailabilityChange = available => {
    mapAttribution.open = !available;
    placeModeIndicator();
  };

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
  const bikeStyleControl = document.getElementById('bike-style-control');
  const bikeStyleSelect = document.getElementById('bike-style');
  for (const style of EDE_BIKE_STYLES) bikeStyleSelect.add(new Option(style.label, style.id));
  bikeStyleSelect.value = controllerManager.entities.cyclist.bikeStyle;
  bikeStyleSelect.addEventListener('change', () => {
    if (!controllerManager.setBikeStyle(bikeStyleSelect.value)) return;
    if (elMode) elMode.textContent = controllerManager.entities.cyclist.label;
    bikeStyleSelect.blur();
    savePlayerState();
  });
  const elCamera = document.getElementById('hud-active-camera');
  const elSpeed = document.getElementById('hud-speed');
  const elSpeedMeter = document.getElementById('hud-speed-meter');
  const elAltitude = document.getElementById('hud-altitude');
  const elLocation = document.getElementById('hud-location');
  const elControlsHint = document.getElementById('hud-controls-hint');
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onCycleMode: (step) => {
      selectMode(modes[(modes.indexOf(controllerManager.activeMode) + step + modes.length) % modes.length]);
    },
    onCycleCamera: cycleCamera,
    onToggleMap: () => mapSystem.toggleFullMap(!mapSystem.isFullMapOpen),
    onCloseMap: () => mapSystem.toggleFullMap(false)
  });

  // Keyboard guide for each mode: [keys, action]
  const controlHints = {
    person: [[['W', 'S'], 'Walk'], [['A', 'D'], 'Turn'], [['Shift'], 'Sprint'], [['Space'], 'Jump'], [['Drag'], 'Orbit']],
    car: [[['W', 'S'], 'Drive / Reverse'], [['A', 'D'], 'Steer'], [['Shift'], 'Boost'], [['B'], 'Horn'], [['Drag'], 'Orbit']],
    cyclist: [[['W', 'S'], 'Pedal / Brake'], [['A', 'D'], 'Lean & Turn'], [['Shift'], 'Sprint'], [['Drag'], 'Orbit']],
    helicopter: [[['W', 'S'], 'Pitch'], [['A', 'D'], 'Yaw'], [['Space', 'E'], 'Ascend'], [['Q', 'C'], 'Descend'], [['Shift'], 'Boost']]
  };
  // Boosted top speeds in km/h (controllers.js caps them at 8.2, 36, 19 & 52 m/s): full scale of the speed meter
  const topSpeedKmh = { person: 30, car: 130, cyclist: 69, helicopter: 188 };

  function renderControlHints(mode) {
    if (!elControlsHint) return;
    const items = (controlHints[mode] || []).map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.appendChild(kbd);
      }
      const label = document.createElement('span');
      label.className = 'hint-label';
      label.textContent = action;
      item.appendChild(label);
      return item;
    });
    elControlsHint.replaceChildren(...items);
  }

  // The taxi-yellow pill under the selected mode glides from button to button
  function placeModeIndicator() {
    const active = modeSwitch ? modeSwitch.querySelector('.mode-btn.active') : null;
    if (!active) return;
    modeSwitch.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    modeSwitch.style.setProperty('--ind-w', `${active.offsetWidth}px`);
  }

  function selectMode(mode) {
    if (!modes.includes(mode)) return;
    controllerManager.setMode(mode);
    touchControls.setMode(controllerManager.activeMode);
    gamepadControls.reset();
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    document.body.dataset.mode = mode;
    bikeStyleControl.hidden = mode !== 'cyclist';
    placeModeIndicator();
    const ent = controllerManager.getActiveEntity();
    if (elMode) elMode.textContent = ent.label;
    renderControlHints(mode);

    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    const currentCam = cameraSystem.getActivePreset();
    if (currentCam.category !== 'follow') {
      selectCamera('chase', false);
    }
  }

  function selectCamera(camId, snap = false) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
    const preset = cameraSystem.getActivePreset();
    if (elCamera) elCamera.textContent = preset.name;
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, and the arrows either side of the camera name)
  function cycleCamera(step) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }

  function refreshLiveTime() {
    const now = new Date();
    const { from, to, weight } = lightingSystem.applyLive(now);
    colorGrade.applyBlend(from, to, weight);
    if (treeSeasonsEnabled) setTreeSeason('today', now);
    decorations.update(localClock(now.getTime() / 1000).date);
    const time = formatEdeTime(now);
    const [hour, minute] = time.split(':').map(Number);
    landmarks.setClockMinutes(hour * 60 + minute);
    liveClock.textContent = time;
    liveClock.dateTime = now.toISOString();
    liveDate.textContent = localDate.format(now);
    liveDate.dateTime = liveClock.dateTime;
    if (!document.hidden) {
      liveTimeTimer = setTimeout(refreshLiveTime, 60000 - Date.now() % 60000);
    }
  }

  function applyPresetTime() {
    lightingSystem.applyPreset(presetTime.value);
    colorGrade.applyPreset(lightingSystem.activePresetId);
    landmarks.setClockMinutes(presetClockMinutes[lightingSystem.activePresetId]);
  }

  function applyPresetSeason() {
    if (treeSeasonsEnabled) setTreeSeason(presetSeason.value);
    decorations.update(undefined, presetSeason.value);
    setEdeSportsIceCover(presetRinkIce(presetSeason.value));
    snowOption.disabled = snowOption.hidden = presetSeason.value !== 'winter';
    if (snowOption.disabled && presetWeather.value === 'snow') presetWeather.value = 'default';
    liveWeather.setPreset(presetWeather.value);
  }

  function updateWaterLevels(levels) {
    cityGrid.setWaterLevels(levels);
    const liveCount = levels.filter(level => level.publishedAt !== null).length;
    waterStatus.textContent = liveCount ? `Frankeneng water · ${liveCount}/${levels.length} gauges live`
      : 'Frankeneng water · reference levels';
  }

  function selectEnvironment(mode) {
    if (mode === environmentMode) return;
    environmentMode = mode;
    clearTimeout(liveTimeTimer);
    const live = mode === 'live';
    setPressed(environmentButtons, 'environment', mode);
    presetControls.hidden = live;
    liveInfo.hidden = !live;
    environmentLabel.textContent = live ? 'Live' : 'Environment';
    liveClock.hidden = !live;
    liveWeather.setEnabled(live);
    if (live) {
      refreshLiveTime();
      waterStatus.hidden = cityGrid.waterLevels.length === 0;
      if (!waterStatus.hidden && !fixedStep) stopWaterLevels = watchFrankenengLevels(updateWaterLevels);
    } else {
      liveClock.textContent = '';
      liveClock.removeAttribute('datetime');
      stopWaterLevels?.();
      stopWaterLevels = undefined;
      if (cityGrid.waterLevels.length) updateWaterLevels(resolveFrankenengLevels());
      applyPresetTime();
      applyPresetSeason();
    }
  }

  function selectTime(timeId) {
    if (timeId === 'live') return selectEnvironment('live');
    presetTime.value = Object.hasOwn(presetClockMinutes, timeId) ? timeId : 'golden';
    if (environmentMode === 'preset') applyPresetTime();
    else selectEnvironment('preset');
  }

  document.addEventListener('visibilitychange', () => {
    if (environmentMode !== 'live') return;
    clearTimeout(liveTimeTimer);
    if (!document.hidden) refreshLiveTime();
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    clearTimeout(liveTimeTimer);
    liveWeather.setEnabled(false);
    stopWaterLevels?.();
  });

  // Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
  // names the element they sit above / below, data-align the one whose right edge they line up with
  const popovers = document.querySelectorAll('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  function closePopovers() {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  }
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor) || invoker;
      const align = document.getElementById(pop.dataset.align) || invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.right = `${Math.max(8, window.innerWidth - align.getBoundingClientRect().right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });

  for (const button of document.querySelectorAll('[data-graphics-quality]')) {
    const quality = button.dataset.graphicsQuality;
    const active = quality === graphics.quality;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      if (active) return closePopovers();
      const url = new URL(window.location.href);
      url.searchParams.set('quality', quality);
      window.location.assign(url);
    });
  }

  function setPressed(buttons, key, value) {
    for (const button of buttons) {
      const active = button.dataset[key] === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  function selectTreeQuality(quality) {
    treeField.setQuality(quality);
    setPressed(treeQualityButtons, 'treeQuality', quality);
  }
  function selectTreeSeason(season) {
    if (season === 'today') return selectEnvironment('live');
    if (TREE_SEASONS[season]?.day == null) return;
    presetSeason.value = season;
    if (environmentMode === 'preset') applyPresetSeason();
    else selectEnvironment('preset');
  }
  setPressed(treeQualityButtons, 'treeQuality', treeQuality);
  for (const button of environmentButtons) button.addEventListener('click', () => selectEnvironment(button.dataset.environment));
  presetTime.addEventListener('change', () => selectTime(presetTime.value));
  presetSeason.addEventListener('change', () => selectTreeSeason(presetSeason.value));
  presetWeather.addEventListener('change', () => liveWeather.setPreset(presetWeather.value));
  for (const button of treeQualityButtons) button.addEventListener('click', () => {
    selectTreeQuality(button.dataset.treeQuality);
    closePopovers();
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.getAttribute('data-mode'));
    });
  });

  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectCamera(btn.getAttribute('data-camera'), true);
      closePopovers();
    });
  });

  const camPrevBtn = document.getElementById('cam-prev');
  const camNextBtn = document.getElementById('cam-next');
  if (camPrevBtn) camPrevBtn.addEventListener('click', () => cycleCamera(-1));
  if (camNextBtn) camNextBtn.addEventListener('click', () => cycleCamera(1));

  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  // Where you are: the place's name over its street corner, drawn as a pair of NYC street-name signs
  const roadNames = new Set(ROADS.map((r) => r.name));
  const placeNames = new Set(NYC_LANDMARKS.map((l) => l.name));
  let locationText = '';
  function renderLocation(label) {
    if (!elLocation || label === locationText) return;
    locationText = label;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (placeNames.has(label) || (!label.includes(' & ') && !roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        near.textContent = 'near';
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        sign.textContent = name;
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    elLocation.replaceChildren(...nodes);
  }

  function teleportTo(x, z, heading = Math.PI, altitude = null, focus = null) {
    const destination = controllerManager.teleportActiveTo(x, z, heading, altitude);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport(focus && {
      x: focus.x, y: terrainHeightAt(focus.x, focus.z) + focus.height, z: focus.z, offset: focus.offset
    });
    selectCamera('chase', true);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z)
    };
    return destination;
  }

  function teleportToLandmark(key) {
    const loc = TELEPORT_LOCATIONS[key];
    if (!loc) return;
    const fly = loc.focus && controllerManager.activeMode === 'helicopter';
    const x = fly ? loc.x - Math.sin(loc.heading) * 52 : loc.x;
    const z = fly ? loc.z - Math.cos(loc.heading) * 52 : loc.z;
    return teleportTo(x, z, loc.heading, fly ? terrainHeightAt(x, z) + 65 : null, loc.focus);
  }

  const mapSystem = new NYCMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    allBlocks: cityBlocks.allBlocks,
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        mapHint.textContent = 'Tap to teleport · Drag to pan · Use + / − to zoom';
      }
    },
    onTeleport: teleportTo,
    onLandmark: teleportToLandmark
  });

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      teleportToLandmark(btn.getAttribute('data-teleport'));
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  const debugMode = query.get('debug') === '1';
  const showLanesOnStart = query.get('laneDebug') === 'on';
  let laneDebug;
  if (showLanesOnStart || (supportsPopover && debugMode)) {
    const { createTrafficLaneDebug } = await import('./ede-traffic-lane-debug.js');
    laneDebug = createTrafficLaneDebug(scene, trafficSystem);
    const button = document.getElementById('btn-traffic-lanes');
    const selectLanes = (value) => {
      laneDebug.setEnabled(value);
      button.classList.toggle('active', value);
      button.setAttribute('aria-pressed', String(value));
    };
    selectLanes(showLanesOnStart);
    button.addEventListener('click', () => selectLanes(button.getAttribute('aria-pressed') !== 'true'));
    if (supportsPopover) document.getElementById('btn-crossing-debug').hidden = false;
  }
  if (supportsPopover && debugMode) {
    const { mountCrossingTeleports } = await import('./ede-crossing-debug.js');
    const teleports = document.getElementById('crossing-debug-teleports');
    teleports.hidden = false;
    mountCrossingTeleports(teleports, (mode, x, z, heading, altitude) => {
      selectMode(mode);
      teleportTo(x, z, heading, altitude);
      closePopovers();
    });
  }

  if (hudToggleBtn) {
    hudToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('hud-minimized');
      const isMin = document.body.classList.contains('hud-minimized');
      hudToggleBtn.setAttribute('aria-pressed', String(isMin));
      hudToggleBtn.setAttribute('aria-label', isMin ? 'Show HUD' : 'Hide HUD');
      hudToggleBtn.title = isMin ? 'Show the HUD [H]' : 'Clean view: hide the HUD [H]';
      if (isMin) closePopovers();
    });
  }

  // Global keyboard shortcuts for modes (1-4), cameras (V / 6-0), and HUD (H)
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    switch (e.code) {
      case 'Digit1':
        selectMode('person');
        break;
      case 'Digit2':
        selectMode('car');
        break;
      case 'Digit3':
        selectMode('cyclist');
        break;
      case 'Digit4':
        selectMode('helicopter');
        break;
      case 'Digit6':
        selectCamera('action', true);
        break;
      case 'Digit7':
        selectCamera('pov', true);
        break;
      case 'Digit8':
        selectCamera('fifthAve', true);
        break;
      case 'Digit9':
        selectCamera('timesSquare', true);
        break;
      case 'Digit0':
        selectCamera('chryslerGCT', true);
        break;
      case 'KeyV':
        cycleCamera(e.shiftKey ? -1 : 1);
        break;
      case 'KeyH':
        if (hudToggleBtn) hudToggleBtn.click();
        break;
      case 'KeyN':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audioSystem.setEnabled(!audioSystem.enabled);
        break;
      case 'KeyB':
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity());
        break;
    }
  });

  window.addEventListener('resize', () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    placeModeIndicator();
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Initialize the UI and chase camera around the restored player, or the default taxi on a first visit.
  selectMode(controllerManager.activeMode);
  selectCamera('chase', true);
  posters?.updateView(cameraSystem.camera.position, performance.now());
  decorations.updateView(cameraSystem.camera.position);
  selectTime('golden');
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // Compile shaders behind the loading screen. Overlapping compileAsync() jobs keep compilation moving
  // while individual jobs yield to the browser.
  const compilePool = appleBrowser ? 2 : 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders(warmWholeScene) {
    await showLoadingStage('Preparing the render pipeline...');
    // An empty frame first: it sets up the post-processing chain, which configures the scene pass's render target
    // (MSAA samples, depth format), so the pipelines compiled below are the very ones the scene pass asks for
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    markInit('postFX');

    // Every visible object with frustum culling off (like the warm-up frame, see the loop). Plain meshes that share
    // a material share its shader, so one job compiles them in turn (the first build serves the rest); every
    // instanced mesh gets a build of its own unless its chunks share a pipeline
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    const pipelines = new Set();
    const camera = cameraSystem.camera;
    camera.updateMatrixWorld();
    const startupView = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      camera.coordinateSystem, camera.reversedDepth);
    scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      if (!warmWholeScene && !o.layers.test(camera.layers)) return;
      if (o.frustumCulled) {
        if (!warmWholeScene && !(o.isSprite ? startupView.intersectsSprite(o) : startupView.intersectsObject(o))) return;
        culled.push(o);
        o.frustumCulled = false;
      }
      // Use the first visible chunk: the original representative may be in an inactive tree cell. Shadow stand-ins
      // only draw in the shadow maps (the warm-up frame compiles those).
      if (o.userData.shadowProxy) return;
      const pipeline = o.userData.sharesPipelineWith || o;
      if (pipelines.has(pipeline)) return;
      pipelines.add(pipeline);
      if (o.isInstancedMesh || Array.isArray(o.material)) {
        jobs.push([o]);
        return;
      }
      let job = jobByMaterial.get(o.material);
      if (!job) {
        job = [];
        jobByMaterial.set(o.material, job);
        jobs.push(job);
      }
      job.push(o);
    });

    await showLoadingStage(`Compiling scene shaders... 0 / ${jobs.length} batches`);
    setLoadingProgress(0);
    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    const compile = async (object) => {
      // Each compile starts in a task of its own: compileAsync() keeps one precompilation state on the renderer,
      // which must not be mid-step for two of them in the same microtask checkpoint
      await nextTask();
      try {
        await renderer.compileAsync(object, cameraSystem.camera, scene);
      } catch (e) {
        console.warn('[compile]', e); // the warm-up frame compiles it instead
      }
    };
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) await compile(object);
        done++;
        if (loadingStatus) {
          loadingStatus.textContent = `Compiling scene shaders... ${done} / ${jobs.length} batches (${Math.round((done / jobs.length) * 100)}%)`;
        }
        setLoadingProgress(done / jobs.length);
      }
    };
    // A lost WebGL context can leave the browser's shader completion query pending.
    const listener = new AbortController();
    try {
      if (renderer.backend.gl?.isContextLost()) throw new Error('WebGL context lost before shader compilation');
      const contextLost = new Promise((_, reject) => {
        renderer.domElement.addEventListener('webglcontextlost', () => {
          reject(new Error('WebGL context lost during shader compilation'));
        }, { signal: listener.signal });
      });
      await Promise.race([Promise.all(Array.from({ length: compilePool }, worker)), contextLost]);
    } finally {
      listener.abort();
      renderer.setMRT(null);
      renderer.setRenderTarget(null);
      for (const o of culled) o.frustumCulled = true;
    }
  }

  cameraSystem.update(0, 0);
  await showLoadingStage('Building paving near your starting point...');
  while (cityGrid.pavingTiles.update(cameraSystem.camera.position, 140)) {
    await (cityGrid.pavingTiles.pendingWork() ?? nextTask());
  }
  if (EDE_DATA.meta.fullMunicipality) expansionCulling?.update(cameraSystem.camera);
  roadFurniture?.update(cameraSystem.camera, 0.25, lightingSystem.uNightFactor.value);
  markInit('local paving');

  // The full municipality would submit distant geometry before the player sees it.
  const canPrecompile = !appleMobile && (!appleBrowser || !renderer.backend.isWebGPUBackend);
  const warmWholeScene = !appleBrowser && !EDE_DATA.meta.fullMunicipality;
  if (canPrecompile) {
    const restoreTreeWarmup = treeField.prepareWarmup();
    const aerialShell = cityBlocks.group.children.find(object => object.userData.aerialBuildingProxy);
    if (aerialShell) aerialShell.visible = true;
    try {
      await precompileShaders(warmWholeScene);
    } finally {
      if (aerialShell) aerialShell.visible = false;
      restoreTreeWarmup();
    }
    markInit('compile');
  }
  await showLoadingStage('Drawing the first frame...');

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let trafficClock = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below
  const municipalWarning = document.getElementById('municipal-warning');
  const municipalStatus = document.getElementById('municipal-warning-status');
  let outsideMunicipality = false;

  if (elFps) elFps.textContent = '60';

  function drawFrame(now) {
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    profiler?.beginFrame(now);
    const dt = fixedStep ? 1 / 60 : Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gamepadControls.update(dt);
    controllerManager.update(dt, elapsed, cameraSystem.initialized ? cameraSystem.currentPos : null);
    cameraSystem.update(dt, elapsed);
    laneDebug?.update(cameraSystem.camera.position);
    terrainTiles?.update(cameraSystem.camera, renderer.domElement.height);
    bgtWorld?.updateMastLod(cameraSystem.camera, renderer.domElement.height);
    if (warmedUp) landmarks.updateMastLod(cameraSystem.camera, renderer.domElement.height, lightingSystem.uNightFactor.value);
    profiler?.stage('Player, camera and terrain');
    if (warmedUp) cityGrid.pavingTiles.update(cameraSystem.camera.position);
    profiler?.stage('Paving tiles');
    if (trafficUpdates) {
      trafficClock += dt;
      const railTime=Date.now()/1000;
      trainSystem?.update(dt,cameraSystem.currentPos,railTime);
      levelCrossings?.update(dt,railTime);
      streetDetails.signalClock.value = trafficClock;
      profiler?.stage('Rail and signals');
      trafficSystem.update(dt, trafficClock, cameraSystem.currentPos, controllerManager.getActiveEntity(), controllerManager.activeMode, cameraSystem.camera);
      profiler?.stage('Traffic simulation');
      highwayTraffic.update(dt, cameraSystem.camera, controllerManager.getActiveEntity(), controllerManager.activeMode);
    }
    profiler?.stage('Ambient highways');
    if (warmedUp) {
      bagBuildings?.userData.update?.(cameraSystem.camera);
      exteriorBag.update(cameraSystem.camera);
      murals.update(cameraSystem.camera.position, now);
      landmarks.update(cameraSystem.camera.position);
    }
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    profiler?.stage('Buildings, façades and murals');
    if (graphics.vegetation) {
      const camera = cameraSystem.camera;
      forestCanopy?.update(camera, treeField);
      profiler?.stage('Woodland canopy');
      treeField.update(camera, {
        renderer, deltaMs: rawDt * 1000, viewportHeight: renderer.domElement.height,
        groundHeight: terrainHeightAt(camera.position.x, camera.position.z),
        canopyRevision: forestCanopy?.stats.revision,
      });
    }
    profiler?.stage('Vegetation');
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    posters?.updateView(cameraSystem.camera.position, now);
    decorations.updateView(cameraSystem.camera.position);
    if (warmedUp) parcelTiles?.update(cameraSystem.camera.position, now);
    if (parcelTiles) profiler?.stage('Parcel tiles');
    const weatherEffects = liveWeather.update(dt);
    const windReading = liveWeather.windReading;
    const windDt = fixedStep ? dt : THREE.MathUtils.clamp(rawDt, 0, 0.25);
    updateSceneWind(windDt, weatherEffects.windX, weatherEffects.windZ);
    landmarks.updateWind(windDt, windReading);
    kiteFlyers.update(windDt, cameraSystem.camera.position, windReading);
    lightingSystem.update(cameraSystem.currentPos, weatherEffects);
    bgtWorld?.updateWind(windDt, liveWeather.turbineWind, now / 1000, lightingSystem.uNightFactor.value);
    precipitation.update(dt, cameraSystem.camera, weatherEffects);
    profiler?.stage('Lighting and weather');
    const { x: playerX, z: playerZ } = controllerManager.getActiveEntity().position;
    const outside = !containsPlayablePoint(playerX, playerZ);
    if (outside !== outsideMunicipality) {
      outsideMunicipality = outside;
      municipalWarning.hidden = !outside;
      municipalStatus.textContent = outside ? 'You are outside Gemeente Ede, in the 500 metre travel area.' : 'You are back inside Gemeente Ede.';
    }
    mapSystem.update();
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.activePresetId === 'midnight');
    profiler?.stage('Map and audio');
    if (warmedUp || !warmWholeScene) {
      expansionCulling?.update(cameraSystem.camera);
      updateSceneCulling(cameraSystem.camera.position);
    }
    // Traffic collisions can move the player after controller updates; finalize moving hierarchies here.
    for (const root of dynamicRoots) root.updateMatrixWorld();
    profiler?.stage('Visibility and transforms');
    const vehicle = controllerManager.getActiveEntity();
    roadFurniture?.update(cameraSystem.camera, dt, lightingSystem.uNightFactor.value,
      vehicle.headLights ?? (vehicle.headLight ? [vehicle.headLight] : null),
      trafficSystem.group.visible ? trafficSystem.headlights : null);
    profiler?.stage('Road furniture');

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp && warmWholeScene) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
      const restoreTreeShadows = treeField.prepareWarmup();
      const culled = [];
      const pipelines = new Set();
      scene.traverseVisible((o) => {
        const pipeline = o.userData.sharesPipelineWith || o;
        if (pipelines.has(pipeline)) return;
        pipelines.add(pipeline);
        if (o.frustumCulled) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      try {
        renderPipeline.render();
      } finally {
        restoreTreeShadows();
        for (const o of culled) o.frustumCulled = true;
      }
      markInit('warmup');
    }
    // Compile both landmark meshes behind the loader, then choose the first visible LOD.
    if (!warmedUp) {
      landmarks.update(cameraSystem.camera.position);
      landmarks.updateMastLod(cameraSystem.camera, renderer.domElement.height, lightingSystem.uNightFactor.value);
    }
    renderPipeline.render();
    profiler?.stage('Render submission');
    profiler?.endFrame();
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      const currentFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;

      const activeEnt = controllerManager.getActiveEntity();
      const mode = controllerManager.activeMode;
      const kmh = Math.round(Math.abs(activeEnt.speed) * 3.6);
      const altitudeM = Math.max(0, Math.round(activeEnt.position.y - terrainHeightAt(activeEnt.position.x, activeEnt.position.z)));

      if (elFps) {
        elFps.textContent = String(currentFps);
        elFps.className = currentFps >= 50 ? 'fps-ok' : currentFps >= 30 ? 'fps-warn' : 'fps-bad';
      }
      if (elSpeed) elSpeed.textContent = String(kmh);
      if (elSpeedMeter) elSpeedMeter.style.transform = `scaleX(${Math.min(1, kmh / (topSpeedKmh[mode] || 80))})`;
      document.body.classList.toggle('is-boosting', controllerManager.keys.boost && kmh > 0);
      if (elAltitude) elAltitude.textContent = altitudeM.toLocaleString('nl-NL');
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? activeEnt.position : cameraSystem.currentPos;
      renderLocation(getLocationLabel(where.x, where.z));
    }
  }

  // Route first-frame failures through the startup retry UI and stop drawing on a failed device.
  let startFirstFrame;
  const firstFrame = new Promise(resolve => { startFirstFrame = resolve; });
  await renderer.setAnimationLoop(now => {
    if (initTimings) startFirstFrame(now);
    else drawFrame(now);
  });
  try {
    drawFrame(await firstFrame);
    if (renderer.backend.gl?.isContextLost()) throw new Error('WebGL context lost during startup');
    const device = renderer.backend.device;
    if (device) {
      if (loadingStatus) loadingStatus.textContent = 'Finishing the first frame...';
      await Promise.race([
        device.queue.onSubmittedWorkDone(),
        device.lost.then(({ message }) => { throw new Error(message || 'WebGPU device lost during startup'); }),
      ]);
    }
  } catch (error) {
    await renderer.setAnimationLoop(null);
    throw error;
  }
  markInit('gpu');
  console.log(`[init] ${initTimings.join(', ')}`);
  // Spike test hooks (tools/probe.mjs, evidence screenshots)
  window.__slopwaw = {
    ready: true, firstFrameAt: performance.now(), init: initTimings.join(', '),
    backend,
    scene, renderer, cameraSystem, controllerManager, TELEPORT_LOCATIONS, trafficSystem, trainSystem, levelCrossings,
    graphics,
    perf: profiler && {
      report: profiler.report, reset: profiler.reset,
      setTrafficUpdates(enabled) { trafficUpdates = Boolean(enabled); },
      setTrafficDraw,
      setBuildingDetail: bagBuildings?.userData.setEnabled,
      setMurals: murals.setEnabled,
      setTreeQuality: selectTreeQuality,
      setTreeSeason: selectTreeSeason,
    },
    terrainTiles: terrainTiles?.stats,
    pavingTiles: cityGrid.pavingTiles.stats,
    exteriorBag: exteriorBag.stats,
    expansionCulling: expansionCulling?.stats,
    roadFurniture: roadFurniture?.stats,
    forestCanopy: forestCanopy?.stats,
    treeStats: treeField.stats,
    treeInventory: {
      source: loadedTrees?.inventory ?? 'osm', records: cityGrid.group.userData.treeInventory,
      mapped: cityGrid.group.userData.mappedTrees, procedural: cityGrid.group.userData.proceduralWoodlandTrees,
      canopyCells: loadedTrees?.canopyDensity?.size ?? 0,
    },
    get treeSeason() { return treeSeasonsEnabled ? getTreeSeason() : 'off'; },
    get environment() { return environmentMode; },
    get weather() { return liveWeather.state; }, streetFeatures, importedDetail, parcelTiles: parcelTiles?.stats, murals: murals.statistics,
    get waterLevels() { return cityGrid.waterLevels; },
    waterWorks: waterWorks?.userData.counts,
    teleport: teleportToLandmark,
    teleportXZ(x, z, heading = 0) { return teleportTo(x, z, heading); },
    mode(m) { selectMode(m); },
    camera(id) { selectCamera(id, true); },
    time(id) { selectTime(id); },
    setCamera(px, py, pz, tx, ty, tz) {
      cameraSystem.fixedPos = new THREE.Vector3(px, py, pz); cameraSystem.fixedLook = new THREE.Vector3(tx, ty, tz);
      selectCamera('fixed', true);
    },
    info() { return renderer.info ? { calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles } : null; },
  };
  initTimings = null;
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
  audioSystem.ready = true;
  setLoadingProgress(1);
}
