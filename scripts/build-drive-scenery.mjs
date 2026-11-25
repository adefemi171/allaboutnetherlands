// Run after build-drive-data.mjs. This adds local aerial and LiDAR detail
// on the same RD grid as the existing Drive & Ride corridor.
// --buildings-only re-bakes the building meshes and facade facts, keeping the
// aerial photos and route guides already in the bundle.
import { createHash } from "node:crypto";
import { get } from "node:https";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import earcut from "earcut";
import { BuildingCollisions } from "../src/drive/collisions.ts";
import { traceRoute } from "./trace-drive-routes.mjs";
import { tileAt, tileBounds } from "../src/map/street-tiles.ts";
import { BUILDING_ERAS, BUILDING_UNDATED, STREET, hex } from "../src/map/style.ts";
import { buildArea } from "./drive-area.mjs";
import { FACADE_FLAG, FACADE_USE, facadeEra } from "../src/drive/facades.ts";

const area = buildArea();
const buildingsOnly = process.argv.includes("--buildings-only");
const target = area.target;
const photos = resolve(target, "aerial");
const cache = area.cache(process.env.DRIVE_SCENERY_CACHE);
const manifest = resolve(target, "corridor.json");
const corridor = JSON.parse(await readFile(manifest, "utf8"));
const { tiles, tileSize } = corridor;
const [startCol, startRow] = area.origin;
const layout = tiles.map(([col, row]) => ({
  key: `${col}-${row}`,
  box: tileBounds(col + startCol, row + startRow),
  positions: [], colors: [], normals: [], indices: [], footprints: [], facades: [],
}));
const byKey = new Map(layout.map((tile) => [tile.key, tile]));
const boxes = layout.map(({ box }) => box);
const bounds = [Math.min(...boxes.map((b) => b.left)), Math.min(...boxes.map((b) => b.bottom)),
  Math.max(...boxes.map((b) => b.right)), Math.max(...boxes.map((b) => b.top))];
await mkdir(photos, { recursive: true });
if (cache) await mkdir(cache, { recursive: true });

async function fetchFile(url, cacheName, validate = () => true) {
  const path = cache && resolve(cache, cacheName);
  if (path) {
    try {
      const saved = await readFile(path);
      if (validate(saved)) return saved;
    } catch { /* Download missing cache entries. */ }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      // HTTP fetch decodes Content-Encoding; keep source bytes for the
      // tile index's checksum, which was calculated over the gzip file.
      const buffer = await new Promise((done, failed) => {
        const request = get(url, { signal: AbortSignal.timeout(35_000) }, (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            failed(new Error(`HTTP ${response.statusCode} from ${url}`));
            return;
          }
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("error", failed);
          response.on("end", () => done(Buffer.concat(chunks)));
        });
        request.on("error", failed);
      });
      if (!validate(buffer)) throw new Error(`Unexpected data from ${url}`);
      if (path) await writeFile(path, buffer);
      return buffer;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((done) => setTimeout(done, 1200 * (attempt + 1)));
    }
  }
}

const indexUrl = new URL("https://data.3dbag.nl/api/BAG3D/wfs");
indexUrl.search = new URLSearchParams({
  service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: "BAG3D:tiles",
  outputFormat: "application/json", srsName: "EPSG:28992",
  bbox: [...bounds, "EPSG:28992"].join(","),
});
const { features } = JSON.parse(await fetchFile(indexUrl, "tiles-index.json"));
const intersects = ([a, b, c, d], box) => c > box.left && a < box.right && d > box.bottom && b < box.top;
const sources = features.filter(({ bbox }) => boxes.some((box) => intersects(bbox, box)));
console.log(`Reading ${sources.length} 3DBAG CityJSON tiles for ${tiles.length} corridor tiles.`);

function seedOf(text) {
  let seed = 2166136261;
  for (const ch of text) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  return seed >>> 0;
}

function unitNormal(ring) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay, az] = ring[i];
    const [bx, by, bz] = ring[(i + 1) % ring.length];
    x += (ay - by) * (az + bz);
    y += (az - bz) * (ax + bx);
    z += (ax - bx) * (ay + by);
  }
  const l = Math.hypot(x, y, z);
  return l > 0.000001 ? [x / l, y / l, z / l] : null;
}

