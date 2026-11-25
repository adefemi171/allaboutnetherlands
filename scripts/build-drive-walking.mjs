// Bake Kadaster BGT footway surfaces for the pilot, plus short residential
// sidewalk walks that the ambient pedestrians can follow.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { fromRD, toRD } from "../src/map/rd.ts";
import { BuildingCollisions } from "../src/drive/collisions.ts";
import { tileBounds } from "../src/map/street-tiles.ts";
import { buildArea } from "./drive-area.mjs";
import { linkDriveWalkways } from "./link-drive-walkways.mjs";

const area = buildArea();
const map = JSON.parse(await readFile(resolve(area.target, "corridor.json"), "utf8"));
const [startCol, startRow] = area.origin;
const origin = tileBounds(startCol, startRow);
const cache = area.cache(process.env.DRIVE_WALK_CACHE);
if (cache) await mkdir(cache, { recursive: true });

const foot = new Set(["voetpad", "voetgangersgebied", "woonerf"]);
const major = new Set(["rijbaan autosnelweg", "rijbaan autoweg", "rijbaan regionale weg"]);
const crossable = new Set(["rijbaan lokale weg", "fietspad", "inrit", "parkeervlak"]);
const functions = [...foot, ...major, ...crossable].map((type) => `'${type}'`).join(", ");
const seen = new Set();
const paths = [];
const fast = [];
const crossingGround = [];
const driveways = [];
const round = (value) => Math.round(value * 20) / 20;
const distance = ([x, z], [xx, zz]) => Math.hypot(x - xx, z - zz);

async function fetchPage(url, key) {
  const file = cache && resolve(cache, key + ".json");
  if (file) {
    try { return JSON.parse(await readFile(file, "utf8")); } catch { /* Cache miss. */ }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(55_000) });
      if (!response.ok) throw new Error(`Kadaster footways: HTTP ${response.status}`);
      const text = await response.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.features)) throw new Error("Unexpected Kadaster response");
      if (file) await writeFile(file, text);
      return data;
    } catch (error) {
      if (attempt === 3) throw new Error(`Could not retrieve BGT walking tile ${key}`, { cause: error });
      await new Promise((done) => setTimeout(done, attempt * 700));
    }
  }
}

function position([lon, lat]) {
  const [x, y] = toRD(lat, lon);
  return [round(x - origin.left), round(origin.top - y)];
}

async function tile(col, row) {
  const { left, right, top, bottom } = tileBounds(startCol + col, startRow + row);
  const geos = [[left, bottom], [left, top], [right, bottom], [right, top]].map(([x, y]) => fromRD(x, y));
  const lats = geos.map(([lat]) => lat);
  const lons = geos.map(([, lon]) => lon);
  const bbox = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)].join(",");
  const endpoint = new URL("https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/wegdeel/items");
  endpoint.search = new URLSearchParams({
    bbox, f: "json", limit: "1000", "filter-lang": "cql2-text",
    filter: `relatieve_hoogteligging = 0 AND eind_registratie IS NULL AND functie IN (${functions})`,
  });
  let url = endpoint.href;
  let page = 0;
  while (url) {
    const data = await fetchPage(url, `walking-current-${col}-${row}-${page++}`);
    for (const { id, geometry, properties: p } of data.features) {
      if (!geometry || p.status !== "bestaand" || p.eind_registratie != null
        || p.relatieve_hoogteligging !== 0 || seen.has(id)) continue;
      const type = p.functie;
      if (!foot.has(type) && !major.has(type) && !crossable.has(type)) continue;
      seen.add(id);
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates]
        : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
      for (const polygon of polygons) {
        const rings = polygon.map((ring) => ring.map(position));
        if (rings[0].length < 4) continue;
        if (foot.has(type)) paths.push({ rings, type });
        else if (major.has(type)) fast.push(rings[0]);
        else if (["open verharding", "gesloten verharding", "half verhard"].includes(p.fysiek_voorkomen)) {
          crossingGround.push([1, ...rings]);
          if (type === "inrit") driveways.push(rings[0]);
        }
      }
    }
    url = data.links?.find(({ rel }) => rel === "next")?.href;
  }
}

const queue = map.tiles.entries();
await Promise.all(Array.from({ length: 5 }, async () => {
  for (const [i, [col, row]] of queue) {
    await tile(col, row);
    if ((i + 1) % 10 === 0) console.log(`BGT tiles ${i + 1}/${map.tiles.length}`);
  }
}));

function inside([x, z], ring) {
  let contained = false;
  for (let i = 1; i < ring.length; i++) {
    const [ax, az] = ring[i - 1];
    const [bx, bz] = ring[i];
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) contained = !contained;
  }
  return contained;
}
const contains = (rings, point) => inside(point, rings[0]) && !rings.slice(1).some((ring) => inside(point, ring));

