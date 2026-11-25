import * as T from "three";
import type { Point } from "./data";
import { box, rod } from "./geometry";
import type { AvatarLook } from "./avatar";
import { distance, mixAngle } from "./simulation";
import type { RoadLighting } from "./road-lighting";
import type { RoadPose } from "./vehicle-contact";
import type { WalkingLink, WalkingRoute, WalkingSurface, Walkways } from "./walking";

const cloth = ["#ce8b35", "#2d6982", "#8d433b", "#53715d", "#354665"]
  .map((color) => new T.MeshStandardMaterial({ color, roughness: 0.88 }));
const pants = new T.MeshStandardMaterial({ color: "#34434b" });
const shoes = new T.MeshStandardMaterial({ color: "#25303a" });
const skin = ["#be8a66", "#926346", "#d4a287"].map((color) => new T.MeshStandardMaterial({ color }));
const hair = new T.MeshStandardMaterial({ color: "#483a31" });
const fur = new T.MeshStandardMaterial({ color: "#a26843", roughness: 0.95 });
const furDark = new T.MeshStandardMaterial({ color: "#523f32" });
const collar = new T.MeshStandardMaterial({ color: "#8b3541" });
const sphere = new T.SphereGeometry(1, 10, 7);

function roundPart(group: T.Group, material: T.Material, x: number, y: number, z: number,
  sx: number, sy: number, sz: number) {
  const mesh = new T.Mesh(sphere, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  group.add(mesh);
  return mesh;
}

export class WalkingPerson {
  readonly model = new T.Group();
  private body = new T.Group();
  private arms: T.Group[] = [];
  private legs: T.Group[] = [];
  private phase = 0;
  /** `you` dresses the figure as the player. */
  constructor(index = 0, you?: AvatarLook) {
    const jacket = you?.top ?? cloth[index % cloth.length];
    const tone = you?.skin ?? skin[index % skin.length];
    this.model.add(this.body);
    box(this.body, jacket, 0, 1.14, 0, 0.36, 0.48, 0.23);
    box(this.body, pants, 0, 0.89, 0, 0.33, 0.17, 0.22);
    roundPart(this.body, tone, 0, 1.51, 0, 0.105, 0.135, 0.106);
    if (you) you.addHair(this.body, 0, 1.51, 0, 0.106);
    else roundPart(this.body, hair, 0, 1.58, -0.024, 0.107, 0.079, 0.105);
    for (const side of [-1, 1]) {
      const arm = new T.Group();
      arm.position.set(0.21 * side, 1.33, 0);
      box(arm, jacket, 0, -0.171, 0, 0.118, 0.355, 0.13);
      roundPart(arm, tone, 0, -0.375, 0, 0.048, 0.075, 0.06);
      this.arms.push(arm);
      this.body.add(arm);
      const leg = new T.Group();
      leg.position.set(side * 0.092, 0.86, 0);
      box(leg, pants, 0, -0.355, 0, 0.14, 0.71, 0.14);
      box(leg, shoes, 0, -0.757, 0.063, 0.155, 0.132, 0.238);
      this.legs.push(leg);
      this.body.add(leg);
    }
  }

  place([x, z]: Point, direction: number, speed: number, dt: number) {
    this.model.position.set(x, 0.08, z);
    this.model.rotation.y = direction;
    const movement = Math.min(1, Math.abs(speed) / 1.2);
    this.phase = (this.phase + dt * Math.abs(speed) * 6.8) % (2 * Math.PI);
    const swing = Math.sin(this.phase) * movement;
    this.body.position.y = Math.abs(swing) * 0.026;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      this.arms[i].rotation.x = 0.32 * swing * side;
      this.legs[i].rotation.x = -0.36 * swing * side;
    }
  }
}