function addFace(tile, rings, color, seed, roof, facade) {
  let normal = unitNormal(rings[0]);
  if (!normal) return;
  if (roof && normal[1] < 0) normal = normal.map((value) => -value);
  const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const flat = [];
  const holes = [];
  const vertices = rings.flat();
  for (const ring of rings) {
    if (flat.length) holes.push(flat.length / 2);
    for (const point of ring) flat.push(point[(axis + 1) % 3], point[(axis + 2) % 3]);
  }
  const indices = earcut(flat, holes, 2);
  if (!indices.length) return;
  const base = tile.positions.length / 3;
  for (const point of vertices) {
    tile.positions.push(...point.map((n) => n / 1000));
    tile.colors.push(...color, seed);
    tile.normals.push(...normal.map((value) => Math.round(value * 127)));
    tile.facades.push(...facade);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3);
    const area = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1])
      - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
    if (area * normal[axis] < 0) tile.indices.push(base + a, base + c, base + b);
    else tile.indices.push(base + a, base + b, base + c);
  }
}

// These volumes have site-specific meshes in local-scenery.ts. Keep the
// surveyed ground rings in the collision index, even when replacing the mesh.
const detailedLandmarks = new Set([
  "NL.IMBAG.Pand.0344100000127759", // Watertoren Rotsoord
  "NL.IMBAG.Pand.0321100000027376", // Station Houten, concourse
  "NL.IMBAG.Pand.0321100000027377", // Station Houten, north section
  "NL.IMBAG.Pand.0321100000027379", // Station Houten, south section
]);

// Building uses from the BAG register (Kadaster, CC0), keyed by pand ID. A pand
// with a shop or café gets a shopfront on the ground floor.
const uses = new Map();
async function bagUses(tile) {
  const { left, bottom, right, top } = tile.box;
  for (let start = 0; ; start += 1000) {
    const url = new URL("https://service.pdok.nl/lv/bag/wfs/v2_0");
    url.search = new URLSearchParams({
      service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: "bag:verblijfsobject",
      outputFormat: "application/json", srsName: "EPSG:28992", count: "1000", startIndex: String(start),
      propertyName: "bag:gebruiksdoel,bag:pandidentificatie", bbox: [left, bottom, right, top, "EPSG:28992"].join(","),
    });
    const { features } = JSON.parse(await fetchFile(url, `bag-${tile.key}-${start}.json`));
    for (const { properties } of features) {
      const purposes = String(properties.gebruiksdoel ?? "").split(",");
      for (const pand of String(properties.pandidentificatie ?? "").split(",")) {
        const count = uses.get(pand) ?? { shop: 0, office: 0, home: 0 };
        for (const purpose of purposes) {
          if (purpose === "winkelfunctie" || purpose === "bijeenkomstfunctie") count.shop++;
          else if (purpose === "kantoorfunctie") count.office++;
          else if (purpose === "woonfunctie") count.home++;
        }
        uses.set(pand, count);
      }
    }
    if (features.length < 1000) return;
  }
}

function useOf(buildingId, floors) {
  const count = uses.get(buildingId.replace("NL.IMBAG.Pand.", ""));
  if (!count) return FACADE_USE.other;
  if (count.shop && floors <= 6) return FACADE_USE.shop;
  if (count.office > count.home) return FACADE_USE.office;
  return FACADE_USE.home;
}

