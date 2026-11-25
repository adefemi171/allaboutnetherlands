import * as T from "three";
import { box } from "./geometry";

/** Which side of the carriage you sit on. */
export type TrainSeat = "left" | "right";
/** Over your shoulder at the window, a view of you from across the aisle, or outside the train. */
export type TrainView = "window" | "you" | "outside";

const cabinMaterial = (color: string, emissiveIntensity = 0.25) =>
  new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity, roughness: 0.8 });
const wall = cabinMaterial("#dbd8cf");
const frame = cabinMaterial("#aaa69d");
const floor = cabinMaterial("#4b535e");
const upholstery = cabinMaterial("#244f82", 0.48);
const headrest = cabinMaterial("#356a9e", 0.52);
const armrest = cabinMaterial("#424954");
const door = cabinMaterial("#e6b943", 0.33);
const ceilingLight = new T.MeshBasicMaterial({ color: "#fbf1d5" });
const windowGlass = new T.MeshBasicMaterial({
  color: "#a8d4e7", side: T.DoubleSide, transparent: true, opacity: 0.065, depthWrite: false,
});
const bays = [-6, -4, -2, 0, 2, 4, 6];

export function trainCabin(): T.Group {
  const group = new T.Group();
  box(group, floor, 0, 0.86, 0, 2.9, 0.12, 18.3);
  box(group, wall, 0, 3.36, 0, 2.94, 0.12, 18.3);
  box(group, ceilingLight, 0, 3.283, 0, 0.30, 0.025, 15.5);
  for (const side of [-1, 1]) {
    const x = side * 1.42;
    box(group, wall, x, 1.30, 0, 0.12, 0.90, 18.3);
    box(group, wall, x, 3.14, 0, 0.12, 0.36, 18.3);
    box(group, frame, x, 1.77, 0, 0.17, 0.10, 14.1);
    box(group, frame, x, 2.97, 0, 0.17, 0.10, 14.1);
    for (const z of [-8.05, 8.05]) box(group, wall, x, 2.36, z, 0.12, 1.26, 2.1);
    for (let i = 0; i < bays.length; i++) {
      const z = bays[i];
      box(group, windowGlass, x, 2.37, z, 0.01, 1.1, 1.74);
      box(group, frame, x, 2.37, z - 1, 0.15, 1.25, 0.25);
    }
    box(group, frame, x, 2.37, 7, 0.15, 1.25, 0.25);
    for (const z of bays) {
      for (const seatX of [0.62 * side, 1.10 * side]) {
        box(group, armrest, seatX, 1.10, z - 0.21, 0.29, 0.37, 0.34);
        box(group, upholstery, seatX, 1.35, z - 0.10, 0.45, 0.14, 0.47);
        box(group, upholstery, seatX, 1.73, z - 0.36, 0.45, 0.69, 0.13).rotation.x = -0.10;
        box(group, headrest, seatX, 2.05, z - 0.39, 0.43, 0.19, 0.15);
      }
      box(group, armrest, 0.36 * side, 1.52, z - 0.13, 0.064, 0.075, 0.39);
    }
  }
  for (const z of [-9.08, 9.08]) {
    box(group, wall, 0, 2.15, z, 2.88, 2.48, 0.13);
    box(group, door, 0, 2.03, z * 0.989, 0.87, 2.21, 0.1);
    box(group, frame, 0, 2.43, z * 0.98, 0.61, 0.55, 0.04);
  }
  group.visible = false;
  return group;
}
