import type { TrafficLane } from "./traffic-rules";
import { vehiclesOverlap, type RoadPose } from "./vehicle-contact";

export type ApproachRange = { start: number; end: number };
export type LaneConflict = [ApproachRange, ApproachRange];
const CELL = 10;
const key = (x: number, z: number) => `${x}:${z}`;
const MAX_MERGED_ZONE = 60;
const close = (a: ApproachRange, b: ApproachRange) => a.start <= b.end + 2.5 && b.start <= a.end + 2.5;

function samples(lane: TrafficLane): (RoadPose & { at: number })[] {
  if (lane.path.length < 5) return [];
  const count = Math.ceil(lane.path.length / 1.1);
  return Array.from({ length: count + 1 }, (_, i) => {
    const at = i * lane.path.length / count;
    return { at, point: lane.pointAt(at), angle: lane.headingAt(at) };
  });
}

export function laneConflicts(first: TrafficLane, second: TrafficLane): LaneConflict[] {
  const a = samples(first);
  const b = samples(second);
  const cells = new Map<string, number[]>();
  b.forEach(({ point: [x, z] }, index) => {
    const id = key(Math.floor(x / CELL), Math.floor(z / CELL));
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id)!.push(index);
  });
  const overlaps = new Map<string, [number, number]>();
  a.forEach((pose, i) => {
    const [x, z] = pose.point;
    for (let col = Math.floor((x - 5) / CELL); col <= Math.floor((x + 5) / CELL); col++) {
      for (let row = Math.floor((z - 5) / CELL); row <= Math.floor((z + 5) / CELL); row++) {
        for (const j of cells.get(key(col, row)) ?? []) {
          if (Math.cos(pose.angle - b[j].angle) < 0.7 && vehiclesOverlap(pose, b[j])) overlaps.set(key(i, j), [i, j]);
        }
      }
    }
  });

  const conflicts: LaneConflict[] = [];
  while (overlaps.size) {
    const start = overlaps.values().next().value!;
    const group = [start];
    overlaps.delete(key(...start));
    let [firstStart, secondStart] = start;
    let [firstEnd, secondEnd] = start;
    for (const [i, j] of group) {
      firstStart = Math.min(firstStart, i);
      firstEnd = Math.max(firstEnd, i);
      secondStart = Math.min(secondStart, j);
      secondEnd = Math.max(secondEnd, j);
      for (let x = i - 1; x <= i + 1; x++) {
        for (let z = j - 1; z <= j + 1; z++) {
          const next = overlaps.get(key(x, z));
          if (!next) continue;
          group.push(next);
          overlaps.delete(key(x, z));
        }
      }
    }
    // Pad by more than the 1.1 m sample spacing so a car waiting at the edge is fully clear.
    const range = (start: number, end: number): ApproachRange => ({ start: Math.max(0, start - 1.8), end: end + 1.8 });
    const zone: LaneConflict = [range(a[firstStart].at, a[firstEnd].at), range(b[secondStart].at, b[secondEnd].at)];
    // Two overlapping turns separated by less than a car length must clear together. This includes
    // a route that crosses the other twice in quick succession, so nobody waits between the two.
    for (let i = conflicts.length - 1; i >= 0; i--) {
      const other = conflicts[i];
      if (!close(zone[0], other[0]) && !close(zone[1], other[1])) continue;
      // Keep separate junctions apart where the routes share a loop or a long street.
      if (zone.some((span, index) => Math.max(span.end, other[index].end)
        - Math.min(span.start, other[index].start) > MAX_MERGED_ZONE)) continue;
      for (const [index, span] of zone.entries()) {
        span.start = Math.min(span.start, other[index].start);
        span.end = Math.max(span.end, other[index].end);
      }
      conflicts.splice(i, 1);
    }
    conflicts.push(zone);
  }
  return conflicts;
}

/** Where two lanes run together in the same direction: `second` at `at + offset` is `first` at `at`. */
export type SharedSpan = { start: number; end: number; offset: number };

export function sharedSpans(first: TrafficLane, second: TrafficLane): SharedSpan[] {
  const a = samples(first);
  const b = samples(second);
  const cells = new Map<string, number[]>();
  b.forEach(({ point: [x, z] }, index) => {
    const id = key(Math.floor(x / CELL), Math.floor(z / CELL));
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id)!.push(index);
  });
  const spans: SharedSpan[] = [];
  let open: SharedSpan | null = null;
  for (const { at, point: [x, z], angle } of a) {
    let match: number | null = null;
    let nearest = 0.8;
    for (const j of cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const d = Math.hypot(b[j].point[0] - x, b[j].point[1] - z);
      if (d < nearest && Math.cos(angle - b[j].angle) > 0.95) {
        nearest = d;
        match = b[j].at - at;
      }
    }
    if (match !== null && open && at - open.end < 4 && Math.abs(match - open.offset) < 3) {
      open.end = at;
    } else if (match !== null) {
      if (open && open.end - open.start > 15) spans.push(open);
      open = { start: at, end: at, offset: match };
    }
  }
  if (open && open.end - open.start > 15) spans.push(open);
  return spans;
}
