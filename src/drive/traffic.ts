import type { Point } from "./data";
import type { CrossingGate, PedestrianCrossings } from "./crossings";
import { distance, type Roads } from "./simulation";
import { motionBlocked, vehiclesOverlap, type RoadPose } from "./vehicle-contact";
import { roundaboutOccupied, TrafficLane, TrafficPath, type TrafficGate, type TrafficRules } from "./traffic-rules";
import { laneConflicts, sharedSpans, type ApproachRange, type SharedSpan } from "./traffic-conflicts";

export interface CarPose {
  point: Point;
  angle: number;
  color: string;
}

const PAINT = ["#315477", "#cebfa7", "#803c30", "#61645f", "#e0e4df", "#447166"];

type LaneYield = ApproachRange & { other: Route; entrance: ApproachRange };
type Route = {
  path: TrafficPath; lane: TrafficLane; gates: TrafficGate[]; crossings: CrossingGate[];
  conflicts: LaneYield[]; shared: (SharedSpan & { other: Route })[]; priority: number;
};
type Leader = { at: number; speed: number };
type TrafficVehicle = {
  route: Route; at: number; speed: number; pace: number; pose: CarPose | null; color: string;
  nextGate: number; stoppedAtSign: number; nextCrossing: number; stationary: number; rejoinAt: number;
};

// Queued cars keep this gap from centre to centre.
const QUEUE_GAP = 6.6;
// A car crawling slower than this ahead counts as a queue that may not clear.
const QUEUE_SPEED = 1;
// Last resort for an unforeseen circular wait: a car held this long away from the
// player, and not at a red light, leaves view and rejoins when it has space.
const STALL_SECONDS = 40;
const STALL_HIDE_DISTANCE = 70;
const END_CLEARANCE = 14;

/**
 * Through traffic skips out-and-back spurs, such as a station access road where the
 * player's guide turns round. Cars would otherwise all U-turn in a narrow dead end.
 */
export function withoutSpurs(points: Point[]): Point[] {
  const path = new TrafficPath(points);
  const direction = (from: number, to: number) => {
    const [x, z] = path.pointAt(from), [a, b] = path.pointAt(to);
    return Math.atan2(a - x, b - z);
  };
  const cuts: [number, number][] = [];
  for (let at = 14; at < path.length - 14; at += 2) {
    const turn = Math.cos(direction(at - 12, at) - direction(at, at + 12));
    if (turn > -0.8 || distance(path.pointAt(at - 12), path.pointAt(at + 12)) > 12) continue;
    // Follow both legs back until they part, where the spur leaves the through road.
    let reach = 12;
    while (at - reach - 2 > 0 && at + reach + 2 < path.length
      && distance(path.pointAt(at - reach - 2), path.pointAt(at + reach + 2)) < 14) reach += 2;
    cuts.push([at - reach, at + reach]);
    at += reach;
  }
  if (!cuts.length) return points;
  // Keep the points outside each spur and join its two ends directly.
  const kept: Point[] = [];
  let cut = 0;
  for (const [i, point] of points.entries()) {
    const at = path.lengths[i];
    while (cuts[cut] && at > cuts[cut][1]) {
      kept.push(path.pointAt(cuts[cut][0]), path.pointAt(cuts[cut][1]));
      cut++;
    }
    if (cuts[cut] && at >= cuts[cut][0]) continue;
    kept.push(point);
  }
  return kept;
}

export class Traffic {
  private cars: TrafficVehicle[] = [];
  visible: CarPose[] = [];

