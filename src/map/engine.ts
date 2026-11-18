// The map itself: one WebGL scene holding the globe, the voxel model of the
// Netherlands and its streets, a camera that can travel from orbit down to
// a single street, and the controls to move it.

import * as THREE from "three";
import { places, type Place } from "../data/places";
import { Aerial, type GroundMode } from "./aerial";
import { buildGlobe, type Globe } from "./globe";
import { Grid, loadGrid, type CellInfo } from "./grid";
import { Labels, type LabelGroup, type LabelKind, type LabelSpec } from "./labels";
import { clamp } from "./math";
import { EARTH_RADIUS_KM, ORIGIN, latLonToWorld, rdToWorld } from "./rd";
import { Streets, type StreetStatus } from "./streets";
import { BACKGROUND } from "./style";
import { sunDirection, sunPosition, type SunPosition } from "./sun";
import { buildTerrain, type SharedUniforms, type Terrain } from "./terrain";

export type { GroundMode };

/** Where the camera is, described the way a person would. */
export interface Pose {
  /** The point on the ground the camera looks at, scene km. */
  x: number;
  z: number;
  /** Distance from that point to the camera, km. */
  dist: number;
  /** Compass direction the camera faces, degrees. 0 looks north. */
  az: number;
  /** 0 looks straight down, 90 would be level with the ground. */
  tilt: number;
  /** Shift of the picture on screen, as a fraction of its width and height. */
  shiftX: number;
  shiftY: number;
}

export interface Picked {
  cell: CellInfo;
  /** Residents within 5 km. */
  nearby: number;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  gridUrl: string;
  globeUrl: string;
  /** Let the visitor drag, zoom and rotate. */
  interactive: boolean;
  pose: Pose;
  reducedMotion: boolean;
}

const RAD = Math.PI / 180;
const FOV = 32;
const MIN_DIST = 0.1;
const MAX_DIST = 2600;
const MAX_TILT = 72;
const GLOBE_CENTRE = new THREE.Vector3(0, -EARTH_RADIUS_KM, 0);
/**
 * The model stretches heights a great deal, which no street could survive.
 * Between these camera distances (km) it settles down to flat ground.
 */
const RELIEF_GONE = 4.5;
const RELIEF_FULL = 20;
/** The view a visitor gets when asking for the streets of a place. */
const STREET_VIEW = { dist: 1.1, tilt: 60 };

