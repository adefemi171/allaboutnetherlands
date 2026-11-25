import * as T from "three";
import type { Point } from "./data";
import { box } from "./geometry";
import { carLaneCenter, type Roads } from "./simulation";
import type { Light, SignalHead, TrafficRules } from "./traffic-rules";

const colors: Record<Light, string> = { red: "#ff3d32", amber: "#ffd042", green: "#44df81" };
const dark: Record<Light, string> = { red: "#562722", amber: "#504324", green: "#214430" };
const bulbs = Object.keys(colors) as Light[];
const lit = Object.fromEntries(bulbs.map((color) => [color, new T.MeshBasicMaterial({ color: colors[color] })]));
const unlit = Object.fromEntries(bulbs.map((color) => [color, new T.MeshStandardMaterial({ color: dark[color] })]));
const pole = new T.MeshStandardMaterial({ color: "#a4adac", roughness: 0.75 });
const housing = new T.MeshStandardMaterial({ color: "#202829", roughness: 0.8 });
const paint = new T.MeshBasicMaterial({ color: "#e8e7db" });
const bulb = new T.CylinderGeometry(0.118, 0.118, 0.035, 16);

export class TrafficLights {
  private readonly fixtures: { head: SignalHead; group: T.Group; lamps: T.Mesh[]; active?: Light }[] = [];

  constructor(scene: T.Scene, private readonly rules: TrafficRules, roads: Roads) {
    for (const head of rules.heads) {
      const lane = roads.carriageway(head.point, 3, head.heading, false);
      if (!lane) continue;
      const [x, z] = carLaneCenter(lane);
      const side = lane.oneWay ? lane.width + 0.4 : Math.max(1.74, lane.width - 0.74);
      const group = new T.Group();
      group.position.set(x, 0, z);
      group.rotation.y = head.heading;
      box(group, paint, 0, 0.123, 0, 2.85, 0.024, 0.24);
      box(group, pole, -side, 1.64, 0.52, 0.12, 3.28, 0.12);
      box(group, housing, -side, 3.25, 0.42, 0.4, 0.99, 0.24);
      const lamps = bulbs.map((color, i) => {
        const mesh = new T.Mesh(bulb, unlit[color]);
        mesh.position.set(-side, 3.57 - i * 0.31, 0.28);
        mesh.rotation.x = Math.PI / 2;
        group.add(mesh);
        return mesh;
      });
      scene.add(group);
      this.fixtures.push({ head, group, lamps });
    }
  }

  frame([x, z]: Point): void {
    for (const fixture of this.fixtures) {
      const [lx, lz] = fixture.head.point;
      fixture.group.visible = (x - lx) ** 2 + (z - lz) ** 2 < 360 ** 2;
      if (!fixture.group.visible) continue;
      const active = this.rules.light(fixture.head);
      if (active === fixture.active) continue;
      fixture.active = active;
      fixture.lamps.forEach((lamp, i) => {
        const color = bulbs[i];
        lamp.material = active === color ? lit[color] : unlit[color];
      });
    }
  }
}
