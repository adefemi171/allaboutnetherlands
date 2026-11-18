// Builds the data behind the voxel map from open sources.
//
//   npm run data
//
// Output
//   public/data/nl-grid.dat      gzip of three layers on a 500 m RD grid:
//                                Int16 elevation (decimetres to NAP),
//                                Uint8 flags, Uint8 population
//   public/data/globe-land.bin   the dots that draw land on the globe, as
//                                Int16 lon/lat pairs (hundredths of a degree)
//   src/data/grid-meta.json      grid geometry, province names, summary stats
//   .cache/preview.png           a flat picture of the grid, for checking
//
// Sources
//   Elevation    AHN (Actueel Hoogtebestand Nederland) via PDOK for the
//                Netherlands; Mapzen/Tilezen terrain tiles on AWS Open Data
//                for the strip of Belgium and Germany around it
//   Provinces    CBS gebiedsindelingen via PDOK (generalised, land only)
//   Population   CBS vierkantstatistieken 500 m via PDOK
//   Neighbours, rivers, globe land   Natural Earth
//
// Downloads are cached in .cache/, so a second run is quick and works offline.

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { geoBounds, geoContains } from "d3-geo";
import { fromArrayBuffer } from "geotiff";
import { PNG } from "pngjs";
import { feature } from "topojson-client";
import { toRD, fromRD } from "./rd.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");

// ---------------------------------------------------------------- the grid --
// Cells are 500 m squares on the RD grid, aligned to multiples of 500 m so
// each one coincides with a CBS statistics square.
const CELL = 500;
const X_MIN = -12000;
const X_MAX = 292000;
const Y_MIN = 295000;
const Y_MAX = 630000;
const W = (X_MAX - X_MIN) / CELL;
const H = (Y_MAX - Y_MIN) / CELL;
const N = W * H;

const cellX = (i) => X_MIN + (i + 0.5) * CELL;
const cellY = (j) => Y_MAX - (j + 0.5) * CELL;

// Flag byte layout. Keep in sync with src/map/grid.ts.
//   bits 0-3  province number (1-12), 0 outside the Netherlands
//   bits 4-5  kind: sea and large open water, Dutch land, foreign land
//   bit 6     inland water (lake or river) inside a province
const KIND_WATER = 0;
const KIND_NL = 1;
const KIND_FOREIGN = 2;
const RIVER_BIT = 0x40;
const kindOf = (flag) => (flag >> 4) & 3;

const POP_YEAR = 2024;
const PROVINCE_YEAR = 2025;
const ELEVATION_ZOOM = 9;

// ----------------------------------------------------------------- helpers --
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function fetchRetry(url, tries = 4) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Download to .cache once, then read from disk. Returns a Buffer. */
async function cached(name, url) {
  const file = path.join(CACHE, name);
  if (await exists(file)) return fs.readFile(file);
  const res = await fetchRetry(url);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return buf;
}

/**
 * Scanline fill. `polygons` is a list of polygons, each a list of closed
 * rings of [x, y] in RD metres. Calls mark(i, j) for every cell whose centre
 * is inside (even-odd rule, so holes work).
 */
function rasterize(polygons, mark) {
  const edges = [];
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let k = 0; k < ring.length - 1; k++) {
        const [x1, y1] = ring[k];
        const [x2, y2] = ring[k + 1];
        if (y1 === y2) continue;
        if (Math.max(y1, y2) < Y_MIN || Math.min(y1, y2) > Y_MAX) continue;
        edges.push(y1 < y2 ? [x1, y1, x2, y2] : [x2, y2, x1, y1]);
      }
    }
  }
  const xs = [];
  for (let j = 0; j < H; j++) {
    const y = cellY(j);
    xs.length = 0;
    for (const [x1, y1, x2, y2] of edges) {
      if (y >= y1 && y < y2) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] - X_MIN) / CELL - 0.5));
      const to = Math.min(W - 1, Math.floor((xs[k + 1] - X_MIN) / CELL - 0.5));
      for (let i = from; i <= to; i++) mark(i, j);
    }
  }
}