export class MapEngine {
  grid!: Grid;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1000);
  private scratch = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1000);
  private shared: SharedUniforms;
  private terrain!: Terrain;
  private globe!: Globe;
  private labels!: Labels;
  private streets!: Streets;
  private aerial!: Aerial;
  private marker: LabelGroup | null = null;

  private pose: Pose;
  private goal: Pose;
  /** How fast the camera closes on its goal. Higher is snappier. */
  private stiffness = 4;
  private width = 1;
  private height = 1;
  private overcastGoal = 0;
  private date = new Date();
  private dirty = true;
  private active = true;
  private frame = 0;
  private hoverPending: [number, number] | null = null;
  private lastTime = 0;
  private lastDrawn = 0;
  /** Flips every frame while only the people on the streets are moving. */
  private held = false;
  private disposers: (() => void)[] = [];

  private onHover: (picked: Picked | null) => void = () => {};
  private onPick: (picked: Picked | null) => void = () => {};
  private onSelect: (id: string) => void = () => {};
  private onMove: (pose: Pose) => void = () => {};
  private onStreets: (status: StreetStatus) => void = () => {};

  constructor(private options: EngineOptions) {
    this.pose = { ...options.pose };
    this.goal = { ...options.pose };

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // The far distance fades into the page background, so both use it.
    const fog = new THREE.Color().setRGB(
      BACKGROUND[0] / 255,
      BACKGROUND[1] / 255,
      BACKGROUND[2] / 255,
      THREE.SRGBColorSpace,
    );
    this.renderer.setClearColor(fog);
    this.shared = {
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
      uOvercast: { value: 0 },
      uFogColor: { value: fog },
      uFogNear: { value: 1e6 },
      uFogFar: { value: 2e6 },
      uRelief: { value: 1 },
      uLift: { value: 0 },
    };
  }

  async init(): Promise<void> {
    // The dots download while the model is built. The model then decides
    // which of them it covers.
    const dots = fetch(this.options.globeUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .catch(() => null);
    this.grid = await loadGrid(this.options.gridUrl);
    this.terrain = buildTerrain(this.grid, this.shared);
    this.globe = await buildGlobe(dots, this.shared, this.terrain.dotHeight);
    this.scene.add(this.globe.group, this.terrain.group);

    this.labels = new Labels(this.options.labels, this.labelSpecs(), (id) =>
      this.onSelect(id),
    );
    this.streets = new Streets(
      this.grid,
      this.shared,
      this.labels,
      () => (this.dirty = true),
      (status) => this.onStreets(status),
      this.options.reducedMotion,
    );
    this.aerial = new Aerial(this.shared, () => (this.dirty = true));
    this.scene.add(this.streets.group, this.aerial.group);

    this.setDate(new Date());
    this.observeSize();
    if (this.options.interactive) this.bindControls();
    this.bindContext();

    this.lastTime = performance.now();
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      this.step(now);
    };
    this.frame = requestAnimationFrame(tick);
    this.disposers.push(() => cancelAnimationFrame(this.frame));
  }

  // ------------------------------------------------------------- public --

  on(event: "hover" | "pick", handler: (picked: Picked | null) => void): void;
  on(event: "select", handler: (id: string) => void): void;
  on(event: "move", handler: (pose: Pose) => void): void;
  on(event: "streets", handler: (status: StreetStatus) => void): void;
  on(event: string, handler: (value: never) => void): void {
    if (event === "hover") this.onHover = handler as typeof this.onHover;
    if (event === "pick") this.onPick = handler as typeof this.onPick;
    if (event === "select") this.onSelect = handler as typeof this.onSelect;
    if (event === "move") this.onMove = handler as typeof this.onMove;
    if (event === "streets") this.onStreets = handler as typeof this.onStreets;
  }

  /** Send the camera somewhere. Fields left out keep their current goal. */
  setGoal(pose: Partial<Pose>, speed = 4): void {
    Object.assign(this.goal, pose);
    this.stiffness = speed;
    if (this.options.reducedMotion) this.pose = { ...this.goal };
    this.dirty = true;
  }

  getGoal(): Pose {
    return { ...this.goal };
  }

  /** A good view of a named place. */
  poseFor(place: Place): Partial<Pose> {
    const [x, z] = latLonToWorld(place.lat, place.lon);
    // A single building is best seen from its street.
    if (place.streets) return { x, z, ...STREET_VIEW };
    const dist = place.kind === "water" ? 170 : place.kind === "city" ? 62 : 48;
    return { x, z, dist, tilt: 54 };
  }

  flyToPlace(place: Place): void {
    this.setGoal(this.poseFor(place), 2.6);
  }

  /** Go down to the streets around a point (scene km). */
  flyToStreets(x: number, z: number): void {
    this.setGoal({ x, z, ...STREET_VIEW }, 2.2);
  }

  /** Have the streets for a view loaded before the camera gets there. */
  preloadStreets(view: Pose | null): void {
    this.streets.preload(view);
  }

  /** Put a named pin on a point (scene km), or take it away with null. */
  setMarker(marker: { x: number; z: number; text: string } | null): void {
    this.marker?.remove();
    this.marker = marker
      ? this.labels.add([
          {
            id: "marker",
            text: marker.text,
            kind: "pin",
            x: marker.x,
            y: 0,
            z: marker.z,
            rank: -1,
            minDistance: 0,
            maxDistance: 60,
            interactive: false,
          },
        ])
      : null;
    this.dirty = true;
  }

  /** Whether streets are showing, loading, or could not be loaded. */
  getStreets(): StreetStatus {
    return this.streets.getStatus();
  }

  /** Where the camera is right now, as opposed to where it is heading. */
  getPose(): Pose {
    return { ...this.pose };
  }

  setDate(date: Date): void {
    this.date = date;
    const [x, y, z] = sunDirection(date, ORIGIN.lat, ORIGIN.lon);
    this.shared.uSunDir.value.set(x, y, z);
    this.dirty = true;
  }

  /** The sun as seen from the middle of the country at the map's time. */
  getSun(): SunPosition {
    return sunPosition(this.date, ORIGIN.lat, ORIGIN.lon);
  }

  /** 0 is a clear sky, 1 fully overcast. */
  setOvercast(amount: number): void {
    this.overcastGoal = amount;
    this.dirty = true;
  }

  /** Cover the land below a level (metres to NAP) with water. Null clears it. */
  setFlood(level: number | null): void {
    this.terrain.setFlood(level);
    this.dirty = true;
  }

  setLabelFilter(maxRank: number, kinds: LabelKind[] | null = null): void {
    this.labels.setFilter(maxRank, kinds);
    this.dirty = true;
  }

  /** Show or hide all names of some kinds, such as the universities. */
  setLabelKinds(kinds: LabelKind[], shown: boolean): void {
    this.labels.setKinds(kinds, shown);
    this.dirty = true;
  }

  /** Show or hide the people walking the streets. */
  setPeople(shown: boolean): void {
    this.streets.setPeople(shown);
  }

  /** Draw the ground as the atlas model, or with the Dutch aerial photo. */
  setGroundMode(mode: GroundMode): void {
    this.aerial.setMode(mode);
    this.terrain.setPhoto(mode !== "model");
    this.dirty = true;
  }

  /** Stop drawing while the map is covered or off screen. */
  setActive(active: boolean): void {
    this.active = active;
    this.dirty = true;
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.aerial?.dispose();
    this.streets?.dispose();
    this.labels?.dispose();
    this.terrain?.dispose();
    this.globe?.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------- labels --

  private labelSpecs(): LabelSpec[] {
    const grid = this.grid;
    const specs: LabelSpec[] = [];
    const heightAt = (x: number, z: number) => {
      const cell = grid.cellAt(x, z);
      return cell < 0 ? 0 : this.terrain.roof[cell];
    };

    specs.push({
      id: "netherlands",
      text: "Netherlands",
      kind: "country",
      x: 0,
      y: 0,
      z: 0,
      rank: 0,
      minDistance: 1500,
      maxDistance: Infinity,
      interactive: false,
    });

    for (const province of grid.meta.provinces) {
      const [x, z] = rdToWorld(province.x, province.y);
      specs.push({
        id: `province:${province.name}`,
        text: province.name,
        kind: "province",
        x,
        y: 0.5,
        z,
        rank: 5,
        minDistance: 210,
        maxDistance: 1100,
        interactive: false,
      });
    }

    const reach: Record<Place["kind"], [number, number, number]> = {
      // The largest cities stay on from far enough out to see the whole
      // country on a phone held upright.
      city: [1300, 520, 300],
      university: [1300, 1300, 1300],
      landmark: [1300, 1300, 700],
      water: [1300, 800, 420],
    };
    // Universities and landmarks are dots from afar, and get their names
    // once the camera is this close and there is room.
    const named: Partial<Record<Place["kind"], [number, number, number]>> = {
      university: [260, 260, 260],
      landmark: [420, 320, 210],
    };
    const order: Record<Place["kind"], number> = {
      city: 0,
      university: 2.5,
      landmark: 3,
      water: 3,
    };
    for (const place of places) {
      const [x, z] = latLonToWorld(place.lat, place.lon);
      specs.push({
        id: place.id,
        text: place.name,
        kind: place.kind,
        x,
        y: place.kind === "water" ? 0 : heightAt(x, z) + 0.4,
        z,
        rank: place.rank + order[place.kind],
        minDistance: place.kind === "water" ? 90 : 0,
        maxDistance: reach[place.kind][place.rank - 1],
        interactive: this.options.interactive,
        dotBeyond: named[place.kind]?.[place.rank - 1],
      });
    }
    return specs;
  }

  // ------------------------------------------------------------- camera --

  private applyPose(camera: THREE.PerspectiveCamera, pose: Pose): void {
    const tilt = clamp(pose.tilt, 0.6, 85) * RAD;
    const az = pose.az * RAD;
    // With az = 0 the camera stands south of its target and looks north.
    camera.position.set(
      pose.x - Math.sin(tilt) * Math.sin(az) * pose.dist,
      Math.cos(tilt) * pose.dist,
      pose.z + Math.sin(tilt) * Math.cos(az) * pose.dist,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(pose.x, 0, pose.z);

    // Keep the depth range tight: from just in front of the nearest ground
    // to the horizon of the globe.
    const altitude = Math.max(
      0.05,
      camera.position.distanceTo(GLOBE_CENTRE) - EARTH_RADIUS_KM,
    );
    const horizon = Math.sqrt(altitude * altitude + 2 * EARTH_RADIUS_KM * altitude);
    camera.near = Math.max(0.002, Math.min(altitude, pose.dist) * 0.04);
    camera.far = Math.max(pose.dist * 3, horizon + (altitude > 1000 ? 1800 : 80));
    camera.aspect = this.width / this.height;
    if (pose.shiftX || pose.shiftY) {
      camera.setViewOffset(
        this.width,
        this.height,
        -pose.shiftX * this.width,
        -pose.shiftY * this.height,
        this.width,
        this.height,
      );
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  /** The point on a horizontal plane under a screen position, for a pose. */
  private groundAt(
    clientX: number,
    clientY: number,
    pose: Pose,
    planeY = 0,
  ): THREE.Vector3 | null {
    const rect = this.options.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.applyPose(this.scratch, pose);
    const point = new THREE.Vector3(nx, ny, 0.5).unproject(this.scratch);
    const direction = point.sub(this.scratch.position).normalize();
    if (direction.y > -1e-4) return null;
    const t = (planeY - this.scratch.position.y) / direction.y;
    return this.scratch.position.clone().addScaledVector(direction, t);
  }

  private pickAt(clientX: number, clientY: number): Picked | null {
    const first = this.groundAt(clientX, clientY, this.pose);
    if (!first) return null;
    let cell = this.grid.cellAt(first.x, first.z);
    if (cell < 0) return null;
    // The ground is not at zero everywhere. Aim again at the height found.
    const second = this.groundAt(
      clientX,
      clientY,
      this.pose,
      this.terrain.ground[cell] * this.shared.uRelief.value,
    );
    if (second) {
      const refined = this.grid.cellAt(second.x, second.z);
      if (refined >= 0) cell = refined;
    }
    const [x, z] = this.grid.cellCentre(cell);
    return {
      cell: this.grid.info(cell),
      nearby: Math.round(this.grid.peopleWithin(x, z, 5) / 100) * 100,
    };
  }

  private limitGoal(): void {
    if (!this.options.interactive) return;
    const g = this.goal;
    g.dist = clamp(g.dist, MIN_DIST, MAX_DIST);
    g.tilt = clamp(g.tilt, 0.6, MAX_TILT);
    g.x = clamp(g.x, this.grid.x0 + 8, this.grid.xMax - 8);
    g.z = clamp(g.z, this.grid.z0 + 8, this.grid.zMax - 8);
  }

  // ----------------------------------------------------------- controls --

  private bindControls(): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: "pan" | "rotate" | "pinch" | null = null;
    let travelled = 0;
    let start = {
      pose: { ...this.goal },
      x: 0,
      y: 0,
      ground: null as THREE.Vector3 | null,
      spread: 1,
      angle: 0,
    };

    const two = () => {
      const [a, b] = [...pointers.values()];
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        spread: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        angle: Math.atan2(b.y - a.y, b.x - a.x) / RAD,
      };
    };

    const begin = (event: PointerEvent | null) => {
      const pose = { ...this.goal };
      if (pointers.size >= 2) {
        const t = two();
        mode = "pinch";
        start = {
          pose,
          x: t.x,
          y: t.y,
          ground: this.groundAt(t.x, t.y, pose),
          spread: t.spread,
          angle: t.angle,
        };
      } else if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        const rotate =
          !!event && (event.button === 2 || event.shiftKey || event.ctrlKey);
        mode = rotate ? "rotate" : "pan";
        start = {
          pose,
          x: p.x,
          y: p.y,
          ground: this.groundAt(p.x, p.y, pose),
          spread: 1,
          angle: 0,
        };
      } else {
        mode = null;
      }
    };

    const down = (event: PointerEvent) => {
      this.options.canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) travelled = 0;
      begin(event);
    };

    const move = (event: PointerEvent) => {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) {
        // Resolved once per frame in step(); a mouse can fire far more often.
        if (event.pointerType === "mouse") this.hoverPending = [event.clientX, event.clientY];
        return;
      }
      travelled += Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      this.stiffness = 16;

      if (mode === "pan" && start.ground) {
        const now = this.groundAt(pointer.x, pointer.y, start.pose);
        if (now) {
          this.goal.x = start.pose.x + start.ground.x - now.x;
          this.goal.z = start.pose.z + start.ground.z - now.z;
        }
      } else if (mode === "rotate") {
        this.goal.az = start.pose.az + (pointer.x - start.x) * 0.3;
        this.goal.tilt = start.pose.tilt - (pointer.y - start.y) * 0.25;
      } else if (mode === "pinch" && pointers.size >= 2) {
        const t = two();
        const turned = { ...start.pose };
        turned.dist = start.pose.dist * (start.spread / t.spread);
        // Twisting two fingers clockwise turns the map with them.
        turned.az = start.pose.az - (t.angle - start.angle);
        this.goal.dist = turned.dist;
        this.goal.az = turned.az;
        if (start.ground) {
          // Keep the spot that was between the fingers between the fingers.
          const now = this.groundAt(t.x, t.y, { ...turned, x: start.pose.x, z: start.pose.z });
          if (now) {
            this.goal.x = start.pose.x + start.ground.x - now.x;
            this.goal.z = start.pose.z + start.ground.z - now.z;
          }
        }
      }
      this.limitGoal();
      this.dirty = true;
    };

    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      const wasTap = pointers.size === 1 && mode === "pan" && travelled < 6;
      pointers.delete(event.pointerId);
      if (wasTap && event.type === "pointerup") {
        this.onPick(this.pickAt(event.clientX, event.clientY));
      }
      begin(null);
    };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      // Pinch on a trackpad arrives as a wheel event with ctrl held.
      const delta = event.deltaMode === 1 ? event.deltaY * 30 : event.deltaY;
      const factor = Math.exp(delta * (event.ctrlKey ? 0.01 : 0.0014));
      const before = this.goal.dist;
      const after = clamp(before * factor, MIN_DIST, MAX_DIST);
      const under = this.groundAt(event.clientX, event.clientY, this.goal);
      if (under) {
        // Zoom towards whatever is under the cursor.
        const k = after / before;
        this.goal.x = under.x + (this.goal.x - under.x) * k;
        this.goal.z = under.z + (this.goal.z - under.z) * k;
      }
      this.goal.dist = after;
      this.stiffness = 12;
      this.limitGoal();
      this.dirty = true;
    };

    const key = (event: KeyboardEvent) => {
      const g = this.goal;
      const stride = g.dist * 0.12;
      const az = g.az * RAD;
      const forward = [Math.sin(az), -Math.cos(az)];
      const right = [Math.cos(az), Math.sin(az)];
      const actions: Record<string, () => void> = {
        ArrowUp: () => ((g.x += forward[0] * stride), (g.z += forward[1] * stride)),
        ArrowDown: () => ((g.x -= forward[0] * stride), (g.z -= forward[1] * stride)),
        ArrowRight: () => ((g.x += right[0] * stride), (g.z += right[1] * stride)),
        ArrowLeft: () => ((g.x -= right[0] * stride), (g.z -= right[1] * stride)),
        "+": () => (g.dist *= 0.8),
        "=": () => (g.dist *= 0.8),
        "-": () => (g.dist *= 1.25),
        q: () => (g.az -= 15),
        e: () => (g.az += 15),
        PageUp: () => (g.tilt -= 8),
        PageDown: () => (g.tilt += 8),
      };
      const action = actions[event.key];
      if (!action || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      action();
      this.stiffness = 8;
      this.limitGoal();
      this.dirty = true;
    };

    const leave = () => this.onHover(null);
    const menu = (event: Event) => event.preventDefault();

    this.listen("pointerdown", down);
    this.listen("pointermove", move);
    this.listen("pointerup", up);
    this.listen("pointercancel", up);
    this.listen("pointerleave", leave);
    this.listen("wheel", wheel, { passive: false });
    this.listen("keydown", key);
    this.listen("contextmenu", menu);
  }

  /** Listen on the canvas until the map is disposed of. */
  private listen<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  private listen(type: `webglcontext${string}`, handler: (event: Event) => void): void;
  private listen(
    type: string,
    handler: (event: never) => void,
    options?: AddEventListenerOptions,
  ): void {
    const canvas = this.options.canvas;
    canvas.addEventListener(type, handler as EventListener, options);
    this.disposers.push(() => canvas.removeEventListener(type, handler as EventListener));
  }

  /** Buttons next to the map use these, so everything works without a mouse. */
  zoomBy(factor: number): void {
    this.setGoal({ dist: this.goal.dist * factor }, 8);
    this.limitGoal();
  }
  rotateBy(degrees: number): void {
    this.setGoal({ az: this.goal.az + degrees }, 6);
  }
  tiltTo(degrees: number): void {
    this.setGoal({ tilt: degrees }, 6);
    this.limitGoal();
  }

  // --------------------------------------------------------------- loop --

  private observeSize(): void {
    const canvas = this.options.canvas;
    const resize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      if (width === this.width && height === this.height) return;
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      this.dirty = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    this.disposers.push(() => observer.disconnect());
  }

  private bindContext(): void {
    this.listen("webglcontextlost", (event) => event.preventDefault());
    this.listen("webglcontextrestored", () => {
      // Street tiles give up their data once it is on the graphics card,
      // so they are loaded again.
      this.streets?.reset();
      this.dirty = true;
    });
  }

  private step(now: number): void {
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.1);
    this.lastTime = now;
    if (!this.active || document.hidden) return;

    // Ease the camera towards its goal. Distance moves on a log scale so a
    // zoom from orbit to street level feels even all the way down.
    const p = this.pose;
    const g = this.goal;
    const a = 1 - Math.exp(-this.stiffness * dt);
    const turn = ((((g.az - p.az) % 360) + 540) % 360) - 180;
    const zoom = Math.log(g.dist / p.dist);
    const gap =
      Math.abs(g.x - p.x) / p.dist +
      Math.abs(g.z - p.z) / p.dist +
      Math.abs(zoom) +
      Math.abs(turn) / 90 +
      Math.abs(g.tilt - p.tilt) / 90 +
      Math.abs(g.shiftX - p.shiftX) +
      Math.abs(g.shiftY - p.shiftY);
    const moving = gap > 2e-4;
    if (moving) {
      p.x += (g.x - p.x) * a;
      p.z += (g.z - p.z) * a;
      p.dist *= Math.exp(zoom * a);
      p.az += turn * a;
      p.tilt += (g.tilt - p.tilt) * a;
      p.shiftX += (g.shiftX - p.shiftX) * a;
      p.shiftY += (g.shiftY - p.shiftY) * a;
    } else if (gap > 0) {
      Object.assign(p, g);
      this.dirty = true;
    }

    const overcast = this.shared.uOvercast;
    const weather = Math.abs(this.overcastGoal - overcast.value) > 0.002;
    if (weather) {
      overcast.value +=
        (this.overcastGoal - overcast.value) * (1 - Math.exp(-3 * dt));
    }

    if (this.hoverPending) {
      const [x, y] = this.hoverPending;
      this.hoverPending = null;
      this.onHover(this.pickAt(x, y));
    }

    if (!moving && !weather && !this.dirty) {
      // Nothing changed but the people on the streets, if there are any.
      // Every other frame is plenty for them.
      if (!this.streets.strolling || (this.held = !this.held)) return;
    }
    this.dirty = false;
    const since = clamp((now - this.lastDrawn) / 1000, 0, 0.1);
    this.lastDrawn = now;

    this.applyPose(this.camera, p);
    // The stretched relief relaxes as the camera comes down. On a log
    // scale, so it keeps pace with the zoom.
    const t = clamp(
      Math.log(p.dist / RELIEF_GONE) / Math.log(RELIEF_FULL / RELIEF_GONE),
      0,
      1,
    );
    const relief = t * t * (3 - 2 * t);
    this.shared.uRelief.value = relief;
    // Streets float a hair above the flat ground: more from further away,
    // where the depth buffer is coarser.
    this.shared.uLift.value = 0.0004 * clamp(p.dist, 0.5, 5);
    // Haze towards the horizon when close in; none from orbit. At street
    // level it closes in, because only the area around the camera is loaded.
    const hazy = p.dist < 1400;
    this.shared.uFogNear.value = hazy ? p.dist * (1.9 + 0.7 * relief) : 1e7;
    this.shared.uFogFar.value = hazy ? p.dist * (6 + 3 * relief) : 2e7;
    this.globe.update(p.dist);
    this.terrain.update(relief);
    if (this.streets.update(p, g, since)) this.dirty = true;
    const heightAt = (x: number, z: number) => {
      const cell = this.grid.cellAt(x, z);
      return cell < 0 ? 0 : this.terrain.ground[cell];
    };
    if (this.aerial.update(p, heightAt)) this.dirty = true;
    this.labels.update(this.camera, this.width, this.height, p.dist, relief);
    this.renderer.render(this.scene, this.camera);
    if (moving) this.onMove({ ...p });
  }
}
