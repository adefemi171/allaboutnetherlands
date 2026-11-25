// Build the street-name index and landmark anchors for the local corridor.
// Run this after build-drive-data.mjs and build-drive-scenery.mjs with Node 24+.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { groundUrl, tileBounds } from "../src/map/street-tiles.ts";
import { toRD } from "../src/map/rd.ts";
import { buildArea } from "./drive-area.mjs";

const area = buildArea();
const map = JSON.parse(await readFile(resolve(area.target, "corridor.json"), "utf8"));
const [startCol, startRow] = area.origin;
const origin = tileBounds(startCol, startRow);
function local(x, y) {
  return [Math.round((x - origin.left) * 100) / 100, Math.round((origin.top - y) * 100) / 100];
}
const stationPart = ([col, row]) => Math.abs(col - 1) < 2 && Math.abs(row - 1) < 2
  || Math.abs(col - 3) < 2 && Math.abs(row - 3) < 2
  || Math.abs(col - 5) < 2 && Math.abs(row - 7) < 2;

const cache = area.cache(process.env.DRIVE_PLACES_CACHE);
if (cache) await mkdir(cache, { recursive: true });
async function readTile(col, row) {
  const file = cache && `${cache}/${col}-${row}.mvt`;
  let data;
  if (file) {
    try { data = await readFile(file); } catch { /* Fetch missing tile. */ }
  }
  if (!data) {
    const url = groundUrl(startCol + col, startRow + row);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
        if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
        data = new Uint8Array(await response.arrayBuffer());
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((done) => setTimeout(done, 800 * attempt));
      }
    }
    if (file) await writeFile(file, data);
  }
  return new VectorTile(new PbfReader(data)).layers;
}

function paths(feature, [col, row], extent) {
  const unit = map.tileSize / extent;
  return feature.loadGeometry().map((line) => line.map(({ x, y }) =>
    [Math.round((col * map.tileSize + x * unit) * 10) / 10, Math.round((row * map.tileSize + y * unit) * 10) / 10]));
}

const entries = [];
const plazas = [];
const canal = [];
const roundaboutArcs = [];
const queue = map.tiles.entries();
await Promise.all(Array.from({ length: 5 }, async () => {
  for (const [index, tile] of queue) {
    const data = await readTile(...tile);
    const roads = data.wegdeel_hartlijn;
    for (let i = 0; roads && i < roads.length; i++) {
      const feature = roads.feature(i);
      const p = feature.properties;
      const name = String(p.naam ?? "").split("|")[0].trim();
      if (p.status === "in gebruik" && p.fysiekvoorkomen === "op rotonde"
        && String(p.hoofdverkeersgebruik).includes("gemengd verkeer")) {
        roundaboutArcs.push(...paths(feature, tile, roads.extent).filter((line) => line.length > 1));
      }
      if (!name || p.status !== "in gebruik" || p.typeweg === "autosnelweg") continue;
      const use = String(p.hoofdverkeersgebruik ?? "");
      const mode = use.includes("gemengd verkeer") ? 3 : /fietsers|bromfietsers/.test(use) ? 2 : 0;
      if (!mode) continue;
      for (const line of paths(feature, tile, roads.extent)) {
        if (line.length >= 2) entries.push([index, name, mode, line]);
      }
    }
    if (area.id === "utrecht" && stationPart(tile)) {
      for (const [layer, output, name] of [[data.wegdeel_vlak, plazas, "Het Rond"],
        [data.waterdeel_vlak, canal, "Vaartsche Rijn"]]) {
        for (let i = 0; layer && i < layer.length; i++) {
          const feature = layer.feature(i);
          const p = feature.properties;
          if (!String(p.naam ?? p.naamnl ?? "").split("|").includes(name)) continue;
          for (const line of paths(feature, tile, layer.extent)) output.push(line);
        }
      }
    }
  }
}));

