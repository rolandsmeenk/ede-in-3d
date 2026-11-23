import { EDE_DATA } from './ede-geodata.js';
import { projectLonLatInto } from './ede-scene-coordinates.js';
import { HUBERTUS_SHELLS } from './ede-sint-hubertus-survey.js';

function site(id, name, district, lon, lat, height, heading = 0) {
  const { x, z } = projectLonLatInto(EDE_DATA.meta.lonLatAffine, lon, lat, {});
  return { id, name, district, x, z, height, heading, focusHeight: height * 0.55, worldSpace: false, mapScenic: true };
}

// Official visitor maps and the Rijksdienst voor het Cultureel Erfgoed monument record.
export const EDE_OUTER_CULTURAL_LANDMARKS = [
  site('kroller-muller-museum', 'Kröller-Müller Museum', 'Otterlo', 5.8176639, 52.0962244, 10, 0.15),
  {
    id: 'jachthuis-sint-hubertus', name: 'Jachthuis Sint Hubertus', district: 'Hoge Veluwe',
    x: 11041.81, z: -8407.13, height: 34.76, focusHeight: 10.5,
    approach: { x: 11053.3, z: -8430.3 }, mapScenic: true, worldSpace: true,
    osmId: HUBERTUS_SHELLS[0].osmId, annexOsmIds: HUBERTUS_SHELLS.slice(1).map(building => building.osmId),
    bagIds: HUBERTUS_SHELLS.map(building => building.bagId),
    surveyFootprints: HUBERTUS_SHELLS.map(({ outline }) => {
      const [outer, ...holes] = outline.map(ring => ring.map(([x, z]) => ({ x, z })));
      return { outer, holes };
    }),
  },
  site('kijk-luistermuseum', 'Kijk & Luistermuseum', 'Bennekom', 5.6751135, 51.997555, 7, 0),
  site('alexanderkerk-bennekom', 'Oude of Sint-Alexanderkerk', 'Bennekom', 5.676173, 51.998031, 28, 0),
];
