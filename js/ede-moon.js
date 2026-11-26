import { EDE_DATA } from './ede-geodata.js';

const { lat0, lon0 } = EDE_DATA.meta.lonLatAffine;
const RAD = Math.PI / 180;
const EPOCH = Date.UTC(1999, 11, 31);
const DAY_MS = 86400000;
const EARTH_RADIUS_KM = 6378.137;
const EARTH_ECCENTRICITY_SQUARED = 0.00669438;
const MOON_RADIUS_KM = 1737.4;
const radians = degrees => (degrees % 360) * RAD;

// Lunar orbit and major perturbations from https://stjarnhimlen.se/comp/ppcomp.html.
export function edeMoon(date) {
  const days = (date.getTime() - EPOCH) / DAY_MS;
  const node = radians(125.1228 - 0.0529538083 * days);
  const perigee = radians(318.0634 + 0.1643573223 * days);
  const inclination = 5.1454 * RAD;
  const anomaly = radians(115.3654 + 13.0649929509 * days);
  const eccentricity = 0.0549;
  const eccentricAnomaly = anomaly + eccentricity * Math.sin(anomaly) * (1 + eccentricity * Math.cos(anomaly));
  const orbitX = Math.cos(eccentricAnomaly) - eccentricity;
  const orbitY = Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly);
  const argument = Math.atan2(orbitY, orbitX) + perigee;
  const orbitNorth = Math.sin(argument) * Math.sin(inclination);

  const solarAnomaly = radians(356.0470 + 0.9856002585 * days);
  const meanSolarLongitude = solarAnomaly + radians(282.9404 + 0.0000470935 * days);
  const argumentOfLatitude = anomaly + perigee;
  const elongation = node + argumentOfLatitude - meanSolarLongitude;
  const twiceElongation = 2 * elongation;
  const evection = anomaly - twiceElongation;
  const longitude = node + Math.atan2(Math.sin(argument) * Math.cos(inclination), Math.cos(argument)) + RAD * (
    -1.274 * Math.sin(evection) + 0.658 * Math.sin(twiceElongation) - 0.186 * Math.sin(solarAnomaly)
    - 0.059 * Math.sin(2 * anomaly - twiceElongation) - 0.057 * Math.sin(evection + solarAnomaly)
    + 0.053 * Math.sin(anomaly + twiceElongation) + 0.046 * Math.sin(twiceElongation - solarAnomaly)
    + 0.041 * Math.sin(anomaly - solarAnomaly) - 0.035 * Math.sin(elongation)
    - 0.031 * Math.sin(anomaly + solarAnomaly) - 0.015 * Math.sin(2 * argumentOfLatitude - twiceElongation)
    + 0.011 * Math.sin(anomaly - 2 * twiceElongation)
  );
  const latitude = Math.asin(orbitNorth) + RAD * (
    -0.173 * Math.sin(argumentOfLatitude - twiceElongation)
    - 0.055 * Math.sin(evection - argumentOfLatitude) - 0.046 * Math.sin(evection + argumentOfLatitude)
    + 0.033 * Math.sin(argumentOfLatitude + twiceElongation) + 0.017 * Math.sin(2 * anomaly + argumentOfLatitude)
  );
  const distance = 60.2666 * Math.hypot(orbitX, orbitY) - 0.58 * Math.cos(evection) - 0.46 * Math.cos(twiceElongation);

  const obliquity = radians(23.4393 - 0.0000003563 * days);
  const orbitalPlane = distance * Math.cos(latitude);
  const eclipticY = orbitalPlane * Math.sin(longitude);
  const eclipticZ = distance * Math.sin(latitude);
  const equatorialX = orbitalPlane * Math.cos(longitude);
  const equatorialY = eclipticY * Math.cos(obliquity) - eclipticZ * Math.sin(obliquity);
  const equatorialZ = eclipticY * Math.sin(obliquity) + eclipticZ * Math.cos(obliquity);

  // Subtract the observer's position on Earth's ellipsoid before projecting onto the local horizon.
  const daysSinceJ2000 = days - 1.5;
  const centuries = daysSinceJ2000 / 36525;
  const sidereal = radians(280.46061837 + 360.98564736629 * daysSinceJ2000
    + (0.000387933 - centuries / 38710000) * centuries ** 2 + lon0);
  const sinLat = Math.sin(lat0 * RAD), cosLat = Math.cos(lat0 * RAD);
  const observerRadius = 1 / Math.sqrt(1 - EARTH_ECCENTRICITY_SQUARED * sinLat ** 2);
  const meridian = equatorialX * Math.cos(sidereal) + equatorialY * Math.sin(sidereal) - observerRadius * cosLat;
  const polar = equatorialZ - observerRadius * (1 - EARTH_ECCENTRICITY_SQUARED) * sinLat;
  const east = equatorialY * Math.cos(sidereal) - equatorialX * Math.sin(sidereal);
  const north = polar * cosLat - meridian * sinLat;
  const up = polar * sinLat + meridian * cosLat;

  const azimuth = Math.atan2(east, north);
  const elevation = Math.atan2(up, Math.hypot(east, north)) / RAD;
  // Standard near-horizon refraction for drawing the apparent disc.
  const refraction = elevation >= -1 && elevation < 89.9
    ? 1.02 / (60 * Math.tan((elevation + 10.3 / (elevation + 5.11)) * RAD))
    : 0;
  const apparent = (elevation + refraction) * RAD;
  const horizontal = Math.cos(apparent);
  const angularRadius = Math.asin(MOON_RADIUS_KM / (EARTH_RADIUS_KM * Math.hypot(east, north, up)));

  return {
    azimuth: (azimuth / RAD + 360) % 360,
    elevation,
    angularRadius,
    direction: [horizontal * Math.sin(azimuth), Math.sin(apparent), -horizontal * Math.cos(azimuth)]
  };
}
