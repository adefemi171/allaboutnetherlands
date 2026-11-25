import type { Point } from "./data";
import { carLaneOffset, type Roads } from "./simulation";
import type { RoadPose } from "./vehicle-contact";

export type Roundabout = { center: Point; radius: number };
export type StopLine = { point: Point; heading: number };
export type SignalData = { poles: Point[]; junctions: Point[] };
type SignalGroup = { point: Point; poles: Point[]; axis: number | null; offset: number };
export type SignalHead = StopLine & { group: SignalGroup; phase: number };
export type Light = "red" | "amber" | "green";
export type TrafficGate =
  | { kind: "stop"; at: number }
  | { kind: "signal"; at: number; head: SignalHead }
  | { kind: "roundabout"; at: number; ring: Roundabout; merge: Point };

const TURN = Math.PI * 2;
const metres = ([x, z]: Point, [a, b]: Point) => Math.hypot(x - a, z - b);
const bearing = ([x, z]: Point, [a, b]: Point) => Math.atan2(a - x, b - z);
const phaseLength = 23;
// Stop the bumper just short of the line. The route measures the car's centre.
const LINE_CLEARANCE = 2.55;

export class TrafficPath {
  readonly lengths = [0];
  readonly length: number;

  constructor(readonly points: Point[]) {
    for (let i = 1; i < points.length; i++) this.lengths.push(this.lengths[i - 1] + metres(points[i - 1], points[i]));
    this.length = this.lengths.at(-1)!;
  }

  pointAt(at: number): Point {
    const { points, lengths, length } = this;
    const t = Math.max(0, Math.min(length, at));
    let low = 0, high = lengths.length - 1;
    while (high - low > 1) {
      const mid = (high + low) >> 1;
      if (lengths[mid] > t) high = mid;
      else low = mid;
    }
    const along = (t - lengths[low]) / (lengths[high] - lengths[low] || 1);
    const [x, z] = points[low], [bx, bz] = points[high];
    return [x + (bx - x) * along, z + (bz - z) * along];
  }

  headingAt(at: number): number {
    return bearing(this.pointAt(at - 2.1), this.pointAt(at + 2.1));
  }

  project([x, z]: Point, limit: number, heading?: number): number | null {
    let closest = limit, result = null;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      if (heading !== undefined && Math.cos(bearing(a, b) - heading) < 0.77) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const distance = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      if (distance >= closest) continue;
      closest = distance;
      result = this.lengths[i - 1] + t * (this.lengths[i] - this.lengths[i - 1]);
    }
    return result;
  }
}

export class TrafficLane {
  private readonly centers: Point[] = [];
  private readonly spacing: number;

  constructor(readonly path: TrafficPath, roads: Roads) {
    const count = Math.ceil(path.length / 0.65);
    this.spacing = count ? path.length / count : 1;
    if (!count) return;
    const samples = Array.from({ length: count + 1 }, (_, i) => {
      const metres = i * this.spacing;
      const point = path.pointAt(metres);
      const angle = path.headingAt(metres);
      const hit = roads.carriageway(point, 2.4, angle);
      return { point, angle, offset: hit ? carLaneOffset(hit) : 0 };
    });
    // Smooth lane changes where centre lines join. The route itself follows the mapped street.
    for (const [i, { point, angle, offset }] of samples.entries()) {
      const shift = (samples[i - 1]?.offset ?? offset) * 0.25
        + offset * 0.5 + (samples[i + 1]?.offset ?? offset) * 0.25;
      this.centers.push([point[0] - Math.cos(angle) * shift, point[1] + Math.sin(angle) * shift]);
    }
  }

