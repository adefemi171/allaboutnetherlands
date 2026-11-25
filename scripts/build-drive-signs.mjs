// Snapshot the placed NDW traffic signs in a Drive & Ride area.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { toRD } from "../src/map/rd.ts";
import { tileBounds } from "../src/map/street-tiles.ts";
import { buildArea } from "./drive-area.mjs";

const area = buildArea();
const map = JSON.parse(await readFile(resolve(area.target, "corridor.json"), "utf8"));
const origin = tileBounds(...area.origin);
const tiles = new Set(map.tiles.map(([x, z]) => `${x}:${z}`));
const types = {
  A1: "speed", "A1(Zone)": "speed", B1: "priority", B6: "yield", B7: "stop",
  C2: "no-entry", C3: "one-way", C4: "one-way-turn",
  D1: "roundabout", G7: "footpath", G11: "cycleway", L2: "crossing",
};
const compass = ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO",
  "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"];
const cache = area.cache(process.env.DRIVE_SIGNS_CACHE);
if (cache) await mkdir(cache, { recursive: true });

async function inventory(countyCode) {
  const file = cache && resolve(cache, countyCode + ".json");
  if (file) {
    try { return JSON.parse(await readFile(file, "utf8")).features; } catch { /* Download uncached data. */ }
  }
  const url = new URL("https://data.ndw.nu/api/rest/static-road-data/traffic-signs/v4/current-state");
  url.search = new URLSearchParams({ countyCode, status: "PLACED" });
  const response = await fetch(url, { signal: AbortSignal.timeout(40_000) });
  if (!response.ok) throw new Error(`NDW ${countyCode}: HTTP ${response.status}`);
  const data = await response.text();
  const { features } = JSON.parse(data);
  if (!Array.isArray(features) || !features.length) throw new Error(`NDW did not return signs for ${countyCode}`);
  if (file) await writeFile(file, data);
  return features;
}

const round = (value) => Math.round(value * 100) / 100;
const seen = new Set();
const signs = [];
for (const { geometry, properties: p } of (await Promise.all(area.municipalities.map(inventory))).flat()) {
  const kind = types[p.rvvCode];
  if (!kind || p.status !== "PLACED" || p.placement === "B" || geometry?.type !== "Point") continue;
  const [lon, lat] = geometry.coordinates;
  if (area.id === "utrecht" && (lon < 5.09 || lon > 5.24 || lat < 52.012 || lat > 52.09)) continue;
  const [east, north] = toRD(lat, lon);
  const point = [round(east - origin.left), round(origin.top - north)];
  if (!tiles.has(point.map((n) => Math.floor(n / map.tileSize)).join(":"))) continue;
  const direction = compass.indexOf(p.side);
  const bearing = typeof p.bearing === "number" && p.bearing >= 0 && p.bearing < 360
    ? p.bearing : direction >= 0 ? direction * 22.5 : null;
  if (bearing === null) continue;

  let detail;
  if (kind === "speed") {
    if (!/^\d+$/.test(p.blackCode) || Number(p.blackCode) > 90 || p.zoneCode === "ZE") continue;
    detail = (p.zoneCode === "ZB" || p.zoneCode === "ZH" ? "zone-" : "") + p.blackCode;
  }
  if (kind === "one-way-turn") {
    if (p.blackCode !== "L" && p.blackCode !== "R") continue;
    detail = p.blackCode;
  }
  const supplementary = (p.textSigns ?? []).map(({ type, text }) =>
    type === "VRIJ" || type === "TIJD" ? text : "").filter(Boolean);
  const key = `${kind}:${detail}:${point.map((n) => Math.round(n * 2)).join(":")}:${bearing}`;
  if (seen.has(key)) continue;
  seen.add(key);
  signs.push({ kind, point, bearing, ...(detail && { detail }),
    ...(supplementary.length && { supplementary }), ...(p.roadName && { street: p.roadName }) });
}
await writeFile(resolve(area.target, "signs.json"), JSON.stringify(signs));
console.log(`Baked ${signs.length} placed NDW signs for the corridor.`);
