const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function load(name, imports, globals) {
  return loadModule(readFileSync(join(__dirname, '../js/', name), 'utf8'), { imports, globals, filename: name });
}

test('Expansion landmarks build finite meshes in the surveyed frame', async () => {
  const three = await import('../vendor/three/build/three.webgpu.js');
  const tsl = await import('../vendor/three/build/three.tsl.js');
  const captions = [];
  const context = {
    fillRect() {}, save() {}, translate() {}, restore() {},
    fillText(text) { captions.push(text); },
  };
  const document = { createElement: () => ({ getContext: () => context }) };
  const terrain = { getTerrain: () => true, terrainHeightAt: () => 0 };
  const civic = load('ede-civic-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './terrain.js': terrain,
    './bag3d.js': {}, './ede-grade.js': { buildingPassageOpenings: () => [] }, './ede-geodata.js': { EDE_DATA: {} },
    './ede-wind-props.js': {}, './aerial-colors.js': {}, './ede-facades.js': {}, './ede-facade-material.js': {},
  }, { document });
  const surveyBuilder = load('ede-survey-landmark.js', {
    './ede-civic-landmarks.js': civic, './terrain.js': terrain,
  });
  const cultural = await import('../js/ede-outer-cultural-survey.js');
  const { EDE_OUTER_CULTURAL_FACTORIES } = load('ede-outer-cultural-models.js', {
    'three/webgpu': three, 'three/tsl': tsl, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    './ede-outer-cultural-survey.js': cultural, './ede-survey-landmark.js': surveyBuilder,
    './ede-facade-material.js': { createFacadeSurfaceTexture: () => ({ texture: new three.DataTexture() }) },
    './ede-sint-hubertus.js': {}, './ede-clock-model.js': {},
  });
  const museumSite = cultural.OUTER_CULTURAL_META.find(site => site.id === 'kijk-luistermuseum');
  const museum = EDE_OUTER_CULTURAL_FACTORIES[museumSite.id](null, museumSite);
  const museumBounds = new three.Box3().setFromObject(museum);
  const [outline] = cultural.OUTER_CULTURAL_SURVEYS[museumSite.id][0].outline;
  const footprint = new three.Box3().setFromPoints(outline.map(([x, z]) => new three.Vector3(x, 0, z)));
  for (const axis of ['x', 'z']) {
    assert.ok(Math.abs(museumBounds.min[axis] - footprint.min[axis]) < 0.1, 'museum trim follows the surveyed footprint');
    assert.ok(Math.abs(museumBounds.max[axis] - footprint.max[axis]) < 0.1, 'museum trim follows the surveyed footprint');
  }

  const surveys = load('ede-expansion-landmark-surveys.js');
  const { EXPANSION_LANDMARK_FACTORIES } = load('ede-expansion-landmarks.js', {
    'three/webgpu': three, 'three/tsl': tsl, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
    './ede-grade.js': { nearbyRailHeightAt: () => undefined, RAIL_TOP: 0.13 },
    './ede-expansion-landmark-surveys.js': surveys, './ede-survey-landmark.js': surveyBuilder,
    './ede-windmill.js': load('ede-windmill.js', {
      'three/webgpu': three, 'three/tsl': tsl,
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: tsl.uniform(0.48) } },
    }),
  });
  const amadeus = load('ede-amadeus-survey.js');
  const { EDE_AMADEUS_LANDMARK_FACTORIES } = load('ede-amadeus-landmark.js', {
    'three/webgpu': three, './ede-civic-landmarks.js': civic, './ede-survey-landmark.js': surveyBuilder,
    './ede-amadeus-survey.js': amadeus, './terrain.js': terrain,
  });
  const sites = [...surveys.EDE_EXPANSION_LANDMARKS, ...amadeus.EDE_AMADEUS_LANDMARKS];
  const factories = { ...EXPANSION_LANDMARK_FACTORIES, ...EDE_AMADEUS_LANDMARK_FACTORIES };
  for (const site of sites) {
    const model = factories[site.id](site.surveyFootprints, site);
    if (!site.worldSpace) model.position.set(site.x, 0, site.z);
    const bounds = new three.Box3().setFromObject(model);
    assert.ok(!bounds.isEmpty(), site.id);
    assert.ok(bounds.min.x <= site.x && bounds.max.x >= site.x, site.id);
    assert.ok(bounds.min.z <= site.z && bounds.max.z >= site.z, site.id);
    model.traverse(({ geometry }) => {
      if (geometry) assert.ok(geometry.attributes.position.array.every(Number.isFinite), site.id);
    });
    if (site.bagIds) {
      const buildingColliders = model.userData.colliders.filter(collider => collider.polygon);
      assert.equal(buildingColliders.length, site.bagIds.length, site.id);
    }
    if (site.id === 'veenendaal-de-klomp') assert.equal(model.userData.platforms.length, 2);
    if (site.id === 'schaapskooi-ginkelse-heide') {
      assert.ok(model.userData.colliders.some(collider => collider.obb));
    }
    if (site.id === 'doesburgermolen') {
      const cap = model.getObjectByName('Windmill cap');
      const sails = model.getObjectByName('Windmill sails');
      const cloth = model.getObjectByName('Windmill sailcloth');
      const [buck] = cap.children.filter(child => child.isMesh);
      const [base] = model.children.filter(child => child.isMesh);
      const baseMatrix = base.matrixWorld.clone();
      const buckMatrix = buck.matrixWorld.clone();
      for (let i = 0; i < 60; i++) cap.userData.updateWind(1 / 60, { windDirection: 90, windSpeed: 18 });
      const front = new three.Vector3(0, 0, 1).transformDirection(cap.matrixWorld);
      assert.ok(front.x > 0.999, 'the buck and shaft face the wind from the east');
      assert.ok(!buck.matrixWorld.equals(buckMatrix), 'the timber buck turns with the sails');
      assert.ok(base.matrixWorld.equals(baseMatrix), 'the base stays fixed');
      assert.notEqual(sails.rotation.z, 0.34);
      assert.equal(cloth.visible, true);
    }
    if (site.id === 'vensters-op-het-verleden') {
      assert.equal(bounds.max.y, 6);
      const cutouts = model.getObjectByName('Vensters steel openwork');
      assert.equal(cutouts.geometry.index.count, 5 * 6, 'one textured quad per window');
      assert.equal(cutouts.material.side, three.DoubleSide, 'the artwork is visible on both sides');
      assert.ok(cutouts.material.alphaTest > 0, 'the alpha mask leaves openings in the steel');
      assert.ok(model.userData.colliders.some(collider => collider.obb), 'the memorial retains its solid footprint');
    }
    if (site.id === 'huzarenmonument') {
      assert.ok(model.userData.colliders.some(collider => collider.obb), 'the brick plinth has a solid footprint');
      assert.ok(bounds.max.y < 1.35, 'the memorial remains a low wall');
    }
  }
  const folds = sites.find(site => site.id === 'schaapskooi-ginkelse-heide');
  assert.equal(folds.surveyFootprints.length, 2);
  assert.deepEqual(captions.sort(), [
    '10 MEI 1940', 'C.E. GRAAF VAN LIMBURG STIRUM', 'J.G. DIJKERS', 'KIJK & LUISTERMUSEUM', 'P.CH. BONKERK',
    'RESTAURANT', 'RESTAURANT', 'STEAKHOUSE', 'THEESCHENKERIJ', 'Veenendaal-De Klomp',
  ]);

  const modules = [
    ['ede-ginkel-landmark-surveys.js', 'EDE_GINKEL_LANDMARKS', 'ede-ginkel-landmarks.js', 'GINKEL_LANDMARK_FACTORIES'],
    ['ede-reemst-landmark-survey.js', 'EDE_REEMST_LANDMARKS', 'ede-reemst-landmarks.js', 'REEMST_LANDMARK_FACTORIES'],
    ['ede-west-expansion-surveys.js', 'EDE_WEST_EXPANSION_LANDMARKS', 'ede-west-expansion-landmarks.js', 'WEST_EXPANSION_LANDMARK_FACTORIES'],
    ['ede-zonneoord-surveys.js', 'EDE_ZONNEOORD_LANDMARKS', 'ede-zonneoord-landmarks.js', 'ZONNEOORD_LANDMARK_FACTORIES'],
  ];
  for (const [surveyFile, siteKey, modelFile, factoryKey] of modules) {
    const survey = load(surveyFile);
    const modelFactories = load(modelFile, {
      'three/webgpu': three, './ede-civic-landmarks.js': civic, './terrain.js': terrain,
      './ede-survey-landmark.js': surveyBuilder, ['./' + surveyFile]: survey,
    })[factoryKey];
    for (const site of survey[siteKey]) {
      const model = modelFactories[site.id](site.surveyFootprints, site);
      const bounds = new three.Box3().setFromObject(model);
      assert.ok(!bounds.isEmpty() && model.children.length <= 6, site.id);
      model.traverse(({ geometry }) => {
        if (geometry) assert.ok(geometry.attributes.position.array.every(Number.isFinite), site.id);
      });
      assert.ok(model.userData.colliders.length > 0, site.id);
      if (site.bagIds?.length) {
        assert.equal(model.userData.colliders.filter(collider => collider.polygon).length,
          site.surveyFootprints.length, site.id);
      }
      if (site.id === 'valenberg') {
        const ramps = model.userData.platforms;
        assert.equal(ramps.length, survey.VALENBERG_RAMP.length);
        const [[startX, startZ], [endX, endZ]] = [survey.VALENBERG_RAMP[0], survey.VALENBERG_RAMP.at(-1)];
        assert.ok(Math.abs(ramps.at(-1).height(endX, endZ) - ramps[0].height(startX, startZ) - 2.5) < 0.001);
      }
      if (site.id === 'wildkijkscherm-nieuw-reemst') {
        assert.ok(model.userData.platforms.some(platform => platform.id.endsWith('-steps')));
      }
    }
  }
});
