// Traffic-light locations from Kadaster BGT and municipal maps.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fromRD, toRD } from "../src/map/rd.ts";
import { tileBounds } from "../src/map/street-tiles.ts";
import { buildArea } from "./drive-area.mjs";

const area = buildArea();
const map = JSON.parse(await readFile(resolve(area.target, "corridor.json"), "utf8"));
const origin = tileBounds(...area.origin);
const tiles = new Set(map.tiles.map(([x, z]) => `${x}:${z}`));
const corners = [0, map.bounds[0]].flatMap((x) =>
  [0, map.bounds[1]].map((z) => fromRD(origin.left + x, origin.top - z)));
const lat = corners.map(([n]) => n);
const lon = corners.map(([, e]) => e);
const first = new URL("https://api.pdok.nl/kadaster/bgt/ogc/v1/collections/paal/items");
first.search = new URLSearchParams({
  bbox: [Math.min(...lon), Math.min(...lat), Math.max(...lon), Math.max(...lat)].join(","),
  f: "json", limit: "1000", "filter-lang": "cql2-text",
  filter: "plus_type = 'verkeersregelinstallatiepaal' AND eind_registratie IS NULL",
});
const cache = area.cache(process.env.DRIVE_SIGNALS_CACHE);
if (cache) await mkdir(cache, { recursive: true });
const poles = [];
const seen = new Set();

function localPoint([longitude, latitude]) {
  const [x, y] = toRD(latitude, longitude);
  const point = [x - origin.left, origin.top - y].map((n) => Math.round(n * 10) / 10);
  return tiles.has(point.map((n) => Math.floor(n / map.tileSize)).join(":")) ? point : null;
}

async function page(url, name) {
  const file = cache && resolve(cache, name);
  if (file) {
    try { return JSON.parse(await readFile(file, "utf8")); } catch { /* Cache miss. */ }
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error(`Traffic-signal data: HTTP ${response.status} from ${url}`);
      const raw = await response.text();
      const result = JSON.parse(raw);
      if (!Array.isArray(result.features)) throw new Error("Unexpected traffic-signal data");
      if (file) await writeFile(file, raw);
      return result;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((done) => setTimeout(done, attempt * 850));
    }
  }
}

for (let url = first.href, i = 0; url; i++) {
  const { features, links } = await page(url, `part-${i}.json`);
  url = links?.find(({ rel }) => rel === "next")?.href;
  for (const feature of features) {
    const { geometry, properties } = feature;
    if (geometry?.type !== "Point" || properties.status !== "bestaand" || properties.eind_registratie != null) continue;
    const point = localPoint(geometry.coordinates);
    if (!point) continue;
    const key = point.join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    poles.push(point);
  }
}

const municipalSource = {
  amsterdam: "https://maps.amsterdam.nl/open_geodata/geojson_lnglat.php?KAARTLAAG=VERKEERSLICHTEN&THEMA=verkeerslichten",
  utrecht: "https://data.utrecht.nl/sites/default/files/open-data/vri-verkeersregelinstallaties.geojson",
}[area.id];
const junctions = [];
if (municipalSource) {
  const { features } = await page(municipalSource, "municipal.json");
  for (const { geometry, properties } of features) {
    if (geometry?.type !== "Point") continue;
    if (area.id === "amsterdam" && properties.SELECTIE !== "BEDRIJF") continue;
    const point = localPoint(geometry.coordinates);
    if (point) junctions.push(point);
  }
}

await writeFile(resolve(area.target, "signals.json"), JSON.stringify({ poles, junctions }));
console.log(`${area.name}: ${poles.length} traffic-signal poles and ${junctions.length} municipal junctions.`);
