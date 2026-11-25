import type { Corridor, GroundMode, Mode, Point, RoadMode } from "./data";
import type { Walkways } from "./walking";
import type { RoadPose } from "./vehicle-contact";

type Segment = { a: Point; b: Point; width: number; oneWay: boolean };
type Hit = { point: Point; distance: number; heading: number; width: number; oneWay: boolean };
type JunctionTurn = { point: Point; approach: number; steer: number };

const CELL = 40;
const SPEED = { car: 16.7, bike: 7.8 };
const ACCELERATION = { car: 4.2, bike: 2.6 };
export const BOARDING_DISTANCE = 105;
const DWELL_SECONDS = 9;
const TRAIN_SPEED = 31;
const TRAIN_ACCELERATION = 1.05;
const TRAIN_BRAKING = 1.25;
const FOOT_STEPS = [0, -Math.PI / 6, Math.PI / 6, -Math.PI / 3, Math.PI / 3];

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function mixAngle(a: number, b: number, amount: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * amount;
}

function heading(a: Point, b: Point): number {
  return Math.atan2(b[0] - a[0], b[1] - a[1]);
}

function junctionTurns(route: Point[]): JunctionTurn[] {
  const result: JunctionTurn[] = [];
  for (let i = 1; i + 1 < route.length; i++) {
    const point = route[i];
    const approach = heading(route[i - 1], point);
    const delta = heading(point, route[i + 1]) - approach;
    const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
    if (Math.abs(turn) > 0.69 && Math.abs(turn) < 2.15) result.push({ point, approach, steer: Math.sign(turn) });
  }
  return result;
}

function moveTowards(value: number, target: number, limit: number): number {
  return value + Math.sign(target - value) * Math.min(Math.abs(target - value), limit);
}

export class Roads {
  private cells = new Map<string, Segment[]>();

  constructor(data: Float32Array) {
    for (let i = 0; i < data.length;) {
      const count = data[i++];
      // Signed half-width. Older bundles use positive values for every line.
      const packedWidth = data[i++];
      const width = Math.abs(packedWidth);
      const oneWay = packedWidth < 0;
      let a: Point = [data[i++], data[i++]];
      for (let j = 1; j < count; j++) {
        const b: Point = [data[i++], data[i++]];
        const segment = { a, b, width, oneWay };
        for (let x = Math.floor((Math.min(a[0], b[0]) - width) / CELL);
          x <= Math.floor((Math.max(a[0], b[0]) + width) / CELL); x++) {
          for (let z = Math.floor((Math.min(a[1], b[1]) - width) / CELL);
            z <= Math.floor((Math.max(a[1], b[1]) + width) / CELL); z++) {
            const key = `${x}:${z}`;
            let cell = this.cells.get(key);
            if (!cell) this.cells.set(key, cell = []);
            cell.push(segment);
          }
        }
        a = b;
      }
    }
  }

  nearest([x, z]: Point, radius: number, direction?: number, inLane = false,
    usable?: (point: Point, angle: number, hit: Hit) => boolean, driving = false): Hit | null {
    let best: Hit | null = null;
    let score = Infinity;
    for (let col = Math.floor((x - radius) / CELL); col <= Math.floor((x + radius) / CELL); col++) {
      for (let row = Math.floor((z - radius) / CELL); row <= Math.floor((z + radius) / CELL); row++) {
        for (const { a, b, width, oneWay } of this.cells.get(`${col}:${row}`) ?? []) {
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const length2 = dx * dx + dz * dz;
          if (!length2) continue;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2));
          const px = a[0] + dx * t;
          const pz = a[1] + dz * t;
          const d = Math.hypot(px - x, pz - z);
          const limit = driving && oneWay ? width - 0.75 : width;
          if (d > radius || (inLane && d > limit)) continue;
          let angle = Math.atan2(dx, dz);
          const alignment = direction === undefined ? 1 : Math.cos(angle - direction);
          if (driving && oneWay && alignment < 0) continue;
          if (alignment < 0) angle += Math.PI;
          const priority = d + (1 - Math.abs(alignment)) * (inLane ? 0.4 : 1.5);
          if (priority >= score) continue;
          const hit: Hit = { point: [px, pz], distance: d, heading: angle, width, oneWay };
          if (usable && !usable(hit.point, angle, hit)) continue;
          score = priority;
          best = hit;
        }
      }
    }
    return best;
  }

  carriageway(point: Point, radius: number, direction: number, inLane = true,
    usable?: (point: Point, angle: number, hit: Hit) => boolean): Hit | null {
    return this.nearest(point, radius, direction, inLane, usable, true);
  }
}