/** GeoJSON Polygon or MultiPolygon to a list of polygons (lists of rings). */
function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function ringBounds(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function pointInPolygon(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a];
      const [xb, yb] = ring[b];
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// ------------------------------------------------------ check the RD maths --
function checkRD() {
  // Published reference points (RD x, y and ETRS89 lat, lon).
  const points = [
    ["Amsterdam Westertoren", 120700.723, 487525.501, 52.37453253, 4.88352559],
    ["Groningen Martinitoren", 233883.131, 582065.167, 53.21938317, 6.56820053],
  ];
  for (const [name, x, y, lat, lon] of points) {
    const [px, py] = toRD(lat, lon);
    const [plat, plon] = fromRD(x, y);
    const forward = Math.hypot(px - x, py - y);
    const inverse = Math.hypot((plat - lat) * 111200, (plon - lon) * 68000);
    if (forward > 2 || inverse > 2) {
      throw new Error(
        `RD conversion is off for ${name}: ${forward.toFixed(2)} m forward, ${inverse.toFixed(2)} m inverse`,
      );
    }
  }
}

// ------------------------------------------------------------------ layers --
async function loadProvinces() {
  const url =
    `https://service.pdok.nl/cbs/gebiedsindelingen/${PROVINCE_YEAR}/wfs/v1_0` +
    "?request=GetFeature&service=WFS&version=2.0.0" +
    "&typeNames=gebiedsindelingen:provincie_gegeneraliseerd" +
    "&outputFormat=application/json";
  const json = JSON.parse(
    await cached(`provinces-${PROVINCE_YEAR}.json`, url),
  );
  if (!json.crs?.properties?.name?.includes("28992")) {
    throw new Error("Expected province boundaries in RD (EPSG:28992)");
  }
  return json.features.map((f) => ({
    name: f.properties.statnaam,
    code: f.properties.statcode,
    polygons: polygonsOf(f.geometry),
  }));
}

/**
 * Country outlines near the Netherlands, projected to RD. Returns the
 * Natural Earth version of the Netherlands separately from everyone else.
 */
function loadNeighbours() {
  const topo = require("world-atlas/countries-10m.json");
  const countries = feature(topo, topo.objects.countries).features;
  const [latS, lonW] = fromRD(X_MIN, Y_MIN);
  const [latN, lonE] = fromRD(X_MAX, Y_MAX);
  const pad = 1;
  const foreign = [];
  const dutch = [];
  for (const country of countries) {
    const isNL = country.properties.name === "Netherlands";
    for (const rings of polygonsOf(country.geometry)) {
      const [minLon, minLat, maxLon, maxLat] = ringBounds(rings[0]);
      if (maxLon < lonW - pad || minLon > lonE + pad) continue;
      if (maxLat < latS - pad || minLat > latN + pad) continue;
      const projected = rings.map((ring) =>
        ring.map(([lon, lat]) => toRD(lat, lon)),
      );
      (isNL ? dutch : foreign).push(projected);
    }
  }
  return { foreign, dutch };
}

async function loadElevationSampler() {
  const size = 256 * 2 ** ELEVATION_ZOOM;
  const toPixel = (lat, lon) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return [
      ((lon + 180) / 360) * size,
      (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
    ];
  };

  // Which tiles cover the grid?
  let minTX = Infinity;
  let minTY = Infinity;
  let maxTX = -Infinity;
  let maxTY = -Infinity;
  for (let a = 0; a <= 8; a++) {
    for (let b = 0; b <= 8; b++) {
      const [lat, lon] = fromRD(
        X_MIN + ((X_MAX - X_MIN) * a) / 8,
        Y_MIN + ((Y_MAX - Y_MIN) * b) / 8,
      );
      const [px, py] = toPixel(lat, lon);
      minTX = Math.min(minTX, Math.floor((px - 2) / 256));
      maxTX = Math.max(maxTX, Math.floor((px + 2) / 256));
      minTY = Math.min(minTY, Math.floor((py - 2) / 256));
      maxTY = Math.max(maxTY, Math.floor((py + 2) / 256));
    }
  }

  const jobs = [];
  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) jobs.push([tx, ty]);
  }
  const tiles = new Map();
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < jobs.length) {
        const [tx, ty] = jobs[next++];
        const buf = await cached(
          `terrarium/${ELEVATION_ZOOM}/${tx}/${ty}.png`,
          `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ELEVATION_ZOOM}/${tx}/${ty}.png`,
        );
        tiles.set(`${tx}/${ty}`, PNG.sync.read(buf).data);
      }
    }),
  );
  console.log(`  ${jobs.length} elevation tiles at zoom ${ELEVATION_ZOOM}`);

  const at = (xi, yi) => {
    const data = tiles.get(`${xi >> 8}/${yi >> 8}`);
    if (!data) return 0;
    const o = ((yi & 255) * 256 + (xi & 255)) * 4;
    return data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
  };

  /** Elevation in metres at a lat/lon, bilinear between tile pixels. */
  return (lat, lon) => {
    const [px, py] = toPixel(lat, lon);
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    return (
      at(x0, y0) * (1 - tx) * (1 - ty) +
      at(x0 + 1, y0) * tx * (1 - ty) +
      at(x0, y0 + 1) * (1 - tx) * ty +
      at(x0 + 1, y0 + 1) * tx * ty
    );
  };
}