  constructor(routes: Point[][], roads: Roads, private rules?: TrafficRules,
    private pedestrianCrossings?: PedestrianCrossings) {
    const traced: Route[] = [];
    for (const [index, points] of routes.entries()) {
      const path = new TrafficPath(withoutSpurs(points));
      const lane = new TrafficLane(path, roads);
      const route: Route = { path, lane, gates: rules?.forPath(path) ?? [], priority: index, conflicts: [], shared: [],
        crossings: pedestrianCrossings?.forPath(path, roads, lane) ?? [] };
      traced.push(route);
      const count = Math.ceil(path.length / 165);
      for (let i = 0; i < count; i++) {
        const at = path.length * ((i + (index === 0 ? 0.54 : 0.29)) / count);
        const pace = 8 + (i % 5) * 0.73;
        const color = PAINT[(i + (index === 0 ? 2 : 0)) % PAINT.length];
        this.cars.push({ route, at, speed: pace, pace, pose: null, color, nextGate: 0, stoppedAtSign: 0, nextCrossing: 0,
          stationary: 0, rejoinAt: 0 });
      }
    }
    const fromShared = (range: ApproachRange, spans: SharedSpan[]) =>
      spans.some(({ start, end }) => range.start >= start - 2 && range.start <= end + 2);
    for (const [index, first] of traced.entries()) {
      for (const second of traced.slice(index + 1)) {
        // Where the routes share a lane, cars from both queue behind each other.
        const shared = sharedSpans(first.lane, second.lane);
        const mirrored = shared.map(({ start, end, offset }) => ({ start: start + offset, end: end + offset, offset: -offset }));
        first.shared.push(...shared.map((span) => ({ ...span, other: second })));
        second.shared.push(...mirrored.map((span) => ({ ...span, other: first })));
        for (const [a, b] of laneConflicts(first.lane, second.lane)) {
          // Cars already queued together in a shared lane keep their order: where it passes close
          // to itself or splits, they don't also give way to each other. Merges into it still do.
          if (fromShared(a, shared) && fromShared(b, mirrored)) continue;
          first.conflicts.push({ ...a, other: second, entrance: b });
          second.conflicts.push({ ...b, other: first, entrance: a });
        }
      }
    }
  }

  private pose(car: TrafficVehicle, at: number, blocked: (point: Point, angle: number) => boolean): CarPose | null {
    const { lane } = car.route;
    const point = lane.pointAt(at);
    const angle = lane.headingAt(at);
    return blocked(point, angle) ? null : { point, angle, color: car.color };
  }

  private speedAtJunction(car: TrafficVehicle, dt: number, occupants: readonly RoadPose[]) {
    const { gates } = car.route;
    while (gates[car.nextGate] && car.at > gates[car.nextGate].at + 0.12) {
      car.nextGate++;
      car.stoppedAtSign = 0;
    }
    const gate = gates[car.nextGate];
    if (!gate || gate.at - car.at > 35) return { limit: car.pace, stopAt: Infinity };
    const remaining = Math.max(0, gate.at - car.at);
    let waiting;
    if (gate.kind === "stop") {
      if (remaining < 0.12 && car.speed < 0.12) car.stoppedAtSign += dt;
      waiting = car.stoppedAtSign < 1;
    } else if (gate.kind === "signal") {
      waiting = this.rules?.light(gate.head) !== "green";
    } else {
      const others = this.cars.flatMap((other) => other !== car && other.pose ? [other.pose] : []);
      waiting = roundaboutOccupied(gate.ring, gate.merge, [...occupants, ...others]);
    }
    if (waiting) return { limit: Math.sqrt(10.4 * remaining), stopAt: gate.at };
    return { limit: gate.kind === "roundabout" && remaining < 12 ? 4.5 : car.pace, stopAt: Infinity };
  }

  /** Where another car is along this car's route, if they share the lane there. */
  private positionOf(other: TrafficVehicle, car: TrafficVehicle): number | null {
    if (other.route === car.route) return other.at;
    for (const span of car.route.shared) {
      const at = other.at - span.offset;
      if (span.other === other.route && at >= span.start && at <= span.end) return at;
    }
    return null;
  }

  /** The nearest visible car ahead in this car's lane, measured along its own route. */
  private leader(car: TrafficVehicle): Leader | null {
    let nearest: Leader | null = null;
    for (const other of this.cars) {
      if (other === car || !other.pose) continue;
      const at = this.positionOf(other, car);
      if (at !== null && at > car.at && (!nearest || at < nearest.at)) nearest = { at, speed: other.speed };
    }
    return nearest;
  }

