import * as T from "three";
import { CAR_PAINTS, fetchBinary, type Corridor, type DriveArea, type Point, type RoadMode } from "./data";
import { distance, mixAngle, type Roads, type Simulation } from "./simulation";
import { BuildingCollisions } from "./collisions";
import { box, rod } from "./geometry";
import { buildingMaterial, FACADE_FLAG } from "./facades";
import { LocalScenery } from "./local-scenery";
import { RoadArrows } from "./road-arrows";
import { WalkingPerson } from "./pedestrians";
import { RoadLighting, type VehicleLamps } from "./road-lighting";
import { trainCabin, type TrainSeat, type TrainView } from "./train-cabin";
import { AvatarLook, SeatedPassenger, savedLook, type TrainActivity } from "./avatar";
import type { Places } from "./places";
import type { TrafficSigns } from "./traffic-signs";
import type { RoadPose } from "./vehicle-contact";

const paint = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.8 });
const rubber = paint("#202833");
const glass = paint("#243c52");
const ivory = paint("#ffefcf");
const scarlet = paint("#bf362c");

function seatDriver(group: T.Group, you: AvatarLook): void {
  const seat = paint("#765f49");
  for (const x of [-0.43, 0.43]) {
    box(group, seat, x, 0.8, -0.09, 0.45, 0.14, 0.45);
    box(group, seat, x, 0.99, -0.34, 0.43, 0.33, 0.12).rotation.x = -0.13;
  }

  // Looking towards +z, +x is the left-hand seat.
  const { top: jacket, skin } = you;
  const point = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  rod(group, jacket, 0.142, point(0.43, 0.88, -0.14), point(0.43, 1.15, -0.045));
  rod(group, skin, 0.057, point(0.43, 1.14, -0.05), point(0.43, 1.23, -0.015));

  const headGeometry = new T.SphereGeometry(1, 14, 10);
  const head = new T.Mesh(headGeometry, skin);
  head.position.set(0.43, 1.3, -0.015);
  head.scale.set(0.106, 0.125, 0.106);
  group.add(head);
  you.addHair(group, 0.43, 1.3, -0.015, 0.106);

  const wheel = new T.Mesh(new T.TorusGeometry(0.138, 0.019, 8, 24), rubber);
  wheel.position.set(0.43, 1.045, 0.43);
  wheel.rotation.x = -0.35;
  group.add(wheel);
  rod(group, rubber, 0.023, point(0.3, 1.045, 0.43), point(0.56, 1.045, 0.43));
  rod(group, rubber, 0.029, wheel.position, point(0.43, 0.92, 0.64));
  for (const side of [-1, 1]) {
    const shoulder = point(0.43 + 0.12 * side, 1.13, -0.04);
    const elbow = point(0.43 + 0.17 * side, 0.969, 0.15);
    const wrist = point(0.43 + 0.127 * side, 1.04, 0.405);
    rod(group, jacket, 0.052, shoulder, elbow);
    rod(group, jacket, 0.042, elbow, wrist);
    const hand = new T.Mesh(headGeometry, skin);
    hand.position.set(wrist.x, wrist.y, wrist.z + 0.027);
    hand.scale.setScalar(0.038);
    group.add(hand);
  }
}

function carModel(body: T.Material, lamps: VehicleLamps, you: AvatarLook): T.Group {
  const group = new T.Group();
  box(group, body, 0, 0.57, 0, 1.79, 0.39, 4.05);
  box(group, body, 0, 0.904, 1.34, 1.79, 0.28, 1.37);
  box(group, body, 0, 0.875, -1.38, 1.79, 0.22, 1.28);
  box(group, rubber, 0, 0.82, -0.045, 1.6, 0.10, 1.48);
  for (const x of [-0.83, 0.83]) {
    box(group, body, x, 0.873, -0.035, 0.13, 0.23, 1.5);
    box(group, rubber, x, 0.979, -0.055, 0.105, 0.04, 1.39);
    box(group, body, x * 1.11, 1.045, 0.58, 0.2, 0.085, 0.13);
  }
  seatDriver(group, you);

  const windshield = new T.MeshStandardMaterial({
    color: "#a2d4ed", roughness: 0.24, transparent: true, opacity: 0.24, depthWrite: false,
  });
  box(group, windshield, 0, 1.216, 0.66, 1.45, 0.416, 0.015).rotation.x = -0.54;
  for (const x of [-0.728, 0.728]) {
    rod(group, rubber, 0.021, new T.Vector3(x, 1.036, 0.767), new T.Vector3(x, 1.396, 0.553));
  }
  rod(group, rubber, 0.019, new T.Vector3(-0.728, 1.396, 0.553), new T.Vector3(0.728, 1.396, 0.553));
  box(group, rubber, 0, 0.48, -2.05, 1.67, 0.16, 0.12);
  box(group, ivory, 0, 0.69, -2.04, 0.46, 0.15, 0.1);
  for (const x of [-0.79, 0.79]) {
    box(group, lamps.rear, x * 0.86, 0.87, -2.045, 0.32, 0.16, 0.06);
    box(group, lamps.front, x * 0.86, 0.87, 2.045, 0.29, 0.17, 0.06);
    for (const z of [-1.23, 1.23]) {
      const wheel = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 0.23, 16), rubber);
      wheel.position.set(x, 0.32, z);
      wheel.rotation.z = Math.PI / 2;
      group.add(wheel);
    }
  }
  return group;
}