export function carLaneOffset(hit: Hit): number {
  // Keep the 1.79 m body inside the carriageway while leaving oncoming cars room to pass
  // on a 4.5 m residential street.
  return hit.oneWay ? 0 : Math.min(1.18, Math.max(0, hit.width - 1.05));
}

export function carLaneCenter(hit: Hit): Point {
  const offset = carLaneOffset(hit);
  return [hit.point[0] - Math.cos(hit.heading) * offset, hit.point[1] + Math.sin(hit.heading) * offset];
}

export type RoadObstacle = "building" | "traffic" | "scenery";

export interface Input {
  throttle: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
}

export class Simulation {
  readonly lengths: number[];
  readonly stopDistances: number[];
  readonly hasTrain: boolean;
  private readonly turns: [outbound: JunctionTurn[], returning: JunctionTurn[]];
  private readonly defaultMode: GroundMode;
  mode: Mode;
  position: Point = [0, 0];
  angle = 0;
  speed = 0;
  journeyStart = 0;
  roadLimit = false;
  obstacle: RoadObstacle | null = null;
  roadObstacle: (point: Point, angle: number, mode: GroundMode) => RoadObstacle | null = () => null;
  train = { distance: 0, speed: 0, current: 0, next: 1, direction: 1, dwell: DWELL_SECONDS };
  pendingStop: number | null = null;

  constructor(readonly map: Corridor, private readonly roads: Record<RoadMode, Roads>, private walkways: Walkways,
    private readonly modes: readonly Mode[] = ["car", "bike", "walk", "train"]) {
    this.hasTrain = modes.includes("train") && map.track.length >= 2;
    this.turns = [junctionTurns(map.guides.car), junctionTurns(map.carReturn?.track ?? map.guides.car.toReversed())];
    const defaultMode = modes.find((mode) => mode !== "train");
    if (!defaultMode) throw new Error("The area needs at least one ground mode");
    this.defaultMode = this.mode = defaultMode;
    this.lengths = [0];
    map.track.slice(1).forEach((point, i) => {
      this.lengths.push(this.lengths[i] + distance(map.track[i], point));
    });
    this.stopDistances = map.stops.map((stop) => this.lengths[stop.trackIndex]);
    if (!this.restart(0)) throw new Error("No safe starting point in this area");
  }

  restart(stop: number): boolean {
    const previous = this.journeyStart;
    this.journeyStart = stop;
    const mode = this.mode === "train" ? this.defaultMode : this.mode;
    if (!this.placeAtStation(mode, stop) && (mode === this.defaultMode || !this.placeAtStation(this.defaultMode, stop))) {
      this.journeyStart = previous;
      return false;
    }
    this.train = {
      distance: this.stopDistances[stop], speed: 0, current: stop,
      next: stop === this.map.stops.length - 1 ? stop - 1 : stop + 1,
      direction: stop === this.map.stops.length - 1 ? -1 : 1,
      dwell: this.hasTrain ? DWELL_SECONDS : 0,
    };
    this.pendingStop = null;
    return true;
  }

  get returning(): boolean {
    return this.journeyStart === this.map.stops.length - 1;
  }

  private placeAtStation(mode: GroundMode, stop: number): boolean {
    if (mode === "walk") {
      const { point, access } = this.map.stops[stop];
      const angle = heading(access.car, access.bike);
      const foot = this.walkways.nearest(access.bike, this.hasTrain ? 32 : 60, (candidate) => {
        const obstacle = this.roadObstacle(candidate, angle, "walk");
        return (!this.hasTrain || distance(candidate, point) <= BOARDING_DISTANCE)
          && obstacle !== "building" && obstacle !== "traffic";
      });
      if (!foot) return false;
      this.mode = "walk";
      this.position = foot;
      this.angle = this.walkingHeading(foot, angle);
      this.speed = 0;
      this.roadLimit = false;
      this.obstacle = null;
      return true;
    }
    const last = this.map.stops.length - 1;
    const returning = stop === last || (stop > 0 && this.returning);
    const carReturn = mode === "car" && returning ? this.map.carReturn : undefined;
    const station = this.map.stops[stop];
    const guide = this.map.guides[mode];
    const returnIndex = carReturn?.stopIndices[last - stop] ?? 0;
    const anchor = carReturn?.track[returnIndex] ?? station.access[mode];
    const target = carReturn?.track[returnIndex + 1] ?? guide[station.approach[mode] + (returning ? -1 : 1)];
    const direction = heading(anchor, target);
    const hit = mode === "car" ? this.roads.car.carriageway(anchor, 120, direction, false)
      : this.roads.bike.nearest(anchor, 120, direction);
    if (!hit) return false;
    const start = this.findRoadSpawn(mode, mode === "car" ? carLaneCenter(hit) : hit.point, hit.heading, true);
    if (!start) return false;
    this.mode = mode;
    this.position = start.point;
    this.angle = start.angle;
    this.speed = 0;
    this.roadLimit = false;
    this.obstacle = null;
    return true;
  }

