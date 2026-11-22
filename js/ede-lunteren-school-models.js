import { createSurveyLandmark, surveyLabel, surveyOpeningFits, surveyPanel, surveyWindow } from './ede-survey-landmark.js';
import { LUNTEREN_SCHOOL_SURVEYS } from './ede-lunteren-school-sites.js';

const glass = 0x40535b;
const charcoal = 0x373d3e;
const cream = 0xc8bb9e;

function row(wall, from, to, pitch, lo, hi, {
  frame = charcoal, columns = 2, rows = 1, proportion = 0.76, color = glass,
} = {}) {
  const count = Math.max(1, Math.round((to - from) / pitch));
  const step = (to - from) / count;
  const inset = step * (1 - proportion) / 2;
  for (let i = 0; i < count; i++) {
    const a = from + i * step + inset;
    surveyWindow(wall, a, a + step - 2 * inset, wall.base + lo, wall.base + hi, { frame, columns, rows, color });
  }
}

function band(wall, lo, hi, color) {
  const { width, base } = wall;
  if (surveyOpeningFits(wall, 0.08, width - 0.08, base + lo, base + hi)) {
    surveyPanel(wall, 0.06, width - 0.06, base + lo, base + hi, color);
  }
}

function sign(wall, from, to, lo, hi, title, background, foreground) {
  const a = from * wall.width, b = to * wall.width;
  if (surveyOpeningFits(wall, a, b, wall.base + lo, wall.base + hi)) {
    surveyLabel(wall, a, b, wall.base + lo, wall.base + hi, title, background, foreground);
  }
}

function bronWall(wall) {
  const { faceIndex, width, low, high, base, rings, normal } = wall;
  const dark = 0x454442;
  if ([13, 23].includes(faceIndex)) {
    // The Postweg school's tall entrance is glazed up to the gable.
    const glazing = rings[0].map(([x, y, z]) => [x + normal.x * 0.044, y, z + normal.z * 0.044]);
    wall.trim.polygon([glazing], glass, 0.7);
    const count = Math.round(width / 0.84);
    for (let i = 0; i < count; i++) {
      const u = width * (i + 0.12) / count;
      const roofEdge = rings[0].filter((p, index, all) => p[1] > base + 4.1
        && !all.some(other => other[0] === p[0] && other[2] === p[2] && other[1] > p[1]));
      const [first, last] = roofEdge.sort((a, b) => Math.hypot(a[0] - wall.a.x, a[2] - wall.a.z)
        - Math.hypot(b[0] - wall.a.x, b[2] - wall.a.z));
      const y = first[1] + (last[1] - first[1]) * u / width;
      surveyPanel(wall, u, u + 0.045, base + 0.06, y - 0.08, dark, 0.054);
    }
    band(wall, 2.37, 2.49, dark);
    band(wall, 4.02, 4.18, dark);
    if (faceIndex === 13) sign(wall, 0.12, 0.90, 3.12, 3.91, 'De Bron', '#dedbd1', '#394c56');
    return dark;
  }
  if (low > base + 0.07 || width < 2.7) return;
  row(wall, 0.2, width - 0.2, 3.2, 0.79, 2.78, { frame: dark });
  if (high - base < 5.9) return;
  band(wall, 4.03, 6.70, dark);
  row(wall, 0.17, width - 0.17, 3.05, 4.43, 6.20, { frame: 0x77716a, proportion: 0.68 });
}

function wegwijzerWall(wall) {
  const { faceIndex, width, base, high } = wall;
  if (width < 1.5) return;
  if ([0, 21, 22, 19, 20, 18, 25, 13, 12, 11].includes(faceIndex)) {
    // Continuous curtain wall beneath the rising, curved eave.
    const rows = [[0.38, 2.45], [3.25, 4.18], [4.28, 5.12], [5.23, 6.22]];
    for (const [bottom, top] of rows) {
      const hi = Math.min(high - base - 0.24, top);
      if (hi - bottom > 0.22) {
        row(wall, 0.06, width - 0.06, 1.57, bottom, hi, { columns: 1, proportion: 0.92, frame: charcoal });
      }
    }
    if ([0, 22].includes(faceIndex)) {
      surveyWindow(wall, width * 0.26, width * 0.77, base + 0.12, base + 2.62, { frame: 0x945f43, columns: 2 });
      surveyPanel(wall, width * 0.10, width * 0.13, base + 0.09, base + 5.42, 0x9e6a48, 0.067);
    }
    return charcoal;
  }
  if ([2, 24].includes(faceIndex)) {
    if (faceIndex === 2) sign(wall, 0.22, 0.80, 3.0, 3.8, 'De Wegwijzer', '#7a4a3f', '#bad98c');
    return;
  }
  row(wall, 0.18, width - 0.18, 3.0, 0.76, 2.53, { frame: charcoal });
  row(wall, 0.18, width - 0.18, 3.0, 3.91, 5.61, { frame: charcoal });
}

