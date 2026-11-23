import { EDE_DATA } from './ede-geodata.js';
import { projectLonLatInto } from './ede-scene-coordinates.js';

function memorial(id, name, district, lon, lat, dx, dz, height, north = false) {
  const { x, z } = projectLonLatInto(EDE_DATA.meta.lonLatAffine, lon, lat, {});
  const cameraOffset = 1.8 / Math.hypot(dx, dz);
  return {
    id, name, district, x, z, height, north, worldSpace: true, mapScenic: true, surveyFootprints: [],
    heading: Math.atan2(dx, dz), focusHeight: height * 0.55, approach: { x: x + dx, z: z + dz },
    focusOffset: [-dz * cameraOffset, dx * cameraOffset],
  };
}

export const EDE_OUTER_MEMORIALS = [
  // Separate inscribed stone beside the Airborne column. Approximate placement from the PDOK orthophoto.
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1310/ede-airborne-monument
  memorial('airborne-landing-boulder', 'Gedenksteen Luchtlanding', 'Ginkelse Heide',
    5.733959, 52.036887, 6.1, 2.0, 1.00),
  // https://www.openstreetmap.org/node/6428865244
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/3229/ede-stirling-monument
  memorial('stirling-monument', 'Stirling-monument', 'Planken Wambuis',
    5.7888787, 52.0337907, -2.0, 1.8, 1.04),
  // https://www.ededoet.nl/kaart/1832
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1297/ederveen-centraal-monument
  memorial('ederveen-centraal-monument', 'Centraal Monument Ederveen', 'Ederveen',
    5.577477, 52.066819, 2.1, 1.3, 1.12),
  // Approximate position at the edge of the Dorpsplein, beside the mapped liberation route panel.
  // https://www.openstreetmap.org/node/11127949772
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1291/wekerom-centraal-monument
  memorial('wekerom-centraal-monument', 'Centraal Monument Wekerom', 'Wekerom',
    5.715869, 52.111700, 1.4, -1.6, 1.02, true),
  // https://www.openstreetmap.org/node/13416677916
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1293/otterlo-oorlogsmonument
  memorial('otterlo-oorlogsmonument', 'Oorlogsmonument Otterlo', 'Otterlo',
    5.7769895, 52.1019601, -1.9, 1.6, 1.40, true),
  // https://www.openstreetmap.org/node/13714546990
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/3164/otterlo-slag-in-otterlo
  memorial('slag-in-otterlo', 'Slag in Otterlo', 'Otterlo',
    5.7765181, 52.1018812, -2.6, 0.9, 1.55, true),
  // https://www.openstreetmap.org/node/13416693266
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1294/otterlo-rode-kruismonument
  memorial('otterlo-rode-kruismonument', 'Rode-Kruismonument Otterlo', 'Otterlo',
    5.7717741, 52.1030884, 2.9, 1.0, 1.80, true),
  // Monument coordinates from the published monument list; shape documented by the National Committee.
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1298/harskamp-bevrijding-op-de-veluwe
  memorial('harskamp-bevrijding-veluwe', 'Bevrijding op de Veluwe', 'Harskamp',
    5.758333, 52.124167, 1.7, -1.1, 1.48, true),
  // The unveiling photograph puts the panel across Dorpsstraat from the hotel's entrance.
  // https://www.ede.nl/nieuws/nieuwe-marker-vertelt-geschiedenis-van-hotel-de-wormshoef
  memorial('wormshoef-geschiedenismarker', 'Geschiedenismarker De Wormshoef', 'Lunteren',
    5.617788, 52.092543, -4.8, 0.8, 1.12, true),
];