  ensureClearSpawn(): void {
    const mode = this.mode;
    if (mode === "train") return;
    const obstacle = this.roadObstacle(this.position, this.angle, mode);
    if (obstacle !== "building" && obstacle !== "traffic") return;
    if (mode === "walk") {
      const foot = this.walkways.nearest(this.position, 25,
        (point) => this.roadObstacle(point, this.angle, "walk") === null);
      if (foot) {
        this.position = foot;
        this.angle = this.walkingHeading(foot, this.angle);
      }
      this.speed = 0;
      return;
    }
    this.speed = 0;
    const start = this.findRoadSpawn(mode, this.position, this.angle);
    if (!start) return;
    this.position = start.point;
    this.angle = start.angle;
  }

  private findRoadSpawn(mode: RoadMode, point: Point, angle: number, allowScenery = false): RoadPose | null {
    const clear = (position: Point, direction: number) => {
      const obstacle = this.roadObstacle(position, direction, mode);
      return obstacle === null || (allowScenery && obstacle === "scenery");
    };
    if (clear(point, angle)) return { point, angle };
    const accepts = (position: Point, direction: number, hit: Hit) =>
      clear(mode === "car" ? carLaneCenter(hit) : position, direction);
    const locate = (probe: Point, radius: number) => {
      const hit = mode === "car" ? this.roads.car.carriageway(probe, radius, angle, false, accepts)
        : this.roads.bike.nearest(probe, radius, angle, false, accepts);
      return hit && { point: mode === "car" ? carLaneCenter(hit) : hit.point, angle: hit.heading };
    };
    for (const gap of [5, -5, 10, -10, 15, -15, 22, -22, 32, -32]) {
      const start = locate([point[0] + Math.sin(angle) * gap, point[1] + Math.cos(angle) * gap], 3.5);
      if (start) return start;
    }
    return locate(point, 110);
  }

  get nearbyStop(): number {
    const d = this.map.stops.map(({ point }) => distance(point, this.position));
    const closest = Math.min(...d);
    return closest <= BOARDING_DISTANCE ? d.indexOf(closest) : -1;
  }

  get currentStop(): number | null {
    return this.train.dwell > 0 ? this.train.current : null;
  }

  get canBoard(): boolean {
    const stop = this.nearbyStop;
    return this.mode !== "train" && stop >= 0 && this.currentStop === stop && Math.abs(this.speed) < 0.8;
  }

  switchGroundMode(mode: GroundMode): boolean {
    if (!this.modes.includes(mode)) return false;
    if (this.mode === mode) return true;
    if (this.mode === "train") return this.alight(mode);
    if (Math.abs(this.speed) >= 0.8) return false;
    if (mode === "walk") {
      const foot = this.walkways.nearest(this.position, 12,
        (point) => this.roadObstacle(point, this.angle, "walk") === null);
      if (!foot) return false;
      this.mode = "walk";
      this.position = foot;
      this.angle = this.walkingHeading(foot, this.angle);
      this.speed = 0;
      this.roadLimit = false;
      this.obstacle = null;
      return true;
    }
    const clear = (point: Point, angle: number, hit: Hit) =>
      !this.roadObstacle(mode === "car" ? carLaneCenter(hit) : point, angle, mode);
    const hit = mode === "car" ? this.roads.car.carriageway(this.position, 24, this.angle, false, clear)
      : this.roads.bike.nearest(this.position, 24, this.angle, false, clear);
    if (!hit) {
      const stop = this.nearbyStop;
      return this.mode === "walk" && stop >= 0 && this.placeAtStation(mode, stop);
    }
    this.mode = mode;
    this.position = mode === "car" ? carLaneCenter(hit) : hit.point;
    this.angle = hit.heading;
    this.speed = 0;
    this.roadLimit = false;
    this.obstacle = null;
    return true;
  }

