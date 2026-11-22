import * as THREE from 'three/webgpu';
import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { LUNTEREN_FIRE_SURVEY } from './ede-lunteren-fire-sites.js';

const RED = 0xb72b23;
const CLADDING = 0xb2b6b6;
const DARK = 0x31363a;

function stationFront(wall) {
  if (wall.faceIndex !== 15) return;
  const { base, width, high, normal, point, shell, trim } = wall;
  const u = fraction => fraction * width;
  const panel = (a, b, low, top, color, offset) =>
    surveyPanel(wall, u(a), u(b), base + low, base + top, color, offset);

  // One wide sectional garage door and a separate personnel entrance.
  surveyWindow(wall, u(.064), u(.80), base + .03, base + 3.58, {
    frame: RED, color: 0x3d5157, columns: 6, rows: 0,
  });
  panel(.064, .80, .035, .73, RED, .063);
  for (const y of [1.43, 2.13, 2.83]) panel(.064, .80, y - .034, y + .034, RED, .061);
  panel(.835, .957, .035, 2.50, RED, .037);
  surveyWindow(wall, u(.839), u(.950), base + .86, base + 2.48, {
    frame: RED, color: 0x435356, rows: 2,
  });
  panel(.852, .862, .91, 1.04, DARK, .058);

  for (const [a, b] of [[.052, .064], [.80, .814]]) panel(a, b, .04, 3.61, DARK, .033);
  panel(.052, .814, 3.58, 3.67, DARK, .033);
  surveyPanel({ ...wall, trim: shell }, 0, width, high - .17, high - .067, RED, .029);
  for (const at of [.10, .25, .40, .55, .70, .82, .96]) {
    panel(at, at + .0011, 3.66, 4.29, 0x939898, .032);
  }

  const heading = Math.atan2(normal.x, normal.z);
  trim.solid(new THREE.BoxGeometry(u(.17), .16, .42)
    .rotateY(heading).translate(...point(u(.897), base + 2.62, .20)), DARK);
  surveyLabel(wall, u(.12), u(.738), base + 3.72, base + 4.24, 'BRANDWEER', '#b2b6b6', '#b32721');

  const crest = [
    [.846, 4.03], [.874, 4.10], [.909, 4.10], [.940, 4.03],
    [.938, 3.59], [.923, 3.34], [.895, 3.20], [.868, 3.34], [.851, 3.56],
  ];
  trim.polygon([crest.reverse().map(([x, y]) => point(u(x), base + y, .075))], RED);
  for (const flame of [
    [[.872, 3.68], [.883, 3.74], [.891, 3.54], [.901, 3.46], [.883, 3.44], [.872, 3.55]],
    [[.890, 3.89], [.902, 3.79], [.909, 3.67], [.902, 3.52], [.893, 3.65], [.895, 3.76]],
    [[.912, 3.78], [.926, 3.74], [.920, 3.56], [.906, 3.43], [.898, 3.50], [.910, 3.60]],
  ]) {
    trim.polygon([flame.reverse().map(([x, y]) => point(u(x), base + y, .085))], 0xe5b56b);
  }
  return CLADDING;
}

export function createLunterenFireStation(_footprints, site) {
  return createSurveyLandmark(site, [LUNTEREN_FIRE_SURVEY], stationFront);
}