class Dog {
  readonly model = new T.Group();
  private legs: T.Group[] = [];
  private tail = new T.Group();
  constructor() {
    roundPart(this.model, fur, 0, 0.37, -0.036, 0.162, 0.173, 0.45);
    roundPart(this.model, fur, 0, 0.53, 0.34, 0.135, 0.141, 0.17);
    roundPart(this.model, furDark, 0, 0.489, 0.475, 0.090, 0.078, 0.10);
    roundPart(this.model, furDark, -0.117, 0.55, 0.315, 0.049, 0.107, 0.061);
    roundPart(this.model, furDark, 0.117, 0.55, 0.315, 0.049, 0.107, 0.061);
    roundPart(this.model, collar, 0, 0.43, 0.24, 0.138, 0.116, 0.051);
    this.tail.position.set(0, 0.43, -0.411);
    rod(this.tail, fur, 0.038, new T.Vector3(), new T.Vector3(0, 0.15, -0.22));
    this.model.add(this.tail);
    for (const side of [-0.105, 0.105]) {
      for (const z of [-0.26, 0.22]) {
        const leg = new T.Group();
        leg.position.set(side, 0.298, z);
        box(leg, fur, 0, -0.112, 0, 0.075, 0.231, 0.075);
        box(leg, furDark, 0, -0.252, 0.034, 0.082, 0.063, 0.11);
        this.model.add(leg);
        this.legs.push(leg);
      }
    }
  }

  place([x, z]: Point, direction: number, phase: number) {
    this.model.position.set(x, 0.081, z);
    this.model.rotation.y = direction;
    this.tail.rotation.y = Math.sin(phase * 1.35) * 0.33;
    for (let i = 0; i < 4; i++) this.legs[i].rotation.x = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.27;
  }
}

export class LocalPedestrians {
  private walkers;
  private elapsed = 0;
  visible: RoadPose[] = [];

  constructor(scene: T.Scene, paths: WalkingRoute[], crossings: WalkingLink[] = []) {
    const leadMaterial = new T.LineBasicMaterial({ color: "#56483d" });
    const routes = [...paths, ...crossings.map(([a, b]) => ({ a, b, dog: false, street: "" }))];
    this.walkers = routes.map((path, index) => {
      const person = new WalkingPerson(index + 1);
      scene.add(person.model);
      const dog = path.dog ? new Dog() : null;
      const lead = dog ? new T.Line(new T.BufferGeometry().setAttribute("position",
        new T.Float32BufferAttribute(new Float32Array(6), 3)), leadMaterial) : null;
      if (dog && lead) {
        lead.frustumCulled = false;
        scene.add(dog.model, lead);
      }
      const crossing = index >= paths.length;
      const offset = index * 13.39;
      const speed = crossing ? 1.24 : 0.95 + (offset % 0.30);
      return { path, person, dog, lead, length: distance(path.a, path.b), angle: 0,
        elapsed: crossing ? 6 + (index % 3) * 1.5 : offset / speed, crossing, speed, pose: null as RoadPose | null };
    });
  }

  update(player: Point, dt: number, walks: Walkways, free: (point: Point) => boolean,
    occupied: (pose: RoadPose) => boolean): void {
    this.elapsed += dt;
    this.visible = [];
    for (const actor of this.walkers) {
      const { path, person, dog, lead, length, crossing, speed } = actor;
      const angle = Math.atan2(path.b[0] - path.a[0], path.b[1] - path.a[1]);
      const near = distance(player, path.a) < 155 || distance(player, path.b) < 155;
      const pause = crossing ? 12 : 0;
      const leg = pause + length / speed;
      const loop = (actor.elapsed + dt) % (2 * leg);
      const forward = loop < leg;
      const phase = forward ? loop : loop - leg;
      const travelled = Math.max(0, phase - pause) * speed;
      const along = forward ? travelled : length - travelled;
      const dx = Math.sin(angle), dz = Math.cos(angle);
      const t = path.dog ? Math.max(1.1, Math.min(length - 1.1, along)) : along;
      const point: Point = [path.a[0] + dx * t, path.a[1] + dz * t];
      const direction = forward ? angle : angle + Math.PI;
      const intent = phase >= pause - 0.9 ? direction : undefined;
      const atKerb = crossing && travelled < 0.65;
      const candidate: RoadPose = { point, angle: direction, mode: "walk", travelHeading: intent, waiting: atKerb };
      const clear = !near || !occupied(candidate);
      const moving = phase >= pause && clear;
      if (!crossing || clear) {
        actor.elapsed += dt;
        actor.pose = candidate;
      } else if (actor.pose) {
        // Still at the kerb: let the blocking traffic clear first instead of holding the crossing.
        actor.pose = { ...actor.pose, travelHeading: atKerb ? undefined : intent, waiting: atKerb };
      }
      const pose = actor.pose;
      person.model.visible = near && pose !== null && free(pose.point) && !occupied(pose);
      if (dog && lead) dog.model.visible = lead.visible = false;
      if (!person.model.visible || !pose) continue;
      this.visible.push(pose);
      actor.angle = mixAngle(actor.angle, direction, 1 - Math.exp(-dt * 6));
      person.place(pose.point, actor.angle, moving ? speed : 0, dt);
      if (!dog || !lead) continue;
      const leashDistance = forward ? 1.03 : -1.03;
      const dogPosition: Point = [point[0] + dx * leashDistance, point[1] + dz * leashDistance];
      if (!walks.includes(dogPosition, 0) || !free(dogPosition)) continue;
      dog.place(dogPosition, direction, this.elapsed * 9);
      dog.model.visible = lead.visible = true;
      const grip = person.model.localToWorld(new T.Vector3(0.20, 0.99, 0.16));
      const neck = dog.model.localToWorld(new T.Vector3(0, 0.46, 0.21));
      const positions = lead.geometry.getAttribute("position");
      positions.setXYZ(0, grip.x, grip.y, grip.z);
      positions.setXYZ(1, neck.x, neck.y, neck.z);
      positions.needsUpdate = true;
    }
  }
}