  /** Whether a queue ahead would leave this car standing between `from` and `to`. */
  private wouldBlock(car: TrafficVehicle, leader: Leader | null, from: number, to: number): boolean {
    if (!leader || leader.speed >= QUEUE_SPEED) return false;
    const waitAt = leader.at - QUEUE_GAP;
    return waitAt > Math.max(car.at, from) && waitAt < to;
  }

  private pedestrianStop(car: TrafficVehicle, leader: Leader | null): number {
    const { crossings } = car.route;
    // Let a car already entering the crossing clear it. Contact checks still apply.
    while (crossings[car.nextCrossing] && crossings[car.nextCrossing].at < car.at - 0.5) car.nextCrossing++;
    for (let i = car.nextCrossing; i < crossings.length && crossings[i].at - car.at < 28; i++) {
      const { at, crossing } = crossings[i];
      if (this.pedestrianCrossings?.active(crossings[i])) return Math.max(car.at, at);
      // Keep the zebra clear when the queue beyond it has no room for this car.
      const far = at + crossing.link[2] + 2 * 2.8 + 2.2;
      if (this.wouldBlock(car, leader, at + 0.3, far)) return Math.max(car.at, at);
    }
    return Infinity;
  }

  /** A stopped rival whose next move runs into this car cannot clear the junction first. */
  private heldBy(rival: TrafficVehicle, car: TrafficVehicle): boolean {
    if (rival.speed > 0.05 || !car.pose) return false;
    const { lane } = rival.route;
    for (const step of [1.4, 2.8, 4.2]) {
      const ahead = { point: lane.pointAt(rival.at + step), angle: lane.headingAt(rival.at + step) };
      if (vehiclesOverlap(ahead, car.pose)) return true;
    }
    return false;
  }

  private conflictStop(car: TrafficVehicle, leader: Leader | null): number {
    let stop = Infinity;
    for (const { start, end, other, entrance } of car.route.conflicts) {
      const remaining = start - car.at;
      if (remaining < 0 || remaining > 17) continue;
      // Don't block the junction: wait at its entrance until the queue beyond it moves.
      if (this.wouldBlock(car, leader, start - 0.9, end + 2.2)) {
        stop = Math.min(stop, Math.max(car.at, start - 0.9));
        continue;
      }
      for (const rival of this.cars) {
        if (rival.route !== other || !rival.pose || rival.at > entrance.end) continue;
        const opposing = entrance.start - rival.at;
        if (opposing > 11 || this.heldBy(rival, car)) continue;
        // Traffic already in the turn clears it first. Approaching drivers compare distance to the entrance.
        if (opposing <= 0 || opposing < remaining - 0.4
          || (Math.abs(opposing - remaining) <= 0.4 && other.priority < car.route.priority)) {
          stop = Math.min(stop, Math.max(car.at, start - 0.9));
        }
      }
    }
    return stop;
  }

  private queueStop(car: TrafficVehicle, leader: Leader | null): number {
    if (!leader || leader.at - car.at >= 25) return Infinity;
    return Math.max(car.at, leader.at - QUEUE_GAP);
  }

  /** Send a car that reached the end of its route back to the start. */
  private restart(car: TrafficVehicle): void {
    car.at = 0;
    car.pose = null;
    car.nextGate = 0;
    car.nextCrossing = 0;
    car.stoppedAtSign = 0;
    car.stationary = 0;
    car.rejoinAt = 0;
  }

