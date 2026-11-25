import { Walkways } from "../src/drive/walking.ts";

const INTERSECTION_JOIN = 1.35;
const CELL = 24;
const SAMPLE = 0.35;
const MAX_GAP = 9.8;
const APPROACHES = [4.5, 7.5, 10.5, 13.5, 2.5];

const cell = ([x, z], size = CELL) => `${Math.floor(x / size)}:${Math.floor(z / size)}`;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot = ([x, z], [dx, dz]) => x * dx + z * dz;
const shift = ([x, z], [dx, dz], metres) => [x + dx * metres, z + dz * metres];
const across = ([dx, dz]) => [-dz, dx];

function streetJunctions(streets) {
  const segments = new Map();
  const vertices = new Map();
  for (const [street, modes, ...line] of streets) {
    if (!(modes & 1)) continue;
    for (let i = 2; i < line.length; i += 2) {
      const from = line.slice(i - 2, i);
      const to = line.slice(i, i + 2);
      const length = distance(from, to);
      if (length < 0.5) continue;
      const direction = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
      const segment = { from, length, direction, street };
      vertices.set(from.join(), from);
      vertices.set(to.join(), to);
      for (let x = Math.floor((Math.min(from[0], to[0]) - INTERSECTION_JOIN) / CELL);
        x <= Math.floor((Math.max(from[0], to[0]) + INTERSECTION_JOIN) / CELL); x++) {
        for (let z = Math.floor((Math.min(from[1], to[1]) - INTERSECTION_JOIN) / CELL);
          z <= Math.floor((Math.max(from[1], to[1]) + INTERSECTION_JOIN) / CELL); z++) {
          const key = `${x}:${z}`;
          if (!segments.has(key)) segments.set(key, []);
          segments.get(key).push(segment);
        }
      }
    }
  }

  const junctions = [];
  for (const point of vertices.values()) {
    const arms = [];
    const names = new Set();
    for (const { from, length, direction, street } of segments.get(cell(point)) ?? []) {
      const along = Math.max(0, Math.min(length, dot([point[0] - from[0], point[1] - from[1]], direction)));
      if (distance(point, shift(from, direction, along)) > INTERSECTION_JOIN) continue;
      names.add(street);
      const branches = [];
      if (length - along > 0.75) branches.push(direction);
      if (along > 0.75) branches.push([-direction[0], -direction[1]]);
      for (const branch of branches) {
        if (arms.every((other) => dot(branch, other) < 0.87)) arms.push(branch);
      }
    }
    // Two bearings can be a bend, a new link needs a real street junction.
    if (arms.length < 3 || (arms.length === 3 && names.size < 2)
      || junctions.some((j) => distance(j.point, point) < 3.5)) continue;
    junctions.push({ point, arms });
  }
  return junctions;
}

function findGaps(center, direction, sidewalks, radius, maxGap) {
  const points = [];
  const foot = [];
  const steps = Math.ceil(2 * radius / SAMPLE);
  for (let i = 0; i <= steps; i++) {
    const point = shift(center, direction, (i - steps / 2) * SAMPLE);
    points.push(point);
    foot.push(sidewalks.includes(point, 0));
  }
  const gaps = [];
  for (let i = 2; i < foot.length - 2; i++) {
    if (foot[i] || !foot[i - 1] || !foot[i - 2]) continue;
    const start = i - 2;
    while (i < foot.length && !foot[i]) i++;
    // Each bank must give the player room to reach the sidewalk.
    if (!foot[i + 1] || (i - start - 2) * SAMPLE > maxGap) continue;
    gaps.push([points[start], points[i + 1]]);
  }
  return gaps;
}

function linkWidth(a, b, direction, allowed) {
  const length = distance(a, b);
  const side = across(direction);
  const steps = Math.ceil(length / SAMPLE);
  for (const width of [2.6, 1.8]) {
    const offset = width / 2 - 0.1;
    let clear = true;
    for (let i = 0; i <= steps; i++) {
      const point = shift(a, direction, i * length / steps);
      if (![-offset, 0, offset].every((n) => allowed(shift(point, side, n)))) {
        clear = false;
        break;
      }
    }
    if (clear) return width;
  }
  return 0;
}

export function linkDriveWalkways({ surfaces, crossingGround, driveways, fast, streets, buildings, extraProbes = [] }) {
  const sidewalks = new Walkways(surfaces);
  const crossings = new Walkways(crossingGround);
  const majorRoads = new Walkways(fast);
  const allowed = (point) => !majorRoads.includes(point, 0.05)
    && (sidewalks.includes(point, 0.24) || crossings.includes(point, 0.24))
    && !buildings.circle(point, 0.34);
  const links = [];
  const add = (center, direction, radius, maxGap, junction, accepts = () => true) => {
    let connected = false;
    for (const [a, b] of findGaps(center, direction, sidewalks, radius, maxGap)) {
      const middle = shift(a, direction, distance(a, b) / 2);
      if (!accepts(middle)) continue;
      if (links.some(({ middle: other, direction: bearing }) =>
        distance(middle, other) < 4.2 && Math.abs(dot(direction, bearing)) > 0.84)) {
        connected = true;
        continue;
      }
      const width = linkWidth(a, b, direction, allowed);
      if (width) {
        connected = true;
        links.push({ a, b, width, middle, direction, junction });
      }
    }
    return connected;
  };

  for (const [a, b] of extraProbes) {
    const length = distance(a, b);
    if (length < 0.5) continue;
    const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    add(shift(a, direction, length / 2), direction, 13, MAX_GAP, true);
  }
  for (const { point, arms } of streetJunctions(streets)) {
    for (const arm of arms) {
      for (const metres of APPROACHES) {
        const center = shift(point, arm, metres);
        if (crossings.includes(center, 0.25) && add(center, across(arm), 14.5, MAX_GAP, true)) break;
      }
    }
  }

  // A driveway can interrupt a continuous sidewalk away from a junction.
  // Probe through the edges of the actual paved driveway, limiting the span.
  for (const ring of driveways) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      const length = distance(a, b);
      if (length < 1.75 || length > 14) continue;
      const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const midpoint = shift(a, direction, length / 2);
      add(midpoint, across(direction), 4.5, 4, false, (point) => distance(point, midpoint) < 2.3);
    }
  }
  const round = (p) => p.map((n) => Math.round(n * 100) / 100);
  return links.map(({ a, b, width, junction }) => [round(a), round(b), width, junction]);
}