  pointAt(at: number): Point {
    const slot = Math.max(0, Math.min(this.centers.length - 1, at / this.spacing));
    const index = Math.floor(slot);
    const a = this.centers[index];
    const b = this.centers[index + 1] ?? a;
    const t = slot - index;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  headingAt(at: number): number {
    return bearing(this.pointAt(at - 1.6), this.pointAt(at + 1.6));
  }
}

function signalGroups(poles: Point[]): SignalGroup[] {
  const groups: SignalGroup[] = [];
  const remaining = new Set(poles);
  while (remaining.size) {
    const cluster = [remaining.values().next().value!];
    remaining.delete(cluster[0]);
    for (const pole of cluster) {
      for (const candidate of remaining) {
        if (metres(pole, candidate) > 24) continue;
        remaining.delete(candidate);
        cluster.push(candidate);
      }
    }
    // Ignore lone poles, which often control only a bike or pedestrian approach.
    if (cluster.length < 2) continue;
    const point: Point = [
      cluster.reduce((sum, p) => sum + p[0], 0) / cluster.length,
      cluster.reduce((sum, p) => sum + p[1], 0) / cluster.length,
    ];
    groups.push(signalGroup(point, cluster));
  }
  return groups;
}

function signalGroup(point: Point, poles: Point[]): SignalGroup {
  const cycle = 2 * phaseLength;
  const offset = (Math.round(point[0] + point[1] * 0.7) % cycle + cycle) % cycle;
  return { point, poles, axis: null, offset };
}

function circulating({ center, radius }: Roundabout, { point, angle }: RoadPose): boolean {
  const x = point[0] - center[0], z = point[1] - center[1];
  const distance = Math.hypot(x, z);
  return Math.abs(distance - radius) < 3
    && (z * Math.sin(angle) - x * Math.cos(angle)) > distance * 0.54;
}

export function roundaboutOccupied(ring: Roundabout, merge: Point, vehicles: readonly RoadPose[]): boolean {
  const entry = Math.atan2(merge[1] - ring.center[1], merge[0] - ring.center[0]);
  return vehicles.some((vehicle) => {
    if (vehicle.mode === "walk" || !circulating(ring, vehicle)) return false;
    const angle = Math.atan2(vehicle.point[1] - ring.center[1], vehicle.point[0] - ring.center[0]);
    return ((angle - entry + TURN) % TURN) * ring.radius < Math.min(24, ring.radius * Math.PI)
      || metres(vehicle.point, merge) < 5.5;
  });
}

export class TrafficRules {
  private time = 0;
  private readonly groups: SignalGroup[];
  readonly heads: SignalHead[] = [];

  constructor(signals: SignalData, private readonly stops: StopLine[], private readonly roundabouts: Roundabout[]) {
    this.groups = signalGroups(signals.poles);
    for (const point of signals.junctions) {
      if (this.groups.some((group) => metres(point, group.point) < 18)) continue;
      this.groups.push(signalGroup(point, []));
    }
  }

  advance(dt: number): void { this.time += dt; }

  light(head: SignalHead): Light {
    const time = (this.time + head.group.offset + head.phase * phaseLength) % (2 * phaseLength);
    return time < 17 ? "green" : time < 20 ? "amber" : "red";
  }

  forPath(path: TrafficPath): TrafficGate[] {
    if (path.length < 5) return [];
    const gates: TrafficGate[] = [];
    for (const group of this.groups) {
      const crossing = path.project(group.point, 11.5);
      if (crossing === null || crossing < 9 || crossing >= path.length - 2) continue;
      const approach = path.headingAt(crossing - 8);
      const poles = group.poles.map((pole) => path.project(pole, 11, approach))
        .filter((at): at is number => at !== null && at > crossing - 17 && at < crossing - 4);
      const line = poles.length ? Math.min(...poles) : crossing - 8;
      const point = path.pointAt(line), heading = path.headingAt(line);
      group.axis ??= heading;
      const phase = Math.abs(Math.cos(heading - group.axis)) >= Math.SQRT1_2 ? 0 : 1;
      const same = this.heads.find((head) => head.group === group && metres(head.point, point) < 5
        && Math.cos(head.heading - heading) > 0.89);
      const head = same ?? { point, heading, group, phase };
      if (!same) this.heads.push(head);
      gates.push({ kind: "signal", at: line - LINE_CLEARANCE, head });
    }
    for (const line of this.stops) {
      const at = path.project(line.point, 3.1, line.heading);
      if (at !== null && at > LINE_CLEARANCE && at < path.length - 1
        && !gates.some((gate) => Math.abs(gate.at - at + LINE_CLEARANCE) < 12)) {
        gates.push({ kind: "stop", at: at - LINE_CLEARANCE });
      }
    }
    for (const ring of this.roundabouts) {
      let inside = false;
      for (let at = 2; at < path.length - 2; at += 1.5) {
        const point = path.pointAt(at);
        const entering = circulating(ring, { point, angle: path.headingAt(at) });
        if (!inside && entering && at > 8 && !gates.some((gate) => Math.abs(gate.at - at + 5.4) < 7)) {
          gates.push({ kind: "roundabout", at: at - 5.4, ring, merge: point });
        }
        // Keep this entry while crossing small joins between the ring segments.
        inside = entering || (inside && metres(point, ring.center) < ring.radius + 5);
      }
    }
    return gates.sort((a, b) => a.at - b.at);
  }

  ahead(point: Point, heading: number): { kind: Light; distance: number } | null {
    let closest = 42;
    let result = null;
    for (const head of this.heads) {
      if (Math.cos(head.heading - heading) < 0.79) continue;
      const dx = head.point[0] - point[0], dz = head.point[1] - point[1];
      const along = dx * Math.sin(heading) + dz * Math.cos(heading);
      const across = dx * Math.cos(heading) - dz * Math.sin(heading);
      if (along < 0 || along >= closest || Math.abs(across) > 4.1) continue;
      closest = along;
      result = { kind: this.light(head), distance: along };
    }
    return result;
  }
}
