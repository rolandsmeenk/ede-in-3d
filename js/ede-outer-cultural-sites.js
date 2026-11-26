import { HUBERTUS_SHELLS } from './ede-sint-hubertus-survey.js';
import { OUTER_CULTURAL_META, OUTER_CULTURAL_SURVEYS } from './ede-outer-cultural-survey.js';

function footprintsFrom(shells) {
  return shells.map(({ outline }) => {
    const [outer, ...holes] = outline.map(ring => ring.map(([x, z]) => ({ x, z })));
    return { outer, holes };
  });
}

// Surveyed 3DBAG LoD 2.2 outer cultural, village and barracks landmarks across Gemeente Ede.
export const EDE_OUTER_CULTURAL_LANDMARKS = [
  ...OUTER_CULTURAL_META.map(meta => ({
    ...meta,
    worldSpace: true,
    mapScenic: true,
    surveyFootprints: footprintsFrom(OUTER_CULTURAL_SURVEYS[meta.id]),
  })),
  {
    id: 'jachthuis-sint-hubertus', name: 'Jachthuis Sint Hubertus', district: 'Hoge Veluwe',
    x: 11041.81, z: -8407.13, height: 34.76, focusHeight: 10.5,
    approach: { x: 11053.3, z: -8430.3 }, mapScenic: true, worldSpace: true,
    osmId: HUBERTUS_SHELLS[0].osmId, annexOsmIds: HUBERTUS_SHELLS.slice(1).map(building => building.osmId),
    bagIds: HUBERTUS_SHELLS.map(building => building.bagId),
    surveyFootprints: footprintsFrom(HUBERTUS_SHELLS),
  },
];