  step(dt: number, center: Point, occupants: readonly RoadPose[],
    blocked: (point: Point, angle: number) => boolean): void {
    this.rules?.advance(dt);
    this.pedestrianCrossings?.update(occupants);
    const solid = occupants.filter((other) => !other.waiting);
    const active: CarPose[] = [];
    for (const car of this.cars) {
      const { path } = car.route;
      const next = car.at + car.speed * dt;
      if (next > path.length) {
        this.restart(car);
        continue;
      }
      if (car.at < car.rejoinAt) {
        // Pass the blockage out of view before appearing again.
        car.at = next;
        car.speed = car.pace;
        continue;
      }
      const leader = this.leader(car);
      const junction = this.speedAtJunction(car, dt, occupants);
      const pedestrian = this.pedestrianStop(car, leader);
      const conflict = this.conflictStop(car, leader);
      const queue = this.queueStop(car, leader);
      const stopAt = Math.min(junction.stopAt, pedestrian, conflict, queue);
      const at = Math.max(car.at, Math.min(next, stopAt));
      const safeSpeed = Math.min(junction.limit, Math.sqrt(10.4 * Math.max(0, junction.stopAt - at)),
        Math.sqrt(7.6 * Math.max(0, pedestrian - at)), Math.sqrt(8.8 * Math.max(0, conflict - at)),
        Math.sqrt(9.8 * Math.max(0, queue - at)));
      const targetSpeed = Math.min(car.pace, safeSpeed, car.speed + dt * 3);
      if (distance(path.pointAt(at), center) > 260) {
        car.at = at;
        car.pose = null;
        car.speed = targetSpeed;
        car.stationary = 0;
        continue;
      }
      const gate = car.route.gates[car.nextGate];
      const atRedLight = gate?.kind === "signal" && gate.at - car.at < 40 && this.rules?.light(gate.head) !== "green";
      // Measure progress rather than speed. A blocked car can creep at a token speed without moving.
      car.stationary = car.pose && at - car.at < 0.02 && !atRedLight ? car.stationary + dt : 0;
      // The routes meet head to head at each end. A car held there finishes its trip
      // instead of locking with cars starting the other way.
      if (car.pose && car.stationary > 2 && path.length - car.at < END_CLEARANCE) {
        this.restart(car);
        continue;
      }
      if (car.pose && car.stationary > STALL_SECONDS && distance(car.pose.point, center) > STALL_HIDE_DISTANCE) {
        // Rejoin out of view, as cars beyond the visible range already do.
        car.pose = null;
        car.stationary = 0;
        car.rejoinAt = car.at + STALL_HIDE_DISTANCE;
        continue;
      }
      // A car queued behind in the same lane keeps its own distance. On a tight turn the
      // leader's path can curl back over it, and the leader must not wait for its follower.
      const follows = (other: TrafficVehicle) => {
        const at = this.positionOf(other, car);
        return at !== null && at < car.at && car.at - at < 20;
      };
      const occupied = (pose: RoadPose) => solid.some((other) => vehiclesOverlap(pose, other))
        || this.cars.some((other) => other !== car && other.pose && vehiclesOverlap(pose, other.pose) && !follows(other));
      const current = car.pose;
      if (current && (blocked(current.point, current.angle)
        || solid.some((other) => vehiclesOverlap(current, other)))) car.pose = null;
      const pose = this.pose(car, at, blocked);
      // Don't appear on a zebra someone is crossing. The walker would wait for the car.
      const appearsOnCrossing = !car.pose && pedestrian - at < 6;
      if (!pose || appearsOnCrossing || motionBlocked(car.pose, pose, occupied)) {
        if (car.pose && path.length - car.at < END_CLEARANCE) {
          this.restart(car);
          continue;
        }
        if (car.pose) car.speed = 0;
        // An offscreen car can keep progressing until it has space to appear.
        else {
          car.at = at;
          car.speed = targetSpeed;
        }
      } else {
        car.at = at;
        car.pose = pose;
        let clear = true;
        const brakingDistance = Math.max(1.8, car.speed ** 2 / 14 + 1.3);
        for (let ahead = 1.4; ahead <= brakingDistance; ahead += 1.4) {
          const look = this.pose(car, Math.min(path.length, at + ahead), blocked);
          if (!look || occupied(look)) {
            clear = false;
            break;
          }
        }
        // Crawl up to a nearby obstacle. The swept contact check stops the actual movement.
        car.speed = clear ? targetSpeed : Math.min(targetSpeed, Math.max(0.55, car.speed - dt * 8));
        if (at >= stopAt) car.speed = 0;
      }
      if (car.pose && !blocked(car.pose.point, car.pose.angle)) active.push(car.pose);
    }
    this.visible = active;
  }
}
