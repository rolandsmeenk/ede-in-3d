import * as THREE from 'three/webgpu';
import { createSurveyLandmark, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { surveyedWindowBatch, surveyPanelTexture, texturedSurveyPanel } from './ede-survey-panel-texture.js';

// 3DBAG LoD 2.2, CC BY 4.0. Coordinates use the Oude Kerk scene frame.
const outline = [[[-1592.14,151.87],[-1588.07,161.73],[-1504.27,126.8],[-1498.27,124.37],[-1502.34,114.45]]];
const shell = {
  ground: -7.35, outline, wallColor: 0x896b62, roofColor: 0x53514e,
  points: [
    [-1588.07,3.84,161.73], [-1588.07,-7.35,161.73], [-1504.27,-7.35,126.8], [-1504.27,3.83,126.8], [-1592.14,3.85,151.87],
    [-1592.14,-7.35,151.87], [-1502.82,3.84,114.65], [-1502.82,-7.35,114.65], [-1498.62,-7.35,124.52], [-1498.62,3.83,124.52],
  ],
  faces: [[0,[0,1,2,3]],[0,[4,5,1,0]],[0,[6,7,5,4]],[0,[3,2,8,9]],[0,[9,8,7,6]],[1,[9,6,4,0,3]]],
};

const paintBottom = -4.96, paintTop = 3.5;
const paintHeight = paintTop - paintBottom;

export function createWeerdesteinFoxBuilding(_footprints, site) {
  const map = surveyPanelTexture(64, 4, ctx => {
    ctx.fillStyle = '#85827a';
    ctx.fillRect(0, 0, 64, 4);
    ctx.fillStyle = '#746f68';
    ctx.fillRect(0, 0, 8, 4);
  });
  map.wrapS = THREE.RepeatWrapping;
  const doorMaterial = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.86 });
  const garageDoors = [];
  const windows = surveyedWindowBatch({ columns: 2, frame: '#cac4b7', glazing: ['#435963'] });
  return createSurveyLandmark(site, [shell], wall => {
    const { width, faceIndex, base, high } = wall;
    if (faceIndex === 1) {
      surveyPanel(wall, 0, width, paintTop, high - 0.012, 0x918275, 0.021);
      surveyPanel(wall, 0, width, paintBottom - 0.24, paintBottom, 0x8e8071, 0.030);
      for (const [top, bottom] of [[0.079, 0.169], [0.408, 0.505], [0.746, 0.837]]) {
        surveyWindow(wall, width * 0.077, width * 0.211, paintTop - bottom * paintHeight,
          paintTop - top * paintHeight, { frame: 0xcdc6b7, color: 0x56666c });
      }
      for (const [left, right] of [[0.069, 0.305], [0.384, 0.614], [0.700, 0.930]]) {
        const start = left * width, end = right * width, lo = base + 0.025, hi = paintBottom - 0.25;
        surveyPanel(wall, start, end, lo, hi, 0x545049, 0.025);
        const leafStart = start + 0.038, leafEnd = end - 0.038;
        const repeat = Math.round((leafEnd - leafStart) / 0.14);
        const door = texturedSurveyPanel(wall, leafStart, leafEnd, lo + 0.035, hi - 0.042,
          doorMaterial, { offset: 0.057, repeat });
        door.name = 'Weerdestein ribbed garage door';
        door.userData.nearDetail = true;
        garageDoors.push(door);
        const center = (start + end) / 2;
        surveyPanel(wall, center - 0.036, center + 0.036, lo + 0.81, lo + 0.98, 0x44413b, 0.105);
      }
    } else if (width > 70) {
      const bays = Math.round(width / 3.65), bay = width / bays;
      for (let floor = 0; floor < 3; floor++) {
        const sill = base + 3.0 + floor * 2.76;
        for (let i = 0; i < bays; i++) {
          const u = bay * i + 0.28;
          const end = u + bay * 0.67;
          if (surveyOpeningFits(wall, u, end, sill, sill + 1.55)) windows.add(wall, u, end, sill, sill + 1.55);
        }
      }
    }
  }, ({ group }) => group.add(...garageDoors, windows.mesh()));
}