function triangelWall(wall) {
  const { faceIndex, width, base, low, high } = wall;
  if (width < 2.3) return;
  const brick = 0x91463d;
  if (faceIndex === 83) {
    row(wall, 0.35, width - 0.35, 2.2, 4.08, 5.71, { columns: 1, proportion: 0.96 });
    return brick;
  }
  if (faceIndex === 84) {
    row(wall, 3.35, width - 1.4, 3.8, 0.31, 2.46, { frame: 0xaba89e, proportion: 0.72 });
    return;
  }
  if (low > base + 0.09) return;
  if ([78, 79].includes(faceIndex)) {
    band(wall, 5.90, 7.12, brick);
    band(wall, 4.17, 5.89, charcoal);
    row(wall, 0.17, width - 0.17, 2.2, 4.19, 5.83, { columns: 1, proportion: 0.95 });
  }
  if (faceIndex === 79) {
    surveyWindow(wall, 1.21, 4.06, base + 0.15, base + 2.75, { columns: 3, frame: 0x385c72 });
    sign(wall, 0.09, 0.82, 2.78, 3.51, 'CNS De Triangel', '#a4977d', '#364650');
    row(wall, 5.0, width - 0.4, 3.5, 0.77, 2.5, { frame: 0xb8b1a1 });
    return;
  }
  row(wall, 0.17, width - 0.17, 3.55, 0.75, Math.min(2.72, high - base - 0.27), {
    frame: 0xaaa28e, columns: 3, rows: 2,
  });
  if ([35, 36, 37, 42, 46, 47, 57, 65, 66].includes(faceIndex)) return 0x927a66;
}

function marterlaanWall(wall) {
  const { faceIndex, width, base, high, low } = wall;
  const top = high - base;
  if (low > base + 0.09 || width < 2.1) return;
  const colors = [0x326c91, 0xa8474b, 0x7b8f4e, 0xca9c53];
  const fullHeight = [0, 16, 17, 20, 21, 38, 46, 51, 57, 75, 82].includes(faceIndex);
  if (fullHeight) {
    band(wall, 2.96, 3.39, 0xc8c2ad);
    band(wall, 3.41, 3.53, 0x925044);
    row(wall, 0.16, width - 0.16, 4.0, 0.54, 2.94, {
      frame: 0xbfbdb2, columns: 3, rows: 2, proportion: 0.89,
    });
    const color = colors[faceIndex % colors.length];
    surveyPanel(wall, width * 0.16, width * 0.16 + 0.15, base + 0.12, base + 3.11, color, 0.059);
  } else if (top > 3.55) {
    row(wall, 0.21, width - 0.21, 4.1, 1.18, 2.65, { frame: 0xbfbdb2, columns: 3 });
  }
  if (faceIndex === 75) {
    surveyWindow(wall, 0.61, width - 0.61, base + 0.11, base + 2.46, { frame: 0x365a75, columns: 2 });
  }
}

function nederwoudWall(wall) {
  const { faceIndex, width, base, low, high } = wall;
  if (width < 1.6) return;
  if (faceIndex === 3) {
    row(wall, 0.25, width - 0.25, 3.52, 4.43, 5.58, {
      frame: 0xbcb29d, columns: 3, rows: 2, proportion: 0.92,
    });
    return;
  }
  if (low > base + 0.10) return;
  if (faceIndex === 14) {
    surveyWindow(wall, 0.40, width - 0.40, base + 0.12, base + 2.54, { frame: 0x407171, columns: 2 });
    sign(wall, 0.08, 0.92, 2.67, 3.27, 'Nederwoud', '#dfd8c6', '#3b5d61');
    return cream;
  }
  row(wall, 0.2, width - 0.2, 2.67, 0.59, 2.39, { frame: cream, columns: 3, rows: 2, proportion: 0.86 });
  if (faceIndex === 16) {
    row(wall, 0.2, width - 0.2, 3.54, 4.04, 5.37, {
      frame: cream, columns: 3, rows: 2, proportion: 0.77,
    });
    return 0x9e8d71;
  }
  if ([4, 10, 13].includes(faceIndex)) band(wall, 2.56, 2.83, 0xb0a68e);
}

const decorations = {
  'lunteren-de-bron': bronWall,
  'lunteren-de-wegwijzer': wegwijzerWall,
  'lunteren-de-triangel': triangelWall,
  'lunteren-de-triangel-marterlaan': marterlaanWall,
  'lunteren-nederwoud': nederwoudWall,
};

export const LUNTEREN_SCHOOL_LANDMARK_FACTORIES = Object.fromEntries(
  Object.entries(decorations).map(([id, decorate]) => [
    id, (_, site) => createSurveyLandmark(site, [LUNTEREN_SCHOOL_SURVEYS[id]], decorate),
  ]),
);
