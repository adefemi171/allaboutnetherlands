import type { CarPose } from "./traffic";
import type { Point } from "./data";

const ROOM = /^[a-z0-9-]{3,32}$/;

export type Peer = CarPose & { id: string };
type Correction = [attempt: Point, accepted: [x: number, z: number, angle: number]];

export class DriveRoom {
  code = "";
  peers: Peer[] = [];
  players = 0;
  connected = false;
  private socket: WebSocket | null = null;
  private id = "";
  private lastSent = 0;
  private correction: Correction | null = null;

  constructor(private area: string, private update: (message?: string) => void) {}

  join(value: string): void {
    const code = value.trim().toLowerCase() || Array.from(crypto.getRandomValues(new Uint8Array(5)),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!ROOM.test(code)) {
      this.update("Use 3–32 letters, numbers, or hyphens.");
      return;
    }
    this.leave(false);
    this.code = code;
    const url = new URL("/drive/socket", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("room", code);
    url.searchParams.set("area", this.area);
    const socket = this.socket = new WebSocket(url);
    this.update(`Joining room ${code}…`);

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || typeof event.data !== "string") return;
      const message = JSON.parse(event.data);
      if (typeof message.id === "string") {
        this.id = message.id;
        this.connected = true;
        this.players = 1;
        this.update();
      } else if (Array.isArray(message.blocked)) {
        this.correction = message.blocked;
      } else if (Array.isArray(message.cars)) {
        this.peers = message.cars.flatMap(([id, x, z, angle, color]: [string, number, number, number, string]) =>
          id === this.id ? [] : [{ id, point: [x, z], angle, color } as Peer]);
        if (message.players !== this.players) {
          this.players = message.players;
          this.update();
        }
      }
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.leave(false);
      this.update(event.code === 1013 ? "This room is full." : "Room connection ended. Join again to reconnect.");
    });
  }

  takeCorrection(): Correction | null {
    const correction = this.correction;
    this.correction = null;
    return correction;
  }

  publish(pose: CarPose | null, now: number): void {
    const socket = this.socket;
    if (!this.connected || !socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 4096
      || now - this.lastSent < 100) return;
    this.lastSent = now;
    if (!pose) socket.send("null");
    else {
      const [x, z] = pose.point;
      const angle = Math.atan2(Math.sin(pose.angle), Math.cos(pose.angle));
      socket.send(JSON.stringify([Number(x.toFixed(2)), Number(z.toFixed(2)), Number(angle.toFixed(3)), pose.color]));
    }
  }

  invite(): string {
    const url = new URL(location.pathname, location.href);
    url.searchParams.set("room", this.code);
    return url.href;
  }

  leave(notify = true): void {
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.connected = false;
    this.peers = [];
    this.players = 0;
    this.code = "";
    this.id = "";
    this.correction = null;
    if (notify) this.update();
  }
}
