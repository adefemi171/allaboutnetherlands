// A close look at one place in a Sentinel-2 scene.
//
// The archive's preview shows a whole frame, 110 km across, in a few
// hundred pixels: a city is a smudge. The full picture is 10 m to the
// pixel and stored so that a part of it can be fetched on its own (a
// cloud-optimised GeoTIFF), which is what this does.

import type { Scene } from "./types";

/** Side of the close-up, in pixels of 10 m. */
const SIZE = 800;

/** The last few close-ups, so the page and the dialog fetch each one once. */
const KEPT = 6;
const cache = new Map<string, Promise<Closeup>>();

const RAD = Math.PI / 180;

/** WGS84 degrees to metres in a UTM zone, as [easting, northing]. */
function toUtm(lat: number, lon: number, zone: number, south: boolean): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const phi = lat * RAD;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const n = a / Math.sqrt(1 - e2 * sin * sin);
  const t = Math.tan(phi) ** 2;
  const c = ep2 * cos * cos;
  const A = (lon - (zone * 6 - 183)) * RAD * cos;
  const m =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  return [
    500000 +
      k0 * n * (A + ((1 - t + c) * A ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * A ** 5) / 120),
    (south ? 10_000_000 : 0) +
      k0 *
      (m +
        n *
          Math.tan(phi) *
          (A ** 2 / 2 +
            ((5 - t + 9 * c + 4 * c * c) * A ** 4) / 24 +
            ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * A ** 6) / 720)),
  ];
}

export interface Closeup {
  image: ImageData;
  /** Where the place is in the image, in pixels. */
  x: number;
  y: number;
}

/**
 * The part of a scene around a place, at full detail.
 * Fails where the scene has no full picture, or the place lies outside it.
 */
export function closeup(scene: Scene, lat: number, lon: number, side = SIZE): Promise<Closeup> {
  const key = `${scene.id}:${lat}:${lon}:${side}`;
  let job = cache.get(key);
  if (!job) {
    job = read(scene, lat, lon, side);
    cache.set(key, job);
    job.catch(() => cache.delete(key));
    if (cache.size > KEPT) cache.delete(cache.keys().next().value!);
  }
  return job;
}

async function read(scene: Scene, lat: number, lon: number, side: number): Promise<Closeup> {
  // "S2A_31UFT_20261114_0_L2A": the frame is on the grid of UTM zone 31,
  // in latitude band U. Bands before N lie south of the equator.
  const [, zone, band] = /^S2\w_(\d\d)([A-Z])[A-Z]{2}_/.exec(scene.id) ?? [];
  if (!scene.visual || !zone) throw new Error("No full picture for this scene");

  // The reader is large and only wanted here, so it loads on first use.
  const { fromUrl } = await import("geotiff");
  const tiff = await fromUrl(scene.visual);
  const image = await tiff.getImage();
  const [left, top] = image.getOrigin();
  const [scale] = image.getResolution();
  const [easting, northing] = toUtm(lat, lon, Number(zone), band < "N");
  const col = Math.round((easting - left) / scale);
  const row = Math.round((top - northing) / scale);
  const width = image.getWidth();
  const height = image.getHeight();
  if (col < 0 || row < 0 || col >= width || row >= height) {
    throw new Error("The place lies outside this scene");
  }

  // Near an edge the window slides inwards, and the place is off-centre.
  const size = Math.min(side, width, height);
  const x0 = Math.min(width - size, Math.max(0, col - size / 2));
  const y0 = Math.min(height - size, Math.max(0, row - size / 2));
  const rgb = (await image.readRasters({
    window: [x0, y0, x0 + size, y0 + size],
    interleave: true,
  })) as unknown as Uint8Array;

  // The archive's pictures are dark, with all the land in the bottom third
  // of the range. This lifts the shadows and leaves the clouds white.
  const lift = Uint8Array.from({ length: 256 }, (_, v) => Math.min(255, 255 * (v / 255) ** 0.62));
  const pixels = new ImageData(size, size);
  let lit = 0;
  for (let i = 0, o = 0; i < size * size; i++, o += 4) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    pixels.data[o] = lift[r];
    pixels.data[o + 1] = lift[g];
    pixels.data[o + 2] = lift[b];
    pixels.data[o + 3] = 255;
    if (r | g | b) lit++;
  }
  // A frame is a slanted strip of the orbit; outside it there is nothing.
  if (lit < size * size * 0.2) throw new Error("The satellite's strip missed this place");
  return { image: pixels, x: col - x0, y: row - y0 };
}
