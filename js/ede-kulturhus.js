import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { KULTURHUS_SHELL } from './ede-kulturhus-survey.js';

const frame = 0xc5c4b9;
const glass = 0x566469;
const lintel = 0xb5ada1;

function decorate(wall) {
  const { width, base, faceIndex } = wall;
  const window = (left, right, low, high, columns, rows = 2) =>
    surveyWindow(wall, width * left, width * right, base + low, base + high,
      { color: glass, frame, columns, rows });
  const panel = (left, right, low, high, color, depth) =>
    surveyPanel(wall, width * left, width * right, base + low, base + high, color, depth);

  if (faceIndex === 21) {
    // The Dorpsplein elevation has offset ribbons in the main hall and a café door at the low wing.
    window(0.025, 0.242, 4.1, 5.72, 2, 3);
    window(0.436, 0.907, 4.1, 5.72, 4, 3);
    window(0.515, 0.975, 0.86, 2.35, 3, 3);
    window(0.132, 0.202, 0.03, 2.58, 1);
    panel(0.008, 0.992, 3.93, 4.07, 0x6b473c, 0.018);
    panel(0.002, 0.998, 9.08, 9.29, frame, 0.12);
  } else if (faceIndex === 2) {
    panel(0.11, 0.95, 0.02, 2.78, 0x797575, 0.034);
    panel(0.10, 0.14, 0.02, 2.87, lintel, 0.12);
    panel(0.91, 0.95, 0.02, 2.87, lintel, 0.12);
    panel(0.10, 0.95, 2.63, 2.87, lintel, 0.12);
    window(0.51, 0.90, 0.11, 2.60, 3, 1);
    panel(0.25, 0.28, 1.32, 1.61, 0x353a39, 0.06);
    surveyLabel(wall, width * 0.12, width * 0.94, base + 2.99, base + 3.52,
      'KULTURHUS WEKEROM', '#825144', '#f8eee1');
  } else if (faceIndex === 1) {
    // Narrow medical-wing openings continue along the pedestrian side.
    for (let i = 0; i < 9; i++) {
      const left = 0.055 + i * 0.103;
      window(left, left + 0.047, 0.38, 2.66, 1, 1);
    }
  }
}

export function createKulturhus(_footprints, site) {
  return createSurveyLandmark(site, [{ ...KULTURHUS_SHELL, roofColors: { 47: 0x828078 } }], decorate);
}