/**
 * Height of the ground in the Netherlands from AHN, the national lidar
 * height model, read from the PDOK coverage service at 100 m spacing. That
 * gives 25 samples per 500 m cell.
 *
 * Returns, per cell, the median of the valid samples (metres to NAP, NaN if
 * there were none) and how many samples were valid. Lidar gets no return
 * from open water, so a cell with few valid samples is mostly water.
 */
async function loadAhn() {
  // Extent of the coverage, trimmed to whole 500 m cells.
  const AX0 = 10000;
  const AX1 = 280000;
  const AY0 = 306500;
  const AY1 = 618500;
  const CHUNK = 50000;
  const STEP = 100;
  const PER_CELL = (CELL / STEP) ** 2;

  const samples = new Float32Array(N * PER_CELL);
  const counts = new Uint8Array(N);

  const jobs = [];
  for (let ya = AY0; ya < AY1; ya += CHUNK) {
    for (let xa = AX0; xa < AX1; xa += CHUNK) {
      jobs.push([xa, ya, Math.min(xa + CHUNK, AX1), Math.min(ya + CHUNK, AY1)]);
    }
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < jobs.length) {
        const [xa, ya, xb, yb] = jobs[next++];
        const cols = (xb - xa) / STEP;
        const rows = (yb - ya) / STEP;
        const buf = await cached(
          `ahn/dtm-${xa}-${ya}.tif`,
          "https://service.pdok.nl/rws/ahn/wcs/v1_0?SERVICE=WCS&VERSION=2.0.1" +
            "&REQUEST=GetCoverage&COVERAGEID=dtm_05m&FORMAT=image/tiff" +
            `&SUBSET=x(${xa},${xb})&SUBSET=y(${ya},${yb})` +
            `&SCALESIZE=x(${cols}),y(${rows})`,
        );
        const tiff = await fromArrayBuffer(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        const image = await tiff.getImage();
        if (image.getWidth() !== cols || image.getHeight() !== rows) {
          throw new Error(`Unexpected AHN chunk size at ${xa},${ya}`);
        }
        const [band] = await image.readRasters();
        for (let r = 0; r < rows; r++) {
          const j = Math.floor((Y_MAX - (yb - (r + 0.5) * STEP)) / CELL);
          for (let c = 0; c < cols; c++) {
            const v = band[r * cols + c];
            // No-data is a huge float. Real heights here are -10 to 330 m.
            if (!(v > -100 && v < 1000)) continue;
            const i = Math.floor((xa + (c + 0.5) * STEP - X_MIN) / CELL);
            const cell = j * W + i;
            samples[cell * PER_CELL + counts[cell]++] = v;
          }
        }
      }
    }),
  );
  console.log(`  ${jobs.length} AHN chunks at ${STEP} m`);

  const median = new Float32Array(N).fill(NaN);
  for (let cell = 0; cell < N; cell++) {
    const n = counts[cell];
    if (!n) continue;
    const values = samples.subarray(cell * PER_CELL, cell * PER_CELL + n).sort();
    median[cell] =
      n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
  }
  return {
    median,
    counts,
    perCell: PER_CELL,
    inside: (i, j) => {
      const x = cellX(i);
      const y = cellY(j);
      return x > AX0 && x < AX1 && y > AY0 && y < AY1;
    },
  };
}

