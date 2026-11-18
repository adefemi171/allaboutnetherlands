// The 500 m grid behind the map: ground height, what each cell is, and how
// many people live there. Built by scripts/build-map-data.mjs.

import meta from "../data/grid-meta.json";
import { fromRD, rdToWorld, worldToRD } from "./rd";

export const KIND_WATER = 0;
export const KIND_NL = 1;
export const KIND_FOREIGN = 2;
const INLAND_WATER_BIT = 0x40;

export interface CellInfo {
  lat: number;
  lon: number;
  rdX: number;
  rdY: number;
  kind: "sea" | "land" | "water" | "abroad";
  province: string | null;
  /** Metres relative to NAP. Null for the sea and open water. */
  elevation: number | null;
  /** Residents of this 500 m square. CBS rounds to fives. */
  people: number;
}

export class Grid {
  readonly width = meta.width;
  readonly height = meta.height;
  /** Cell size in scene units (kilometres). */
  readonly cell = meta.cell / 1000;
  /** Scene coordinates of the grid's north-west corner. */
  readonly x0: number;
  readonly z0: number;
  readonly meta = meta;

  /** Sorted heights (decimetres) of every dry Dutch cell. */
  private sortedLand: Int16Array;

  constructor(
    /** Decimetres relative to NAP. */
    readonly elevation: Int16Array,
    readonly flags: Uint8Array,
    /** 3 * sqrt(residents), see people(). */
    readonly population: Uint8Array,
  ) {
    [this.x0, this.z0] = rdToWorld(meta.xMin, meta.yMax);
    const land: number[] = [];
    for (let c = 0; c < flags.length; c++) {
      if (this.isDryLand(c)) land.push(elevation[c]);
    }
    this.sortedLand = Int16Array.from(land).sort();
  }

  get size(): number {
    return this.width * this.height;
  }
  get xMax(): number {
    return this.x0 + this.width * this.cell;
  }
  get zMax(): number {
    return this.z0 + this.height * this.cell;
  }

  kind(c: number): number {
    return (this.flags[c] >> 4) & 3;
  }
  isInlandWater(c: number): boolean {
    return (this.flags[c] & INLAND_WATER_BIT) !== 0;
  }
  isDryLand(c: number): boolean {
    return this.kind(c) === KIND_NL && !this.isInlandWater(c);
  }
  province(c: number): string | null {
    const index = this.flags[c] & 0x0f;
    return index ? meta.provinces[index - 1].name : null;
  }
  people(c: number): number {
    const root = this.population[c] / 3;
    return Math.round((root * root) / 5) * 5;
  }

  /** Cell index under a scene position, or -1 outside the grid. */
  cellAt(wx: number, wz: number): number {
    const i = Math.floor((wx - this.x0) / this.cell);
    const j = Math.floor((wz - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.width || j >= this.height) return -1;
    return j * this.width + i;
  }

  /** Scene position of a cell's centre, as [x, z]. */
  cellCentre(c: number): [number, number] {
    const i = c % this.width;
    const j = (c - i) / this.width;
    return [this.x0 + (i + 0.5) * this.cell, this.z0 + (j + 0.5) * this.cell];
  }

  info(c: number): CellInfo {
    const [wx, wz] = this.cellCentre(c);
    const [rdX, rdY] = worldToRD(wx, wz);
    const [lat, lon] = fromRD(rdX, rdY);
    const kind = this.kind(c);
    const dry = this.isDryLand(c);
    return {
      lat,
      lon,
      rdX,
      rdY,
      kind:
        kind === KIND_WATER
          ? "sea"
          : kind === KIND_FOREIGN
            ? "abroad"
            : dry
              ? "land"
              : "water",
      province: this.province(c),
      elevation: dry ? this.elevation[c] / 10 : null,
      people: this.people(c),
    };
  }

  /** Share of Dutch land (0 to 1) lying below a level in metres to NAP. */
  shareBelow(level: number): number {
    const target = level * 10;
    const sorted = this.sortedLand;
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (sorted[mid] < target) low = mid + 1;
      else high = mid;
    }
    return low / sorted.length;
  }

  /** Residents within a radius (km) of a scene position. */
  peopleWithin(wx: number, wz: number, radius: number): number {
    const reach = Math.ceil(radius / this.cell);
    const ci = Math.floor((wx - this.x0) / this.cell);
    const cj = Math.floor((wz - this.z0) / this.cell);
    let total = 0;
    for (let dj = -reach; dj <= reach; dj++) {
      for (let di = -reach; di <= reach; di++) {
        if ((di * di + dj * dj) * this.cell * this.cell > radius * radius) {
          continue;
        }
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.width || j >= this.height) continue;
        const root = this.population[j * this.width + i] / 3;
        total += root * root;
      }
    }
    return total;
  }
}

async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function loadGrid(url: string): Promise<Grid> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load map data (${response.status})`);
  let buffer = await response.arrayBuffer();
  // The file is gzip. Some hosts unpack it on the way; check the magic bytes.
  const head = new Uint8Array(buffer, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) buffer = await gunzip(buffer);

  const n = meta.width * meta.height;
  if (buffer.byteLength !== n * 4) {
    throw new Error("Map data does not match the grid description");
  }
  return new Grid(
    new Int16Array(buffer, 0, n),
    new Uint8Array(buffer, n * 2, n),
    new Uint8Array(buffer, n * 3, n),
  );
}
