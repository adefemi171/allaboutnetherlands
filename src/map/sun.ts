// Where the sun is. Low-precision solar position after the NOAA solar
// calculator (itself after Meeus), accurate to a fraction of a degree, which
// is plenty for lighting a model and printing sunrise to the minute.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

interface Ephemeris {
  /** Solar declination in degrees: the latitude where the sun is overhead. */
  declination: number;
  /** Equation of time in minutes. */
  equationOfTime: number;
}

function ephemeris(date: Date): Ephemeris {
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  const t = (julianDay - 2451545) / 36525;
  const meanLong = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = meanAnomaly * RAD;
  const centre =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const apparentLong =
    (meanLong + centre - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const meanObliquity =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD;
  const declination =
    Math.asin(Math.sin(obliquity) * Math.sin(apparentLong)) * DEG;

  const y = Math.tan(obliquity / 2) ** 2;
  const l = meanLong * RAD;
  const equationOfTime =
    4 *
    DEG *
    (y * Math.sin(2 * l) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l) -
      0.5 * y * y * Math.sin(4 * l) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m));

  return { declination, equationOfTime };
}

function utcMinutes(date: Date): number {
  return (
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60
  );
}

export interface SunPosition {
  /** Degrees above the horizon. Negative at night. */
  altitude: number;
  /** Compass bearing in degrees, clockwise from north. */
  azimuth: number;
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const { declination, equationOfTime } = ephemeris(date);
  const solarTime = utcMinutes(date) + equationOfTime + 4 * lon;
  const hourAngle = (solarTime / 4 - 180) * RAD;
  const phi = lat * RAD;
  const delta = declination * RAD;
  const sinAlt =
    Math.sin(phi) * Math.sin(delta) +
    Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
  const azimuth =
    (Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi),
    ) *
      DEG +
      180 +
      360) %
    360;
  return { altitude, azimuth };
}

/**
 * Unit vector pointing at the sun in scene coordinates (+x east, +y up,
 * +z south) for an observer at lat/lon.
 */
export function sunDirection(
  date: Date,
  lat: number,
  lon: number,
): [number, number, number] {
  const { altitude, azimuth } = sunPosition(date, lat, lon);
  const alt = altitude * RAD;
  const az = azimuth * RAD;
  return [
    Math.cos(alt) * Math.sin(az),
    Math.sin(alt),
    -Math.cos(alt) * Math.cos(az),
  ];
}

export interface SunTimes {
  /** Null when the sun does not cross the horizon that day. */
  rise: Date | null;
  set: Date | null;
}

/** Sunrise and sunset on the UTC day of `date`. */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const noon = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
  );
  const { declination, equationOfTime } = ephemeris(noon);
  const phi = lat * RAD;
  const delta = declination * RAD;
  // 90.833 degrees: the sun's upper edge on the horizon, with refraction.
  const cosH =
    (Math.cos(90.833 * RAD) - Math.sin(phi) * Math.sin(delta)) /
    (Math.cos(phi) * Math.cos(delta));
  if (cosH < -1 || cosH > 1) return { rise: null, set: null };
  const half = Math.acos(cosH) * DEG * 4;
  const solarNoon = 720 - 4 * lon - equationOfTime;
  const midnight = noon.getTime() - 12 * 3600000;
  return {
    rise: new Date(midnight + (solarNoon - half) * 60000),
    set: new Date(midnight + (solarNoon + half) * 60000),
  };
}