/** Inhabitants per CBS 500 m square, as a Map from square id to count. */
async function loadPopulation() {
  const file = path.join(CACHE, `population-${POP_YEAR}.json`);
  if (await exists(file)) {
    return new Map(Object.entries(JSON.parse(await fs.readFile(file, "utf8"))));
  }

  const type = `vierkantstatistieken500m:Vierkant500M${POP_YEAR}`;
  const base =
    `https://service.pdok.nl/cbs/vierkantstatistieken500m/${POP_YEAR}/wfs/v1_0` +
    `?request=GetFeature&service=WFS&version=2.0.0&typeNames=${type}` +
    "&outputFormat=application/json&count=1000" +
    "&propertyName=crs28992res500m,aantalInwoners";

  // The service returns at most 1000 rows per request and refuses to page
  // past row 50,000. So read the country in horizontal strips, each small
  // enough to stay under that limit. Squares on a strip edge come back
  // twice; keying by square id removes the duplicates.
  const STRIP = 25000;
  const PAGE_LIMIT = 50000;
  const page = async (yLow, start) => {
    const bbox = `${X_MIN},${yLow},${X_MAX},${yLow + STRIP},urn:ogc:def:crs:EPSG::28992`;
    const res = await fetchRetry(`${base}&bbox=${bbox}&startIndex=${start}`);
    const json = JSON.parse(await res.text());
    if (!Array.isArray(json.features)) throw new Error("No features in page");
    return json.features;
  };

  const result = {};
  let rows = 0;
  for (let yLow = Y_MIN; yLow < Y_MAX; yLow += STRIP) {
    let start = 0;
    let done = false;
    while (!done) {
      if (start + 8000 > PAGE_LIMIT) {
        throw new Error(
          `Strip at y=${yLow} has more than ${PAGE_LIMIT} squares; make STRIP smaller`,
        );
      }
      const starts = Array.from({ length: 8 }, (_, k) => start + k * 1000);
      const pages = await Promise.all(starts.map((s) => page(yLow, s)));
      for (const features of pages) {
        if (features.length < 1000) done = true;
        rows += features.length;
        for (const f of features) {
          const count = f.properties.aantalInwoners;
          if (count > 0) result[f.properties.crs28992res500m] = count;
        }
      }
      start += 8000;
    }
    console.log(`    strip y=${yLow / 1000} km done, ${rows} rows so far`);
  }

  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(file, JSON.stringify(result));
  return new Map(Object.entries(result));
}

async function loadRivers() {
  const base =
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
  const lines = [];
  for (const name of [
    "ne_10m_rivers_lake_centerlines.geojson",
    "ne_10m_rivers_europe.geojson",
  ]) {
    let json;
    try {
      json = JSON.parse(await cached(name, base + name));
    } catch (error) {
      console.warn(`  skipped ${name}: ${error.message}`);
      continue;
    }
    for (const f of json.features) {
      const g = f.geometry;
      if (!g) continue;
      const parts =
        g.type === "LineString"
          ? [g.coordinates]
          : g.type === "MultiLineString"
            ? g.coordinates
            : [];
      for (const part of parts) {
        const near = part.some(
          ([lon, lat]) => lon > 2.5 && lon < 8 && lat > 50.2 && lat < 54,
        );
        if (near) lines.push(part.map(([lon, lat]) => toRD(lat, lon)));
      }
    }
  }
  return lines;
}

