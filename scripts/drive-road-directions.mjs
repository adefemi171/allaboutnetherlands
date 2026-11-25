// Match the TOP10NL centreline geometry to the permitted travel directions
// in Rijkswaterstaat's Nationaal Wegenbestand. B = both, H = with the line,
// O = against the line.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fromRD, toRD } from "../src/map/rd.ts";
import { tileBounds } from "../src/map/street-tiles.ts";

const CELL = 18;
const RANGE = 6.2;
const endpoint = "https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1/collections/wegvakken/items";

export async function roadDirections(area) {
  const origin = tileBounds(...area.origin);
  const tiles = area.tiles.map(([c, r]) => tileBounds(area.origin[0] + c, area.origin[1] + r));
  const edges = [[Math.min(...tiles.map((t) => t.left)), Math.min(...tiles.map((t) => t.bottom))],
    [Math.max(...tiles.map((t) => t.right)), Math.max(...tiles.map((t) => t.top))]];
  const corners = edges.flatMap(([x]) => edges.map(([, y]) => fromRD(x, y)));
  const lons = corners.map(([, lon]) => lon);
  const lats = corners.map(([lat]) => lat);
  const bbox = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)].join(",");
  const first = new URL(endpoint);
  first.search = new URLSearchParams({ f: "json", limit: "1000", bbox });
  const cache = area.cache(process.env.DRIVE_DIRECTIONS_CACHE);
  if (cache) await mkdir(cache, { recursive: true });
  const local = ([lon, lat]) => {
    const [x, y] = toRD(lat, lon);
    return [x - origin.left, origin.top - y];
  };
  const cells = new Map();
  let total = 0;

  for (let url = first.href, page = 0; url; page++) {
    const file = cache && resolve(cache, `${area.id}-${page}.json`);
    const { features, links } = await inventory(url, file);
    url = links?.find(({ rel }) => rel === "next")?.href;
    total += features.length;
    for (const { geometry, properties } of features) {
      const direction = { H: 1, O: -1, B: 0 }[properties.rijrichtng];
      if (direction === undefined) continue;
      const lines = geometry?.type === "LineString" ? [geometry.coordinates]
        : geometry?.type === "MultiLineString" ? geometry.coordinates : [];
      for (const line of lines) {
        const points = line.map(local);
        for (let i = 1; i < points.length; i++) {
          const [x, z] = points[i - 1];
          const [bx, bz] = points[i];
          const dx = bx - x, dz = bz - z, length = Math.hypot(dx, dz);
          if (length < 0.15) continue;
          const leg = { x, z, dx, dz, length, direction };
          for (let c = Math.floor((Math.min(x, bx) - RANGE) / CELL); c <= Math.floor((Math.max(x, bx) + RANGE) / CELL); c++) {
            for (let r = Math.floor((Math.min(z, bz) - RANGE) / CELL); r <= Math.floor((Math.max(z, bz) + RANGE) / CELL); r++) {
              const key = `${c}:${r}`;
              if (!cells.has(key)) cells.set(key, []);
              cells.get(key).push(leg);
            }
          }
        }
      }
    }
  }
  if (!total) throw new Error(`No NWB road records in ${area.id}`);
  console.log(`${area.id}: loaded ${total} NWB road sections.`);

  return (a, b) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.15) return null;
    const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
    const votes = new Map();
    for (const t of [0.24, 0.5, 0.76]) {
      const x = a[0] + ux * length * t, z = a[1] + uz * length * t;
      let best = RANGE, chosen;
      for (const leg of cells.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`) ?? []) {
        const aligned = (ux * leg.dx + uz * leg.dz) / leg.length;
        if (Math.abs(aligned) < 0.75) continue;
        const s = ((x - leg.x) * leg.dx + (z - leg.z) * leg.dz) / leg.length ** 2;
        const f = Math.max(0, Math.min(1, s));
        const d = Math.hypot(x - leg.x - leg.dx * f, z - leg.z - leg.dz * f);
        const score = d + 3 * (1 - Math.abs(aligned)) + (s < 0 || s > 1 ? 0.6 : 0);
        if (score >= best) continue;
        best = score;
        chosen = leg.direction * Math.sign(aligned);
      }
      if (chosen !== undefined) votes.set(chosen, (votes.get(chosen) ?? 0) + 1);
    }
    for (const [direction, count] of votes) {
      if (count >= 2) return direction;
    }
    return null;
  };
}

async function inventory(url, file) {
  if (file) {
    try { return JSON.parse(await readFile(file, "utf8")); } catch { /* Fetch missing pages. */ }
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`NWB HTTP ${response.status}`);
      const result = await response.text();
      const data = JSON.parse(result);
      if (!Array.isArray(data.features)) throw new Error("Unexpected NWB response");
      if (file) await writeFile(file, result);
      return data;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((done) => setTimeout(done, attempt * 600));
    }
  }
}