const names = [...new Set(entries.map(([, name]) => name))].sort((a, b) => a.localeCompare(b, "nl"));
const ids = new Map(names.map((name, i) => [name, i]));
const streets = entries.sort((a, b) => a[0] - b[0]).map(([, name, mode, line]) => [ids.get(name), mode, ...line.flat()]);

const places = area.id === "utrecht" ? [
  { id: "westerkade", name: "Westerkade", point: map.stops[0].access.car, radius: 120,
    description: "The west quay of the Vaartsche Rijn, opposite Oosterkade." },
  { id: "vaartsche-rijn", name: map.stops[0].name, point: map.stops[0].point, radius: 190,
    description: "The elevated train and tram station crosses the Vaartsche Rijn." },
  { id: "rotsoord", name: "Watertoren Rotsoord", point: local(136735.42, 454168.8), radius: 285,
    description: "The 1907 brick water tower overlooks the former industrial waterfront at Heuveloord." },
  { id: "lunetten", name: map.stops[1].name, point: map.stops[1].point, radius: 220,
    description: "Lunetten’s island platform sits beside the Nieuwe Houtenseweg underpass." },
  { id: "houten", name: "Station Houten", point: map.stops[2].point, radius: 185,
    description: "The elevated station has curved glass screens and bicycle parking underneath." },
  { id: "het-rond", name: "Het Rond", point: [4870, 6474], radius: 180,
    description: "Houten’s town square is on the east side of the railway, beside the station." },
] : [
  ...map.stops.map((stop, i) => ({
    id: `start-${i}`, name: stop.name, point: stop.point, radius: 160, description: area.stopDetails[i],
  })),
  ...(area.landmarks ?? []).map(([id, name, lat, lon, description]) => ({
    id, name, point: local(...toRD(lat, lon)), radius: 175, description,
  })),
];
const quayEdges = [];
const edges = new Set();
for (const ring of canal) {
  for (let i = 1; i < ring.length; i++) {
    const [ax, az] = ring[i - 1];
    const [bx, bz] = ring[i];
    const span = Math.hypot(bx - ax, bz - az);
    // Ignore the ends of clipped rings and concentrate on the two quays.
    if (span < 0.6 || span > 103
      || Math.abs(ax - bx) < 0.05 || Math.abs(az - bz) < 0.05
      || az < 1300 || bz < 1300 || az > 1880 || bz > 1880
      || ax < 1430 || bx < 1430 || ax > 1800 || bx > 1800) continue;
    const key = [`${ax},${az}`, `${bx},${bz}`].sort().join(":");
    if (edges.has(key)) continue;
    edges.add(key);
    quayEdges.push([ax, az, bx, bz]);
  }
}
const groups = [];
const metres = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
for (const arc of roundaboutArcs) {
  const ends = [arc[0], arc.at(-1)];
  let points = arc;
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i].ends.some((a) => ends.some((b) => metres(a, b) < 1.5))) continue;
    const [part] = groups.splice(i, 1);
    points = points.concat(part.points);
    ends.push(...part.ends);
  }
  groups.push({ points, ends });
}
const roundabouts = [...(area.roundabouts ?? [])];
for (const { points } of groups) {
  const xs = points.map(([x]) => x), zs = points.map(([, z]) => z);
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...zs) - Math.min(...zs);
  if (points.length < 7 || Math.min(width, height) < 8 || Math.max(width, height) > Math.min(width, height) * 1.6) continue;
  const center = [Math.min(...xs) + width / 2, Math.min(...zs) + height / 2].map((n) => Math.round(n * 10) / 10);
  const radius = Math.round((width + height) * 2.5) / 10;
  if (radius <= 45 && roundabouts.every((entry) => metres(center, entry.center) > 8)) roundabouts.push({ center, radius });
}
await writeFile(resolve(area.target, "places.json"), JSON.stringify({ names, streets, places, quayEdges, plazas, roundabouts }));
console.log(`Baked ${streets.length} named road lines and ${places.length} landmark anchors.`);
