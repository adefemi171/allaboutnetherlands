// Conversion between WGS84 (lat/lon in degrees) and the Dutch national grid,
// Rijksdriehoekscoordinaten (RD New, EPSG:28992, metres).
//
// Polynomial approximation by Schreutelkamp & Strang van Hees. Inside the
// Netherlands it is good to well under a metre, which is far finer than the
// 500 m cells this project works with. Accuracy drops off abroad, where we
// only use it to place neighbouring countries roughly.
//
// The same formulas live in src/map/rd.ts for the browser. Keep them in sync.

const LAT0 = 52.1551744;
const LON0 = 5.38720621;
const X0 = 155000;
const Y0 = 463000;

const R = [
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
const S = [
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
const K = [
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
const L = [
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

function poly(terms, a, b) {
  let sum = 0;
  for (const [p, q, c] of terms) sum += c * a ** p * b ** q;
  return sum;
}

/** WGS84 degrees to RD metres. */
export function toRD(lat, lon) {
  const dLat = 0.36 * (lat - LAT0);
  const dLon = 0.36 * (lon - LON0);
  return [X0 + poly(R, dLat, dLon), Y0 + poly(S, dLat, dLon)];
}

/** RD metres to WGS84 degrees, as [lat, lon]. */
export function fromRD(x, y) {
  const dx = (x - X0) * 1e-5;
  const dy = (y - Y0) * 1e-5;
  return [LAT0 + poly(K, dx, dy) / 3600, LON0 + poly(L, dx, dy) / 3600];
}
