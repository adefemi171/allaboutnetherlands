import areas from "./areas.json";

export type Point = [x: number, z: number];
export type RoadMode = "car" | "bike";
export type GroundMode = RoadMode | "walk";
export type Mode = GroundMode | "train";

export interface DriveArea {
  id: string;
  center: [latitude: number, longitude: number];
  name: string;
  first: string;
  last: string;
  stops: string[];
  modes: Mode[];
}

export const DRIVE_AREAS = areas as DriveArea[];
export const drivePath = (area: DriveArea) => area.id === "utrecht" ? "/drive/" : `/drive/${area.id}/`;
export const driveDataUrl = (area: DriveArea) => area.id === "utrecht" ? "/data/drive" : `/data/drive/${area.id}`;

export interface Stop {
  name: string;
  point: Point;
  trackIndex: number;
  access: Record<RoadMode, Point>;
  approach: Record<RoadMode, number>;
}

export interface Corridor {
  tileSize: number;
  tiles: [col: number, row: number][];
  bounds: [width: number, height: number];
  stops: Stop[];
  track: Point[];
  guides: Record<RoadMode, Point[]>;
  carReturn?: { track: Point[]; stopIndices: number[] };
}

export const CAR_PAINTS = [
  { name: "Petrol blue", color: "#16768a" },
  { name: "Brick red", color: "#bc493b" },
  { name: "Polder green", color: "#497859" },
  { name: "Dune cream", color: "#d8be91" },
  { name: "Midnight", color: "#303c56" },
] as const;

export async function fetchAsset(url: string): Promise<Response> {
  let response = await fetch(url).catch(() => null);
  if (!response || response.status === 408 || response.status === 429 || response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 220));
    response = await fetch(url, { cache: "reload" });
  }
  if (!response.ok) throw new Error(`Corridor data: HTTP ${response.status}`);
  return response;
}

export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const response = await fetchAsset(url);
  if (!response.body) throw new Error("Corridor data is empty");
  return new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
