import type { Point } from "./data";

export type WalkingSurface = [kind: 0 | 1, ...rings: Point[][]];
export type WalkingLink = [from: Point, to: Point, width: number, junction?: boolean];
export type WalkingRoute = { a: Point; b: Point; dog: boolean; street: string };
export interface WalkingData {
  surfaces: WalkingSurface[];
  links?: WalkingLink[];
  pedestrians: WalkingRoute[];
}

const CELL = 32;
// Decimetre differences between adjacent BGT polygons can open thin seams.
const JOIN = 0.22;

function inside([x, z]: Point, ring: Point[]): boolean {
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) contained = !contained;
  }
  return contained;
}

function distanceToEdge([x, z]: Point, [ax, az]: Point, [bx, bz]: Point): [Point, number] {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  const point: Point = [ax + t * dx, az + t * dz];
  return [point, Math.hypot(point[0] - x, point[1] - z)];
}

type Area = { outer: Point[]; holes: Point[][] };

export class Walkways {
  private cells = new Map<string, Area[]>();

  constructor(surfaces: WalkingSurface[], links: WalkingLink[] = []) {
    for (const [, outer, ...holes] of surfaces) {
      if (outer?.length >= 3) this.add(outer, holes);
    }
    for (const [[ax, az], [bx, bz], width] of links) {
      const length = Math.hypot(bx - ax, bz - az);
      if (length === 0) continue;
      const dx = (bz - az) * width / (length * 2);
      const dz = (ax - bx) * width / (length * 2);
      this.add([[ax + dx, az + dz], [bx + dx, bz + dz], [bx - dx, bz - dz], [ax - dx, az - dz]]);
    }
  }

  add(outer: Point[], holes: Point[][] = []): void {
    const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
    const area = { outer, holes };
    for (let x = Math.floor((Math.min(...xs) - JOIN) / CELL); x <= Math.floor((Math.max(...xs) + JOIN) / CELL); x++) {
      for (let z = Math.floor((Math.min(...zs) - JOIN) / CELL); z <= Math.floor((Math.max(...zs) + JOIN) / CELL); z++) {
        const key = `${x}:${z}`;
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, cell = []);
        cell.push(area);
      }
    }
  }

  includes(point: Point, join = JOIN): boolean {
    const [x, z] = point;
    const cell = this.cells.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`);
    for (const { outer, holes } of cell ?? []) {
      if (holes.some((hole) => inside(point, hole))) continue;
      if (inside(point, outer)) return true;
      if (!join) continue;
      for (let i = 0; i < outer.length; i++) {
        if (distanceToEdge(point, outer[i], outer[(i + 1) % outer.length])[1] <= join) return true;
      }
    }
    return false;
  }

  nearest(point: Point, radius: number, allowed = (_point: Point) => true): Point | null {
    if (this.includes(point, 0) && allowed(point)) return point;
    const [x, z] = point;
    let closest = radius;
    let result: Point | null = null;
    const visited = new Set<Area>();
    for (let col = Math.floor((x - radius) / CELL); col <= Math.floor((x + radius) / CELL); col++) {
      for (let row = Math.floor((z - radius) / CELL); row <= Math.floor((z + radius) / CELL); row++) {
        for (const area of this.cells.get(`${col}:${row}`) ?? []) {
          if (visited.has(area)) continue;
          visited.add(area);
          const { outer } = area;
          if (inside(point, outer) && !area.holes.some((hole) => inside(point, hole)) && allowed(point)) return point;
          for (let i = 0; i < outer.length; i++) {
            const a = outer[i], b = outer[(i + 1) % outer.length];
            const [p, distance] = distanceToEdge(point, a, b);
            if (distance >= closest) continue;
            const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
            if (!length) continue;
            for (const side of [-0.32, 0.32]) {
              const inset: Point = [p[0] + dz / length * side, p[1] - dx / length * side];
              if (!inside(inset, outer) || area.holes.some((hole) => inside(inset, hole)) || !allowed(inset)) continue;
              result = inset;
              closest = distance;
              break;
            }
          }
        }
      }
    }
    return result;
  }
}
