// Snapshot the painted zebra crossings in a Drive & Ride area from OpenStreetMap (ODbL).
// NDW records where the crossing sign stands at the kerb, often metres from the paint.
// OSM maps the crossing itself, on the road where it is painted.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fromRD, toRD } from "../src/map/rd.ts";
import { tileBounds } from "../src/map/street-tiles.ts";
import { buildArea } from "./drive-area.mjs";

const area = buildArea();
const map = JSON.parse(await readFile(resolve(area.target, "corridor.json"), "utf8"));
const origin = tileBounds(...area.origin);
const tiles = new Set(map.tiles.map(([x, z]) => `${x}:${z}`));
const cache = area.cache(process.env.DRIVE_ZEBRAS_CACHE);
if (cache) await mkdir(cache, { recursive: true });

// The corridor's extent in WGS84, for the Overpass bounding box.
const xs = map.tiles.map(([x]) => x * map.tileSize), zs = map.tiles.map(([, z]) => z * map.tileSize);
const corners = [[Math.min(...xs), Math.min(...zs)], [Math.max(...xs) + map.tileSize, Math.max(...zs) + map.tileSize]]
  .map(([x, z]) => fromRD(origin.left + x, origin.top - z));
const [south, north] = [Math.min(corners[0][0], corners[1][0]), Math.max(corners[0][0], corners[1][0])];
const [west, east] = [Math.min(corners[0][1], corners[1][1]), Math.max(corners[0][1], corners[1][1])];
const box = [south, west, north, east].map((n) => n.toFixed(5)).join(",");
const query = `[out:json][timeout:90];
(node["crossing:markings"="zebra"](${box});node["crossing"="zebra"](${box});node["crossing_ref"="zebra"](${box}););
out;`;

async function download() {
  const file = cache && resolve(cache, "zebras-osm.json");
  if (file) {
    try { return JSON.parse(await readFile(file, "utf8")); } catch { /* Download uncached data. */ }
  }
  for (let attempt = 0; ; attempt++) {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      // Overpass refuses requests without a client name.
      headers: { "User-Agent": "drive-and-ride-map-build/1.0", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(120_000),
    }).catch((error) => ({ ok: false, status: String(error) }));
    if (response.ok) {
      const data = await response.json();
      if (file) await writeFile(file, JSON.stringify(data));
      return data;
    }
    if (attempt === 2) throw new Error(`Overpass: ${response.status}`);
    await new Promise((done) => setTimeout(done, 5000 * (attempt + 1)));
  }
}

const round = (value) => Math.round(value * 100) / 100;
const zebras = [];
for (const { lat, lon } of (await download()).elements ?? []) {
  const [east, north] = toRD(lat, lon);
  const point = [round(east - origin.left), round(origin.top - north)];
  if (!tiles.has(point.map((n) => Math.floor(n / map.tileSize)).join(":"))) continue;
  if (zebras.some(([x, z]) => Math.hypot(x - point[0], z - point[1]) < 1)) continue;
  zebras.push(point);
}
await writeFile(resolve(area.target, "zebras.json"), JSON.stringify(zebras));
console.log(`Baked ${zebras.length} OpenStreetMap zebra crossings for the corridor.`);