function bikeModel(you: AvatarLook): T.Group {
  const group = new T.Group();
  const frame = paint("#f48b3d");
  const { top: jacket, skin } = you;
  const trousers = paint("#233d49");
  const p = (y: number, z: number, x = 0) => new T.Vector3(x, y, z);
  for (const z of [-0.57, 0.64]) {
    const wheel = new T.Mesh(new T.TorusGeometry(0.34, 0.031, 6, 20), rubber);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0, 0.36, z);
    group.add(wheel);
    for (const a of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      rod(group, ivory, 0.009, p(0.36 + Math.cos(a) * 0.33, z + Math.sin(a) * 0.33),
        p(0.36 - Math.cos(a) * 0.33, z - Math.sin(a) * 0.33));
    }
  }
  const crank = p(0.42, -0.07);
  const saddle = p(0.92, -0.24);
  const fork = p(0.96, 0.42);
  for (const [a, b] of [
    [crank, p(0.36, -0.57)], [saddle, p(0.36, -0.57)], [crank, saddle],
    [crank, fork], [saddle, fork], [fork, p(0.36, 0.64)],
  ]) rod(group, frame, 0.023, a, b);
  rod(group, rubber, 0.025, p(1.03, 0.42, -0.28), p(1.03, 0.42, 0.28));
  box(group, rubber, 0, 0.94, -0.25, 0.16, 0.06, 0.24);
  rod(group, jacket, 0.14, p(1.03, -0.21), p(1.42, 0.07));
  const head = new T.Mesh(new T.SphereGeometry(0.105, 12, 8), skin);
  head.position.copy(p(1.58, 0.13));
  group.add(head);
  you.addHair(group, 0, 1.58, 0.13, 0.105);
  for (const x of [-0.13, 0.13]) {
    const knee = p(0.75, 0.12, x);
    rod(group, trousers, 0.063, p(1.05, -0.21, x * 0.7), knee);
    rod(group, trousers, 0.051, knee, p(0.49, -0.09, x));
    rod(group, jacket, 0.049, p(1.38, 0.07, x), p(1.04, 0.42, x * 1.85));
  }
  return group;
}

function trainModel(): T.Group {
  const group = new T.Group();
  const yellow = paint("#edbd30");
  const blue = paint("#244e9b");
  box(group, yellow, 0, 2.06, 0, 2.85, 2.83, 18.5);
  box(group, ivory, 0, 3.52, -0.1, 2.65, 0.20, 17.7);
  box(group, blue, 0, 2.57, 0, 2.88, 0.79, 18.55);
  box(group, rubber, 0, 0.53, 0, 2.57, 0.65, 17.8);
  for (const x of [-1.452, 1.452]) {
    for (const z of [-7.3, -5.45, -3.6, -1.75, 0.1, 1.95, 3.8, 5.65, 7.5]) {
      box(group, glass, x, 2.63, z, 0.035, 0.61, 1.3);
    }
    for (const z of [-6.35, 6.55]) {
      box(group, blue, x, 1.53, z, 0.035, 1.64, 0.71);
      box(group, glass, x * 1.016, 2.06, z, 0.032, 0.51, 0.51);
    }
  }
  for (const z of [-9.3, 9.3]) {
    box(group, glass, 0, 2.63, z, 1.94, 0.72, 0.09);
    for (const x of [-0.95, 0.95]) box(group, z > 0 ? ivory : scarlet, x, 1.18, z, 0.28, 0.19, 0.12);
  }
  return group;
}

