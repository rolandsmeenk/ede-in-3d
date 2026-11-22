import { EDE_DATA } from './ede-geodata.js';
import { projectLonLatInto } from './ede-scene-coordinates.js';

const project = ([lon, lat]) => projectLonLatInto(EDE_DATA.meta.lonLatAffine, lon, lat, {});

// The station and square are on the same side of the railway.
export const LUNTEREN_WATERLINE = [
  [5.623761, 52.085315], [5.623678, 52.085364], [5.622830, 52.085442],
  [5.621324, 52.085579], [5.620779, 52.085628], [5.620542, 52.085620],
  [5.620350, 52.085575], [5.620211, 52.085531], [5.620163, 52.085504],
].map(project);

// The granito curves across the pedestrian paving at the Wilbrinkstraat junction.
export const LUNTEREN_MEANDER = [
  [5.619941, 52.085455], [5.619967, 52.085450], [5.619989, 52.085431],
  [5.620009, 52.085426], [5.620029, 52.085442], [5.620045, 52.085467],
  [5.620059, 52.085483], [5.620076, 52.085489], [5.620105, 52.085491],
  [5.620133, 52.085497], [5.620163, 52.085504],
].map(project);

export const LUNTEREN_TILE_PANELS = [
  { ...project([5.619637, 52.0866709]), heading: 0.061, style: 'landleven' },
  { ...project([5.619668, 52.0866722]), heading: 0.061, style: 'hugo-de-vries' },
];

export const KEUENKLEP_BENCH = {
  ...project([5.683679, 52.088514]), heading: 0.22,
};

// @ OpenStreetMap contributors (ODbL) for mapped artwork and route positions.
// Remaining anchors and headings are fitted from the reference photos and PDOK imagery.
export const EDE_LUNTEREN_ART_LANDMARKS = [
  ['di-tengah-ombak', 'Di tengah ombak · Moluks monument', 'Dorpsstraat',
    [5.620030, 52.085595], [5.619961, 52.085609], 1.78, 1.27, -1.87],
  ['lunters-vrouwtje', 'Lunters Vrouwtje', 'Nieuwe Erf',
    [5.6193311, 52.0862824], [5.619267, 52.086260], 1.86, 1.43, -1.1],
  ['goudsberg-pijlpunt-nieuwe-erf', 'Goudsberg-pijlpunt · Nieuwe Erf', 'Nieuwe Erf',
    [5.619548, 52.086143], [5.619489, 52.086098], 1.65, 0.35, -0.84],
  ['de-bron-lunteren', 'De Bron · Stationskunst', 'Spoorstraat',
    [5.623791, 52.085287], [5.623842, 52.085368], 0.35, 0.25, -0.31],
  ['de-meander-lunteren', 'De Meander · Waterlijn', 'Dorpsstraat',
    [5.620039, 52.085458], [5.619982, 52.085469], 0.08, 0.08, 0],
  ['lunteren-centraal-monument', 'Centraal Monument · Bevrijdingsbank', 'Dorpsstraat',
    [5.621806, 52.083546], [5.621750, 52.083582], 1.56, 0.88, -2.26],
  ['lunteren-bevrijdingstegel', '75 jaar bevrijding · Lunteren', 'Dorpsstraat',
    [5.621840, 52.083487], [5.621889, 52.083494], 1.15, 0.91, 1.52],
  ['lunteren-gedenksteen-kerkhoflaan', 'Gedenksteen Kerkhoflaan', 'Kerkhoflaan',
    [5.618298, 52.081744], [5.618325, 52.081770], 1.20, 0.80, 1.84],
  ['de-keuenklep', 'Herinneringsmonument De Keuenklep', 'Immenweg',
    [5.683691, 52.088472], [5.683659, 52.088434], 1.36, 0.87, -0.25],
  ['lunteren-tegelroute', 'Tegelroute · Nieuwe Erf', 'Nieuwe Erf',
    [5.619652, 52.0866716], [5.619652, 52.086622], 1.95, 1.61, 0.03],
].map(([id, name, road, position, arrival, height, focusHeight, heading]) => {
  const { x, z } = project(position);
  const approach = project(arrival);
  const dx = x - approach.x, dz = z - approach.z;
  const scale = 1.8 / Math.hypot(dx, dz);
  return {
    id, name, road, district: 'Lunteren', x, z, approach, focusOffset: [dz * scale, -dx * scale],
    height, focusHeight, heading, mapScenic: true, worldSpace: true, surveyFootprints: [],
  };
});
