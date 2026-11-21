import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { LANGE_WEIDE_BUILDINGS } from './ede-lange-weide-survey.js';

const cream = 0xd0c9b7, brick = 0x80574c, plank = 0x494640;
const green = 0x23342d, glass = 0x3b4c50, plinth = 0x515453;

// The west gable has one continuous plane across the two BAG objects.
const farmhouseWest = (z, y, relief) => [-2698.52 + 0.0535 * (z - 2485.7) - relief, y, z];
const barnWest = (z, y, relief) => [-2697.94 + 0.0523 * (z - 2497.18) - relief, y, z];

function archedDoor(trim, plane, center, halfWidth, ground, spring, rise, surround, border = 0.14) {
  const shape = (half, base, shoulder, offset) => [
    plane(center - half, base, offset), plane(center + half, base, offset),
    ...Array.from({ length: 9 }, (_, i) => {
      const angle = Math.PI * i / 8;
      return plane(center + Math.cos(angle) * half, shoulder + Math.sin(angle) * rise, offset);
    }),
  ];
  trim.polygon([shape(halfWidth + border, ground, spring + border, 0.047)], surround);
  trim.polygon([shape(halfWidth, ground + 0.018, spring, 0.061)], green);
  trim.quad(plane(center - 0.015, ground + 0.02, 0.069), plane(center + 0.015, ground + 0.02, 0.069),
    plane(center + 0.015, spring + rise - 0.02, 0.069), plane(center - 0.015, spring + rise - 0.02, 0.069), 0x161d19);
}

function windowWithSill(wall, u, sill, height, shutters = false) {
  const half = shutters ? 0.49 : 0.31, head = sill + height;
  if (!surveyWindow(wall, u - half, u + half, sill, head, { frame: cream, color: glass, rows: 2, columns: 2 })) return;
  surveyPanel(wall, u - half - 0.05, u + half + 0.05, sill - 0.07, sill, 0x898681, 0.079);
  if (!shutters) return;
  const shutter = half * 0.93;
  surveyPanel(wall, u - half - shutter, u - half - 0.045, sill + 0.035, head - 0.05, green, 0.064);
  surveyPanel(wall, u + half + 0.045, u + half + shutter, sill + 0.035, head - 0.05, green, 0.064);
  surveyPanel(wall, u - half - 0.04, u + half + 0.04, head, head + 0.16, 0x956953, 0.048);
  surveyPanel(wall, u - 0.065, u + 0.065, head + 0.04, head + 0.16, 0xc5af8e, 0.057);
}

function decorate(wall) {
  const { building: { kind }, normal, faceIndex, width, low, high, base } = wall;
  if (low > base + 0.025 || width < 0.8) return;
  const west = normal.x < -0.88, east = normal.x > 0.90;
  const [x, , z] = wall.point(width * 0.5, low);
  const zOffset = value => (value - wall.a.z) / (wall.b.z - wall.a.z) * width;

  if (kind === 'south-barn') {
    if (!west && !east) return cream;
    surveyPanel(wall, 0, width, base + 0.02, base + 0.54, cream, 0.033);
    for (let y = base + 0.72; y + 0.18 < high; y += 0.19) {
      const inset = Math.max(0.012, (y - high + 0.7) * 0.68);
      if (surveyOpeningFits(wall, inset, width - inset, y, y + 0.18)) {
        surveyPanel(wall, inset, width - inset, y, y + 0.018, 0x363632, 0.036);
      }
    }
    if (west && faceIndex === 2) {
      surveyWindow(wall, width * 0.42, width * 0.58, base + 2.77, base + 3.45, { frame: green, color: glass });
    }
    return plank;
  }

  if (kind === 'north-barn') {
    for (let y = base + 0.28; y < Math.min(high - 0.18, base + 1.95); y += 0.19) {
      surveyPanel(wall, 0.025, width - 0.025, y, y + 0.022, 0x322d27, 0.042);
    }
    if (west && width > 2.6) {
      surveyPanel(wall, width * 0.18, width * 0.81, base + 0.05, base + 2.17, green, 0.052);
    }
    return;
  }

  if (east && x > -2679.1) {
    for (const opening of [2477.65, 2481.25, 2486.02, 2489.12]) windowWithSill(wall, zOffset(opening), -11.60, 1.83, true);
    for (const opening of [2478.1, 2487.7]) windowWithSill(wall, zOffset(opening), -8.62, 1.05);
    surveyPanel(wall, 0, width, high - 0.20, high - 0.045, cream, 0.04);
    return brick;
  }

  if (west && x < -2698.1) {
    surveyPanel(wall, 0, width, base + 0.02, -12.20, plinth, 0.026);
    for (const slit of [2482.65, 2488.24]) windowWithSill(wall, zOffset(slit), -10.39, 0.68);
    if (kind === 'farmhouse-north' && faceIndex === 14) {
      surveyLabel(wall, 0.16, width - 0.20, -8.20, -7.86, 'De Lange Weide', '#d0c9b7', '#3b352a');
    }
    return cream;
  }

  if (x < -2681 && (z > 2491.15 || z < 2479.45) && width > 3.1) {
    surveyPanel(wall, 0, width, base + 0.02, base + 0.44, plinth, 0.028);
    for (const fraction of [0.17, 0.56, 0.82]) windowWithSill(wall, width * fraction, base + 0.85, 1.02);
  }
  return cream;
}

export function buildEdeLangeWeideLandmark(site) {
  return createSurveyLandmark(site, LANGE_WEIDE_BUILDINGS, decorate, ({ trim }) => {
    // Door dimensions and lintels are fitted to the 2021–24 exterior views.
    archedDoor(trim, farmhouseWest, 2480.72, 1.16, -12.62, -10.55, 0.18, brick);
    archedDoor(trim, farmhouseWest, 2485.53, 1.26, -12.71, -9.27, 0.28, brick);
    archedDoor(trim, farmhouseWest, 2490.48, 1.28, -12.75, -10.50, 0.18, brick);
    archedDoor(trim, barnWest, 2502.82, 1.11, -13.06, -10.85, 0.07, plank, 0.08);
  });
}
