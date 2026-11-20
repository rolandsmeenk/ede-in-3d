import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, positionView, metalness, roughness, vec2, vec3, smoothstep } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { createPostProcessing } from './post-processing.js?v=20261119-perf';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { getLocationLabel, isTypingInField, ROADS, NYC_LANDMARKS, TELEPORT_LOCATIONS } from './city-config.js';
import { buildCityGrid } from './city-grid.js';
import { buildLandmarks } from './landmarks.js';
import { createEdeMurals } from './ede-murals.js';
import { buildCityBlocks } from './buildings.js';
import { createBagBuildingStream, loadBagBuildings } from './bag3d.js';
import { buildStreetDetails } from './street-details.js';
import { createTrafficSystem, createHighwayTraffic } from './traffic.js?v=20261119-fitted-lanes';
import { loadEdeParking } from './ede-parking.js';
import { buildRoadPaint } from './road-paint.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { TouchControls } from './touch-controls.js';
import { GamepadControls } from './gamepad-controls.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { LightingSystem } from './lighting.js?v=20261119-weather';
import { createLiveWeather, formatWeatherTime, weatherCondition } from './ede-weather.js';
import { createWeatherPrecipitation } from './weather-precipitation.js';
import { formatEdeTime } from './live-sky.js';
import { NYCMapSystem } from './nyc-map.js';
import { setupSceneCulling, updateSceneCulling } from './scene-culling.js';
import { CityAudioSystem } from './audio-system.js';
import { loadTerrain, terrainHeightAt } from './terrain.js';
import { loadAerialColors } from './aerial-colors.js';
import { loadEdeTrees } from './ede-tree-data.js';
import { loadEdeLamps } from './ede-lamp-data.js';
import { gradeDeckAt, gradeProfileAt, gradeWayAt, loadEdeGrade, nearbyRailHeightAt, setEdeHelipads, setEdePlatforms, setEdeStructureRoofs } from './ede-grade.js';
import { buildEdeGradeWorld } from './ede-grade-world.js';
import { buildEdeBgtWorld } from './ede-bgt-world.js';
import { loadEdeBusSchedule } from './ede-bus-schedule.js';
import { loadEdeTrainTimetable } from './ede-train-schedule.js';
import { createEdeTrainSystem } from './ede-trains.js';
import { createEdeLevelCrossings } from './ede-level-crossings.js';
import { BICYCLE, FOOT } from './road-access.js';
import { createEdeRoadTraffic, loadEdePostedSpeeds, watchEdeTraffic } from './ede-road-traffic.js';
import { loadEdeStreetFeatures } from './ede-street-features.js';
import { buildEdeStreetFeaturesWorld } from './ede-street-features-world.js';
import { buildEdeBusStops } from './ede-bus-stops.js';
import { loadEdeMotorwayLanes } from './ede-motorway-lanes.js';
import { loadEdeRoadSurfaces } from './ede-road-surfaces.js';
import { loadEdeFittedLanes } from './ede-lane-geometry.js';
import { buildEdeDetail, loadEdeDetail } from './ede-detail.js';

// js/main.js
// Main entry point for Ede in Three.js WebGPURenderer & TSL (three.js dev, see index.html)

