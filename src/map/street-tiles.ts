// Street-level detail: where it comes from and how it is cut up.
//
// Below a few kilometres the map stops drawing 500 m squares and loads real
// streets and buildings for the area in view. Both sources are open data
// served straight to the browser:
//
//   Ground     TOP10NL by Kadaster, as vector tiles from PDOK. Roads, water,
//              land use, railways, and the names of streets, canals and
//              neighbourhoods. CC BY 4.0.
//   Buildings  3DBAG by the 3D geoinformation group at TU Delft. Every
//              building in the country with its measured height and the
//              year it was built. CC BY 4.0.
//
// PDOK cuts its tiles on the Dutch national grid, which is also the grid
// the scene is laid out on, so a tile is an exact square in the scene.
//
// This file is shared by the page and by the worker that builds the tiles.

export const TILE_ZOOM = 10;

// The NetherlandsRDNewQuad tile matrix set: one square that is halved at
// every zoom level, with rows counted from the top.
// The aerial photographs (aerial.ts) are cut the same way.
export const SET_LEFT = -285401.92;
export const SET_TOP = 903401.92;
export const SET_SPAN = 880803.84;

/** Side of one tile at a zoom level, metres. */
export function tileSize(zoom: number): number {
  return SET_SPAN / 2 ** zoom;
}

/** Side of one street tile, in metres and in scene kilometres. */
export const TILE_M = tileSize(TILE_ZOOM);
export const TILE_KM = TILE_M / 1000;

/** Edges of a tile in RD metres. */
export interface TileBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export function tileAt(rdX: number, rdY: number, zoom = TILE_ZOOM): [col: number, row: number] {
  const size = tileSize(zoom);
  return [Math.floor((rdX - SET_LEFT) / size), Math.floor((SET_TOP - rdY) / size)];
}

export function tileBounds(col: number, row: number, zoom = TILE_ZOOM): TileBounds {
  const size = tileSize(zoom);
  const left = SET_LEFT + col * size;
  const top = SET_TOP - row * size;
  return { left, top, right: left + size, bottom: top - size };
}

export function groundUrl(col: number, row: number): string {
  return (
    "https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1/tiles/NetherlandsRDNewQuad/" +
    `${TILE_ZOOM}/${row}/${col}?f=mvt`
  );
}

/**
 * Building parts inside a tile. "lod13" splits a building where its roof
 * jumps in height, so a church keeps its tower. Only the few attributes
 * the map draws are asked for; the full records are twenty times larger.
 */
export function buildingsUrl(bounds: TileBounds): string {
  const box = [bounds.left, bounds.bottom, bounds.right, bounds.top]
    .map((value) => value.toFixed(2))
    .join(",");
  return (
    "https://data.3dbag.nl/api/BAG3D/wfs?service=WFS&version=2.0.0" +
    "&request=GetFeature&typeNames=BAG3D:lod13" +
    "&outputFormat=application/json&srsName=EPSG:28992" +
    `&bbox=${box},EPSG:28992` +
    "&propertyName=geom,identificatie,b3_h_70p,b3_h_maaiveld,b3_dak_type," +
    "b3_kas_warenhuis,oorspronkelijkbouwjaar"
  );
}

export type StreetLabelKind =
  | "street"
  | "canal"
  | "hood"
  | "station"
  | "civic"
  | "campus"
  | "area"
  | "building";

/** A name found in a tile. Positions are km from the tile's north-west corner. */
export interface StreetLabel {
  text: string;
  kind: StreetLabelKind;
  x: number;
  z: number;
  /** Lower ranks win when two names would overlap. */
  rank: number;
  /** The name shows while the camera is closer than this, km. */
  reach: number;
  /** Direction of the street in the scene, radians. Names follow it. */
  angle?: number;
}

/** Flat geometry: everything that lies on the ground, in drawing order. */
export interface GroundMesh {
  /** x, z pairs, km from the tile's north-west corner. */
  positions: Float32Array;
  /** r, g, b, and what the surface is (see SURFACE below). */
  colours: Uint8Array;
  indices: Uint32Array;
}

/** Upright geometry: buildings, or trees. */
export interface SolidMesh {
  /** x, y, z triples in km; y is height above the ground. */
  positions: Float32Array;
  normals: Int8Array;
  /** r, g, b, and for walls a seed for their windows (0 means no windows). */
  colours: Uint8Array;
  /** Distance along the wall in metres, so windows line up around corners. */
  along: Float32Array;
  indices: Uint32Array;
}

/**
 * Centre lines packed for whatever follows them. Each line is its number
 * of points, how far from the centre line to keep (km), how busy it is
 * (1 for an ordinary street), and then its points as x, z pairs in km from
 * the tile's north-west corner.
 */
export type RouteLines = Float32Array;

/** What moves along the routes of a tile: walkers, cyclists, cars, trains. */
export type MoverKey = "walks" | "cycles" | "drives" | "rails";

export const SURFACE = {
  plain: 0,
  /** Lit by street lamps at night. */
  road: 1,
  water: 2,
} as const;

export type StreetPart = "ground" | "buildings";

export interface StreetRequest {
  id: number;
  part: StreetPart;
  col: number;
  row: number;
}

export type StreetResponse =
  | { id: number; ok: false; error: string }
  | {
      id: number;
      ok: true;
      part: "ground";
      /** Null where the tile has nothing in it, such as open sea. */
      ground: GroundMesh | null;
      trees: SolidMesh | null;
      labels: StreetLabel[];
      /** Where walkers, cyclists, cars and trains go. */
      routes: Record<MoverKey, RouteLines | null>;
      /** Street lamps: x, z (km from the corner) and the way the arm points. */
      lamps: Float32Array | null;
    }
  | {
      id: number;
      ok: true;
      part: "buildings";
      buildings: SolidMesh | null;
    };
