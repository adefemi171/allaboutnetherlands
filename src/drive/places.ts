import type { GroundMode, Point } from "./data";
import type { Roundabout } from "./traffic-rules";

export interface Landmark {
  id: string;
  name: string;
  point: Point;
  radius: number;
  description: string;
}

export interface Places {
  names: string[];
  streets: number[][];
  places: Landmark[];
  quayEdges: [number, number, number, number][];
  plazas: Point[][];
  roundabouts?: Roundabout[];
}

type Section = { name: number; mask: number; ax: number; az: number; dx: number; dz: number; length2: number };
const STREET_CELL = 80;
const STREET_RADIUS = 7;

export class StreetNames {
  private cells = new Map<string, Section[]>();

  constructor(private data: Places) {
    for (const [name, mask, ...path] of data.streets) {
      for (let i = 2; i < path.length; i += 2) {
        const [ax, az, bx, bz] = path.slice(i - 2, i + 2);
        const dx = bx - ax;
        const dz = bz - az;
        const length2 = dx * dx + dz * dz;
        if (!length2) continue;
        const section = { name, mask, ax, az, dx, dz, length2 };
        for (let col = Math.floor((Math.min(ax, bx) - STREET_RADIUS) / STREET_CELL);
          col <= Math.floor((Math.max(ax, bx) + STREET_RADIUS) / STREET_CELL); col++) {
          for (let row = Math.floor((Math.min(az, bz) - STREET_RADIUS) / STREET_CELL);
            row <= Math.floor((Math.max(az, bz) + STREET_RADIUS) / STREET_CELL); row++) {
            const key = `${col}:${row}`;
            let cell = this.cells.get(key);
            if (!cell) this.cells.set(key, cell = []);
            cell.push(section);
          }
        }
      }
    }
  }

  at([x, z]: Point, angle: number, mode: GroundMode): string | null {
    const key = `${Math.floor(x / STREET_CELL)}:${Math.floor(z / STREET_CELL)}`;
    const mask = mode === "car" ? 1 : mode === "bike" ? 2 : 3;
    const forwardX = Math.sin(angle);
    const forwardZ = Math.cos(angle);
    let closest = STREET_RADIUS;
    let name = null;
    for (const section of this.cells.get(key) ?? []) {
      if (!(section.mask & mask)) continue;
      const { ax, az, dx, dz, length2 } = section;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2));
      const alignment = Math.abs((forwardX * dx + forwardZ * dz) / Math.sqrt(length2));
      const score = Math.hypot(x - ax - t * dx, z - az - t * dz) + (1 - alignment) * 2;
      if (score >= closest) continue;
      closest = score;
      name = this.data.names[section.name];
    }
    return name;
  }
}

export function nearbyLandmark(landmarks: Landmark[], [x, z]: Point, skip?: string): Landmark | undefined {
  let nearest;
  let closest = Infinity;
  for (const place of landmarks) {
    const distance = Math.hypot(x - place.point[0], z - place.point[1]);
    if (place.id === skip || distance > place.radius || distance >= closest) continue;
    closest = distance;
    nearest = place;
  }
  return nearest;
}
