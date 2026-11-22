const park = { district: 'Paasberg', road: 'Vossenakker', surveyFootprints: [], mapScenic: true };

export const EDE_PAASBERG_MEMORIALS = [
  // Unnamed OSM memorial node matches the slab in the 2026 PDOK orthophoto.
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/4248/ede-joods-monument
  { ...park, id: 'joods-monument-ede', name: 'Joods Monument Ede', osmId: 'n9819839608',
    x: 413.4, z: 224.3, heading: -1.04, height: 0.85, focusHeight: 0.62, approach: { x: 409.6, z: 226.5 } },
  // https://gemeentearchief.ede.nl/geschiedenis/indisch-monument-ede
  // PDOK orthophoto checked against https://commons.wikimedia.org/wiki/File:Indi%C3%ABmonument,_Vossenakker_in_Ede_01.jpg
  // The 2026 seating is represented around the nearby footpath in the same memorial group.
  { ...park, id: 'indie-monument-ede', name: 'Indiëmonument en Stilteplaats', x: 429.3, z: 311.1,
    heading: 1.94, height: 2.45, focusOffset: [-1, -1.5], approach: { x: 434.8, z: 307.3 } },
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1308/ede-gedenkzuil-op-de-paasberg
  // OSM node on the south approach, near the viewpoint of the current photograph.
  // https://commons.wikimedia.org/wiki/File:Mausoleum_Ede_foto_8.jpg
  { ...park, id: 'militaire-slachtoffers-paasberg', name: 'Monument Militaire Slachtoffers', osmId: 'n9819839610',
    x: 476.1, z: 287.0, heading: -1.02, height: 1.95, approach: { x: 473.4, z: 289.0 } },
  // https://www.4en5mei.nl/oorlogsmonumenten/zoeken/1307/ede-monument-voor-canadese-militairen
  { ...park, id: 'canadese-bevrijdingsmonument', name: 'Canadees Bevrijdingsmonument', road: 'Arnhemseweg',
    osmId: 'n8248010314', x: 465.6, z: 348.1, heading: 1.45, height: 1.05, focusHeight: 0.67,
    approach: { x: 468.3, z: 348.8 } },
  // https://monumentenregister.cultureelerfgoed.nl/monumenten/14465
  { ...park, id: 'anna-maria-moens', name: 'Grafmonument Anna Maria Moens', road: 'Paasbergerweg',
    osmId: 'n665482600', x: 385.8, z: 286.5, heading: 1.06, height: 3.25,
    approach: { x: 392.8, z: 290.6 } },
  // PDOK aerial and the photograph looking towards the left end of the Mausoleum.
  // https://commons.wikimedia.org/wiki/File:Mausoleum_Ede_foto_3.jpg
  { ...park, id: 'paasberg-canadese-gedenksteen', name: 'Canadese Gedenksteen Memorial Park',
    x: 438.9, z: 238.1, heading: -1.31, height: 0.80, focusHeight: 0.56, approach: { x: 437.5, z: 233.4 } },
].map(site => {
  const dx = site.x - site.approach.x, dz = site.z - site.approach.z;
  const scale = 1.8 / Math.hypot(dx, dz);
  return { focusOffset: [dz * scale, -dx * scale], ...site };
});
