// Coordinates.
//
// The map is laid out on the Dutch national grid (Rijksdriehoekscoordinaten,
// RD New, EPSG:28992), in metres. The 3D scene uses kilometres with its
// origin at the origin of that grid, the Onze Lieve Vrouwetoren in
// Amersfoort: +x is east, +z is south, +y is up.
//
// WGS84 <-> RD uses the polynomial approximation by Schreutelkamp & Strang
// van Hees, good to well under a metre inside the Netherlands. The same
// formulas live in scripts/rd.mjs for the data build. Keep them in sync.

export const ORIGIN = {
  lat: 52.1551744,
  lon: 5.38720621,
  x: 155000,
  y: 463000,
} as const;

type Terms = readonly (readonly [number, number, number])[];

const R: Terms = [
  [0, 1, 190094.945],
  [1, 1, -11832.228],
  [2, 1, -114.221],
  [0, 3, -32.391],
  [1, 0, -0.705],
  [3, 1, -2.34],
  [1, 3, -0.608],
  [0, 2, -0.008],
  [2, 3, 0.148],
];
const S: Terms = [
  [1, 0, 309056.544],
  [0, 2, 3638.893],
  [2, 0, 73.077],
  [1, 2, -157.984],
  [3, 0, 59.788],
  [0, 1, 0.433],
  [2, 2, -6.439],
  [1, 1, -0.032],
  [0, 4, 0.092],
  [1, 4, -0.054],
];
const K: Terms = [
  [0, 1, 3235.65389],
  [2, 0, -32.58297],
  [0, 2, -0.2475],
  [2, 1, -0.84978],
  [0, 3, -0.0655],
  [2, 2, -0.01709],
  [1, 0, -0.00738],
  [4, 0, 0.0053],
  [2, 3, -0.00039],
  [4, 1, 0.00033],
  [1, 1, -0.00012],
];
const L: Terms = [
  [1, 0, 5260.52916],
  [1, 1, 105.94684],
  [1, 2, 2.45656],
  [3, 0, -0.81885],
  [1, 3, 0.05594],
  [3, 1, -0.05607],
  [0, 1, 0.01199],
  [3, 2, -0.00256],
  [1, 4, 0.00128],
  [0, 2, 0.00022],
  [2, 0, -0.00022],
  [5, 0, 0.00026],
];

function poly(terms: Terms, a: number, b: number): number {
  let sum = 0;
  for (const [p, q, c] of terms) sum += c * a ** p * b ** q;
  return sum;
}

/** WGS84 degrees to RD metres. */
export function toRD(lat: number, lon: number): [number, number] {
  const dLat = 0.36 * (lat - ORIGIN.lat);
  const dLon = 0.36 * (lon - ORIGIN.lon);
  return [ORIGIN.x + poly(R, dLat, dLon), ORIGIN.y + poly(S, dLat, dLon)];
}

/** RD metres to WGS84 degrees, as [lat, lon]. */
export function fromRD(x: number, y: number): [number, number] {
  const dx = (x - ORIGIN.x) * 1e-5;
  const dy = (y - ORIGIN.y) * 1e-5;
  return [
    ORIGIN.lat + poly(K, dx, dy) / 3600,
    ORIGIN.lon + poly(L, dx, dy) / 3600,
  ];
}

/** RD metres to scene kilometres, as [x, z]. */
export function rdToWorld(x: number, y: number): [number, number] {
  return [(x - ORIGIN.x) / 1000, -(y - ORIGIN.y) / 1000];
}

/** Scene kilometres to RD metres. */
export function worldToRD(wx: number, wz: number): [number, number] {
  return [wx * 1000 + ORIGIN.x, -wz * 1000 + ORIGIN.y];
}

/** WGS84 degrees to scene kilometres, as [x, z]. */
export function latLonToWorld(lat: number, lon: number): [number, number] {
  const [x, y] = toRD(lat, lon);
  return rdToWorld(x, y);
}

/** Scene kilometres to WGS84 degrees, as [lat, lon]. */
export function worldToLatLon(wx: number, wz: number): [number, number] {
  const [x, y] = worldToRD(wx, wz);
  return fromRD(x, y);
}

export const EARTH_RADIUS_KM = 6371;

/**
 * A point on the globe in scene coordinates. The scene is the tangent plane
 * at the grid origin, so the globe's centre sits one Earth radius below it.
 * Unlike latLonToWorld this works anywhere on Earth.
 */
export function globePoint(
  lat: number,
  lon: number,
  radius = EARTH_RADIUS_KM,
): [number, number, number] {
  const rad = Math.PI / 180;
  const p = lat * rad;
  const l = (lon - ORIGIN.lon) * rad;
  const p0 = ORIGIN.lat * rad;
  // Unit vector to the point, in a frame where the origin's meridian is at
  // longitude zero, then rotated so the origin is straight up.
  const ex = Math.cos(p) * Math.sin(l);
  const ey = Math.cos(p) * Math.cos(l);
  const ez = Math.sin(p);
  const east = ex;
  const north = -Math.sin(p0) * ey + Math.cos(p0) * ez;
  const up = Math.cos(p0) * ey + Math.sin(p0) * ez;
  return [east * radius, up * radius - EARTH_RADIUS_KM, -north * radius];
}
