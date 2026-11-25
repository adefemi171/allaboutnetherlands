import * as T from "three";
import { box, rod } from "./geometry";

export type Body = "woman" | "man";
export type Look = { body: Body; skin: string };
export type TrainActivity = "look" | "read" | "music" | "quiet";

export const SKIN_TONES = [
  { name: "Light", color: "#efc6a4" },
  { name: "Medium", color: "#c98f68" },
  { name: "Brown", color: "#8d5b3e" },
  { name: "Deep", color: "#5a3626" },
] as const;

const STORAGE_KEY = "drive.you";
const sphere = new T.SphereGeometry(1, 14, 10);

export function savedLook(): Look {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Look> | null;
    const body = saved?.body === "man" ? "man" : "woman";
    const skin = SKIN_TONES.find(({ color }) => color === saved?.skin)?.color ?? SKIN_TONES[2].color;
    return { body, skin };
  } catch {
    return { body: "woman", skin: SKIN_TONES[2].color };
  }
}

export function saveLook(look: Look): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // The choice still applies for this visit.
  }
}

function round(group: T.Object3D, material: T.Material, x: number, y: number, z: number,
  sx: number, sy: number, sz: number): T.Mesh {
  const mesh = new T.Mesh(sphere, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  group.add(mesh);
  return mesh;
}

/**
 * The player's appearance, shared by the driver, the cyclist, the walker and the
 * train passenger. Changing it recolours every figure at once.
 */
export class AvatarLook {
  readonly skin = new T.MeshStandardMaterial({ roughness: 0.75 });
  readonly hair = new T.MeshStandardMaterial({ color: "#2a201c", roughness: 0.9 });
  readonly top = new T.MeshStandardMaterial({ roughness: 0.85 });
  readonly trousers = new T.MeshStandardMaterial({ color: "#2f3d48", roughness: 0.9 });
  private longHair: T.Object3D[] = [];
  private shortHair: T.Object3D[] = [];
  look: Look;

  constructor(look: Look) {
    this.look = look;
    this.set(look);
  }

  set(look: Look): void {
    this.look = look;
    this.skin.color.set(look.skin);
    this.top.color.set(look.body === "woman" ? "#b0455b" : "#d8ad55");
    for (const piece of this.longHair) piece.visible = look.body === "woman";
    for (const piece of this.shortHair) piece.visible = look.body === "man";
  }

  /** Hair for a head of radius `r` centred at (x, y, z), facing +z. */
  addHair(group: T.Object3D, x: number, y: number, z: number, r: number): void {
    const short = round(group, this.hair, x, y + r * 0.42, z - r * 0.25, r * 1.06, r * 0.72, r * 1.0);
    const crown = round(group, this.hair, x, y + r * 0.38, z - r * 0.18, r * 1.1, r * 0.78, r * 1.06);
    const back = round(group, this.hair, x, y - r * 0.35, z - r * 0.62, r * 1.08, r * 1.45, r * 0.62);
    this.shortHair.push(short);
    this.longHair.push(crown, back);
    short.visible = this.look.body === "man";
    crown.visible = back.visible = this.look.body === "woman";
  }
}

const bookCover = new T.MeshStandardMaterial({ color: "#2e6a74", roughness: 0.8 });
const paper = new T.MeshStandardMaterial({ color: "#f4efe2", emissive: "#f4efe2", emissiveIntensity: 0.18 });
const headphone = new T.MeshStandardMaterial({ color: "#1d2329", roughness: 0.5 });
const shoe = new T.MeshStandardMaterial({ color: "#23292f" });

/** You, seated in a train seat facing +z, hips at the origin. */
export class SeatedPassenger {
  readonly model = new T.Group();
  private head = new T.Group();
  private book = new T.Group();
  private headphones = new T.Group();
  private readingArms = new T.Group();
  private restingArms = new T.Group();
  private time = 0;
  activity: TrainActivity = "look";
  /** Which way the window is: 1 for +x, -1 for -x. */
  windowSide = 1;

  constructor(look: AvatarLook) {
    const { top, skin, trousers } = look;
    const torso = new T.Group();
    torso.rotation.x = -0.1;
    this.model.add(torso);
    box(torso, top, 0, 0.29, -0.04, 0.36, 0.52, 0.22);
    box(torso, top, 0, 0.53, -0.04, 0.42, 0.1, 0.22);
    rod(torso, skin, 0.05, new T.Vector3(0, 0.56, -0.03), new T.Vector3(0, 0.66, -0.02));
    this.head.position.set(0, 0.76, -0.02);
    torso.add(this.head);
    round(this.head, skin, 0, 0, 0, 0.1, 0.125, 0.108);
    look.addHair(this.head, 0, 0, 0, 0.105);

    // Headphones: a band over the crown and a cup over each ear.
    this.head.add(this.headphones);
    const band = new T.Mesh(new T.TorusGeometry(0.118, 0.012, 6, 18, Math.PI), headphone);
    band.position.set(0, 0.02, -0.01);
    this.headphones.add(band);
    for (const side of [-1, 1]) {
      const cup = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.035, 14), headphone);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.112, 0, -0.005);
      this.headphones.add(cup);
    }

    for (const side of [-1, 1]) {
      const knee = new T.Vector3(side * 0.1, 0.02, 0.42);
      rod(this.model, trousers, 0.075, new T.Vector3(side * 0.1, 0.02, 0), knee);
      rod(this.model, trousers, 0.062, knee, new T.Vector3(side * 0.1, -0.43, 0.47));
      box(this.model, shoe, side * 0.1, -0.47, 0.53, 0.1, 0.08, 0.22);
      const shoulder = new T.Vector3(side * 0.2, 0.5, -0.06);
      const elbow = new T.Vector3(side * 0.23, 0.24, 0.08);
      for (const [arms, hand] of [
        [this.readingArms, new T.Vector3(side * 0.11, 0.33, 0.3)],
        [this.restingArms, new T.Vector3(side * 0.12, 0.09, 0.28)],
      ] as const) {
        rod(arms, top, 0.05, shoulder, elbow);
        rod(arms, top, 0.043, elbow, hand);
        round(arms, skin, hand.x, hand.y, hand.z + 0.02, 0.04, 0.035, 0.05);
      }
    }
    this.model.add(this.readingArms, this.restingArms);

    // An open book held at reading height.
    this.book.position.set(0, 0.37, 0.33);
    this.book.rotation.x = -0.75;
    for (const side of [-1, 1]) {
      const leaf = new T.Group();
      leaf.rotation.y = side * 0.32;
      box(leaf, bookCover, side * 0.075, 0, 0, 0.15, 0.005, 0.21);
      box(leaf, paper, side * 0.072, 0.008, 0, 0.14, 0.012, 0.2);
      this.book.add(leaf);
    }
    this.model.add(this.book);
    this.setActivity("look");
  }

  setActivity(activity: TrainActivity): void {
    this.activity = activity;
    const reading = activity === "read";
    this.book.visible = this.readingArms.visible = reading;
    this.restingArms.visible = !reading;
    this.headphones.visible = activity === "music";
  }

  /** Sway with the train, turn to the window or the page, and nod along to music. */
  update(dt: number, speed: number, beat: number): void {
    this.time += dt;
    const sway = Math.sin(this.time * 2.1) * Math.min(1, speed / 25) * 0.012;
    this.model.rotation.z = sway;
    const { head } = this;
    const turn = this.activity === "look" ? this.windowSide * 0.55 : this.activity === "music" ? this.windowSide * 0.25 : 0;
    const tilt = this.activity === "read" ? 0.42 : this.activity === "quiet" ? 0.2 : 0;
    const nod = this.activity === "music" ? Math.max(0, Math.sin(beat * Math.PI * 2)) * 0.07 : 0;
    const ease = 1 - Math.exp(-dt * 3);
    head.rotation.y += (turn - head.rotation.y) * ease;
    head.rotation.x += (tilt + nod - head.rotation.x) * Math.min(1, ease * (this.activity === "music" ? 4 : 1));
  }
}
