const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('surveyed façade finishes filter fine detail and face out from the wall', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const canvas = { getContext: () => ({ fillRect() {} }) };
  const { surveyedWindowBatch, surveyPanelTexture, texturedSurveyPanel } = loadModule(
    readFileSync(join(__dirname, '../js/ede-survey-panel-texture.js'), 'utf8'),
    { imports: { 'three/webgpu': THREE }, globals: { document: { createElement: () => canvas } } },
  );
  let painted = false;
  const map = surveyPanelTexture(64, 4, () => { painted = true; });
  assert.ok(painted);
  assert.equal(map.image.width, 64);
  assert.equal(map.generateMipmaps, true);
  assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(map.colorSpace, THREE.SRGBColorSpace);

  const wall = { point: (u, y, offset) => [u, y, offset] };
  const material = new THREE.MeshStandardNodeMaterial({ map });
  const panel = texturedSurveyPanel(wall, 1, 3, 0.1, 2, material, { offset: 0.06, repeat: 14 });
  assert.equal(panel.geometry.getAttribute('position').count, 4);
  assert.equal(panel.geometry.getAttribute('uv').getX(1), 14);
  assert.ok(panel.geometry.getAttribute('normal').getZ(0) > 0.99);
  assert.equal(panel.receiveShadow, true);

  const windows = surveyedWindowBatch({ columns: 3, frame: '#bbbbbb', glazing: ['#555555', '#666666'] });
  windows.add(wall, 1, 3, 0.1, 2);
  windows.add(wall, 4, 6, 0.1, 2, 1);
  const batch = windows.mesh();
  assert.equal(batch.geometry.getAttribute('position').count, 8);
  assert.equal(batch.geometry.index.count, 12);
  assert.ok(batch.geometry.getAttribute('uv').getX(1) < 0.5);
  assert.ok(batch.geometry.getAttribute('uv').getX(4) > 0.5);
  assert.equal(batch.material.map.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(batch.userData.nearDetail, true);
});
