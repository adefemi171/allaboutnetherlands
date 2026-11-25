// Builds street-level tiles off the main thread: downloads the data for one
// tile, turns it into triangles, and hands the arrays back.
//
// A tile has two parts that load separately. "ground" is everything flat:
// land use, water, roads and railways, plus the names found on them and
// the trees. "buildings" is the blocks that stand on it.

import {
  VectorTile,
  classifyRings,
  type VectorTileFeature,
} from "@mapbox/vector-tile";
import earcut from "earcut";
import { PbfReader } from "pbf";
import {
  SURFACE,
  TILE_KM,
  buildingsUrl,
  groundUrl,
  tileBounds,
  type GroundMesh,
  type MoverKey,
  type RouteLines,
  type SolidMesh,
  type StreetLabel,
  type StreetRequest,
  type StreetResponse,
} from "./street-tiles";
import {
  BUILDING_ERAS,
  BUILDING_UNDATED,
  STREET,
  hash,
  hex,
  type RGB,
} from "./style";

type Properties = Record<string, number | string | boolean>;
/** A ring or a line as x, z, x, z ... in km from the tile corner. */
type Path = number[];

const M = 0.001; // one metre in scene units

// ------------------------------------------------------------- geometry --

/** Twice the signed area of a closed path. Positive is counter-clockwise. */
function area2(path: Path): number {
  let sum = 0;
  for (let i = 0, n = path.length; i < n; i += 2) {
    const j = (i + 2) % n;
    sum += path[i] * path[j + 1] - path[j] * path[i + 1];
  }
  return sum;
}

function length(path: Path): number {
  let sum = 0;
  for (let i = 2; i < path.length; i += 2) {
    sum += Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]);
  }
  return sum;
}

/** Drop repeated points, and the closing point of a ring. */
function tidy(path: Path, closed: boolean, tolerance = 0.05 * M): Path {
  const out: Path = [];
  for (let i = 0; i < path.length; i += 2) {
    const n = out.length;
    if (
      n &&
      Math.abs(path[i] - out[n - 2]) < tolerance &&
      Math.abs(path[i + 1] - out[n - 1]) < tolerance
    ) {
      continue;
    }
    out.push(path[i], path[i + 1]);
  }
  if (
    closed &&
    out.length > 4 &&
    Math.abs(out[0] - out[out.length - 2]) < tolerance &&
    Math.abs(out[1] - out[out.length - 1]) < tolerance
  ) {
    out.length -= 2;
  }
  return out;
}

/** The point halfway along a line, and the direction of the line there. */
function midpoint(path: Path): [x: number, z: number, angle: number] {
  const half = length(path) / 2;
  let walked = 0;
  for (let i = 2; i < path.length; i += 2) {
    const dx = path[i] - path[i - 2];
    const dz = path[i + 1] - path[i - 1];
    const step = Math.hypot(dx, dz);
    if (walked + step >= half && step > 0) {
      const t = (half - walked) / step;
      return [path[i - 2] + dx * t, path[i - 1] + dz * t, Math.atan2(dz, dx)];
    }
    walked += step;
  }
  return [path[0], path[1], 0];
}

/** A polygon cut into triangles: its points, and three indices for each. */
function triangulate(rings: Path[]): { flat: number[]; triangles: number[] } {
  const flat: number[] = [];
  const holes: number[] = [];
  rings.forEach((ring, k) => {
    if (ring.length < 6) return;
    if (k) holes.push(flat.length / 2);
    for (const value of ring) flat.push(value);
  });
  return { flat, triangles: earcut(flat, holes, 2) };
}

/** Size of a polygon, by its outline. */
function areaOf(rings: Path[]): number {
  return Math.abs(area2(rings[0])) / 2;
}

/** The largest of the polygons of a feature. */
function largest(polygons: Path[][]): { size: number; rings: Path[] } | null {
  let best: { size: number; rings: Path[] } | null = null;
  for (const rings of polygons) {
    const size = areaOf(rings);
    if (!best || size > best.size) best = { size, rings };
  }
  return best;
}

/**
 * Visit points at regular steps along a line: where each is, and the
 * direction of the line there.
 */
function alongPath(
  path: Path,
  first: number,
  step: number,
  visit: (x: number, z: number, dx: number, dz: number) => void,
): void {
  let next = first;
  let walked = 0;
  for (let i = 2; i < path.length; i += 2) {
    const dx = path[i] - path[i - 2];
    const dz = path[i + 1] - path[i - 1];
    const span = Math.hypot(dx, dz);
    while (span > 0 && next <= walked + span) {
      const t = (next - walked) / span;
      visit(path[i - 2] + dx * t, path[i - 1] + dz * t, dx / span, dz / span);
      next += step;
    }
    walked += span;
  }
}

/** A point that is certainly inside a polygon: the middle of its largest triangle. */
function interior(rings: Path[]): [x: number, z: number] | null {
  const { flat, triangles } = triangulate(rings);
  let best = 0;
  let point: [number, number] | null = null;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * 2;
    const b = triangles[i + 1] * 2;
    const c = triangles[i + 2] * 2;
    const size = Math.abs(
      (flat[b] - flat[a]) * (flat[c + 1] - flat[a + 1]) -
        (flat[c] - flat[a]) * (flat[b + 1] - flat[a + 1]),
    );
    if (size > best) {
      best = size;
      point = [
        (flat[a] + flat[b] + flat[c]) / 3,
        (flat[a + 1] + flat[b + 1] + flat[c + 1]) / 3,
      ];
    }
  }
  return point;
}