const colors = new Float32Array(256);
const sample = new T.Color();
for (let i = 0; i < colors.length; i++) colors[i] = sample.setRGB(i / 255, 0, 0, T.SRGBColorSpace).r;

function readMesh(buffer: ArrayBuffer, start: number, ground: boolean): [T.BufferGeometry | null, number] {
  const [header, indexCount] = new Uint32Array(buffer, start, 2);
  const withFacades = !ground && (header & FACADE_FLAG) !== 0;
  const count = header & 0x7fffffff;
  let offset = start + 8;
  if (!count) return [null, offset];
  const dimensions = ground ? 2 : 3;
  const coords = new Float32Array(buffer, offset, count * dimensions);
  offset += coords.byteLength;
  const bytes = new Uint8Array(buffer, offset, count * 4);
  offset += bytes.byteLength;
  const indices = new Uint32Array(buffer, offset, indexCount);
  offset += indices.byteLength;
  const positions = new Float32Array(count * 3);
  const tint = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const base = i * dimensions;
    positions[i * 3] = coords[base] * 1000;
    positions[i * 3 + 1] = ground ? (0.006 + 0.046 * i / count) : coords[base + 1] * 1000;
    positions[i * 3 + 2] = coords[base + dimensions - 1] * 1000;
    for (let c = 0; c < 3; c++) tint[i * 3 + c] = colors[bytes[i * 4 + c]];
  }
  const mesh = new T.BufferGeometry();
  mesh.setAttribute("position", new T.BufferAttribute(positions, 3));
  mesh.setAttribute("color", new T.BufferAttribute(tint, 3));
  mesh.setIndex(new T.BufferAttribute(indices, 1));
  if (ground) {
    mesh.computeVertexNormals();
  } else {
    const seeds = new Uint8Array(count);
    for (let i = 0; i < count; i++) seeds[i] = bytes[i * 4 + 3];
    mesh.setAttribute("facadeSeed", new T.BufferAttribute(seeds, 1, true));
    const normals = new Int8Array(buffer, offset, count * 3);
    mesh.setAttribute("normal", new T.BufferAttribute(normals, 3, true));
    offset += Math.ceil(normals.byteLength / 4) * 4;
    if (withFacades) {
      mesh.setAttribute("facadeInfo", new T.BufferAttribute(new Uint8Array(buffer, offset, count * 4), 4));
      offset += count * 4;
    }
  }
  return [mesh, offset];
}

export class DriveGraphicsError extends Error {}

export class DriveView {
  readonly renderer: T.WebGLRenderer;
  readonly camera = new T.PerspectiveCamera(62, 1, 0.28, 980);
  readonly scene = new T.Scene();
  readonly lighting: RoadLighting;
  private readonly ground: T.MeshLambertMaterial;
  private imagery = new T.TextureLoader();
  private treeTrunk = new T.CylinderGeometry(1, 1.45, 1, 6);
  private treeCrown = new T.IcosahedronGeometry(1, 1);
  private treeLight = new T.MeshLambertMaterial();
  readonly buildings = new BuildingCollisions();
  private loadedTiles = new Set<string>();
  private solids = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  private tileGroups = new Map<string, { group: T.Group; ready: Promise<void>; finished: boolean }>();
  private failedTiles = new Set<string>();
  private carPaint = new T.MeshStandardMaterial({ color: CAR_PAINTS[0].color, roughness: 0.36 });
  private readonly car: T.Group;
  /** How you look as driver, cyclist, walker and passenger. */
  readonly you = new AvatarLook(savedLook());
  private bike = bikeModel(this.you);
  private train = [trainModel(), trainModel()];
  private cabin: T.Group | null;
  trainSeat: TrainSeat = "left";
  trainView: TrainView = "window";
  private passenger = new SeatedPassenger(this.you);
  /** The music's beat position, for the passenger to nod along. */
  beat = 0;
  private seated = false;
  private arrows: RoadArrows;
  private walker = new WalkingPerson(0, this.you);
  private scenery: LocalScenery;
  private map: Corridor;
  private cameraAngle = 0;
  private lastPosition: Point | null = null;
  private lastTile = "";
  private shadow = new T.Mesh(new T.CircleGeometry(1, 20),
    new T.MeshBasicMaterial({ color: "#182829", transparent: true, opacity: 0.22, depthWrite: false }));
  private lookAt = new T.Vector3();
  private cameraTarget = new T.Vector3();
  nearCamera = false;

