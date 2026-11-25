import type { Point, GroundMode } from "./data";

type Footprint = { rings: Point[][]; left: number; right: number; top: number; bottom: number };
const CELL = 24;
const BODY = { car: { half: 1.14, radius: 0.98 }, bike: { half: 0.47, radius: 0.36 }, walk: { half: 0, radius: 0.26 } };

function inside([x, z]: Point, ring: Point[]): boolean {
  let inRing = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inRing = !inRing;
  }
  return inRing;
}

function nearWall([x, z]: Point, radius: number, ring: Point[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    if ((x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2 < radius ** 2) return true;
  }
  return false;
}

export class BuildingCollisions {
  private readonly cells = new Map<string, Footprint[]>();

  add(data: Float32Array, x: number, z: number): void {
    for (let i = 0; i < data.length;) {
      const count = data[i++];
      const rings: Point[][] = [];
      for (let r = 0; r < count; r++) {
        const points = data[i++];
        const ring: Point[] = [];
        for (let j = 0; j < points; j++) ring.push([x + data[i++], z + data[i++]]);
        rings.push(ring);
      }
      if (!rings[0]?.length) continue;
      const outer = rings[0];
      const xs = outer.map((point) => point[0]);
      const zs = outer.map((point) => point[1]);
      const footprint = { rings, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...zs), bottom: Math.max(...zs) };
      for (let col = Math.floor(footprint.left / CELL); col <= Math.floor(footprint.right / CELL); col++) {
        for (let row = Math.floor(footprint.top / CELL); row <= Math.floor(footprint.bottom / CELL); row++) {
          const key = `${col}:${row}`;
          const cell = this.cells.get(key);
          if (cell) cell.push(footprint);
          else this.cells.set(key, [footprint]);
        }
      }
    }
  }

  circle(point: Point, radius: number): boolean {
    const [x, z] = point;
    for (let col = Math.floor((x - radius) / CELL); col <= Math.floor((x + radius) / CELL); col++) {
      for (let row = Math.floor((z - radius) / CELL); row <= Math.floor((z + radius) / CELL); row++) {
        for (const { rings, left, right, top, bottom } of this.cells.get(`${col}:${row}`) ?? []) {
          if (x < left - radius || x > right + radius || z < top - radius || z > bottom + radius) continue;
          if (inside(point, rings[0]) && !rings.slice(1).some((ring) => inside(point, ring))) return true;
          if (rings.some((ring) => nearWall(point, radius, ring))) return true;
        }
      }
    }
    return false;
  }

  vehicle([x, z]: Point, angle: number, mode: GroundMode): boolean {
    const { half, radius } = BODY[mode];
    if (!half) return this.circle([x, z], radius);
    const dx = Math.sin(angle) * half;
    const dz = Math.cos(angle) * half;
    return this.circle([x, z], radius)
      || this.circle([x + dx, z + dz], radius)
      || this.circle([x - dx, z - dz], radius);
  }
}
