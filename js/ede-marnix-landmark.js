import { createSurveyLandmark, surveyLabel, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { MARNIX_COLLEGE_SURVEY } from './ede-marnix-survey.js';

const brick = 0x9e7d6b;
const frame = 0x45494a;
const timber = 0x654339;
const terracotta = 0xa8513f;
const glazing = [0x586b6d, 0x485b63, 0x697c7b];
const auditorium = new Set([2, 3, 4, 5, 6, 7, 9, 10, 11, 28, 33, 34, 38]);
const classroomWings = new Set([0, 8, 15, 22, 23, 32, 40, 47, 50, 53]);

function wallBand(wall, left, right, lo, hi) {
  if (right <= left || hi <= lo) return;
  surveyPanel(wall, left, right, lo, hi, timber, .042);
  for (let y = lo + .075; y + .024 < hi; y += .14) {
    surveyPanel(wall, left, right, y, y + .024, 0x825b4b, .058);
  }
}

function classroom(wall) {
  const { faceIndex, low, high, base, width } = wall;
  const left = faceIndex === 8 ? 5.9 : Math.min(1.1, width / 5);
  const right = width - Math.min(1, width / 6);
  const bays = Math.max(1, Math.round((right - left) / 3.2));
  const pitch = (right - left) / bays;
  for (let floor = 0; floor < 3; floor++) {
    const sill = base + .47 + 3.39 * floor;
    const lintel = sill + 2.31;
    if (sill < low + .05 || lintel > high - .16) continue;
    for (let i = 0; i < bays; i++) {
      const a = left + i * pitch, b = a + pitch;
      const panel = Math.min(.49, pitch * .19);
      surveyWindow(wall, a + .062, b - panel, sill, lintel,
        { color: glazing[(i + floor) % glazing.length], frame, columns: 2 });
      surveyPanel(wall, b - panel + .035, b - .09, sill + .05, lintel - .04,
        i % 4 === 3 ? 0x984c40 : terracotta, .049);
    }
    const bandTop = Math.min(high - .13, lintel + 1.02);
    wallBand(wall, left, right, lintel + .065, bandTop);
    surveyPanel(wall, left, right, sill - .105, sill - .035, 0xa4a5a3, .071);
  }
  if (faceIndex === 8) {
    surveyLabel(wall, .52, 5.48, 1.19, 2.03, 'MARNIX COLLEGE', '#9e7d6b', '#362b26');
  }
  surveyPanel(wall, .05, width - .05, high - .28, high - .13, frame, .064);
}

function mainEntrance(wall) {
  const { base, width, high, point, trim } = wall;
  const left = .65, right = width - .44;
  const glazingTop = Math.min(base + 6.2, high - .5);
  surveyWindow(wall, left, right, base + .18, glazingTop,
    { color: 0x536871, frame: 0xadb0a7, columns: 8, rows: 3 });
  const doorLeft = width * .37, doorRight = width * .57;
  surveyPanel(wall, doorLeft, doorRight, base + .11, base + 2.40, 0xb65743, .085);
  for (const u of [doorLeft, (doorLeft + doorRight) / 2, doorRight]) {
    surveyPanel(wall, u - .023, u + .023, base + .12, base + 2.41, 0xb8b6ad, .096);
  }
  for (const u of [width * .445, width * .48]) {
    surveyPanel(wall, u, u + .045, base + .97, base + 1.42, 0xd5d2c6, .108);
  }
  surveyPanel(wall, left, right, glazingTop + .2, high - .29, 0xd0cbc2);
  surveyPanel(wall, width * .29, width * .66, glazingTop + .26, high - .75, terracotta, .073);
  surveyLabel(wall, width * .30, width * .65, high - 1.20, high - .81,
    'MARNIX COLLEGE', '#a8513f', '#f6eee0');

  // Thin, projecting roof above the glazed entry bay.
  const soffit = base + 5.92, leadingEdge = base + 6.13, overhang = 1.17;
  trim.quad(point(left, leadingEdge, overhang), point(right, leadingEdge, overhang),
    point(right, leadingEdge, 0), point(left, leadingEdge, 0), 0x9a9a8f);
  trim.quad(point(left, soffit, overhang), point(right, soffit, overhang),
    point(right, leadingEdge, overhang), point(left, leadingEdge, overhang), 0xa6a69d);
  trim.quad(point(left, soffit, 0), point(right, soffit, 0),
    point(right, soffit, overhang), point(left, soffit, overhang), 0x696965);
}

function auditoriumFront(wall) {
  const { faceIndex, width, high, base, point, trim } = wall;
  const glassBase = base + .25;
  function fold(u) {
    const [x, , z] = point(u, glassBase);
    return Math.max(glassBase + .12, base + 3.09 - Math.hypot(x + 416.38, z - 1689.56) * .117);
  }
  const bays = Math.max(1, Math.round(width / 1.47));
  for (let i = 0; i < bays; i++) {
    const a = width * i / bays + .035, b = width * (i + 1) / bays - .035;
    if (b <= a || Math.max(fold(a), fold(b)) < glassBase + .21) continue;
    trim.quad(point(a, glassBase, .047), point(b, glassBase, .047), point(b, fold(b), .047),
      point(a, fold(a), .047), glazing[i % glazing.length], .64);
    surveyPanel(wall, a - .022, a + .026, glassBase, fold(a), frame, .06);
  }
  trim.quad(point(.02, fold(.02) - .046, .071), point(width - .02, fold(width - .02) - .046, .071),
    point(width - .02, fold(width - .02) + .06, .071), point(.02, fold(.02) + .06, .071), 0x694940);
  for (let y = Math.max(fold(0), fold(width)) + .12; y < high - .16; y += .20) {
    surveyPanel(wall, .015, width - .015, y, y + .032, 0x795345, .046);
  }
  if (faceIndex === 9) surveyWindow(wall, width * .34, width * .70, base + 4.61, base + 5.19,
    { color: 0x3b5157, frame, columns: 4 });
  return timber;
}

function decorate(wall) {
  const { faceIndex } = wall;
  if (auditorium.has(faceIndex)) return auditoriumFront(wall);
  if (faceIndex === 41) mainEntrance(wall);
  else if (classroomWings.has(faceIndex)) classroom(wall);
  return brick;
}

export function createMarnixCollege(_footprints, site) {
  return createSurveyLandmark(site, [{
    ...MARNIX_COLLEGE_SURVEY,
    roofColors: { 55: 0x656a64, 58: 0x646762, 59: 0x676563, 60: 0x827d72 },
  }], decorate);
}
