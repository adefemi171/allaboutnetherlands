import * as T from "three";
import type { Point } from "./data";
import type { Peer } from "./rooms";
import { vehicleLamps, type VehicleLamps } from "./road-lighting";
import { mixAngle } from "./simulation";
import type { CarPose } from "./traffic";
import { vehiclesOverlap, type RoadPose } from "./vehicle-contact";

const body = new T.BoxGeometry(1.72, 0.66, 3.93);
const windows = new T.BoxGeometry(1.48, 0.47, 1.91);
const roof = new T.BoxGeometry(1.40, 0.10, 1.60);
const tire = new T.BoxGeometry(0.25, 0.57, 0.64);
const light = new T.BoxGeometry(0.31, 0.14, 0.04);
const glass = new T.MeshStandardMaterial({ color: "#253a48", roughness: 0.3 });
const rubber = new T.MeshStandardMaterial({ color: "#20272d" });
const peerMarker = new T.MeshBasicMaterial({ color: "#95d8ff" });
const diamond = new T.OctahedronGeometry(0.32);

function model(online: boolean, lamps: VehicleLamps) {
  const group = new T.Group();
  const paint = new T.MeshStandardMaterial({ roughness: 0.45 });
  function part(geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) {
    const object = new T.Mesh(geometry, material);
    object.position.set(x, y, z);
    group.add(object);
  }
  part(body, paint, 0, 0.7, 0);
  part(windows, glass, 0, 1.13, -0.20);
  part(roof, paint, 0, 1.36, -0.23);
  for (const x of [-0.75, 0.75]) {
    part(light, lamps.rear, x * 0.90, 0.81, -1.98);
    part(light, lamps.front, x * 0.90, 0.82, 1.98);
    for (const z of [-1.21, 1.24]) part(tire, rubber, x, 0.29, z);
  }
  if (online) part(diamond, peerMarker, 0, 2.4, 0);
  return { group, paint, color: "" };
}

type RoadCar = ReturnType<typeof model>;

export class RoadCars {
  readonly group = new T.Group();
  private traffic: RoadCar[] = [];
  private online = new Map<string, RoadCar>();
  private target = new T.Vector3();

  constructor(private readonly lamps = vehicleLamps()) {}

  private place(actor: RoadCar, { point, angle, color }: CarPose, blend: number,
    occupied?: (pose: RoadPose) => boolean): RoadPose | null {
    const [x, z] = point;
    const previous: RoadPose = { point: [actor.group.position.x, actor.group.position.z], angle: actor.group.rotation.y };
    if (!actor.group.visible || Math.hypot(x - previous.point[0], z - previous.point[1]) > 25) blend = 1;
    const next: RoadPose = {
      point: [previous.point[0] + (x - previous.point[0]) * blend, previous.point[1] + (z - previous.point[1]) * blend],
      angle: mixAngle(previous.angle, angle, blend),
    };
    if (occupied?.(next)) {
      if (actor.group.visible && !occupied(previous)) return previous;
      if (occupied({ point, angle })) {
        actor.group.visible = false;
        return null;
      }
      next.point = point;
      next.angle = angle;
    }
    actor.group.position.copy(this.target.set(next.point[0], 0.075, next.point[1]));
    actor.group.rotation.y = next.angle;
    actor.group.visible = true;
    if (actor.color !== color) {
      actor.paint.color.set(color);
      actor.color = color;
    }
    return next;
  }

  update(traffic: CarPose[], peers: Peer[], player: Point, dt: number,
    occupied: (pose: RoadPose) => boolean): Peer[] {
    for (let i = 0; i < traffic.length; i++) {
      if (!this.traffic[i]) {
        this.traffic[i] = model(false, this.lamps);
        this.group.add(this.traffic[i].group);
      }
      this.place(this.traffic[i], traffic[i], 1);
    }
    for (let i = traffic.length; i < this.traffic.length; i++) this.traffic[i].group.visible = false;

    const present = new Set<string>();
    const visible: Peer[] = [];
    for (const peer of peers) {
      if (Math.hypot(peer.point[0] - player[0], peer.point[1] - player[1]) > 700) continue;
      present.add(peer.id);
      let actor = this.online.get(peer.id);
      if (!actor) {
        actor = model(true, this.lamps);
        actor.group.visible = false;
        this.online.set(peer.id, actor);
        this.group.add(actor.group);
      }
      const pose = this.place(actor, peer, 1 - Math.exp(-dt * 12),
        (candidate) => occupied(candidate) || visible.some((other) => vehiclesOverlap(candidate, other)));
      if (pose) visible.push({ ...peer, point: pose.point, angle: pose.angle });
    }
    for (const [id, actor] of this.online) {
      if (present.has(id)) continue;
      this.group.remove(actor.group);
      actor.paint.dispose();
      this.online.delete(id);
    }
    return visible;
  }
}