  constructor(private viewport: HTMLElement, world: Simulation, places: Places, roads: Record<RoadMode, Roads>,
    signs: TrafficSigns, area: DriveArea, private assetUrl: string) {
    const map = this.map = world.map;
    try {
      this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      try {
        this.renderer = new T.WebGLRenderer({ antialias: false });
      } catch (cause) {
        throw new DriveGraphicsError("WebGL could not start", { cause });
      }
    }
    // Phones have dense screens and small GPUs. A lower ratio there keeps the frame rate up.
    const maxRatio = matchMedia("(pointer: coarse)").matches ? 1.25 : 1.6;
    this.renderer.setPixelRatio(Math.min(maxRatio, window.devicePixelRatio));
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.viewport.prepend(this.renderer.domElement);
    this.lighting = new RoadLighting(this.scene, area.center);
    this.ground = this.lighting.surface({ vertexColors: true, side: T.DoubleSide });
    this.car = carModel(this.carPaint, this.lighting.lamps, this.you);
    this.scene.add(this.car, this.bike, this.walker.model);
    this.cabin = world.hasTrain ? trainCabin() : null;
    if (this.cabin) {
      this.cabin.add(this.passenger.model);
      this.scene.add(...this.train, this.cabin);
    }
    this.solids.onBeforeCompile = (shader) => {
      shader.uniforms.nightMix = this.lighting.darkness;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float facadeSeed;\nvarying vec3 vFacade;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vFacade = vec3(dot(position.xz + modelMatrix[3].xz, vec2(-normal.z, normal.x)),
            position.y, facadeSeed);`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFacade;\nuniform float nightMix;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          if (vFacade.z > 0.001 && vFacade.y > 0.65) {
            vec2 span = vec2(2.45 + 0.9 * vFacade.z, 2.9 + 0.45 * vFacade.z);
            vec2 cell = abs(fract((vFacade.xy + vec2(12.0 * vFacade.z, 0.06)) / span) - 0.5);
            vec2 pixel = max(fwidth(vFacade.xy / span), vec2(0.003));
            vec2 mask = 1.0 - smoothstep(vec2(0.23, 0.22) - pixel, vec2(0.23, 0.22) + pixel, cell);
            vec2 brick = vec2(vFacade.x / 0.23, vFacade.y / 0.067);
            brick.x += 0.5 * mod(floor(brick.y), 2.0);
            vec2 joints = min(fract(brick), 1.0 - fract(brick));
            float mortar = (1.0 - smoothstep(0.026, 0.09, min(joints.x, joints.y)))
              * (1.0 - smoothstep(0.2, 0.75, max(fwidth(brick.x), fwidth(brick.y))));
            float isBrick = smoothstep(0.012, 0.05, diffuseColor.r - diffuseColor.g);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.31, 0.26), 0.24 * mortar * isBrick);
            float windowMask = mask.x * mask.y * (1.0 - smoothstep(0.22, 0.42, max(pixel.x, pixel.y)));
            vec2 glassMask = 1.0 - smoothstep(vec2(0.193, 0.187) - pixel, vec2(0.193, 0.187) + pixel, cell);
            float trim = clamp(windowMask - glassMask.x * glassMask.y, 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.070, 0.093, 0.119), windowMask * 0.76);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.40, 0.35, 0.28), trim * 0.70);
            vec2 window = floor((vFacade.xy + vec2(12.0 * vFacade.z, 0.06)) / span);
            float occupancy = fract(sin(dot(window, vec2(73.13, 43.83)) + vFacade.z * 527.0) * 9758.3);
            totalEmissiveRadiance += vec3(0.40, 0.23, 0.087) * nightMix * step(0.86, occupancy)
              * glassMask.x * glassMask.y * (1.0 - smoothstep(0.09, 0.17, max(pixel.x, pixel.y)));
          }`);
    };
    const fallback = new T.Mesh(new T.PlaneGeometry(this.map.bounds[0] + 1600, this.map.bounds[1] + 1600),
      this.lighting.surface({ color: "#9fb184" }));
    fallback.rotation.x = -Math.PI / 2;
    fallback.position.set(this.map.bounds[0] / 2, -0.17, this.map.bounds[1] / 2);
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(fallback, this.shadow);
    this.scenery = new LocalScenery(this.scene, world, places, roads, area.id, this.lighting);
    this.arrows = new RoadArrows(this.scene, map, roads, signs);
    new ResizeObserver(() => this.resize()).observe(viewport);
    this.resize();
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.viewport;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / Math.max(1, clientHeight);
    this.camera.updateProjectionMatrix();
  }

  private addTrees(geometry: T.BufferGeometry, group: T.Group): void {
    // TOP10NL's tree mesh packs each trunk and crown as two 20-vertex
    // boxes. Reuse their surveyed locations and dimensions.
    const coords = geometry.getAttribute("position");
    const tint = geometry.getAttribute("color");
    if (coords.count % 40 !== 0) {
      group.add(new T.Mesh(geometry, this.solids));
      return;
    }
    const count = coords.count / 40;
    const trunk = new T.InstancedMesh(this.treeTrunk, this.treeLight, count);
    const crown = new T.InstancedMesh(this.treeCrown, this.treeLight, count);
    const shape = new T.Object3D();
    const color = new T.Color();
    for (let i = 0; i < count; i++) {
      const stem = i * 40;
      const leaves = stem + 20;
      const x = (coords.getX(leaves) + coords.getX(leaves + 1)) / 2;
      const z = (coords.getZ(leaves) + coords.getZ(leaves + 5)) / 2;
      const height = coords.getY(stem + 2);
      shape.position.set(x, height / 2, z);
      shape.scale.set(0.15, height, 0.15);
      shape.updateMatrix();
      trunk.setMatrixAt(i, shape.matrix);
      trunk.setColorAt(i, color.setRGB(tint.getX(stem), tint.getY(stem), tint.getZ(stem)));
      const top = coords.getY(leaves + 2);
      const radius = (coords.getX(leaves + 1) - coords.getX(leaves)) / 2;
      shape.position.set(x, (height + top) / 2, z);
      shape.scale.set(radius, (top - height) * 0.58, radius);
      shape.rotation.y = (i * 2.39996) % (2 * Math.PI);
      shape.updateMatrix();
      crown.setMatrixAt(i, shape.matrix);
      crown.setColorAt(i, color.setRGB(tint.getX(leaves), tint.getY(leaves), tint.getZ(leaves)));
    }
    group.add(trunk, crown);
    geometry.dispose();
  }

  private async addAerial(geometry: T.BufferGeometry, mesh: T.Mesh, key: string): Promise<T.Texture | null> {
    try {
      const texture = await this.imagery.loadAsync(`${this.assetUrl}/aerial/${key}.jpg`);
      texture.colorSpace = T.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const coords = geometry.getAttribute("position");
      const uv = new Float32Array(coords.count * 2);
      for (let i = 0; i < coords.count; i++) {
        uv[i * 2] = coords.getX(i) / this.map.tileSize;
        uv[i * 2 + 1] = 1 - coords.getZ(i) / this.map.tileSize;
      }
      geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
      mesh.material = this.lighting.surface({ vertexColors: true, side: T.DoubleSide, map: texture }, true);
      return texture;
    } catch {
      // Keep the vector map available if an aerial tile is unavailable.
      return null;
    }
  }

  isTileLoaded([x, z]: Point): boolean {
    const size = this.map.tileSize;
    return this.loadedTiles.has(`${Math.floor(x / size)}-${Math.floor(z / size)}`);
  }

  private loadTile(col: number, row: number): Promise<void> {
    const key = `${col}-${row}`;
    const loaded = this.tileGroups.get(key);
    if (loaded) return loaded.ready;
    const group = new T.Group();
    group.position.set(col * this.map.tileSize, 0, row * this.map.tileSize);
    this.scene.add(group);
    const ready = fetchBinary(`${this.assetUrl}/${key}.bin`).then(async (buffer) => {
      const [flat, offset] = readMesh(buffer, 0, true);
      const [trees, end] = readMesh(buffer, offset, false);
      const [buildings, footprintStart] = readMesh(buffer, end, false);
      if (!this.loadedTiles.has(key)) {
        this.buildings.add(new Float32Array(buffer, footprintStart), group.position.x, group.position.z);
      }
      this.loadedTiles.add(key);
      this.failedTiles.delete(key);
      if (trees) this.addTrees(trees, group);
      const solids = buildings ? buildingMaterial(this.lighting.darkness, this.map.tileSize) : null;
      if (buildings && solids) group.add(new T.Mesh(buildings, solids.material));
      if (flat) {
        const surface = new T.Mesh(flat, this.ground);
        group.add(surface);
        const photo = await this.addAerial(flat, surface, key);
        if (photo) solids?.setRoofPhoto(photo);
      }
    }).catch((error) => {
      this.failedTiles.add(key);
      this.scene.remove(group);
      this.tileGroups.delete(key);
      throw error;
    });
    const entry = { group, ready, finished: false };
    this.tileGroups.set(key, entry);
    void ready.then(() => { entry.finished = true; }, () => {});
    return ready;
  }

  async loadAround([x, z]: Point): Promise<void> {
    const size = this.map.tileSize;
    const col = Math.floor(x / size);
    const row = Math.floor(z / size);
    const key = `${col}-${row}`;
    if (key === this.lastTile) return this.tileGroups.get(key)?.ready;
    this.lastTile = key;
    const near = this.map.tiles.filter(([c, r]) => Math.abs(c - col) <= 1 && Math.abs(r - row) <= 1);
    const adjacent = new Set(near.map(([c, r]) => `${c}-${r}`));
    for (const [id, entry] of this.tileGroups) {
      entry.group.visible = adjacent.has(id);
      if (entry.group.visible || !entry.finished) continue;
      for (const mesh of entry.group.children as T.Mesh<T.BufferGeometry, T.Material>[]) {
        if (mesh instanceof T.InstancedMesh) mesh.dispose();
        else mesh.geometry.dispose();
        if (mesh.material instanceof T.MeshLambertMaterial && mesh.material.map) {
          mesh.material.map.dispose();
          mesh.material.dispose();
        } else if (mesh.material.userData.perTile) {
          mesh.material.dispose();
        }
      }
      this.scene.remove(entry.group);
      this.tileGroups.delete(id);
    }
    const center = adjacent.has(key) ? this.loadTile(col, row) : undefined;
    void Promise.allSettled(near.map(([c, r]) => this.loadTile(c, r)));
    await center;
  }

  get incomplete(): boolean {
    return this.failedTiles.size > 0;
  }

  set trainActivity(activity: TrainActivity) {
    this.passenger.setActivity(activity);
  }

  setCarPaint(color: string): void {
    this.carPaint.color.set(color);
  }

  private clearCamera(position: Point, eye: T.Vector3): number {
    const [x, z] = position;
    const dx = eye.x - x, dz = eye.z - z;
    const length = Math.hypot(dx, dz);
    if (length === 0) return 0;
    const steps = Math.ceil(length / 0.35);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      if (!this.buildings.circle([x + dx * t, z + dz * t], 0.24)) continue;
      const clear = (step - 1) / steps;
      eye.x = x + dx * clear;
      eye.z = z + dz * clear;
      return length * clear;
    }
    return length;
  }

  frame(world: Simulation, dt: number, roadCars: readonly RoadPose[] = []): void {
    void this.loadAround(world.position).catch(() => {});
    const [x, z] = world.position;
    const car = world.mode === "car";
    const bike = world.mode === "bike";
    const train = world.mode === "train";
    const walk = world.mode === "walk";
    this.lighting.refresh();
    this.lighting.headlamps(car ? { point: world.position, angle: world.angle } : null, roadCars, world.position);
    this.car.visible = car;
    this.bike.visible = bike;
    this.arrows.follow(world);
    if (car || bike) {
      const vehicle = car ? this.car : this.bike;
      vehicle.position.set(x, 0.07, z);
      vehicle.rotation.y = world.angle;
    }
    if (walk) this.walker.place(world.position, world.angle, world.speed, dt);
    if (!train) {
      this.shadow.position.set(x, 0.085, z);
      this.shadow.scale.set(car ? 1.18 : walk ? 0.31 : 0.42, car ? 2.16 : walk ? 0.28 : 0.92, 1);
    }
    this.shadow.visible = !train;
    for (let i = 0; world.hasTrain && i < this.train.length; i++) {
      const unit = this.train[i];
      const at = world.train.distance - i * 19.2 * world.train.direction;
      const { x: tx, z: tz, height, heading } = this.scenery.pose(at);
      unit.position.set(tx, height + 0.24, tz);
      const slope = Math.atan2(this.scenery.height(at + 7) - this.scenery.height(at - 7), 14);
      unit.rotation.set(-slope * world.train.direction, heading + (world.train.direction < 0 ? Math.PI : 0), 0, "YXZ");
    }
    const seated = train && this.trainView !== "outside";
    if (this.camera.fov !== (seated ? 72 : 62)) {
      this.camera.fov = seated ? 72 : 62;
      this.camera.updateProjectionMatrix();
    }
    if (this.cabin) {
      this.cabin.visible = seated;
      this.train[0].visible = !seated;
      if (seated) {
        this.cabin.position.copy(this.train[0].position);
        this.cabin.rotation.copy(this.train[0].rotation);
        // +x is the left side of the carriage. You sit in the window seat of the middle bay.
        const side = this.trainSeat === "left" ? 1 : -1;
        this.passenger.model.position.set(side * 1.1, 1.47, -0.06);
        this.passenger.windowSide = side;
        this.passenger.update(dt, world.train.speed, this.beat);
        if (this.trainView === "you") {
          // From across the aisle, a seat ahead: you, your book or music, and the window.
          this.camera.position.copy(this.cabin.localToWorld(this.cameraTarget.set(-side * 0.2, 2.3, 1.42)));
          this.camera.lookAt(this.cabin.localToWorld(this.lookAt.set(side * 1.05, 1.86, -0.12)));
        } else {
          // Over your shoulder, looking out of the window.
          this.camera.position.copy(this.cabin.localToWorld(this.cameraTarget.set(side * 0.5, 2.66, -0.72)));
          this.camera.lookAt(this.cabin.localToWorld(this.lookAt.set(side * 2.9, 1.9, 1.25)));
        }
        this.walker.model.visible = false;
        this.renderer.render(this.scene, this.camera);
        this.lastPosition = world.position;
        this.seated = true;
        return;
      }
    }
    const warp = this.seated || !this.lastPosition || distance(this.lastPosition, world.position) > 18;
    this.seated = false;
    this.cameraAngle = warp ? world.angle : mixAngle(this.cameraAngle, world.angle, 1 - Math.exp(-dt * 5.4));
    const dx = Math.sin(this.cameraAngle);
    const dz = Math.cos(this.cameraAngle);
    const closeCar = car && this.nearCamera;
    const tail = walk ? (this.nearCamera ? 2.7 : 4.7) : this.nearCamera ? (train ? 5 : car ? 5.3 : 2.5) : (train ? 33 : car ? 9.2 : 6.5);
    const railHeight = train ? this.scenery.height(world.train.distance) : 0;
    const lift = walk ? (this.nearCamera ? 1.94 : 2.75) : this.nearCamera ? (train ? 5.3 : car ? 3.1 : 2.6) : (train ? 13 : car ? 5.4 : 4.0);
    const side = train ? (this.nearCamera ? 3.7 : 13) : closeCar ? 1.4 : 0;
    const lookAhead = train ? 17 : walk ? 3.6 : closeCar ? 4.2 : 9;
    const cameraX = x - dx * tail + dz * side;
    const cameraZ = z - dz * tail - dx * side;
    const viewHeight = train ? lift + railHeight : this.scenery.roadCameraHeight(cameraX, cameraZ, lift);
    this.cameraTarget.set(cameraX, viewHeight, cameraZ);
    if (!train) {
      const clearance = this.clearCamera(world.position, this.cameraTarget);
      if (clearance < 2) this.cameraTarget.y = Math.min(viewHeight, (walk ? 1.65 : 2.25) + clearance * 0.45);
    }
    this.camera.position.lerp(this.cameraTarget, warp ? 1 : 1 - Math.exp(-dt * 8));
    if (!train) {
      const eye = this.camera.position;
      const clearance = this.clearCamera(world.position, eye);
      if (clearance < 2) eye.y = Math.min(eye.y, this.cameraTarget.y);
      eye.y = this.scenery.roadCameraHeight(eye.x, eye.z, eye.y);
    }
    this.walker.model.visible = walk && Math.hypot(x - this.camera.position.x, z - this.camera.position.z) >= 0.8;
    this.lookAt.set(x + dx * lookAhead, train ? 2.8 + railHeight : 1.45, z + dz * lookAhead);
    this.camera.lookAt(this.lookAt);
    this.renderer.render(this.scene, this.camera);
    this.lastPosition = world.position;
  }
}