/**
 * Dots that draw the land on the globe, like a halftone print: rows of
 * points at even spacing, every other row shifted half a step, kept where
 * they fall on land. `step` is the spacing in degrees of latitude.
 *
 * Dots under the voxel model are included too. The map hides the ones the
 * model covers, which depends on how far the model's edge is faded.
 */
function landDots(atlasFile, { step, latMin, latMax, lonMin, lonMax }) {
  const topo = require(atlasFile);
  const land = feature(topo, topo.objects.land);
  // These outlines are drawn for a sphere: Russia and Fiji cross the 180°
  // meridian and Antarctica wraps the pole. A flat point-in-polygon test
  // gets whole rows of latitude wrong there, so test on the sphere.
  const polygons = (land.type === "FeatureCollection" ? land.features : [land])
    .flatMap((f) => polygonsOf(f.geometry))
    .map((coordinates) => {
      const polygon = { type: "Polygon", coordinates };
      const [[west, south], [east, north]] = geoBounds(polygon);
      return { polygon, west, south, east, north };
    });
  const near = (p, lon, lat) =>
    lat >= p.south &&
    lat <= p.north &&
    (p.west <= p.east
      ? lon >= p.west && lon <= p.east
      : lon >= p.west || lon <= p.east);

  const out = [];
  let row = 0;
  for (let lat = latMin + step / 2; lat < latMax; lat += step * 0.866, row++) {
    const ideal = step / Math.cos((lat * Math.PI) / 180);
    const columns = Math.max(1, Math.round((lonMax - lonMin) / ideal));
    const lonStep = (lonMax - lonMin) / columns;
    for (let k = 0; k < columns; k++) {
      const lon = lonMin + (k + (row % 2 ? 0.75 : 0.25)) * lonStep;
      for (const p of polygons) {
        if (near(p, lon, lat) && geoContains(p.polygon, [lon, lat])) {
          out.push(Math.round(lon * 100), Math.round(lat * 100));
          break;
        }
      }
    }
  }
  return Int16Array.from(out);
}