export function crossingsNearStarts(links: WalkingLink[], starts: Point[], walks: Walkways): WalkingLink[] {
  const selected = new Set<WalkingLink>();
  for (const start of starts) {
    let best: WalkingLink | undefined;
    let nearest = Infinity;
    for (const link of links) {
      const [a, b] = link;
      const offset = Math.min(distance(a, start), distance(b, start));
      if (offset >= nearest || distance(a, b) < 3.5 || !walks.includes(a, 0) || !walks.includes(b, 0)) continue;
      if ([...selected].some(([from]) => distance(from, a) < 90)) continue;
      best = link;
      nearest = offset;
    }
    if (best) selected.add(best);
  }
  return [...selected];
}

export function addFootwaySurfaces(scene: T.Scene, surfaces: WalkingSurface[], lighting: RoadLighting): void {
  const tiles = new Map<string, number[]>();
  for (const [kind, outer, ...inner] of surfaces) {
    if (!outer || outer.length < 3 || kind === 1) continue;
    const key = `${Math.floor(outer[0][0] / 430)}:${Math.floor(outer[0][1] / 430)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    const out = tiles.get(key)!;
    const ring = (line: Point[]) => line.map(([x, z]) => new T.Vector2(x, z));
    const contour = ring(outer);
    const holes = inner.map(ring);
    const faces = T.ShapeUtils.triangulateShape(contour, holes);
    const vertices = [...contour, ...holes.flat()];
    for (const face of faces) for (const index of face) out.push(vertices[index].x, 0.074, vertices[index].y);
  }
  const material = lighting.surface({ color: "#b0a69a", transparent: true, opacity: 0.25,
    depthWrite: false, side: T.DoubleSide });
  for (const vertices of tiles.values()) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    scene.add(new T.Mesh(geometry, material));
  }
}

export function addJunctionGuides(scene: T.Scene, links: WalkingLink[]): T.Group {
  const group = new T.Group();
  group.visible = false;
  const tiles = new Map<string, Point[]>();
  for (const [a, b, , junction] of links) {
    if (!junction) continue;
    const key = `${Math.floor(a[0] / 130)}:${Math.floor(a[1] / 130)}`;
    let points = tiles.get(key);
    if (!points) tiles.set(key, points = []);
    const count = Math.max(2, Math.round(distance(a, b) / 1.5));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const disc = new T.CircleGeometry(0.14, 10).rotateX(-Math.PI / 2);
  const material = new T.MeshBasicMaterial({ color: "#a3efd8", transparent: true, opacity: 0.8, depthWrite: false });
  const transform = new T.Matrix4();
  for (const points of tiles.values()) {
    const mesh = new T.InstancedMesh(disc, material, points.length);
    points.forEach(([x, z], i) => mesh.setMatrixAt(i, transform.makeTranslation(x, 0.16, z)));
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  scene.add(group);
  return group;
}
