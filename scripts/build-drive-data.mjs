// Node 22.18+ with native TypeScript stripping. Run from the project root.
// Geometry and route centrelines: Kadaster TOP10NL and TU Delft 3DBAG (CC BY 4.0).
import { registerHooks } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { buildArea } from "./drive-area.mjs";
import { roadDirections } from "./drive-road-directions.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./street-tiles" || specifier === "./style") {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});
const { buildGround, buildBuildings } = await import("../src/map/street.worker.ts");
const { TILE_M } = await import("../src/map/street-tiles.ts");
const { toRD } = await import("../src/map/rd.ts");
const { tileBounds } = await import("../src/map/street-tiles.ts");

const area = buildArea();
const out = area.target;
const cache = area.cache(process.env.DRIVE_BUILD_CACHE);
await mkdir(out, { recursive: true });
if (cache) await mkdir(cache, { recursive: true });

const [startCol, startRow] = area.origin;
const origin = tileBounds(startCol, startRow);
const { tiles } = area;
const hasTrain = area.modes.includes("train");
const travelDirection = area.modes.includes("car") ? await roadDirections(area) : null;

function bufferOf(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function meshBuffers(mesh, ground = false) {
  const header = new Uint32Array([mesh?.colours.length / 4 || 0, mesh?.indices.length || 0]);
  if (!mesh) return [bufferOf(header)];
  const arrays = [mesh.positions, mesh.colours, mesh.indices];
  // Normals are signed bytes. Put them last and align the next header.
  if (!ground) arrays.push(mesh.normals, new Uint8Array((4 - mesh.normals.length % 4) % 4));
  return [bufferOf(header), ...arrays.map(bufferOf)];
}

async function retry(fn, col, row) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(col, row, AbortSignal.timeout(30_000), true);
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((done) => setTimeout(done, 1000 * (attempt + 1)));
    }
  }
}

const drives = [];
const cycles = [];
const rails = [];
const roadPaths = { drives: [], cycles: [] };
const stationLabels = [];

async function fetchTile([col, row]) {
  const key = `${col}-${row}`;
  const tmp = cache && resolve(cache, `${key}-directed.json`);
  let meta;
  let data;
  if (tmp) {
    try {
      meta = JSON.parse(await readFile(tmp, "utf8"));
      data = await readFile(resolve(cache, `${key}-directed.bin.gz`));
    } catch {
      meta = undefined;
    }
  }
  if (!meta) {
    const [ground, solids] = await Promise.all([
      retry(buildGround, col + startCol, row + startRow),
      area.id === "utrecht" ? retry(buildBuildings, col + startCol, row + startRow) : null,
    ]);
    data = gzipSync(Buffer.concat([
      ...meshBuffers(ground.ground, true),
      ...meshBuffers(ground.trees),
      ...meshBuffers(solids?.buildings),
    ]));
    meta = {
      drives: Array.from(ground.routes.drives ?? []),
      cycles: Array.from(ground.routes.cycles ?? []),
      rails: Array.from(ground.routes.rails ?? []),
      stations: ground.labels.filter((label) => label.kind === "station"),
    };
    if (tmp) {
      await writeFile(resolve(cache, `${key}-directed.bin.gz`), data);
      await writeFile(tmp, JSON.stringify(meta));
    }
  }
  await writeFile(resolve(out, `${key}.bin`), data);
  console.log(key, Math.round(data.length / 1024), "KiB");
  return meta;
}

function readRoutes(src, col, row, kind, target) {
  for (let i = 0; i < src.length;) {
    const count = src[i++];
    const offset = src[i++] * 1000;
    const weight = src[i++];
    const points = [];
    for (let j = 0; j < count; j++) {
      points.push([col * TILE_M + src[i++] * 1000, row * TILE_M + src[i++] * 1000]);
    }
    if (kind === "rails") {
      if (weight > 1) target.push({ points });
      continue;
    }
    if (kind === "drives") {
      if (!travelDirection) continue;
      const divided = weight < 0;
      const halfWidth = divided ? Math.max(1.8, offset + 0.3) : Math.max(2, offset * 1.5 + 0.6);
      const save = (first, last, direction) => {
        const line = points.slice(first, last + 1);
        if (direction === -1) line.reverse();
        target.push(line.length, direction ? -halfWidth : halfWidth, ...line.flat());
        roadPaths.drives.push({ points: line, oneWay: Boolean(direction) });
      };
      let first = 0, direction;
      for (let j = 1; j < points.length; j++) {
        const next = divided ? (travelDirection(points[j - 1], points[j]) === -1 ? -1 : 1) : 0;
        if (j > 1 && direction !== next) {
          save(first, j - 1, direction);
          first = j - 1;
        }
        direction = next;
      }
      save(first, points.length - 1, direction);
    } else {
      const halfWidth = weight > 2 ? 1.8 : Math.max(2.1, offset + 0.65);
      target.push(count, halfWidth, ...points.flat());
      roadPaths.cycles.push({ points, multiplier: weight > 2 ? 0.80 : 1 });
    }
  }
}

const remaining = tiles.entries();
const metadata = [];
await Promise.all(Array.from({ length: 5 }, async () => {
  for (const [index, tile] of remaining) metadata[index] = await fetchTile(tile);
}));
for (const [index, [col, row]] of tiles.entries()) {
  const meta = metadata[index];
  readRoutes(meta.drives, col, row, "drives", drives);
  readRoutes(meta.cycles, col, row, "cycles", cycles);
  readRoutes(meta.rails, col, row, "rails", rails);
  for (const station of meta.stations) {
    stationLabels.push({ name: station.text, point: [(col * TILE_M + station.x * 1000), (row * TILE_M + station.z * 1000)] });
  }
}
console.log("Station labels:", stationLabels);

const { traceRoute } = await import("./trace-drive-routes.mjs");
const stations = area.stationSeeds.map(([name, lat, lon]) => {
  const [x, y] = toRD(lat, lon);
  const source = stationLabels.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return { name, point: source?.point ?? [x - origin.left, origin.top - y] };
});
const { track, stopIndices } = hasTrain ? traceRoute(rails, stations, "rail") : { track: [], stopIndices: [] };
const stops = stations.map(({ name, point }, i) => ({
  name,
  point: track[stopIndices[i]] ?? point,
  trackIndex: stopIndices[i] ?? 0,
  access: { car: point, bike: point },
  approach: { car: 0, bike: 0 },
}));
const guides = { car: [], bike: [] };
for (const [mode, paths] of [["car", roadPaths.drives], ["bike", roadPaths.cycles]]) {
  if (!area.modes.includes(mode)) continue;
  const anchors = stations.map((station) => ({ ...station, radius: area.roadRadius }));
  if (area.roadStart?.[mode]) anchors[0] = area.roadStart[mode];
  const route = traceRoute(paths, anchors, mode);
  guides[mode] = route.track;
  stops.forEach((stop, i) => {
    stop.approach[mode] = route.stopIndices[i];
    stop.access[mode] = route.track[route.stopIndices[i]];
  });
}
const header = new Uint32Array([drives.length, cycles.length]);
await writeFile(resolve(out, "roads.bin"), gzipSync(Buffer.concat([
  bufferOf(header), bufferOf(new Float32Array(drives)), bufferOf(new Float32Array(cycles)),
])));
await writeFile(resolve(out, "corridor.json"), JSON.stringify({
  tileSize: TILE_M,
  tiles,
  bounds: [0, 1].map((axis) => (Math.max(...tiles.map((tile) => tile[axis])) + 1) * TILE_M),
  stops,
  track,
  guides,
}));
