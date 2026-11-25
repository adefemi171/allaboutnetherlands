import type { Point } from "./data";
import { distance, type Roads } from "./simulation";
import { TrafficLane, type TrafficPath } from "./traffic-rules";
import type { RoadPose } from "./vehicle-contact";
import type { WalkingLink } from "./walking";

type Crossing = { link: WalkingLink; length: number; direction: Point };
export type CrossingGate = { at: number; crossing: Crossing };
const CELL = 24;
const key = ([x, z]: Point) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
const subtract = ([x, z]: Point, [a, b]: Point): Point => [x - a, z - b];
const dot = ([x, z]: Point, [a, b]: Point) => x * a + z * b;
const cross = ([x, z]: Point, [a, b]: Point) => x * b - z * a;

export class PedestrianCrossings {
  private readonly cells = new Map<string, Crossing[]>();
  private readonly used = new Set<Crossing>();
  private readonly occupied = new Set<Crossing>();

  constructor(links: WalkingLink[]) {
    for (const link of links) {
      const [a, b, width] = link;
      const length = distance(a, b);
      if (length < 1.2) continue;
      const [dx, dz] = subtract(b, a);
      const crossing: Crossing = { link, length, direction: [dx / length, dz / length] };
      const margin = width / 2 + 2.5;
      for (let x = Math.floor((Math.min(a[0], b[0]) - margin) / CELL);
        x <= Math.floor((Math.max(a[0], b[0]) + margin) / CELL); x++) {
        for (let z = Math.floor((Math.min(a[1], b[1]) - margin) / CELL);
          z <= Math.floor((Math.max(a[1], b[1]) + margin) / CELL); z++) {
          const id = `${x}:${z}`;
          const candidates = this.cells.get(id);
          if (candidates) candidates.push(crossing);
          else this.cells.set(id, [crossing]);
        }
      }
    }
  }

  trafficLinks(): WalkingLink[] {
    return [...this.used].map(({ link }) => link);
  }

  forPath(path: TrafficPath, roads: Roads, lane = new TrafficLane(path, roads)): CrossingGate[] {
    if (path.length < 4) return [];
    const gates: CrossingGate[] = [];
    let previous: Point | null = null;
    let last = 0;
    const steps = Math.ceil(path.length / 2);
    for (let i = 0; i <= steps; i++) {
      const along = i * path.length / steps;
      const point = lane.pointAt(along);
      if (point && previous) {
        const travel = subtract(point, previous);
        const nearby = this.cells.get(key(point)) ?? [];
        for (const crossing of nearby) {
          const { direction, length, link: [start, , width] } = crossing;
          const intersection = cross(travel, direction);
          const angle = Math.abs(intersection) / (Math.hypot(...travel) || 1);
          if (angle < 0.55) continue;
          const offset = subtract(start, previous);
          const t = cross(offset, direction) / intersection;
          const bank = cross(offset, travel) / intersection;
          if (t <= 0 || t > 1 || bank < -0.3 || bank > length + 0.3) continue;
          const at = last + t * (along - last) - width / (2 * angle) - 2.8;
          if (at < 0 || gates.some((gate) => gate.crossing === crossing && Math.abs(gate.at - at) < 4)) continue;
          gates.push({ at, crossing });
          this.used.add(crossing);
        }
      }
      previous = point;
      last = along;
    }
    return gates.sort((a, b) => a.at - b.at);
  }

  update(occupants: readonly RoadPose[]): void {
    this.occupied.clear();
    for (const { point, mode, travelHeading } of occupants) {
      if (mode !== "walk") continue;
      for (const crossing of this.cells.get(key(point)) ?? []) {
        if (!this.used.has(crossing)) continue;
        const { direction, length, link: [start, , width] } = crossing;
        const offset = subtract(point, start);
        const along = dot(offset, direction);
        if (along < -1 || along > length + 1 || Math.abs(cross(offset, direction)) > width / 2 + 0.25) continue;
        if (along >= 0.65 && along <= length - 0.65) {
          this.occupied.add(crossing);
        } else if (travelHeading !== undefined) {
          const alignment = dot([Math.sin(travelHeading), Math.cos(travelHeading)], direction);
          if (along < 0.65 ? alignment > 0.56 : alignment < -0.56) this.occupied.add(crossing);
        }
      }
    }
  }

  active({ crossing }: CrossingGate): boolean {
    return this.occupied.has(crossing);
  }
}