const used = new Set();
async function source({ properties }) {
  const { cj_download: url, cj_sha256: digest, tile_id: id } = properties;
  const raw = await fetchFile(url, `${id.replaceAll("/", "-")}.json.gz`,
    (buffer) => createHash("sha256").update(buffer).digest("hex") === digest);
  const { CityObjects, vertices, transform } = JSON.parse(gunzipSync(raw));
  const { scale, translate } = transform;
  const georef = (index) => vertices[index].map((value, axis) => value * scale[axis] + translate[axis]);
  for (const [buildingId, building] of Object.entries(CityObjects)) {
    if (building.type !== "Building" || !building.geographicalExtent) continue;
    const [left, bottom, , right, top] = building.geographicalExtent;
    const [col, row] = tileAt((left + right) / 2, (bottom + top) / 2);
    const tile = byKey.get(`${col - startCol}-${row - startRow}`);
    if (!tile || used.has(buildingId)) continue;
    used.add(buildingId);
    const props = building.attributes;
    const seed = seedOf(buildingId);
    const year = props.oorspronkelijkbouwjaar;
    const walls = BUILDING_ERAS.find((era) => year >= 1200 && year < era.until)?.walls ?? BUILDING_UNDATED;
    const wall = hex(props.b3_kas_warenhuis ? STREET.glass : walls[seed % walls.length]);
    const sloped = props.b3_dak_type === "slanted";
    const roofs = sloped ? STREET.roofTile : STREET.roofFlat;
    const roof = hex(props.b3_kas_warenhuis ? STREET.glass : roofs[(seed >>> 9) % roofs.length]);
    // Real storeys: the LiDAR roof height shared over the registered floor count.
    const floors = Math.max(1, Math.round(props.b3_bouwlagen ?? 0) || 1);
    const height = (props.b3_h_dak_50p ?? props.b3_h_dak_70p ?? 0) - (props.b3_h_maaiveld ?? 0);
    const storey = height > 0 && props.b3_bouwlagen ? Math.min(4.4, Math.max(2.6, height / floors)) : 0;
    const facade = [Math.round(storey * 20), useOf(buildingId, floors), facadeEra(year), Math.min(255, floors)];

    for (const partId of building.children ?? []) {
      const parts = CityObjects[partId]?.geometry ?? [];
      const solid = ["2.2", "1.3", "1.2"].map((lod) =>
        parts.find((entry) => entry.lod === lod && entry.type === "Solid" && entry.semantics))
        .find(Boolean);
      if (!solid) continue;
      const floorHeights = solid.boundaries[0].flatMap((rings, i) =>
        solid.semantics.surfaces[solid.semantics.values[0][i]]?.type === "GroundSurface"
          ? rings[0].map((index) => georef(index)[2]) : []);
      const floor = floorHeights.length
        ? Math.min(...floorHeights)
        : (props.b3_h_maaiveld ?? building.geographicalExtent[2]);
      const pointOf = (index) => {
        const [x, y, h] = georef(index);
        return [Math.round((x - tile.box.left) * 100) / 100,
          Math.round(Math.max(0, h - floor) * 100) / 100,
          Math.round((tile.box.top - y) * 100) / 100];
      };
      solid.boundaries[0].forEach((surface, i) => {
        const type = solid.semantics.surfaces[solid.semantics.values[0][i]]?.type;
        if (type !== "WallSurface" && type !== "RoofSurface" && type !== "GroundSurface") return;
        const rings = surface.map((ring) => ring.map(pointOf)).filter((ring) => ring.length >= 3);
        if (!rings.length) return;
        if (type === "GroundSurface") {
          if (rings[0].every(([, y]) => y < 2.1)) {
            tile.footprints.push(rings.length);
            for (const ring of rings) {
              tile.footprints.push(ring.length);
              for (const [x, , z] of ring) tile.footprints.push(x, z);
            }
          }
          return;
        }
        if (detailedLandmarks.has(buildingId)) return;
        const isRoof = type === "RoofSurface";
        addFace(tile, rings, isRoof ? roof : wall, isRoof ? 0 : 1 + seed % 254, isRoof, facade);
      });
    }
  }
}

function readMeshEnd(raw, start, ground) {
  const vertices = raw.readUInt32LE(start);
  const indices = raw.readUInt32LE(start + 4);
  const normals = ground ? 0 : Math.ceil(vertices * 3 / 4) * 4;
  return start + 8 + vertices * (ground ? 12 : 16) + indices * 4 + normals;
}

