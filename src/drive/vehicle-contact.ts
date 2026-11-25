import type { GroundMode, Point } from "./data";

export type RoadPose = {
  point: Point; angle: number; mode?: GroundMode; travelHeading?: number;
  /** A walker standing at the kerb before a crossing. Traffic passes, and the walker steps out of view. */
  waiting?: boolean;
};

// Half sizes in metres, including the car's bumpers and mirrors.
const size = {
  car: { length: 2.13, width: 1.04 },
  bike: { length: 1.04, width: 0.32 },
  walk: { length: 0.29, width: 0.29 },
};

export function vehiclesOverlap(a: RoadPose, b: RoadPose): boolean {
  const dx = b.point[0] - a.point[0], dz = b.point[1] - a.point[1];
  if (dx * dx + dz * dz > 23) return false;
  const first = size[a.mode ?? "car"];
  const second = size[b.mode ?? "car"];
  const sa = Math.sin(a.angle), ca = Math.cos(a.angle);
  const sb = Math.sin(b.angle), cb = Math.cos(b.angle);
  const parallel = Math.abs(sa * sb + ca * cb);
  const perpendicular = Math.abs(sa * cb - ca * sb);
  // A separating axis in either car's frame means the bodies do not touch.
  return Math.abs(dx * sa + dz * ca) < first.length + second.length * parallel + second.width * perpendicular
    && Math.abs(dx * ca - dz * sa) < first.width + second.width * parallel + second.length * perpendicular
    && Math.abs(dx * sb + dz * cb) < second.length + first.length * parallel + first.width * perpendicular
    && Math.abs(dx * cb - dz * sb) < second.width + first.width * parallel + first.length * perpendicular;
}

export function motionBlocked(from: RoadPose | null, to: RoadPose, blocked: (pose: RoadPose) => boolean): boolean {
  if (blocked(to)) return true;
  if (!from) return false;
  const dx = to.point[0] - from.point[0], dz = to.point[1] - from.point[1];
  const distance = Math.hypot(dx, dz);
  // A station jump reserves its destination. Driving checks the space in between.
  if (distance > 8) return false;
  const delta = to.angle - from.angle;
  const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
  const steps = Math.ceil((distance + Math.abs(turn) * size[to.mode ?? "car"].length) / 0.28);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocked({
      point: [from.point[0] + dx * t, from.point[1] + dz * t],
      angle: from.angle + turn * t,
      mode: to.mode,
    })) return true;
  }
  return false;
}