/** Everything that lies flat. Triangles are drawn in the order they are added. */
class Flat {
  private positions: number[] = [];
  private colours: number[] = [];
  private indices: number[] = [];
  private count = 0;

  private vertex(x: number, z: number, colour: RGB, surface: number): void {
    this.positions.push(x, z);
    this.colours.push(colour[0], colour[1], colour[2], surface);
    this.count++;
  }

  polygon(rings: Path[], colour: RGB, surface: number): void {
    const { flat, triangles } = triangulate(rings);
    if (!triangles.length) return;
    const base = this.count;
    for (let i = 0; i < flat.length; i += 2) {
      this.vertex(flat[i], flat[i + 1], colour, surface);
    }
    for (const index of triangles) this.indices.push(base + index);
  }

  /** A line drawn with a width, mitred at the bends. */
  ribbon(line: Path, half: number, colour: RGB, surface: number): void {
    const n = line.length / 2;
    if (n < 2) return;
    const base = this.count;
    for (let i = 0; i < n; i++) {
      const x = line[i * 2];
      const z = line[i * 2 + 1];
      let ax = 0;
      let az = 0;
      let bx = 0;
      let bz = 0;
      if (i > 0) {
        ax = x - line[i * 2 - 2];
        az = z - line[i * 2 - 1];
        const l = Math.hypot(ax, az) || 1;
        ax /= l;
        az /= l;
      }
      if (i < n - 1) {
        bx = line[i * 2 + 2] - x;
        bz = line[i * 2 + 3] - z;
        const l = Math.hypot(bx, bz) || 1;
        bx /= l;
        bz /= l;
      }
      if (i === 0) [ax, az] = [bx, bz];
      if (i === n - 1) [bx, bz] = [ax, az];
      let nx = -(az + bz);
      let nz = ax + bx;
      const l = Math.hypot(nx, nz);
      let reach = half;
      if (l < 1e-6) {
        nx = -az;
        nz = ax;
      } else {
        nx /= l;
        nz /= l;
        // Wider at a bend so the edges stay parallel, within reason.
        reach = half / Math.max(0.5, nx * -az + nz * ax);
      }
      this.vertex(x + nx * reach, z + nz * reach, colour, surface);
      this.vertex(x - nx * reach, z - nz * reach, colour, surface);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      this.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  finish(): GroundMesh | null {
    if (!this.indices.length) return null;
    return {
      positions: new Float32Array(this.positions),
      colours: new Uint8Array(this.colours),
      indices: new Uint32Array(this.indices),
    };
  }
}

/** Everything that stands up. */
class Solid {
  private positions: number[] = [];
  private normals: number[] = [];
  private colours: number[] = [];
  private along: number[] = [];
  private indices: number[] = [];
  private count = 0;

  private vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    colour: RGB,
    windows: number,
    along: number,
  ): void {
    this.positions.push(x, y, z);
    this.normals.push(
      Math.round(nx * 127),
      Math.round(ny * 127),
      Math.round(nz * 127),
    );
    this.colours.push(colour[0], colour[1], colour[2], windows);
    this.along.push(along);
    this.count++;
  }

  /** An upright rectangle from a to b. */
  private wall(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    y0: number,
    y1: number,
    nx: number,
    nz: number,
    colour: RGB,
    windows: number,
    s0: number,
    s1: number,
  ): void {
    const base = this.count;
    this.vertex(ax, y0, az, nx, 0, nz, colour, windows, s0);
    this.vertex(bx, y0, bz, nx, 0, nz, colour, windows, s1);
    this.vertex(bx, y1, bz, nx, 0, nz, colour, windows, s1);
    this.vertex(ax, y1, az, nx, 0, nz, colour, windows, s0);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A footprint pulled up to a height: walls all round and a flat roof. */
  prism(rings: Path[], height: number, wall: RGB, roof: RGB, windows: number): void {
    rings.forEach((ring, k) => {
      if (ring.length < 6) return;
      // Walls face away from the building: outwards on the outline,
      // into the courtyard on a hole.
      const outward = (area2(ring) > 0 ? 1 : -1) * (k === 0 ? 1 : -1);
      let walked = 0;
      for (let i = 0, n = ring.length; i < n; i += 2) {
        const j = (i + 2) % n;
        const dx = ring[j] - ring[i];
        const dz = ring[j + 1] - ring[i + 1];
        const step = Math.hypot(dx, dz);
        if (step < 1e-7) continue;
        this.wall(
          ring[i],
          ring[i + 1],
          ring[j],
          ring[j + 1],
          0,
          height,
          (dz / step) * outward,
          (-dx / step) * outward,
          wall,
          windows,
          walked / M,
          (walked + step) / M,
        );
        walked += step;
      }
    });
    const { flat, triangles } = triangulate(rings);
    const base = this.count;
    for (let i = 0; i < flat.length; i += 2) {
      this.vertex(flat[i], height, flat[i + 1], 0, 1, 0, roof, 0, 0);
    }
    for (const index of triangles) this.indices.push(base + index);
  }

  /** A box standing on a square, without a bottom. */
  box(cx: number, cz: number, half: number, y0: number, y1: number, colour: RGB): void {
    const x0 = cx - half;
    const x1 = cx + half;
    const z0 = cz - half;
    const z1 = cz + half;
    this.wall(x0, z0, x1, z0, y0, y1, 0, -1, colour, 0, 0, 0);
    this.wall(x1, z0, x1, z1, y0, y1, 1, 0, colour, 0, 0, 0);
    this.wall(x1, z1, x0, z1, y0, y1, 0, 1, colour, 0, 0, 0);
    this.wall(x0, z1, x0, z0, y0, y1, -1, 0, colour, 0, 0, 0);
    const base = this.count;
    this.vertex(x0, y1, z0, 0, 1, 0, colour, 0, 0);
    this.vertex(x1, y1, z0, 0, 1, 0, colour, 0, 0);
    this.vertex(x1, y1, z1, 0, 1, 0, colour, 0, 0);
    this.vertex(x0, y1, z1, 0, 1, 0, colour, 0, 0);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  finish(): SolidMesh | null {
    if (!this.indices.length) return null;
    return {
      positions: new Float32Array(this.positions),
      normals: new Int8Array(this.normals),
      colours: new Uint8Array(this.colours),
      along: new Float32Array(this.along),
      indices: new Uint32Array(this.indices),
    };
  }
}

// --------------------------------------------------------------- ground --

const { leaves, roofTile, roofFlat, ...plain } = STREET;
const C = Object.fromEntries(
  Object.entries(plain).map(([name, colour]) => [name, hex(colour)]),
) as Record<keyof typeof plain, RGB>;
const LEAVES = leaves.map(hex);
const ROOF_TILE = roofTile.map(hex);
const ROOF_FLAT = roofFlat.map(hex);
const ERAS = BUILDING_ERAS.map((era) => ({
  until: era.until,
  walls: era.walls.map(hex),
}));
const UNDATED = BUILDING_UNDATED.map(hex);

/** TOP10NL joins several values with a bar or a comma where features were merged. */
function values(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  return value.split(/[|,]/).map((part) => part.trim()).filter(Boolean);
}
function first(value: unknown): string {
  return values(value)[0] ?? "";
}

function landColour(use: string): RGB {
  if (use === "bebouwd gebied") return C.built;
  if (use === "grasland") return C.grass;
  if (use === "akkerland") return C.field;
  if (use.startsWith("bos: naald")) return C.conifer;
  if (use.startsWith("bos") || use === "populieren") return C.wood;
  if (use === "boomgaard" || use === "boomkwekerij" || use === "fruitkwekerij") {
    return C.orchard;
  }
  if (use === "heide") return C.heath;
  if (use === "zand" || use === "duin") return C.sand;
  if (use === "dodenakker" || use === "dodenakker met bos") return C.cemetery;
  if (use === "braakliggend") return C.fallow;
  if (use === "spoorbaanlichaam") return C.railbed;
  if (use === "aanlegsteiger") return C.jetty;
  if (use.startsWith("basaltblokken")) return C.stone;
  return C.other;
}

/** Colour of a road, and how far up the pile it is drawn. */
function roadStyle(p: Properties): [colour: RGB, rank: number] {
  const uses = values(p.hoofdverkeersgebruik);
  const types = values(p.typeweg);
  const has = (type: string) => types.includes(type);
  // Where a road and a path were merged, the road wins.
  if (has("autosnelweg")) return [C.motorway, 49];
  if (has("hoofdweg")) return [C.main, 48];
  if (has("regionale weg")) return [C.regional, 47];
  if (has("lokale weg")) return [C.local, 46];
  if (types.some((type) => type.startsWith("startbaan") || type.startsWith("rolbaan"))) {
    return [C.runway, 44];
  }
  if (uses.length && uses.every((use) => use.startsWith("fietsers"))) return [C.cycle, 42];
  if (uses.length && uses.every((use) => use === "voetgangers")) return [C.foot, 40];
  if (uses.length && uses.every((use) => use === "busverkeer")) return [C.bus, 45];
  if (p.verhardingstype === "onverhard") return [C.dirt, 40];
  if (p.verhardingstype === "half verhard") return [C.gravel, 40];
  if (has("straat")) return [C.street, 45];
  if (types.some((type) => type.startsWith("parkeerplaats"))) return [C.parking, 43];
  return [C.otherRoad, 41];
}

/** Buildings worth a name on the map, most important first. */
const NOTABLE: [match: RegExp, kind: StreetLabel["kind"], rank: number, reach: number, fallback: string][] = [
  [/gemeentehuis/, "civic", 10, 4.4, "Town hall"],
  [/ziekenhuis/, "building", 15, 3, "Ziekenhuis"],
  [/museum|kasteel|paleis|stadion|vuurtoren/, "building", 16, 2.4, ""],
  [/windmolen|watermolen|klokkentoren|toren/, "building", 17, 2, ""],
  [/kerk|moskee|synagoge|kapel/, "building", 22, 1.4, ""],
];
/** A university or a university of applied sciences, by its name. */
const HIGHER = /universiteit|university|hogeschool/i;
/** Names that say what a building is for, preferred over its other names. */
const TELLING = /museum|paleis|kasteel|theater|station|bibliotheek/i;

/** Named grounds: campuses, parks, zoos. Anything not listed gets the last entry. */
const GROUNDS: [match: RegExp, rank: number, reach: number][] = [
  [/campus/, 14.5, 4.4],
  [/dierentuin|attractiepark|openluchtmuseum|botanische tuin/, 16.5, 3.4],
  [/nationaal park|natuurgebied|landgoed|recreatiegebied/, 19.3, 4.4],
  [/^park$|verdedigingswerk|gebouwencomplex/, 19.1, 2.6],
  [/bedrijventerrein|haven|vliegveld/, 21.5, 3],
  [/./, 23.6, 1.3],
];
/** Grounds whose name adds nothing, or is on the map already. */
const NO_GROUNDS = /waterkering|ziekenhuiscomplex|helikopter|sluizencomplex|parkeerterrein/;

/** Where something keeps to on a route (km from the centre line), and how busy it is. */
type RouteStyle = [offset: number, weight: number] | null;

/** What matters about a road that is in use, at ground level and in the open. */
interface Road {
  type: string;
  types: string[];
  uses: string[];
  /** "<", "4" or ">" for the narrow, middling and wide classes; "" if unknown. */
  width: string;
  mixed: boolean;
}

function inUse(p: Properties): boolean {
  return (
    String(p.status ?? "in gebruik") === "in gebruik" &&
    !String(p.fysiekvoorkomen ?? "").includes("tunnel")
  );
}

function openRoad(p: Properties, pilot = false): Road | null {
  if (pilot) {
    if (String(p.status ?? "in gebruik") !== "in gebruik") return null;
  } else if (!inUse(p) || (Number(p.hoogteniveau) || 0) !== 0) return null;
  const types = values(p.typeweg);
  const uses = values(p.hoofdverkeersgebruik);
  if (!uses.length || types.includes("autosnelweg")) return null;
  return {
    type: types[0] ?? "",
    types,
    uses,
    width: String(p.verhardingsbreedteklasse ?? "").charAt(0),
    mixed: uses.includes("gemengd verkeer"),
  };
}

/** Half the width of a carriageway in metres, for each width class. */
function half(road: Road, narrow: number, middling: number, wide: number, unknown: number): number {
  return road.width === "<" ? narrow : road.width === "4" ? middling : road.width === ">" ? wide : unknown;
}

const onFoot = (use: string) => use === "voetgangers";

/** People keep to the side of a street, and to the middle of a footpath. */
function walkStyle(p: Properties): RouteStyle {
  const road = openRoad(p);
  if (!road || road.types.includes("hoofdweg")) return null;
  if (road.uses.every(onFoot)) {
    return [0.4 * M, p.verhardingstype === "onverhard" ? 0.7 : 2.4];
  }
  if (!road.mixed) return null;
  // Half the carriageway, and a step onto the pavement.
  const edge = half(road, 1, 2.8, 4.6, 1.6);
  if (road.type === "straat") return [(edge + 1.2) * M, 1];
  if (road.type === "lokale weg") return [(edge + 1.4) * M, 0.55];
  if (road.type === "regionale weg") return [(edge + 1.8) * M, 0.5];
  return [(edge + 0.8) * M, 0.35];
}

/** Cars drive in their lane on streets that take traffic. */
function driveStyle(p: Properties, pilot = false): RouteStyle {
  const road = openRoad(p, pilot);
  if (!road) return null;
  if (!road.mixed && (pilot || !road.uses.some((use) => use.includes("bus")))) return null;
  // In the pilot a negative weight keeps the source direction of a
  // separately mapped carriageway or roundabout arc.
  const direction = pilot && (p.gescheidenrijbaan === "ja" || String(p.fysiekvoorkomen ?? "").includes("rotonde")) ? -1 : 1;
  const lane = half(road, 1.1, 1.6, 2.4, 1.1);
  if (road.type === "straat") return [lane * M, direction * 1.25];
  if (road.type === "lokale weg") return [lane * M, direction];
  if (road.type === "regionale weg" || road.type === "hoofdweg") return [(lane + 0.4) * M, direction * 0.85];
  // Unknown type but mixed traffic: still driveable.
  return road.mixed ? [lane * M, direction * 0.55] : null;
}

/** Trains and trams run on rails at ground level and on bridges. */
function railStyle(p: Properties, pilot = false): RouteStyle {
  if (pilot) {
    if (String(p.status ?? "in gebruik") !== "in gebruik") return null;
  } else if (!inUse(p) || (Number(p.hoogteniveau) || 0) < 0) return null;
  const kind = String(p.typespoorbaan ?? "");
  return [0, kind === "tram" ? 0.7 : kind === "metro" ? 0.5 : 1.3];
}

/**
 * Cyclists ride the cycle paths first, then the kerb side of ordinary
 * streets, between the cars and the pavement.
 */
function cycleStyle(p: Properties, pilot = false): RouteStyle {
  const road = openRoad(p, pilot);
  if (!road || road.uses.every(onFoot)) return null;
  const bike = road.uses.some((use) => use.startsWith("fietsers") || use === "bromfietsers");
  // Red asphalt, or a shared bike and moped path: ride the middle.
  if (bike && !road.mixed) return [0.25 * M, 2.6];
  if (!road.mixed) return null;
  const edge = half(road, 1, 2, 3.2, 1.2);
  if (road.type === "straat") return [(edge + 0.35) * M, 1.7];
  if (road.type === "lokale weg") return [(edge + 0.45) * M, 1.15];
  if (road.type === "regionale weg") return [(edge + 0.6) * M, 0.75];
  return [(edge + 0.25) * M, 1];
}

/** Which centre lines each kind of traffic follows, and the shortest worth having. */
const ROUTES: Record<MoverKey, [layer: string, style: (p: Properties, pilot?: boolean) => RouteStyle, minLength: number]> = {
  walks: ["wegdeel_hartlijn", walkStyle, 4 * M],
  cycles: ["wegdeel_hartlijn", cycleStyle, 6 * M],
  drives: ["wegdeel_hartlijn", driveStyle, 8 * M],
  rails: ["spoorbaandeel_lijn", railStyle, 20 * M],
};

/**
 * Street lamps stand along the streets that take traffic: how far from the
 * centre line (km), and how far apart.
 */
function lampStyle(p: Properties): [offset: number, spacing: number] | null {
  const road = openRoad(p);
  if (!road || !road.mixed || p.verhardingstype === "onverhard") return null;
  const edge = half(road, 1.4, 2.8, 4.6, 1.8) + 0.7;
  if (road.type === "straat") return [edge * M, 30 * M];
  if (road.type === "lokale weg" || road.type === "regionale weg" || road.type === "hoofdweg") {
    return [edge * M, 42 * M];
  }
  return null;
}
/** More than this in one tile would be a forest of posts. */
const MAX_LAMPS = 700;

type Visit = (p: Properties, feature: VectorTileFeature, paths: () => Path[]) => void;

interface Item {
  order: number;
  draw: () => void;
}

export async function buildGround(
  col: number,
  row: number,
  signal: AbortSignal,
  pilot = false,
): Promise<Extract<StreetResponse, { part: "ground" }>> {
  const empty = {
    id: 0,
    ok: true as const,
    part: "ground" as const,
    ground: null,
    trees: null,
    labels: [],
    routes: { walks: null, cycles: null, drives: null, rails: null },
    lamps: null,
  };
  const response = await fetch(groundUrl(col, row), { signal });
  // PDOK answers 204 for a tile with nothing in it, such as open sea.
  if (response.status === 204 || response.status === 404) return empty;
  if (!response.ok) throw new Error(`Ground tile: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) return empty;
  const tile = new VectorTile(new PbfReader(bytes));

  const flat = new Flat();
  const trees = new Solid();
  const labels: StreetLabel[] = [];
  const items: Item[] = [];
  const inTile = (x: number, z: number) =>
    x >= 0 && x < TILE_KM && z >= 0 && z < TILE_KM;

  /** Visit a layer. Geometry arrives already converted to km. */
  const each = (name: string, visit: Visit) => {
    const layer = tile.layers[name];
    if (!layer) return;
    const k = TILE_KM / layer.extent;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      visit(feature.properties, feature, () =>
        feature.loadGeometry().map((points) => {
          const path: Path = [];
          for (const point of points) path.push(point.x * k, point.y * k);
          return path;
        }),
      );
    }
  };
  /** The polygons of a feature, each as an outline followed by its holes. */
  const polygonsOf = (feature: VectorTileFeature, extent: number): Path[][] => {
    const k = TILE_KM / extent;
    return classifyRings(feature.loadGeometry()).map((rings) =>
      rings.map((points) => {
        const path: Path = [];
        for (const point of points) path.push(point.x * k, point.y * k);
        return tidy(path, true);
      }),
    );
  };
  /** Things under a bridge are drawn before the bridge. */
  const order = (p: Properties, rank: number) => (Number(p.hoogteniveau) || 0) * 100 + rank;
  const fill = (name: string, style: (p: Properties) => [RGB, number, number] | null) => {
    const layer = tile.layers[name];
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (feature.type !== 3) continue;
      const styled = style(feature.properties);
      if (!styled) continue;
      const [colour, rank, surface] = styled;
      const polygons = polygonsOf(feature, layer.extent);
      items.push({
        order: order(feature.properties, rank),
        draw: () => polygons.forEach((rings) => flat.polygon(rings, colour, surface)),
      });
    }
  };
  const stroke = (
    name: string,
    style: (p: Properties) => [RGB, number, number, number] | null,
  ) => {
    each(name, (p, feature, paths) => {
      if (feature.type !== 2) return;
      const styled = style(p);
      if (!styled) return;
      const [colour, rank, surface, half] = styled;
      const lines = paths().map((path) => tidy(path, false));
      items.push({
        order: order(p, rank),
        draw: () => lines.forEach((line) => flat.ribbon(line, half, colour, surface)),
      });
    });
  };

  // ---- what lies on the ground
  fill("terrein_vlak", (p) => [landColour(String(p.typelandgebruik ?? "")), 10, SURFACE.plain]);
  fill("waterdeel_vlak", (p) => {
    const type = String(p.typewater ?? "");
    if (type === "zee") return [C.sea, 20, SURFACE.water];
    if (type === "droogvallend") return [C.tidal, 20, SURFACE.plain];
    return [C.water, 20, SURFACE.water];
  });
  stroke("waterdeel_lijn", (p) => {
    if (String(p.typewater ?? "") !== "waterloop") return null;
    const width = String(p.breedteklasse ?? "");
    const half = width.startsWith("0,5") ? 1.1 : width.startsWith("3") ? 2.2 : 4;
    return [C.water, 21, SURFACE.water, half * M];
  });
  fill("gebouw_vlak", () => [C.footprint, 30, SURFACE.plain]);
  fill("wegdeel_vlak", (p) => {
    const [colour, rank] = roadStyle(p);
    return [colour, rank, SURFACE.road];
  });
  stroke("wegdeel_lijn", (p) => {
    if (first(p.typeweg) === "veerverbinding") return null;
    const [colour, rank] = roadStyle(p);
    return [colour, rank, SURFACE.road, 0.9 * M];
  });
  stroke("spoorbaandeel_lijn", (p) => {
    if (String(p.fysiekvoorkomen ?? "").includes("tunnel")) return null;
    if ((Number(p.hoogteniveau) || 0) < 0) return null;
    const tram = p.typespoorbaan === "tram";
    return [tram ? C.tram : C.rail, 55, SURFACE.plain, (tram ? 0.8 : 1.5) * M];
  });

  items.sort((a, b) => a.order - b.order);
  for (const item of items) item.draw();

  // ---- trees: single ones, and rows along roads and dikes
  let planted = 0;
  const plant = (x: number, z: number) => {
    if (planted >= 1400 || !inTile(x, z)) return;
    const seed = Math.round(x * 1e6) * 7919 + Math.round(z * 1e6);
    const crown = (2 + 1.2 * hash(seed)) * M;
    const top = (7 + 4 * hash(seed + 1)) * M;
    trees.box(x, z, 0.3 * M, 0, 3 * M, C.trunk);
    trees.box(x, z, crown, 2.6 * M, top, LEAVES[Math.floor(hash(seed + 2) * LEAVES.length)]);
    planted++;
  };
  each("inrichtingselement_punt", (p, feature, paths) => {
    if (feature.type !== 1 || p.typeinrichtingselement !== "boom") return;
    for (const path of paths()) plant(path[0], path[1]);
  });
  each("inrichtingselement_lijn", (p, feature, paths) => {
    if (feature.type !== 2 || p.typeinrichtingselement !== "bomenrij") return;
    for (const path of paths()) alongPath(path, 6 * M, 13 * M, plant);
  });

  // ---- names. Streets: one name per street, on its longest stretch.
  const streets = new Map<
    string,
    { total: number; longest: number; at: [number, number, number]; base: number; reach: number }
  >();
  each("wegdeel_hartlijn", (p, feature, paths) => {
    const name = first(p.naam);
    if (feature.type !== 2 || !name) return;
    const type = first(p.typeweg);
    const [base, reach] =
      type === "autosnelweg" || type === "hoofdweg" || type === "regionale weg"
        ? [20, 2.6]
        : type === "lokale weg"
          ? [20.5, 2]
          : type === "straat"
            ? [21, 1.4]
            : [22, 0.8];
    for (const path of paths()) {
      const size = length(path);
      const at = midpoint(path);
      let entry = streets.get(name);
      if (!entry) {
        entry = { total: 0, longest: 0, at, base, reach };
        streets.set(name, entry);
      }
      entry.total += size;
      entry.base = Math.min(entry.base, base);
      entry.reach = Math.max(entry.reach, reach);
      if (size > entry.longest && inTile(at[0], at[1])) {
        entry.longest = size;
        entry.at = at;
      }
    }
  });
  const named: StreetLabel[] = [];
  for (const [text, street] of streets) {
    // A stretch shorter than its own name has no room for it.
    if (street.longest < 0.03) continue;
    named.push({
      text,
      kind: "street",
      x: street.at[0],
      z: street.at[1],
      angle: street.at[2],
      rank: street.base - Math.min(0.45, street.total / 2),
      reach: street.reach,
    });
  }
  named.sort((a, b) => a.rank - b.rank);
  labels.push(...named.slice(0, 48));

  // Water: the name sits on the largest piece of it in this tile.
  const waters = new Map<string, { size: number; rings: Path[] }>();
  const water = tile.layers.waterdeel_vlak;
  if (water) {
    for (let i = 0; i < water.length; i++) {
      const feature = water.feature(i);
      const name = first(feature.properties.naamnl);
      if (feature.type !== 3 || !name) continue;
      for (const rings of polygonsOf(feature, water.extent)) {
        const size = areaOf(rings);
        const entry = waters.get(name);
        if (!entry || size > entry.size) waters.set(name, { size, rings });
      }
    }
  }
  for (const [text, entry] of waters) {
    const at = interior(entry.rings);
    if (!at || !inTile(at[0], at[1]) || entry.size < 0.0004) continue;
    const large = entry.size > 0.04;
    labels.push({
      text,
      kind: "canal",
      x: at[0],
      z: at[1],
      rank: large ? 19 : 23 - Math.min(0.9, entry.size * 60),
      reach: large ? 4.4 : 2.2,
    });
  }

  // Neighbourhoods and districts.
  const places = tile.layers.plaats_vlak;
  if (places) {
    for (let i = 0; i < places.length; i++) {
      const feature = places.feature(i);
      const text = first(feature.properties.naamnl);
      const type = String(feature.properties.typegebied ?? "");
      if (feature.type !== 3 || !text) continue;
      const best = largest(polygonsOf(feature, places.extent));
      if (!best || best.size < 0.03) continue;
      const at = interior(best.rings);
      if (!at || !inTile(at[0], at[1])) continue;
      const small = type === "buurt";
      labels.push({
        text,
        kind: "hood",
        x: at[0],
        z: at[1],
        rank: (small ? 19.5 : 18.5) - Math.min(0.4, best.size),
        reach: small ? 2.4 : 4.4,
      });
    }
  }

  // Stations.
  each("inrichtingselement_punt", (p, feature, paths) => {
    const type = String(p.typeinrichtingselement ?? "");
    const text = first(p.naam);
    if (feature.type !== 1 || !text) return;
    if (type !== "treinstation" && type !== "metrostation") return;
    const [x, z] = paths()[0];
    if (!inTile(x, z)) return;
    const train = type === "treinstation";
    labels.push({
      text,
      kind: "station",
      x,
      z,
      rank: train ? 12 : 14,
      reach: train ? 4.4 : 2.4,
    });
  });

  // Buildings people look for: those with a job, and those with a name.
  // A university is named once in a tile, on its largest building.
  const campuses = new Map<string, { size: number; at: [number, number] }>();
  const buildings = tile.layers.gebouw_vlak;
  if (buildings) {
    for (let i = 0; i < buildings.length; i++) {
      const feature = buildings.feature(i);
      if (feature.type !== 3) continue;
      const type = String(feature.properties.typegebouw ?? "");
      const names = values(feature.properties.naam).filter((name) => name.length > 2);
      const institution = names.find((name) => HIGHER.test(name));
      const match = NOTABLE.find(([pattern]) => pattern.test(type));
      if (!match && !names.length) continue;
      const polygons = polygonsOf(feature, buildings.extent);
      if (!polygons.length) continue;
      const at = interior(polygons[0]);
      if (!at || !inTile(at[0], at[1])) continue;

      if (institution) {
        const size = Math.abs(area2(polygons[0][0]));
        const known = campuses.get(institution);
        if (!known || size > known.size) campuses.set(institution, { size, at });
      }
      const own = names.filter((name) => !HIGHER.test(name));
      let text = own.find((name) => TELLING.test(name)) ?? own[0] ?? "";
      if (match) {
        const [, kind, rank, reach, fallback] = match;
        text ||= fallback;
        if (!text) continue;
        // The town hall is where a move starts, so it is always called
        // that, also where the building has a name of its own.
        if (kind === "civic" && !/town hall/i.test(text)) text += " (town hall)";
        labels.push({ text, kind, x: at[0], z: at[1], rank, reach });
      } else if (text) {
        const telling = TELLING.test(text);
        labels.push({
          text,
          kind: "building",
          x: at[0],
          z: at[1],
          rank: telling ? 16.4 : 23.4,
          reach: telling ? 2.4 : 1.3,
        });
      }
    }
  }
  for (const [text, campus] of campuses) {
    labels.push({ text, kind: "campus", x: campus.at[0], z: campus.at[1], rank: 13, reach: 3.4 });
  }

  // Named grounds: a campus, a park, a zoo.
  for (const name of ["functioneel_gebied_vlak", "functioneel_gebied_multivlak"]) {
    const layer = tile.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const text = first(feature.properties.naamnl);
      const type = String(feature.properties.typefunctioneelgebied ?? "");
      if (feature.type !== 3 || !text || NO_GROUNDS.test(type)) continue;
      // The buildings of a university carry its name already.
      if (campuses.has(text)) continue;
      const best = largest(polygonsOf(feature, layer.extent));
      if (!best || best.size < 0.0015) continue;
      const at = interior(best.rings);
      if (!at || !inTile(at[0], at[1])) continue;
      const [, rank, reach] = GROUNDS.find(([pattern]) => pattern.test(type)) ?? GROUNDS[GROUNDS.length - 1];
      const campus = type === "campus" && HIGHER.test(text);
      labels.push({
        text,
        kind: campus ? "campus" : "area",
        x: at[0],
        z: at[1],
        rank: campus ? 13 : rank - Math.min(0.3, best.size),
        reach,
      });
    }
  }

  // ---- where people walk, cyclists ride, cars drive and trains run
  const routes = Object.fromEntries(
    Object.entries(ROUTES).map(([kind, [layer, style, minLength]]) => {
      const out: number[] = [];
      if (pilot && kind === "walks") return [kind, null];
      each(layer, (p, feature, paths) => {
        const styled = feature.type === 2 ? style(p, pilot) : null;
        if (!styled) return;
        for (const path of paths()) {
          const line = tidy(path, false, 0.3 * M);
          if (line.length < 4 || (!pilot && length(line) < minLength)) continue;
          const middle = midpoint(line);
          if ((pilot && kind === "rails") || inTile(middle[0], middle[1])) out.push(line.length / 2, ...styled, ...line);
        }
      });
      return [kind, out.length ? new Float32Array(out) : null];
    }),
  ) as Record<MoverKey, RouteLines | null>;

  // ---- street lamps: down one side of the street, the arm over the road
  const lamps: number[] = [];
  let street = 0;
  each("wegdeel_hartlijn", (p, feature, paths) => {
    const styled = feature.type === 2 ? lampStyle(p) : null;
    if (!styled) return;
    const [offset, spacing] = styled;
    const side = hash(street++) < 0.5 ? 1 : -1;
    for (const path of paths()) {
      alongPath(path, spacing / 2, spacing, (x, z, dx, dz) => {
        const lx = x - dz * offset * side;
        const lz = z + dx * offset * side;
        if (lamps.length < MAX_LAMPS * 3 && inTile(lx, lz)) {
          lamps.push(lx, lz, Math.atan2(dz * side, -dx * side));
        }
      });
    }
  });

  return {
    id: 0,
    ok: true,
    part: "ground",
    ground: flat.finish(),
    trees: trees.finish(),
    labels,
    routes,
    lamps: lamps.length ? new Float32Array(lamps) : null,
  };
}

// ------------------------------------------------------------ buildings --

interface BuildingPart {
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
  properties: {
    identificatie?: string;
    b3_h_70p?: number | null;
    b3_h_maaiveld?: number | null;
    b3_dak_type?: string | null;
    b3_kas_warenhuis?: boolean | null;
    oorspronkelijkbouwjaar?: number | null;
  };
}

/** A number from a string, the same every time. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function shadeOf(colour: RGB, amount: number): RGB {
  const shade = (value: number) => Math.min(255, Math.round(value * amount));
  return [shade(colour[0]), shade(colour[1]), shade(colour[2])];
}

export async function buildBuildings(
  col: number,
  row: number,
  signal: AbortSignal,
): Promise<Extract<StreetResponse, { part: "buildings" }>> {
  const bounds = tileBounds(col, row);
  const response = await fetch(buildingsUrl(bounds), { signal });
  if (!response.ok) throw new Error(`Buildings: HTTP ${response.status}`);
  const data = (await response.json()) as { features?: BuildingPart[] };
  const solid = new Solid();

  for (const part of data.features ?? []) {
    if (!part.geometry) continue;
    const polygons = (
      part.geometry.type === "Polygon"
        ? [part.geometry.coordinates]
        : part.geometry.coordinates
    ) as number[][][][];
    // The service returns everything that touches the tile. A part belongs
    // to the tile its first corner is in, so neighbours do not draw it twice.
    const corner = polygons[0]?.[0]?.[0];
    if (
      !corner ||
      corner[0] < bounds.left ||
      corner[0] >= bounds.right ||
      corner[1] < bounds.bottom ||
      corner[1] >= bounds.top
    ) {
      continue;
    }

    const p = part.properties;
    const roofHeight = p.b3_h_70p;
    const groundHeight = p.b3_h_maaiveld;
    let height =
      typeof roofHeight === "number" && typeof groundHeight === "number"
        ? roofHeight - groundHeight
        : 6;
    height = Math.min(320, Math.max(2.2, height));

    const seed = seedOf(p.identificatie ?? `${corner[0]},${corner[1]}`);
    const year = p.oorspronkelijkbouwjaar ?? 0;
    // The register uses years such as 1005 where the year is unknown.
    const palette =
      year < 1200 || year > 2100
        ? UNDATED
        : (ERAS.find((era) => year < era.until) ?? ERAS[ERAS.length - 1]).walls;
    let wall = shadeOf(palette[seed % palette.length], 0.94 + 0.12 * hash(seed));
    const roofs = p.b3_dak_type === "slanted" ? ROOF_TILE : ROOF_FLAT;
    let roof = roofs[(seed >>> 8) % roofs.length];
    let windows = 1 + (seed % 254);
    if (p.b3_kas_warenhuis) {
      wall = C.glass;
      roof = C.glass;
      windows = 0;
    }

    for (const polygon of polygons) {
      const rings = polygon.map((ring) => {
        const path: Path = [];
        for (const [x, y] of ring) {
          path.push((x - bounds.left) * M, (bounds.top - y) * M);
        }
        return tidy(path, true, 0.1 * M);
      });
      if (rings[0].length < 6) continue;
      solid.prism(rings, height * M, wall, roof, windows);
    }
  }
  return { id: 0, ok: true, part: "buildings", buildings: solid.finish() };
}

// ------------------------------------------------------------- messages --

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: StreetResponse, transfer: Transferable[]): void;
};
const running = new Map<number, AbortController>();

/** The memory behind a set of arrays, to hand over rather than copy. */
function buffers(arrays: object | null): Transferable[] {
  return Object.values(arrays ?? {})
    .filter((array) => array !== null)
    .map((array) => (array as Float32Array).buffer);
}

if (typeof self !== "undefined") scope.onmessage = async (event) => {
  const message = event.data as StreetRequest | { cancel: number };
  if ("cancel" in message) {
    running.get(message.cancel)?.abort();
    return;
  }
  const control = new AbortController();
  running.set(message.id, control);
  try {
    if (message.part === "ground") {
      const result = await buildGround(message.col, message.row, control.signal);
      result.id = message.id;
      scope.postMessage(result, [
        ...buffers(result.ground),
        ...buffers(result.trees),
        ...buffers(result.routes),
        ...buffers({ lamps: result.lamps }),
      ]);
    } else {
      const result = await buildBuildings(message.col, message.row, control.signal);
      result.id = message.id;
      scope.postMessage(result, buffers(result.buildings));
    }
  } catch (error) {
    scope.postMessage(
      { id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) },
      [],
    );
  } finally {
    running.delete(message.id);
  }
};
