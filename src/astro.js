// Sun, moon and natural light levels for a UTC time and place.
// Moon: low-precision lunar ephemeris from the Astronomical Almanac (section D), about 0.3 deg in
//       longitude, plus topocentric parallax. Good enough for where the moon is in the sky and its phase.
// Moon brightness by phase: Krisciunas & Schaefer (1991), PASP 103:1033, eq. 9 (Allen's magnitudes).
// Natural light levels: approximate clear-sky horizontal illuminance by sun elevation, after the
//       U.S. Naval Observatory natural-illumination tables. Used only to scale exposure, not to light the scene.
import { sunPosition } from './storm.js';
export { sunPosition };

const D2R = Math.PI / 180;
const days = (time) => time / 86400000 - 10957.5; // days since J2000.0
const wrap = (a) => ((a % 360) + 360) % 360;

// Sun's apparent ecliptic longitude (deg), same series as storm.js sunPosition
export function sunLongitude(time) {
  const d = days(time), g = (357.529 + 0.98560028 * d) * D2R;
  return wrap(280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
}

// Greenwich mean sidereal time (hours) and local sidereal time (rad)
export const gmstHours = (time) => (((18.697374558 + 24.06570982441908 * days(time)) % 24) + 24) % 24;
export const lstRad = (time, lonDeg) => (gmstHours(time) * 15 + lonDeg) * D2R;

function moonEcliptic(time) {
  const T = days(time) / 36525, s = (a) => Math.sin(a * D2R), c = (a) => Math.cos(a * D2R);
  const lon = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) + 0.66 * s(235.7 + 890534.22 * T)
    + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
  const lat = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const par = 0.9508 + 0.0518 * c(134.9 + 477198.85 * T) + 0.0095 * c(259.2 - 413335.38 * T) + 0.0078 * c(235.7 + 890534.23 * T) + 0.0028 * c(269.9 + 954397.7 * T);
  return { lon: wrap(lon), lat, par };
}

// Moon position and phase. el/az radians (az clockwise from north), topocentric.
// phase: phase angle in degrees (0 full, 180 new); lit: illuminated fraction; rel: illuminance at the
// top of the atmosphere relative to the sun's (full moon at mean distance ~2.5e-6); waxing: boolean.
export function moonPosition(time, latDeg, lonDeg) {
  const m = moonEcliptic(time), d = days(time);
  const eps = (23.439 - 3.6e-7 * d) * D2R, L = m.lon * D2R, B = m.lat * D2R;
  const x = Math.cos(B) * Math.cos(L), y = Math.cos(B) * Math.sin(L), z = Math.sin(B);
  const ye = y * Math.cos(eps) - z * Math.sin(eps), ze = y * Math.sin(eps) + z * Math.cos(eps);
  const ra = Math.atan2(ye, x), dec = Math.asin(ze);
  const ha = lstRad(time, lonDeg) - ra, lat = latDeg * D2R;
  let el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  el -= m.par * D2R * Math.cos(el); // parallax: the moon sits about 1 deg lower than seen from Earth's centre
  const sl = sunLongitude(time);
  const elong = Math.acos(Math.cos(B) * Math.cos((m.lon - sl) * D2R)) / D2R; // sun-moon angle seen from Earth
  const phase = 180 - elong; // good to ~0.2 deg (ignores the sun-moon distance ratio)
  const mag = -12.73 + 0.026 * Math.abs(phase) + 4e-9 * Math.pow(phase, 4);
  const distK = Math.pow(0.9508 / m.par, -2); // brighter at perigee
  return {
    el, az: (az + 2 * Math.PI) % (2 * Math.PI), phase, lit: (1 + Math.cos(phase * D2R)) / 2,
    rel: Math.pow(10, -0.4 * (mag + 26.74)) * distK, waxing: wrap(m.lon - sl) < 180,
  };
}

// Sun transmittance through a clear atmosphere (Kasten-Young air mass), mean over the visible band.
export function airTrans(el) {
  const dg = el / D2R; if (dg < -1.5) return 0;
  const m = 1 / (Math.sin(Math.max(el, -0.02)) + 0.50572 * Math.pow(Math.max(dg, -1) + 6.07995, -1.6364));
  return Math.exp(-m * 0.17) * Math.min(1, (dg + 1.5) / 1.5);
}

// Approximate clear-sky horizontal illuminance from the sun (lux), by elevation (deg).
const SUN_LUX = [[-18, -3.4], [-15, -2.9], [-12, -2.0], [-9, -0.8], [-6, 0.5], [-3, 1.6], [0, 2.8], [5, 3.9], [10, 4.2], [20, 4.5], [30, 4.7], [60, 4.95], [90, 5.03]];
export function sunLux(elDeg) {
  if (elDeg <= SUN_LUX[0][0]) return 0;
  for (let i = 1; i < SUN_LUX.length; i++) if (elDeg <= SUN_LUX[i][0]) {
    const [a, la] = SUN_LUX[i - 1], [b, lb] = SUN_LUX[i];
    return Math.pow(10, la + ((lb - la) * (elDeg - a)) / (b - a));
  }
  return Math.pow(10, 5.03);
}
export const SUN_ZENITH_LUX = 1.07e5, NIGHT_FLOOR_LUX = 0.002; // starlight + airglow on a clear moonless night
export const moonLux = (mn) => (mn.el > -0.01 ? SUN_ZENITH_LUX * mn.rel * Math.max(Math.sin(mn.el), 0) * airTrans(mn.el) : 0);