// -------------------------------------------------------------------- main --
async function main() {
  checkRD();
  await fs.mkdir(CACHE, { recursive: true });

  const flags = new Uint8Array(N);
  const elevation = new Int16Array(N);
  const population = new Uint8Array(N);

  console.log("Provinces (CBS via PDOK)");
  const provinces = await loadProvinces();
  provinces.forEach((province, index) => {
    rasterize(province.polygons, (i, j) => {
      flags[j * W + i] = (KIND_NL << 4) | (index + 1);
    });
  });

  console.log("Neighbouring countries (Natural Earth)");
  const { foreign, dutch } = loadNeighbours();
  const inNaturalEarthNL = new Uint8Array(N);
  rasterize(dutch, (i, j) => {
    inNaturalEarthNL[j * W + i] = 1;
  });
  for (const rings of foreign) {
    rasterize([rings], (i, j) => {
      const c = j * W + i;
      if (flags[c] === 0) flags[c] = KIND_FOREIGN << 4;
    });
  }

  // Natural Earth and CBS draw the border slightly differently. That leaves
  // thin strips that Natural Earth calls Dutch and CBS does not, which would
  // otherwise show up as a moat along the border. Hand those to the
  // neighbour, working outwards a few cells from foreign land. Strips far
  // from any neighbour stay water: those are the IJsselmeer and friends.
  {
    let frontier = [];
    for (let c = 0; c < N; c++) {
      if (kindOf(flags[c]) === KIND_FOREIGN) frontier.push(c);
    }
    for (let step = 0; step < 8 && frontier.length; step++) {
      const nextFrontier = [];
      for (const c of frontier) {
        const i = c % W;
        const j = (c - i) / W;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          if (flags[n] === 0 && inNaturalEarthNL[n]) {
            flags[n] = KIND_FOREIGN << 4;
            nextFrontier.push(n);
          }
        }
      }
      frontier = nextFrontier;
    }
  }

  console.log(`Population (CBS 500 m squares, ${POP_YEAR})`);
  const squares = await loadPopulation();
  let peopleTotal = 0;
  let peoplePlaced = 0;
  let densest = 0;
  for (const [id, count] of squares) {
    const match = /^E(\d+)N(\d+)$/.exec(id);
    if (!match) continue;
    peopleTotal += count;
    const i = (Number(match[1]) * 100 - X_MIN) / CELL;
    const j = (Y_MAX - Number(match[2]) * 100) / CELL - 1;
    if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
    if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const c = j * W + i;
    if (kindOf(flags[c]) === KIND_FOREIGN) continue;
    if (kindOf(flags[c]) === KIND_WATER) {
      // The generalised coastline cuts off squares where people do live
      // (harbour districts, new land). If Dutch land is right next door,
      // the square is land too and joins that province.
      let province = 0;
      for (let reach = 1; reach <= 3 && !province; reach++) {
        for (let dj = -reach; dj <= reach && !province; dj++) {
          for (let di = -reach; di <= reach && !province; di++) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
            const n = flags[nj * W + ni];
            if (kindOf(n) === KIND_NL) province = n & 0x0f;
          }
        }
      }
      if (!province) continue;
      flags[c] = (KIND_NL << 4) | province;
    }
    peoplePlaced += count;
    if (count > densest) densest = count;
    // sqrt keeps detail at the low end; 3 * sqrt(7000) still fits a byte.
    population[c] = Math.min(255, Math.round(Math.sqrt(count) * 3));
  }

  console.log("Rivers (Natural Earth)");
  const rivers = await loadRivers();
  for (const line of rivers) {
    for (let k = 0; k < line.length - 1; k++) {
      const [x1, y1] = line[k];
      const [x2, y2] = line[k + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 200));
      for (let s = 0; s <= steps; s++) {
        const x = x1 + ((x2 - x1) * s) / steps;
        const y = y1 + ((y2 - y1) * s) / steps;
        const i = Math.floor((x - X_MIN) / CELL);
        const j = Math.floor((Y_MAX - y) / CELL);
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const c = j * W + i;
        if (kindOf(flags[c]) === KIND_NL && !population[c]) flags[c] |= RIVER_BIT;
      }
    }
  }

  console.log("Elevation (AHN via PDOK, terrain tiles abroad)");
  const ahn = await loadAhn();
  const tileElevation = await loadElevationSampler();
  const offsets = [-CELL / 3, 0, CELL / 3];
  const fromTiles = (i, j) => {
    let sum = 0;
    for (const dx of offsets) {
      for (const dy of offsets) {
        const [lat, lon] = fromRD(cellX(i) + dx, cellY(j) + dy);
        sum += tileElevation(lat, lon);
      }
    }
    return sum / 9;
  };

  // A cell needs this share of valid lidar samples to count as dry land.
  const LAND_SHARE = 0.6;
  const unknown = [];
  let fromAhn = 0;
  let fallback = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      const kind = kindOf(flags[c]);
      if (kind === KIND_WATER) continue;
      if (kind === KIND_FOREIGN || !ahn.inside(i, j)) {
        // The tiles carry seabed depths; land never goes far below NAP.
        elevation[c] = Math.round(Math.max(-7, fromTiles(i, j)) * 10);
        if (kind === KIND_NL) fallback++;
        continue;
      }
      const valid = ahn.counts[c];
      const mostlyWater = valid < ahn.perCell * LAND_SHARE;
      if (mostlyWater && !population[c]) flags[c] |= RIVER_BIT;
      if (valid) {
        elevation[c] = Math.round(ahn.median[c] * 10);
        fromAhn++;
      } else {
        unknown.push(c);
      }
    }
  }
  // Cells with no lidar return at all are open water in the middle of a lake.
  // Give them the level of the nearest cell that does have a height.
  {
    const known = new Uint8Array(N);
    for (let c = 0; c < N; c++) known[c] = kindOf(flags[c]) !== KIND_WATER ? 1 : 0;
    for (const c of unknown) known[c] = 0;
    let pending = unknown;
    for (let pass = 0; pass < 200 && pending.length; pass++) {
      const filled = [];
      const still = [];
      for (const c of pending) {
        const i = c % W;
        const j = (c - i) / W;
        let sum = 0;
        let n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const neighbour = nj * W + ni;
          if (known[neighbour] && kindOf(flags[neighbour]) === KIND_NL) {
            sum += elevation[neighbour];
            n++;
          }
        }
        if (n) filled.push([c, Math.round(sum / n)]);
        else still.push(c);
      }
      for (const [c, value] of filled) {
        elevation[c] = value;
        known[c] = 1;
      }
      pending = still;
    }
  }
  console.log(
    `  ${fromAhn} cells from AHN, ${fallback} Dutch cells from tiles, ${unknown.length} filled from neighbours`,
  );

  // ---- summary numbers, also a sanity check on the inputs
  let landCells = 0;
  let waterCells = 0;
  let belowNap = 0;
  let lowest = { dm: Infinity, c: -1 };
  let highest = { dm: -Infinity, c: -1 };
  const sums = provinces.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let c = 0; c < N; c++) {
    if (kindOf(flags[c]) !== KIND_NL) continue;
    const p = (flags[c] & 0x0f) - 1;
    const i = c % W;
    sums[p].x += cellX(i);
    sums[p].y += cellY((c - i) / W);
    sums[p].n++;
    if (flags[c] & RIVER_BIT) {
      waterCells++;
      continue;
    }
    landCells++;
    if (elevation[c] < 0) belowNap++;
    if (elevation[c] < lowest.dm) lowest = { dm: elevation[c], c };
    if (elevation[c] > highest.dm) highest = { dm: elevation[c], c };
  }
  const describe = ({ dm, c }) => {
    const i = c % W;
    const j = (c - i) / W;
    const [lat, lon] = fromRD(cellX(i), cellY(j));
    return {
      metres: dm / 10,
      lat: +lat.toFixed(4),
      lon: +lon.toFixed(4),
      province: provinces[(flags[c] & 0x0f) - 1].name,
    };
  };

  const meta = {
    cell: CELL,
    xMin: X_MIN,
    yMax: Y_MAX,
    width: W,
    height: H,
    provinces: provinces.map((p, k) => ({
      name: p.name,
      code: p.code,
      x: Math.round(sums[k].x / sums[k].n),
      y: Math.round(sums[k].y / sums[k].n),
      landKm2: Math.round(sums[k].n * 0.25),
    })),
    stats: {
      landKm2: Math.round(landCells * 0.25),
      inlandWaterKm2: Math.round(waterCells * 0.25),
      shareBelowNap: +(belowNap / landCells).toFixed(3),
      lowest: describe(lowest),
      highest: describe(highest),
      population: peopleTotal,
      populationOnGrid: peoplePlaced,
      densestSquare: densest,
      populationYear: POP_YEAR,
      provinceYear: PROVINCE_YEAR,
    },
    generated: new Date().toISOString().slice(0, 10),
  };

  // ---- write
  const raw = Buffer.concat([
    Buffer.from(elevation.buffer),
    Buffer.from(flags.buffer),
    Buffer.from(population.buffer),
  ]);
  const packed = zlib.gzipSync(raw, { level: 9 });
  await fs.mkdir(path.join(ROOT, "public/data"), { recursive: true });
  await fs.mkdir(path.join(ROOT, "src/data"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "public/data/nl-grid.dat"), packed);
  await fs.writeFile(
    path.join(ROOT, "src/data/grid-meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  );

  // Two sets of dots: coarse ones for the whole world, fine ones for Europe
  // that take over as the camera comes closer. The file is a count of
  // world dots (Int32), then the world dots, then the Europe dots.
  const worldDots = landDots("world-atlas/land-110m.json", {
    step: 0.9,
    latMin: -86,
    latMax: 86,
    lonMin: -180,
    lonMax: 180,
  });
  // The fine dots are only shown from closer than about 3,000 km, so they
  // only need to cover what the camera can see from there.
  const europeDots = landDots("world-atlas/land-50m.json", {
    step: 0.13,
    latMin: 39,
    latMax: 65,
    lonMin: -15,
    lonMax: 27,
  });
  await fs.writeFile(
    path.join(ROOT, "public/data/globe-land.bin"),
    Buffer.concat([
      Buffer.from(Int32Array.of(worldDots.length / 2).buffer),
      Buffer.from(worldDots.buffer),
      Buffer.from(europeDots.buffer),
    ]),
  );

  // ---- preview picture
  const png = new PNG({ width: W, height: H });
  for (let c = 0; c < N; c++) {
    const kind = kindOf(flags[c]);
    let rgb = [18, 30, 44];
    if (kind === KIND_FOREIGN) rgb = [58, 62, 66];
    if (kind === KIND_NL) {
      const m = elevation[c] / 10;
      if (flags[c] & RIVER_BIT) rgb = [90, 200, 235];
      else if (m < 0) rgb = [40, 90 + Math.max(-60, m * 10), 170];
      else {
        const t = Math.min(1, m / 60);
        rgb = [90 + 120 * t, 160 - 40 * t, 70];
      }
      if (population[c]) {
        const p = Math.min(1, population[c] / 160);
        rgb = [
          rgb[0] + (255 - rgb[0]) * p,
          rgb[1] * (1 - 0.6 * p),
          rgb[2] * (1 - 0.6 * p),
        ];
      }
    }
    png.data.set([rgb[0], rgb[1], rgb[2], 255], c * 4);
  }
  await fs.writeFile(path.join(CACHE, "preview.png"), PNG.sync.write(png));

  console.log("\nDone.");
  console.log(`  grid ${W} x ${H} cells, ${(packed.length / 1024).toFixed(0)} KB gzipped (${(raw.length / 1024).toFixed(0)} KB raw)`);
  console.log(`  globe dots: ${worldDots.length / 2} world, ${europeDots.length / 2} Europe`);
  console.log(`  rivers: ${rivers.length} lines`);
  console.log("  stats:", JSON.stringify(meta.stats, null, 2));

  // Spot checks against places whose height is well known.
  const spots = [
    ["Schiphol (about -3 to -4 m)", 52.3105, 4.7683],
    ["Lelystad (about -4 m)", 52.5185, 5.4714],
    ["Zuidplaspolder (about -6 m)", 51.985, 4.6],
    ["Amersfoort (about +3 m)", 52.1551, 5.3872],
    ["Veluwe, Torenberg (about +100 m)", 52.16, 5.89],
    ["Vaalserberg (322 m)", 50.7546, 6.0208],
    ["IJsselmeer (water)", 52.8, 5.4],
    ["Markermeer (water)", 52.52, 5.2],
    ["Waddenzee (water)", 53.3, 5.5],
    ["Oosterschelde (water)", 51.6, 3.9],
  ];
  for (const [name, lat, lon] of spots) {
    const [x, y] = toRD(lat, lon);
    const i = Math.floor((x - X_MIN) / CELL);
    const j = Math.floor((Y_MAX - y) / CELL);
    const c = j * W + i;
    const kind = ["water", "NL", "foreign"][kindOf(flags[c])];
    console.log(`  ${name}: ${kind}, ${(elevation[c] / 10).toFixed(1)} m`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
