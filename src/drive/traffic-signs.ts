import * as T from "three";
import type { Point, RoadMode } from "./data";
import type { Roads } from "./simulation";
import type { WalkingLink, Walkways } from "./walking";
import type { StopLine } from "./traffic-rules";

type SignKind = "stop" | "yield" | "priority" | "speed" | "no-entry" | "one-way" | "one-way-turn"
  | "crossing" | "roundabout" | "cycleway" | "footpath";
export interface TrafficSign {
  kind: SignKind;
  point: Point;
  bearing: number;
  detail?: string;
  supplementary?: string[];
  street?: string;
}

const controls = ["stop", "yield", "crossing", "no-entry"] as const;
type Control = (typeof controls)[number];
/** `paint` is where markings are drawn when it differs from the point traffic stops for. */
type Approach = { kind: Control; point: Point; heading: number; width: number; mode: RoadMode; paint?: Point };
const paint = new T.MeshBasicMaterial({ color: "#eee9da", side: T.DoubleSide });

function polygon(ctx: CanvasRenderingContext2D, points: Point[], color: string, inset = 1): void {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(64 + (x - 64) * inset, 64 + (y - 64) * inset);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function text(ctx: CanvasRenderingContext2D, value: string, size: number, color: string, y = 65) {
  ctx.font = `bold ${size}px Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, 64, y, 103);
}

function stroke(ctx: CanvasRenderingContext2D, points: Point[], width: number) {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.lineWidth = width;
  ctx.stroke();
}

function face({ kind, detail }: TrafficSign): T.MeshBasicMaterial {
  const texture = document.createElement("canvas");
  texture.width = texture.height = 128;
  const ctx = texture.getContext("2d")!;
  const red = "#ca262c", white = "#f9faf6", blue = "#145591", ink = "#152028";
  if (kind === "stop") {
    const stop: Point[] = [[42, 5], [86, 5], [123, 42], [123, 86], [86, 123], [42, 123], [5, 86], [5, 42]];
    polygon(ctx, stop, white);
    polygon(ctx, stop, red, 0.90);
    text(ctx, "STOP", 34, white, 66);
  } else if (kind === "yield") {
    const triangle: Point[] = [[4, 15], [124, 15], [64, 118]];
    polygon(ctx, triangle, white);
    polygon(ctx, triangle, red, 0.93);
    polygon(ctx, triangle, white, 0.63);
  } else if (kind === "priority") {
    const diamond: Point[] = [[64, 6], [122, 64], [64, 122], [6, 64]];
    polygon(ctx, diamond, ink);
    polygon(ctx, diamond, white, 0.94);
    polygon(ctx, diamond, "#ecc237", 0.71);
  } else if (kind === "speed") {
    const zone = detail?.startsWith("zone-");
    if (zone) {
      ctx.fillStyle = white;
      ctx.fillRect(13, 4, 102, 120);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 3;
      ctx.strokeRect(15, 7, 98, 114);
      text(ctx, "ZONE", 20, ink, 25);
    }
    const y = zone ? 76 : 64;
    circle(ctx, 64, y, zone ? 40 : 61, red);
    circle(ctx, 64, y, zone ? 32 : 48, white);
    text(ctx, detail?.replace("zone-", "") ?? "", zone ? 32 : 50, ink, y + 2);
  } else if (kind === "no-entry") {
    circle(ctx, 64, 64, 61, white);
    circle(ctx, 64, 64, 57, red);
    ctx.fillStyle = white;
    ctx.fillRect(23, 54, 82, 20);
  } else if (kind === "one-way" || kind === "one-way-turn") {
    ctx.fillStyle = white;
    ctx.fillRect(7, 7, 114, 114);
    ctx.fillStyle = blue;
    ctx.fillRect(12, 12, 104, 104);
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate(detail === "R" ? Math.PI / 2 : detail === "L" ? -Math.PI / 2 : 0);
    polygon(ctx, [[-9, 32], [9, 32], [9, -4], [27, -4], [0, -34], [-27, -4], [-9, -4]]
      .map(([x, y]): Point => [x, y]), white);
    ctx.restore();
  } else {
    if (kind === "crossing") {
      ctx.fillStyle = blue;
      ctx.fillRect(9, 10, 110, 108);
      polygon(ctx, [[16, 105], [112, 105], [64, 20]], white);
      ctx.strokeStyle = ink;
      for (let x = 32; x <= 96; x += 12) stroke(ctx, [[x - 3, 105], [x + 2, 95]], 4);
    } else {
      circle(ctx, 64, 64, 61, white);
      circle(ctx, 64, 64, 57, blue);
      ctx.strokeStyle = white;
    }
    const color = kind === "crossing" ? ink : white;
    if (kind === "cycleway") {
      const wheel = (x: number) => {
        ctx.beginPath(); ctx.arc(x, 80, 17, 0, 2 * Math.PI); ctx.lineWidth = 4; ctx.stroke();
      };
      wheel(33); wheel(94);
      stroke(ctx, [[33, 80], [47, 57], [65, 80], [33, 80], [78, 55], [94, 80], [77, 49], [85, 47]], 4);
      stroke(ctx, [[42, 57], [54, 57]], 4);
    } else if (kind === "roundabout") {
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.translate(64, 64); ctx.rotate(i * (Math.PI * 2 / 3));
        ctx.beginPath(); ctx.arc(0, 0, 30, -2.62, -1.2); ctx.lineWidth = 7; ctx.stroke();
        polygon(ctx, [[11, -39], [22, -25], [4, -16]], white);
        ctx.restore();
      }
    } else {
      const scale = kind === "crossing" ? 0.74 : 1.0;
      ctx.save();
      ctx.translate(64, 73);
      ctx.scale(scale, scale);
      ctx.translate(-64, -64);
      circle(ctx, 68, 31, 7, color);
      ctx.strokeStyle = color;
      stroke(ctx, [[43, 64], [59, 49], [68, 48], [85, 63]], 6);
      stroke(ctx, [[63, 49], [59, 72], [43, 94]], 8);
      stroke(ctx, [[59, 71], [75, 79], [88, 93]], 7);
      ctx.restore();
    }
  }
  const map = new T.CanvasTexture(texture);
  map.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicMaterial({ map, alphaTest: 0.56, side: T.FrontSide });
}

function at([x, z]: Point, angle: number, ahead: number, side: number): Point {
  return [x + Math.sin(angle) * ahead - Math.cos(angle) * side,
    z + Math.cos(angle) * ahead + Math.sin(angle) * side];
}

export class TrafficSigns {
  private approaches: Approach[] = [];
  readonly zebraCrossings: WalkingLink[] = [];

  /**
   * `zebras` are painted crossings from OpenStreetMap. When present they place the zebras,
   * because NDW records the crossing sign at the kerb, often metres from the paint.
   */
  constructor(signs: TrafficSign[], roads: Record<RoadMode, Roads>, private walks: Walkways, zebras?: Point[]) {
    for (const point of zebras ?? []) {
      // Snap the mapped crossing onto the simulator's road centreline, cars first.
      const car = roads.car.nearest(point, 3.5);
      const bike = car ? null : roads.bike.nearest(point, 2.5);
      const hit = car ?? bike;
      // Draw the stripes where OSM maps the paint, which matches the aerial photo.
      if (hit) this.addCrossing(hit, car ? "car" : "bike", point);
    }
    for (const sign of signs) {
      if (!(controls as readonly string[]).includes(sign.kind)) continue;
      if (zebras && sign.kind === "crossing") continue;
      const heading = Math.PI - sign.bearing * Math.PI / 180;
      const candidates = (["car", "bike"] as const).flatMap((mode) => {
        const hit = roads[mode].nearest(sign.point, 8.5, heading);
        return hit && Math.cos(heading - hit.heading) > 0.73 ? [{ mode, hit }] : [];
      });
      // Closest aligned carriageway; a bike lane can have its own yield sign.
      candidates.sort((a, b) => (a.hit.distance + (a.mode === "bike" ? 0.65 : 0))
        - (b.hit.distance + (b.mode === "bike" ? 0.65 : 0)));
      const selected = candidates[0];
      if (!selected) continue;
      const { hit, mode } = selected;
      if (sign.kind === "crossing") {
        this.addCrossing(hit, mode);
        continue;
      }
      const point = at(hit.point, hit.heading, -0.8, mode === "car" ? Math.min(1.1, hit.width / 2) : 0);
      const approach = { point, kind: sign.kind as Control, heading: hit.heading, width: hit.width, mode };
      if (this.approaches.some((entry) => entry.kind === approach.kind &&
        Math.hypot(entry.point[0] - point[0], entry.point[1] - point[1]) < 2.2 &&
        Math.cos(entry.heading - approach.heading) > 0.80)) continue;
      this.approaches.push(approach);
    }
  }

  /** A zebra across the road at `hit`, with a walkable crossing for pedestrians on car roads. */
  private addCrossing(hit: { point: Point; heading: number; width: number }, mode: RoadMode, paint?: Point): void {
    const { point, heading, width } = hit;
    if (this.approaches.some((entry) => entry.kind === "crossing"
      && Math.hypot(entry.point[0] - point[0], entry.point[1] - point[1]) < 2.2)) return;
    this.approaches.push({ point, kind: "crossing", heading, width, mode, paint });
    if (mode !== "car") return;
    const reach = Math.min(8.2, width + 1.1);
    const leftEdge = at(point, heading, 0, -reach);
    const rightEdge = at(point, heading, 0, reach);
    const left = this.walks.nearest(leftEdge, 2.1);
    const right = this.walks.nearest(rightEdge, 2.1);
    if (left && right && Math.hypot(left[0] - right[0], left[1] - right[1]) > 3.1) {
      this.walks.add([at(left, heading, -1.5, -0.16), at(right, heading, -1.5, 0.16),
        at(right, heading, 1.5, 0.16), at(left, heading, 1.5, -0.16)]);
      this.zebraCrossings.push([left, right, 3]);
    } else {
      this.zebraCrossings.push([leftEdge, rightEdge, 3]);
    }
  }

  carStops(): StopLine[] {
    return this.approaches.filter((entry) => entry.kind === "stop" && entry.mode === "car");
  }

  ahead(position: Point, heading: number, mode: RoadMode, kind?: Control): { kind: Control; distance: number } | null {
    let closest = 38;
    let next: { kind: Control; distance: number } | null = null;
    for (const entry of this.approaches) {
      if (kind && entry.kind !== kind) continue;
      if (entry.mode !== mode && entry.kind !== "crossing") continue;
      const alignment = Math.cos(entry.heading - heading);
      if (entry.kind === "crossing" ? Math.abs(alignment) < 0.78 : alignment < 0.80) continue;
      const dx = entry.point[0] - position[0], dz = entry.point[1] - position[1];
      const along = dx * Math.sin(heading) + dz * Math.cos(heading);
      const across = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
      if (along < -0.35 || along >= closest || across > Math.min(3, entry.width + 0.5)) continue;
      closest = along;
      next = { kind: entry.kind, distance: Math.max(0, along) };
    }
    return next;
  }

  addTo(scene: T.Scene, signs: TrafficSign[]): void {
    const posts = new T.InstancedMesh(new T.CylinderGeometry(0.031, 0.031, 2.3, 6),
      new T.MeshStandardMaterial({ color: "#858c8c", roughness: 0.86 }), signs.length);
    const board = new T.PlaneGeometry(0.94, 0.94);
    const metal = new T.MeshBasicMaterial({ color: "#8c9291", side: T.DoubleSide });
    const shape = new T.CircleGeometry(0.415, 8);
    const backs = new T.InstancedMesh(shape, metal, signs.length);
    const styles = new Map<string, TrafficSign[]>();
    const scratch = new T.Object3D();
    signs.forEach((sign, i) => {
      const [x, z] = sign.point;
      const angle = -sign.bearing * Math.PI / 180;
      const key = `${sign.kind}:${sign.detail ?? ""}`;
      if (!styles.has(key)) styles.set(key, []);
      styles.get(key)!.push(sign);
      scratch.position.set(x, 1.15, z);
      scratch.rotation.y = 0;
      scratch.updateMatrix();
      posts.setMatrixAt(i, scratch.matrix);
      scratch.position.y = 2.34;
      scratch.rotation.y = angle;
      scratch.updateMatrix();
      backs.setMatrixAt(i, scratch.matrix);
    });
    scene.add(posts, backs);
    for (const list of styles.values()) {
      const display = new T.InstancedMesh(board, face(list[0]), list.length);
      list.forEach((sign, i) => {
        const angle = -sign.bearing * Math.PI / 180;
        scratch.position.set(sign.point[0] + Math.sin(angle) * 0.035, 2.34, sign.point[1] + Math.cos(angle) * 0.035);
        scratch.rotation.y = angle;
        scratch.updateMatrix();
        display.setMatrixAt(i, scratch.matrix);
      });
      scene.add(display);
    }
    const points: number[] = [];
    function triangle(a: Point, b: Point, c: Point) {
      for (const [x, z] of [a, b, c]) points.push(x, 0.102, z);
    }
    function stripe(entry: Approach, half: number, side: number, along: number, depth: number) {
      const point = (a: number, b: number) => at(entry.paint ?? entry.point, entry.heading, a, b);
      const a = point(along - depth / 2, side - half), b = point(along - depth / 2, side + half);
      const c = point(along + depth / 2, side - half), d = point(along + depth / 2, side + half);
      triangle(a, b, c); triangle(c, b, d);
    }
    for (const entry of this.approaches) {
      const half = Math.min(entry.mode === "car" ? 1.52 : 1.11, entry.width / 1.72);
      if (entry.kind === "stop") stripe(entry, half, 0, 0, 0.23);
      if (entry.kind === "yield") {
        const teeth = entry.mode === "car" ? 5 : 4;
        for (let i = 0; i < teeth; i++) {
          const step = 2 * half / teeth;
          const side = -half + step * (i + 0.5);
          triangle(at(entry.point, entry.heading, 0.18, side - step * 0.37),
            at(entry.point, entry.heading, 0.18, side + step * 0.37),
            at(entry.point, entry.heading, -0.39, side));
        }
      }
      if (entry.kind === "crossing") {
        const across = Math.min(5.8, entry.width);
        for (let side = -across + 0.28; side < across; side += 0.84) stripe(entry, 0.24, side, 0, 2.55);
      }
    }
    const mesh = new T.BufferGeometry();
    mesh.setAttribute("position", new T.Float32BufferAttribute(points, 3));
    scene.add(new T.Mesh(mesh, paint));
  }
}
