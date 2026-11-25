import * as T from "three";
import type { Corridor, Point, RoadMode } from "./data";
import { carLaneCenter, type Roads, type Simulation } from "./simulation";
import type { TrafficSigns } from "./traffic-signs";

const paint = new T.MeshBasicMaterial({ color: "#b1f5dc", side: T.DoubleSide });
const outline = new T.MeshBasicMaterial({ color: "#1d625a", side: T.DoubleSide });
const straight: Point[] = [
  [-0.18, -0.8], [0.18, -0.8], [0.18, 0.12], [0.54, 0.12],
  [0, 1.03], [-0.54, 0.12], [-0.18, 0.12],
];
const turn: Point[] = [
  [-0.46, -0.87], [-0.08, -0.87], [-0.08, 0.10], [0.20, 0.32],
  [0.20, 0.69], [1.00, 0.21], [0.20, -0.31], [0.20, -0.05], [-0.46, -0.13],
];

function marks(points: Point[], roads: Roads, mode: RoadMode, signs: TrafficSigns): T.Group {
  const group = new T.Group();
  if (points.length < 2) return group;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const length = lengths.at(-1)!;
  const sample = (at: number): Point => {
    const value = Math.max(0, Math.min(length, at));
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] >= value) hi = mid;
      else lo = mid;
    }
    const t = (value - lengths[lo]) / (lengths[hi] - lengths[lo] || 1);
    const [ax, az] = points[lo];
    const [bx, bz] = points[hi];
    return [ax + t * (bx - ax), az + t * (bz - az)];
  };
  const heading = ([ax, az]: Point, [bx, bz]: Point) => Math.atan2(bx - ax, bz - az);
  const shapes = [straight, turn, turn.map(([x, z]): Point => [-x, z])].map((shape) => {
    const geometry = new T.ShapeGeometry(new T.Shape(shape.map(([x, z]) => new T.Vector2(x, -z))));
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  });
  const entries: { at: number; kind: number; direction?: number }[] = [];
  const turns: typeof entries = [];
  for (let i = 1; i + 1 < points.length; i++) {
    const at = lengths[i];
    if (at < 5 || at > length - 6 || (turns.length && at < turns.at(-1)!.at + 18)) continue;
    const angle = heading(sample(at - 5), sample(at - 0.5));
    const next = heading(sample(at + 0.6), sample(at + 6));
    const change = Math.atan2(Math.sin(next - angle), Math.cos(next - angle));
    if (Math.abs(change) < 0.58 || Math.abs(change) > 2.7) continue;
    turns.push({ at: at - 3.5, kind: change > 0 ? 1 : 2, direction: angle });
  }
  // Extra arrows near junctions, spaced apart from the regular ones.
  entries.push(...turns);
  let turnIndex = 0;
  for (let at = 3.3; at < length - 1; at += mode === "bike" ? 12 : 15) {
    while (turns[turnIndex]?.at < at - 5) turnIndex++;
    if (turns[turnIndex]?.at <= at + 5) continue;
    entries.push({ at, kind: 0 });
  }

  const scratch = new T.Object3D();
  const placements = entries.flatMap(({ at, kind, direction }) => {
    const point = sample(at);
    const angle = direction ?? heading(sample(at - 1.3), sample(at + 1.3));
    const lane = mode === "car" ? roads.carriageway(point, 1.8, angle) : null;
    if (mode === "car" && (!lane || Math.cos(lane.heading - angle) < 0.68)) return [];
    const placement = lane ? carLaneCenter(lane) : point;
    const restriction = signs.ahead(placement, angle, mode, "no-entry");
    if (restriction && restriction.distance < 15) return [];
    return [{ kind, point: placement, angle }];
  });
  for (const [kind, geometry] of shapes.entries()) {
    const row = placements.filter((entry) => entry.kind === kind);
    const arrows = new T.InstancedMesh(geometry, paint, row.length);
    const borders = new T.InstancedMesh(geometry, outline, row.length);
    row.forEach(({ point, angle }, index) => {
      scratch.position.set(point[0], 0.111, point[1]);
      scratch.rotation.y = angle;
      const scale = mode === "car" ? 1.06 : 0.76;
      scratch.scale.set(scale, 1, scale);
      scratch.updateMatrix();
      arrows.setMatrixAt(index, scratch.matrix);
      scratch.position.y = 0.107;
      scratch.scale.set(scale * 1.17, 1, scale * 1.12);
      scratch.updateMatrix();
      borders.setMatrixAt(index, scratch.matrix);
    });
    group.add(borders, arrows);
  }
  return group;
}

export class RoadArrows {
  private variants: Record<RoadMode, [T.Group, T.Group]>;
  constructor(scene: T.Scene, map: Corridor, roads: Record<RoadMode, Roads>, signs: TrafficSigns) {
    this.variants = {
      car: [marks(map.guides.car, roads.car, "car", signs),
        marks(map.carReturn?.track ?? map.guides.car.toReversed(), roads.car, "car", signs)],
      bike: [marks(map.guides.bike, roads.bike, "bike", signs), marks(map.guides.bike.toReversed(), roads.bike, "bike", signs)],
    };
    scene.add(...this.variants.car, ...this.variants.bike);
  }

  follow(world: Simulation): void {
    const reverse = world.returning;
    for (const mode of ["car", "bike"] as const) {
      this.variants[mode][0].visible = world.mode === mode && !reverse;
      this.variants[mode][1].visible = world.mode === mode && reverse;
    }
  }
}
