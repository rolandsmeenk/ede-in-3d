import { createSurveyLandmark } from './ede-survey-landmark.js';
import { EDE_STATIONSWEG_LANDMARKS, STATIONSWEG_SURVEYS } from './ede-stationsweg-survey.js';
import { STATIONSWEG_NORTH_VILLAS } from './ede-stationsweg-north-villas.js';
import { STATIONSWEG_SOUTH } from './ede-stationsweg-south.js';
import { STATIONSWEG_CORNERS } from './ede-stationsweg-corners.js';
import { STATIONSWEG_VILLAS } from './ede-stationsweg-villas.js';

const details = {
  ...STATIONSWEG_NORTH_VILLAS,
  ...STATIONSWEG_SOUTH,
  ...STATIONSWEG_CORNERS,
  ...STATIONSWEG_VILLAS,
};

function createStationswegLandmark(_footprints, site) {
  const buildings = site.bagIds.map(id => STATIONSWEG_SURVEYS[id]);
  return createSurveyLandmark(site, buildings, wall => {
    const detail = details[wall.building.bagId];
    return (detail.decorate ?? detail)(wall);
  }, context => {
    for (const { bagId } of buildings) details[bagId].finish?.(context, buildings);
  });
}

export const STATIONSWEG_LANDMARK_FACTORIES = Object.fromEntries(
  EDE_STATIONSWEG_LANDMARKS.map(({ id }) => [id, createStationswegLandmark]),
);