  board(): boolean {
    if (!this.canBoard) return false;
    this.mode = "train";
    this.train.dwell = Math.min(this.train.dwell, 4);
    this.position = this.trackPoint(this.train.distance);
    this.angle = this.trainHeading();
    this.pendingStop = null;
    return true;
  }

  /** While parked at a station, call the pilot shuttle to the platform. */
  callTrain(): boolean {
    const stop = this.nearbyStop;
    if (!this.hasTrain || this.mode === "train" || stop < 0 || Math.abs(this.speed) >= 0.8) return false;
    if (this.currentStop !== stop) this.pendingStop = stop;
    return true;
  }

  alight(mode: GroundMode): boolean {
    if (this.mode !== "train" || this.currentStop === null || !this.modes.includes(mode)) return false;
    const stop = this.train.current;
    if (!this.placeAtStation(mode, stop)) return false;
    if (stop === 0 || stop === this.map.stops.length - 1) this.journeyStart = stop;
    return true;
  }

  trackPoint(metres: number): Point {
    const track = this.map.track;
    const lengths = this.lengths;
    if (metres <= 0) return track[0];
    if (metres >= lengths.at(-1)!) return track.at(-1)!;
    let low = 0;
    let high = lengths.length - 1;
    while (high - low > 1) {
      const mid = (high + low) >> 1;
      if (lengths[mid] < metres) low = mid;
      else high = mid;
    }
    const t = (metres - lengths[low]) / (lengths[high] - lengths[low]);
    const a = track[low];
    const b = track[high];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  trainHeading(): number {
    const d = this.train.distance;
    const a = this.trackPoint(d - 13);
    const b = this.trackPoint(d + 13);
    return this.train.direction === 1 ? heading(a, b) : heading(b, a);
  }

  private stepTrain(dt: number, held: boolean): void {
    const train = this.train;
    if (train.dwell > 0) {
      // Hold the local shuttle while the player is nearby and deciding to board.
      if (held && train.dwell < 4) return;
      train.dwell = Math.max(0, train.dwell - dt);
      return;
    }
    const target = this.stopDistances[train.next];
    const remaining = Math.abs(target - train.distance);
    const targetSpeed = Math.min(TRAIN_SPEED, Math.sqrt(2 * TRAIN_BRAKING * remaining));
    train.speed = moveTowards(train.speed, targetSpeed, dt * (train.speed > targetSpeed ? TRAIN_BRAKING : TRAIN_ACCELERATION));
    const step = Math.max(0.15, train.speed) * dt;
    train.distance += Math.min(remaining, step) * train.direction;
    if (remaining > step) return;

    train.distance = target;
    train.current = train.next;
    train.speed = 0;
    train.dwell = DWELL_SECONDS;
    if (train.current === 0) train.direction = 1;
    if (train.current === this.stopDistances.length - 1) train.direction = -1;
    train.next = train.current + train.direction;
    if (this.pendingStop === train.current) this.pendingStop = null;
  }

  private walkingHeading([x, z]: Point, preferred: number): number {
    let best = preferred;
    let score = -Infinity;
    for (let lane = -11; lane <= 12; lane++) {
      const angle = preferred + lane * Math.PI / 12;
      const dx = Math.sin(angle), dz = Math.cos(angle);
      let metres = 0;
      while (metres < 6) {
        const next: Point = [x + dx * (metres + 0.5), z + dz * (metres + 0.5)];
        if (!this.walkways.includes(next) || this.roadObstacle(next, angle, "walk") === "building") break;
        metres += 0.5;
      }
      const priority = metres - Math.abs(lane) * 0.09;
      if (priority > score) {
        best = angle;
        score = priority;
      }
    }
    return best;
  }

  private stepWalking(dt: number, input: Input): void {
    const steer = Number(input.left) - Number(input.right);
    this.angle += steer * dt * 2.4;
    const target = input.brake ? 0 : input.reverse ? -0.86 : input.throttle ? 1.72 : 0;
    this.speed = moveTowards(this.speed, target, dt * (input.brake ? 14 : 5.8));
    if (Math.abs(this.speed) < 0.025) return;
    const n = this.speed * dt;
    const [x, z] = this.position;
    this.roadLimit = true;
    this.obstacle = null;
    // Follow an angled curb with digital controls when the forward step is blocked.
    for (const offset of FOOT_STEPS) {
      const direction = this.angle + offset;
      const stride = n * Math.cos(offset);
      const point: Point = [x + Math.sin(direction) * stride, z + Math.cos(direction) * stride];
      if (!this.walkways.includes(point)) continue;
      const obstacle = this.roadObstacle(point, this.angle, "walk");
      if (obstacle) {
        this.obstacle ??= obstacle;
        continue;
      }
      this.position = point;
      this.roadLimit = false;
      this.obstacle = null;
      return;
    }
    this.speed = 0;
  }

  step(dt: number, input: Input): void {
    if (this.hasTrain) {
      const holding = this.mode !== "train" && this.nearbyStop === this.currentStop && Math.abs(this.speed) < 0.8;
      this.stepTrain(dt, holding);
    }
    if (this.mode === "train") {
      this.position = this.trackPoint(this.train.distance);
      this.angle = this.trainHeading();
      this.speed = this.train.speed;
      return;
    }

    const mode = this.mode;
    if (mode === "walk") {
      this.stepWalking(dt, input);
      return;
    }
    const steer = Number(input.left) - Number(input.right);
    let steering = steer;
    if (mode === "car" && steer && !input.reverse) {
      const upcoming = this.turns[this.returning ? 1 : 0].find(({ point, approach, steer: side }) => {
        if (side !== steer || Math.cos(this.angle - approach) < 0.89) return false;
        const dx = point[0] - this.position[0], dz = point[1] - this.position[1];
        const along = dx * Math.sin(approach) + dz * Math.cos(approach);
        const across = dx * Math.cos(approach) - dz * Math.sin(approach);
        return along > 2.9 && along < 13 && Math.abs(across) < 2.8;
      });
      if (upcoming) steering = 0;
    }
    let target = 0;
    if (!input.brake) {
      if (input.throttle) target = steer ? (mode === "car" ? 4.5 : SPEED.bike * 0.68) : SPEED[mode];
      else if (steer && mode === "car") target = 1.5;
      if (input.reverse) target = mode === "car" ? -4.5 : -1.8;
    }
    const braking = input.brake || (target !== 0 && Math.sign(target) !== Math.sign(this.speed));
    const slowingToTurn = steer && Math.abs(this.speed) > Math.abs(target);
    const rate = braking || slowingToTurn ? 10 : target === 0 ? 3.2 : ACCELERATION[mode];
    this.speed = moveTowards(this.speed, target, dt * rate);
    if (Math.abs(this.speed) < 0.03) return;
    const turn = (mode === "car" ? 1.8 : 2.6) * Math.min(1, 0.25 + Math.abs(this.speed) / 2.8);
    const turnAngle = this.angle + steering * dt * turn * Math.sign(this.speed);
    const step = this.speed * dt;
    const candidate: Point = [
      this.position[0] + Math.sin(turnAngle) * step,
      this.position[1] + Math.cos(turnAngle) * step,
    ];
    const hit = mode === "car" ? this.roads.car.carriageway(candidate, 8, turnAngle)
      : this.roads.bike.nearest(candidate, 8, turnAngle, true);
    const size = this.map.tileSize;
    const covered = this.map.tiles.some(([col, row]) =>
      Math.floor(candidate[0] / size) === col && Math.floor(candidate[1] / size) === row,
    );
    this.obstacle = null;
    this.roadLimit = !hit || !covered;
    if (hit && covered) {
      // Gentle centring with digital steering. Use the raw steering position
      // if centring would point into a wall or a vehicle.
      const assist = steering ? 0 : Math.max(0, Math.cos(turnAngle - hit.heading));
      const blend = assist * Math.min(1, Math.abs(step) * 0.13);
      const lane = mode === "car" ? carLaneCenter(hit) : hit.point;
      const centred: Point = [
        candidate[0] + (lane[0] - candidate[0]) * blend,
        candidate[1] + (lane[1] - candidate[1]) * blend,
      ];
      const angle = mixAngle(turnAngle, hit.heading, assist * Math.min(dt * 3.5, 0.3));
      this.obstacle = this.roadObstacle(centred, angle, mode);
      if (!this.obstacle) {
        this.position = centred;
        this.angle = angle;
        return;
      }
      this.obstacle = this.roadObstacle(candidate, turnAngle, mode);
      if (!this.obstacle) {
        this.position = candidate;
        this.angle = turnAngle;
        return;
      }
    }
    this.speed = this.obstacle === "traffic" ? 0 : this.speed * Math.max(0, 1 - 13 * dt);
  }
}