function bounds(ring, margin = 0) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
  }
  return ([x, z]) => x >= minX - margin && x <= maxX + margin && z >= minZ - margin && z <= maxZ + margin;
}

// Sidewalk polygons can run through driveways or pass close to a building.
const buildings = new BuildingCollisions();
const places = JSON.parse(await readFile(resolve(area.target, "places.json"), "utf8"));
function meshEnd(buffer, start, stride, solid = false) {
  const vertices = buffer.readUInt32LE(start);
  return start + 8 + vertices * stride + buffer.readUInt32LE(start + 4) * 4
    + (solid ? Math.ceil(vertices * 3 / 4) * 4 : 0);
}
for (const [col, row] of map.tiles) {
  const buffer = gunzipSync(await readFile(resolve(area.target, `${col}-${row}.bin`)));
  const ground = meshEnd(buffer, 0, 12);
  const trees = meshEnd(buffer, ground, 16, true);
  const mesh = meshEnd(buffer, trees, 16, true);
  buildings.add(new Float32Array(buffer.buffer, buffer.byteOffset + mesh, (buffer.length - mesh) / 4),
    col * map.tileSize, row * map.tileSize);
}
const distantFromFastRoad = fast.map((ring) => bounds(ring, 13));
const footPaths = paths.filter(({ type }) => type === "voetpad").map(({ rings }) => ({
  rings, within: bounds(rings[0], 41),
}));
const walks = [];

function safeWalk(rings, near) {
  let chosen, score = Infinity;
  for (let i = 1; i < rings[0].length; i++) {
    const a = rings[0][i - 1];
    const b = rings[0][i];
    const length = distance(a, b);
    if (length < 8) continue;
    const xd = (b[0] - a[0]) / length;
    const zd = (b[1] - a[1]) / length;
    const nearest = Math.max(4, Math.min(length - 4, (near[0] - a[0]) * xd + (near[1] - a[1]) * zd));
    const nearLength = Math.min(length / 2 - 1, 13);
    for (const offset of [-0.75, 0.75, -1.08, 1.08]) {
      const mid = [a[0] + xd * nearest - zd * offset, a[1] + zd * nearest + xd * offset];
      const dist = distance(mid, near);
      if (dist > 38 || dist >= score || distantFromFastRoad.some((hit) => hit(mid))) continue;
      const p = [mid[0] - xd * nearLength, mid[1] - zd * nearLength].map(round);
      const q = [mid[0] + xd * nearLength, mid[1] + zd * nearLength].map(round);
      const checks = Math.ceil(nearLength * 10);
      let clear = true;
      for (let j = 0; j <= checks; j++) {
        const t = j / checks;
        const point = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        if (buildings.circle(point, 0.35) || !contains(rings, point) || !contains(rings, [point[0] - zd * 0.21, point[1] + xd * 0.21])
          || !contains(rings, [point[0] + zd * 0.21, point[1] - xd * 0.21])) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      chosen = { a: p, b: q, mid };
      score = dist;
    }
  }
  return chosen;
}

for (const [name, count, anchor] of area.residential) {
  const id = places.names.indexOf(name);
  const candidates = places.streets.filter(([index]) => index === id)
    .map((line) => [(line[2] + line.at(-2)) / 2, (line[3] + line.at(-1)) / 2]);
  const reference = anchor ?? candidates[Math.floor(candidates.length / 2)];
  if (!reference) continue;
  const chosen = [];
  for (const target of [reference, ...candidates.toSorted((a, b) => distance(a, reference) - distance(b, reference))]) {
    const options = footPaths.filter(({ within }) => within(target))
      .map(({ rings }) => safeWalk(rings, target)).filter(Boolean)
      .filter(({ mid }) => walks.every((entry) => distance(mid, entry.mid) > 14))
      .sort((a, b) => distance(a.mid, target) - distance(b.mid, target));
    if (!options[0]) continue;
    chosen.push(options[0]);
    walks.push({ ...options[0], dog: chosen.length === 1, street: name });
    if (chosen.length >= count) break;
  }
}

const surfaces = paths.map(({ rings, type }) => [type === "woonerf" ? 1 : 0, ...rings]);
const links = linkDriveWalkways({
  surfaces, crossingGround, driveways, fast: fast.map((ring) => [1, ring]), streets: places.streets, buildings,
  extraProbes: area.walkingCrossingProbes,
});
const data = {
  surfaces,
  links,
  pedestrians: walks.map(({ a, b, dog, street }) => ({ a, b, dog, street })),
};
// Keep raw coordinates out of the initial JavaScript bundle. The .bin
// suffix lets fetchBinary decompress the static asset consistently.
await writeFile(resolve(area.target, "walking.bin"), gzipSync(JSON.stringify(data)));
console.log(`Baked ${paths.length} current walking surfaces, ${links.length} connections and ${walks.length} residential walks.`);