function bytes(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

async function writeTile(tile) {
  const path = resolve(target, `${tile.key}.bin`);
  const raw = gunzipSync(await readFile(path));
  const prefix = raw.subarray(0, readMeshEnd(raw, readMeshEnd(raw, 0, true), false));
  if (!tile.indices.length && raw.readUInt32LE(prefix.length)) {
    throw new Error(`Missing detailed buildings for corridor tile ${tile.key}`);
  }
  const payload = [
    new Uint32Array([(tile.positions.length / 3 | FACADE_FLAG) >>> 0, tile.indices.length]),
    new Float32Array(tile.positions), new Uint8Array(tile.colors), new Uint32Array(tile.indices),
    new Int8Array(tile.normals), new Uint8Array((4 - tile.normals.length % 4) % 4),
    new Uint8Array(tile.facades),
    new Float32Array(tile.footprints),
  ].map(bytes);
  await writeFile(path, gzipSync(Buffer.concat([prefix, ...payload])));
}

async function photo(tile) {
  const { left, bottom, right, top } = tile.box;
  const url = new URL("https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0");
  const resolution = Math.round(tileSize / 0.48);
  url.search = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: "Actueel_ortho25",
    CRS: "EPSG:28992", BBOX: [left, bottom, right, top].map((n) => n.toFixed(2)).join(","),
    WIDTH: String(resolution), HEIGHT: String(resolution), FORMAT: "image/jpeg", STYLES: "",
  });
  const name = `${tile.key}.jpg`;
  const image = await fetchFile(url, name, (data) => data[0] === 255 && data[1] === 216);
  await writeFile(resolve(photos, name), image);
}

async function batch(items, work, count) {
  const queue = items.entries();
  await Promise.all(Array.from({ length: count }, async () => {
    for (const [index, item] of queue) {
      await work(item);
      if ((index + 1) % 12 === 0) console.log(`${work.name}: ${index + 1}/${items.length}`);
    }
  }));
}

await batch(layout, bagUses, 4);
console.log(`Read BAG uses for ${uses.size} buildings.`);
await Promise.all([batch(sources, source, 4), buildingsOnly ? null : batch(layout, photo, 4)]);
if (buildingsOnly) {
  await batch(layout, writeTile, 3);
  console.log(`Baked surveyed buildings and facades for ${tiles.length} tiles.`);
  process.exit(0);
}

// Guides must follow clear sections of road once the full footprints are
// present. Build them from the original centreline network in the bundle.
const colliders = new BuildingCollisions();
for (const tile of layout) {
  const [col, row] = tile.key.split("-").map(Number);
  colliders.add(new Float32Array(tile.footprints), col * tileSize, row * tileSize);
}
const roadBytes = gunzipSync(await readFile(resolve(target, "roads.bin")));
const [cars, bikes] = new Uint32Array(roadBytes.buffer, roadBytes.byteOffset, 2);
for (const mode of ["car", "bike"]) {
  if (!area.modes.includes(mode)) continue;
  const car = mode === "car";
  const data = new Float32Array(roadBytes.buffer, roadBytes.byteOffset + 8 + (car ? 0 : cars * 4),
    car ? cars : bikes);
  const paths = [];
  for (let i = 0; i < data.length;) {
    const count = data[i++];
    const width = data[i++];
    const points = [];
    for (let j = 0; j < count; j++) points.push([data[i++], data[i++]]);
    paths.push({ points, oneWay: car && width < 0, multiplier: !car && width < 2 ? 0.80 : 1.0 });
  }

  function canTravel(a, b) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const angle = Math.atan2(dx, dz);
    const steps = Math.ceil(Math.hypot(dx, dz) / 1.2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (colliders.vehicle([a[0] + dx * t, a[1] + dz * t], angle, mode)) return false;
    }
    return true;
  }

  const anchors = corridor.stops.map((stop) => ({ point: stop.point, radius: area.roadRadius }));
  if (area.roadStart?.[mode]) anchors[0] = area.roadStart[mode];
  const { track, stopIndices } = traceRoute(paths, anchors, mode, canTravel);
  corridor.guides[mode] = track;
  for (let i = 0; i < corridor.stops.length; i++) {
    const stop = corridor.stops[i];
    stop.approach[mode] = stopIndices[i];
    stop.access[mode] = track[stopIndices[i]];
  }
  if (car) {
    const returning = anchors.toReversed();
    if (area.carReturnEnd) returning[returning.length - 1] = area.carReturnEnd;
    const { track, stopIndices } = traceRoute(paths, returning, mode, canTravel);
    corridor.carReturn = { track, stopIndices };
  }
}
await batch(layout, writeTile, 3);
await writeFile(manifest, JSON.stringify(corridor));
console.log(`Baked surveyed buildings and aerial photos for ${tiles.length} tiles.`);