async function initApp() {
  const query = new URLSearchParams(window.location.search);
  const profiling = query.get('perf') === '1';
  const fixedStep = profiling && query.get('bench') === '1';
  const bgtStage = profiling ? query.get('bgtStage') ?? undefined : undefined;
  const standard = query.get('quality') === 'standard';
  const enabled = (key, fallback = true) => {
    const value = profiling ? query.get(key) : null;
    return value === 'on' ? true : value === 'off' ? false : fallback;
  };
  const scale = profiling ? Number(query.get('scale')) : 0;
  const graphics = {
    quality: standard ? 'standard' : 'fast',
    msaa: enabled('msaa', standard), ssr: enabled('ssr', standard),
    bloom: enabled('bloom'), shadows: enabled('shadows'), vegetation: enabled('vegetation'),
    buildingDetail: enabled('buildingDetail'),
    scale: scale >= 0.5 && scale <= 1 ? scale : 1,
  };
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
  console.info(`[renderer] Three.js r${THREE.REVISION}; ${renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL fallback'}`);
  container.dataset.renderer = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL fallback';
  container.dataset.threeRevision = THREE.REVISION;
  container.dataset.quality = graphics.quality;

  // 2. Scene, atmosphere and lighting
  await showLoadingStage('Creating sky and environment lighting...');
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer);
  lightingSystem.sunLight.castShadow = graphics.shadows;
  const precipitation = createWeatherPrecipitation(scene);
  markInit('lighting');

  await showLoadingStage('Loading Ede’s map and timetables…');
  const [terrainResult, aerialResult, treeResult, lampResult, busResult, gradeResult, speedResult, featureResult,
    motorwayResult, roadSurfaceResult, trainResult, parkingResult, detailResult, laneFitResult] = await Promise.allSettled([
    loadTerrain(), loadAerialColors(), loadEdeTrees(), loadEdeLamps(), loadEdeBusSchedule(), loadEdeGrade(),
    loadEdePostedSpeeds(), loadEdeStreetFeatures(), loadEdeMotorwayLanes(), loadEdeRoadSurfaces(), loadEdeTrainTimetable(), loadEdeParking(),
    enabled('detail') ? loadEdeDetail({ bgt: enabled('bgtDetail'), bgtStage, motorway: enabled('motorwayDetail'),
      directional: enabled('motorwayDetail') && enabled('nbdSigns') }) : null,
    enabled('laneFits') ? loadEdeFittedLanes() : null
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
  if (!streetFeatures) console.warn('[street features] using existing road markings:', featureResult.reason);
  if (trainResult.status === 'rejected') console.warn('[trains] timetable unavailable:', trainResult.reason);
  markInit('map assets and timetables');

  // 3. Build the city, buildings, street details and traffic
  await showLoadingStage('Building streets, parks and water…');
  const cityGrid = buildCityGrid(scene, treeResult.status === 'fulfilled' ? treeResult.value : undefined, detailData?.landCover);
  markInit('cityGrid');
  await showLoadingStage('Building bridges, tunnels and railway platforms…');
  const gradeWorld = buildEdeGradeWorld(scene);
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
    setEdeStructureRoofs(bgtWorld.weatherCovers);
  } catch (error) {
    console.warn('[bgt] structure layer unavailable:', error);
  }
  markInit('grade and BGT structures');
  await showLoadingStage('Building landmarks...');
  const landmarks = buildLandmarks(scene);
  setEdePlatforms([...(bgtWorld?.platforms ?? []), ...landmarks.platforms]);
  setEdeHelipads(landmarks.helipads);
  markInit('landmarks');
  const eagerBag = graphics.buildingDetail && profiling && query.get('bag') === 'eager';
  const streamBag = graphics.buildingDetail && !eagerBag;
  let bagBuildings = null;
  if (eagerBag) {
    await showLoadingStage('Loading 3D BAG buildings...');
    try {
      bagBuildings = await loadBagBuildings(scene, {
        onProgress: (done, total) => { if (loadingStatus) loadingStatus.textContent = `Loading 3D BAG buildings ${done}/${total}…`; }
      });
    } catch (error) {
      console.warn('[bag3d] falling back to OSM buildings:', error);
    }
    markInit('bag3d');
  }
  await showLoadingStage('Generating building facades...');
  const cityBlocks = buildCityBlocks(scene, { bag: !!bagBuildings, streamBag });
  const murals = createEdeMurals(scene, { enabled: enabled('murals'), isFallbackVisible: cityBlocks.isFallbackVisible });
  if (streamBag) bagBuildings = createBagBuildingStream(scene, { fallback: cityBlocks });
  markInit('blocks');
  const allColliders = [...landmarks.colliders, ...cityBlocks.colliders, ...(cityGrid.colliders || []),
    ...gradeWorld.colliders, ...(bgtWorld?.colliders || [])];

  await showLoadingStage('Placing trees, streetlights and street furniture...');
  const mappedLamps = lampResult.status === 'fulfilled' ? lampResult.value : undefined;
  let importedDetail;
  try {
    if (detailResult.status === 'rejected') throw detailResult.reason;
    if (detailData?.features.length) {
      importedDetail = buildEdeDetail(scene, detailData.features, {
        deckProfiles: bgtWorld?.deckProfiles, mappedLamps, nbdTexture: detailData.nbdTexture,
      });
      importedDetail.stats.surveyedMarkings = detailData.markings.length;
      markInit('imported street and motorway detail');
    }
  } catch (error) {
    console.warn('[detail] street and motorway detail unavailable:', error);
  }
  const streetDetails = buildStreetDetails(scene, allColliders, mappedLamps, importedDetail?.gantryLampMounts);
  streetDetails.treeField.group.visible = graphics.vegetation;
  if (busSchedule) buildEdeBusStops(scene, busSchedule.variants);
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
    {enabled:trafficPilot,streetFeatures,railStop,profile:profiling,laneFits:laneFitResult.value});
  if (parkingResult.status==='rejected') console.warn('[parking] inventory unavailable:', parkingResult.reason);
  watchEdeTraffic(roadTraffic);
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
      await buildEdeStreetFeaturesWorld(scene, streetFeatures, roadSurfaceResult.value?.surfaces);
    } catch (error) {
      console.warn('[street features] unable to build the feature layer:', error);
    }
  }
  markInit('street features');
  buildRoadPaint(scene, trafficSystem.network, cityGrid.roadPaint,
    (x, z, edge) => {
      const fitted = edge?.profileId && gradeProfileAt(x, z, undefined, undefined, undefined, edge.profileId, 5);
      const grade = fitted || gradeWayAt(edge?.wayId, x, z, 1.2);
      // Free-standing surveyed strips and the broad asphalt polygons sample the AHN grid at different intervals.
      return grade ? grade.y + 0.055 : terrainHeightAt(x, z) + (edge?.type === 'marking' ? 0.09 : 0.065);
    }, { surveyed: detailData?.markings, preserveGBuffer: graphics.ssr });
  markInit('roadPaint');

  // 4. Initialize Third-Person Controllers (Person, Car, Cyclist, Helicopter) & Multi-Camera System
  await showLoadingStage('Preparing player, vehicles and controls...');
  const controllerManager = new ThirdPersonControllerManager(scene, allColliders);
  // The old flat-world Y and current saved Y both measure height above local ground.
  try {
    const saved = JSON.parse(localStorage.getItem('slop-ede-player-state'));
    if (saved?.version === 1 || saved?.version === 2) {
      for (const mode of Object.keys(controllerManager.entities)) {
        const p = saved.entities?.[mode];
        if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
        controllerManager.setMode(mode);
        controllerManager.teleportActiveTo(p.x, p.z, p.heading, terrainHeightAt(p.x, p.z) + p.y);
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
      localStorage.setItem('slop-ede-player-state', JSON.stringify({ version: 2, activeMode: controllerManager.activeMode, entities }));
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
      audioSystem.dispose();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
  markInit('controllers');

  // Island-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (scene-culling.js)
  await showLoadingStage('Preparing scene visibility and shadows...');
  const cullingRoots = ['EdeCityGrid', 'EdeCityBlocks', 'EdeStreetDetails', 'EdeGradeWorld', 'Ede BGT structures',
    'ManhattanLandmarks', 'EdeBoundaryContext', 'RoadMarkings', 'EdeStreetFeatures', 'EdeImportedDetail']
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
  const timeButtons = document.querySelectorAll('[data-time]');
  const liveClock = document.getElementById('time-live-clock');
  let liveTimeTimer;
  const weatherButton = document.getElementById('btn-live-weather');
  const weatherInfo = document.getElementById('live-weather-info');
  const weatherStatus = document.getElementById('live-weather-status');
  const weatherClock = document.getElementById('live-weather-time');
  const liveWeather = createLiveWeather({
    onChange({ enabled, status, current }) {
      weatherButton.setAttribute('aria-pressed', String(enabled));
      weatherInfo.hidden = !enabled;
      weatherClock.hidden = !current;
      weatherClock.textContent = current ? formatWeatherTime(current.observedAt) : '';
      if (current) weatherClock.dateTime = new Date(current.observedAt).toISOString();
      else weatherClock.removeAttribute('datetime');

      if (status === 'loading') weatherStatus.textContent = 'Loading weather…';
      else if (status === 'unavailable') weatherStatus.textContent = 'Weather unavailable · using preset';
      else if (status === 'expired') weatherStatus.textContent = 'Weather expired · using preset';
      else if (current) weatherStatus.textContent =
        `${weatherCondition(current.code)} · ${Math.round(current.temperature)} °C${status === 'stale' ? ' · Stale' : ''}`;
      else weatherStatus.textContent = '';
    }
  });
  weatherButton.addEventListener('click', () => liveWeather.setEnabled(!liveWeather.state.enabled));
  const teleportButtons = document.querySelectorAll('[data-teleport]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const modeSwitch = document.getElementById('mode-switch');
  touchControls.onAvailabilityChange = placeModeIndicator;

  const elFps = document.getElementById('hud-fps');
  const elMode = document.getElementById('hud-active-mode');
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
    liveClock.textContent = formatEdeTime(now);
    liveClock.dateTime = now.toISOString();
    if (!document.hidden) {
      liveTimeTimer = setTimeout(refreshLiveTime, 60000 - Date.now() % 60000);
    }
  }

  function selectTime(timeId) {
    clearTimeout(liveTimeTimer);
    const live = timeId === 'live';
    liveClock.hidden = !live;
    if (live) {
      refreshLiveTime();
    } else {
      liveClock.textContent = '';
      lightingSystem.applyPreset(timeId);
      colorGrade.applyPreset(lightingSystem.activePresetId);
    }
    timeButtons.forEach((btn) => {
      const active = btn.getAttribute('data-time') === timeId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!lightingSystem.live) return;
    clearTimeout(liveTimeTimer);
    if (!document.hidden) refreshLiveTime();
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

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTime(btn.getAttribute('data-time'));
      closePopovers();
    });
  });

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

  function teleportTo(x, z, heading = Math.PI, altitude = null) {
    const destination = controllerManager.teleportActiveTo(x, z, heading, altitude);
    touchControls.reset();
    gamepadControls.reset();
    cameraSystem.resetForTeleport();
    selectCamera('chase', true);
    mapSystem.waypoint = {
      x: destination.x,
      z: destination.z,
      name: getLocationLabel(destination.x, destination.z)
    };
    return destination;
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
    onTeleport: teleportTo
  });

  teleportButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-teleport');
      const loc = TELEPORT_LOCATIONS[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
      }
      closePopovers();
    });
  });

  const openMapBtn = document.getElementById('btn-open-map');
  if (openMapBtn) openMapBtn.addEventListener('click', () => mapSystem.toggleFullMap(true));

  if (supportsPopover && new URLSearchParams(window.location.search).get('debug') === '1') {
    const { mountCrossingTeleports } = await import('./ede-crossing-debug.js');
    mountCrossingTeleports(document.getElementById('crossing-debug-popover'), (mode, x, z, heading, altitude) => {
      selectMode(mode);
      teleportTo(x, z, heading, altitude);
      closePopovers();
    });
    document.getElementById('btn-crossing-debug').hidden = false;
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

  // Global keyboard shortcuts for modes (1-3, 5), cameras (V / 6-0), and HUD (H)
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
      case 'Digit5':
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
  selectTime('golden');
  // the web fonts change the buttons' widths once they arrive
  if (document.fonts) document.fonts.ready.then(placeModeIndicator);
  markInit('ui');

  // Compile shaders behind the loading screen. Overlapping compileAsync() jobs keep compilation moving
  // while individual jobs yield to the browser.
  const COMPILE_POOL = 16;
  const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0)));
  async function precompileShaders() {
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
    scene.traverseVisible((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
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
    await Promise.all(Array.from({ length: COMPILE_POOL }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  await precompileShaders();
  markInit('compile');
  await showLoadingStage('Preparing shadows and the first frame...');

  // 6. Animation Loop
  let lastTime = performance.now();
  let elapsed = 0;
  let trafficClock = 0;
  let frameCount = 0;
  let fpsTimer = 0;
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below

  if (elFps) elFps.textContent = '60';

  renderer.setAnimationLoop((now) => {
    profiler?.beginFrame(now);
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    const dt = fixedStep ? 1 / 60 : Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsed += dt;

    // Update 3rd-person controllers, camera, signals, traffic & vehicle collisions, building LODs, and dynamic shadow focus
    gamepadControls.update(dt);
    controllerManager.update(dt, elapsed, cameraSystem.initialized ? cameraSystem.currentPos : null);
    cameraSystem.update(dt, elapsed);
    profiler?.stage('Player and camera');
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
      murals.update(cameraSystem.camera.position, now);
    }
    cityBlocks.update(cameraSystem.currentPos.x, cameraSystem.currentPos.z);
    profiler?.stage('Buildings, façades and murals');
    if (graphics.vegetation) streetDetails.treeField.update(cameraSystem.camera.position);
    profiler?.stage('Vegetation');
    if (!document.hidden && now >= nextPlayerSave) {
      savePlayerState();
      nextPlayerSave = now + 5000;
    }
    if (cityBlocks.updateLights) cityBlocks.updateLights(cameraSystem.camera);
    if (streetDetails.update) streetDetails.update(cameraSystem.camera);
    const weatherEffects = liveWeather.update(dt);
    lightingSystem.update(cameraSystem.currentPos, weatherEffects);
    precipitation.update(dt, cameraSystem.camera, weatherEffects);
    profiler?.stage('Lighting and weather');
    mapSystem.update();
    audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.activePresetId === 'midnight');
    profiler?.stage('Map and audio');
    if (warmedUp) updateSceneCulling(cameraSystem.camera.position); // the warm-up frame draws every chunk
    // Traffic collisions can move the player after controller updates; finalize moving hierarchies here.
    for (const root of dynamicRoots) root.updateMatrixWorld();
    profiler?.stage('Visibility and transforms');

    // Render frame via TSL RenderPipeline (SSR + Bloom)
    if (!warmedUp) {
      // First frame = pipeline warm-up behind the loading screen, for what precompileShaders() can't reach (the shadow
      // map passes): with frustum culling off, every visible material's pipelines compile now instead of stalling the
      // first time the camera turns towards it (one chunk / shadow stand-in per shared pipeline is enough)
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
      renderPipeline.render();
      for (const o of culled) o.frustumCulled = true;
      markInit('warmup');
    }
    renderPipeline.render();
    profiler?.stage('Render submission');
    profiler?.endFrame();
    if (!warmedUp) {
      warmedUp = true;
      markInit('firstFrame');
      // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
      // compiled), i.e. until the city is actually on screen
      const device = renderer.backend.device;
      if (loadingStatus) loadingStatus.textContent = 'Waiting for graphics to finish the first frame...';
      Promise.resolve(device && device.queue.onSubmittedWorkDone()).catch(() => {}).then(() => {
        markInit('gpu');
        console.log(`[init] ${initTimings.join(', ')}`);
        // Spike test hooks (tools/probe.mjs, evidence screenshots)
        window.__slopwaw = {
          ready: true, firstFrameAt: performance.now(), init: initTimings.join(', '),
          backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL fallback',
          scene, renderer, cameraSystem, controllerManager, TELEPORT_LOCATIONS, trafficSystem, trainSystem, levelCrossings,
          graphics,
          perf: profiler && {
            report: profiler.report, reset: profiler.reset,
            setTrafficUpdates(enabled) { trafficUpdates = Boolean(enabled); },
            setTrafficDraw,
            setBuildingDetail: bagBuildings?.userData.setEnabled,
            setMurals: murals.setEnabled,
          },
          get weather() { return liveWeather.state; }, streetFeatures, importedDetail, murals: murals.statistics,
          teleport(key) { const l = TELEPORT_LOCATIONS[key]; return teleportTo(l.x, l.z, l.heading); },
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
      });
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
  });
}

initApp().catch((error) => {
  console.error(error);
  const status = document.getElementById('loading-status');
  if (status) status.textContent = 'Ede couldn’t open this time. Please try again.';
  document.getElementById('loading-overlay')?.classList.add('has-error');
  const retry = document.getElementById('loading-retry');
  if (retry) {
    retry.hidden = false;
    retry.addEventListener('click', () => window.location.reload());
  }
});
