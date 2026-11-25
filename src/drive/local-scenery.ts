import * as T from "three";
import type { Point, RoadMode } from "./data";
import { box, rod } from "./geometry";
import type { Places } from "./places";
import type { RoadLighting } from "./road-lighting";
import { type Roads, type Simulation } from "./simulation";

const matte = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.88 });
const concrete = matte("#a6a99f");
const graphite = matte("#4a535c");
const white = matte("#e2e7e8");
const timber = matte("#a86c43");
const brick = matte("#854836");
const stone = matte("#b6a18a");
const blueGlass = new T.MeshStandardMaterial({ color: "#5b8f99", transparent: true,
  opacity: 0.52, depthWrite: false, roughness: 0.34, side: T.DoubleSide });
const greenGlass = new T.MeshStandardMaterial({ color: "#70a39b", transparent: true,
  opacity: 0.48, depthWrite: false, roughness: 0.33, side: T.DoubleSide });
const darkGlass = matte("#29343c");
const rail = matte("#999b96");
const ballast = matte("#686a60");
const grassBank = matte("#798762");
const platformEdge = matte("#e8e4ca");
const vec = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

function profile(group: T.Group, material: T.Material, section: [number, number][]): void {
  const geometry = new T.LatheGeometry(section.map(([radius, height]) => new T.Vector2(radius, height)), 32);
  group.add(new T.Mesh(geometry, material));
}

function sign(group: T.Group, label: string, x: number, y: number, z: number, width: number, yaw = 0): void {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#103d6a";
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = "#e5edf4";
  ctx.lineWidth = 4;
  ctx.strokeRect(9, 9, 494, 78);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 45px sans-serif";
  ctx.fillText(label, 256, 50, 466);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const face = new T.MeshBasicMaterial({ map });
  const board = new T.Group();
  box(board, graphite, 0, 0, 0, width, width * 0.1875, 0.045);
  for (const side of [-1, 1]) {
    const panel = new T.Mesh(new T.PlaneGeometry(width, width * 0.1875), face);
    panel.rotation.y = side < 0 ? Math.PI : 0;
    panel.position.z = side * 0.026;
    board.add(panel);
  }
  board.position.set(x, y, z);
  board.rotation.y = yaw;
  group.add(board);
}

function waterTower(scene: T.Scene, [x, z]: Point): void {
  // The masonry shaft and cantilevered tank are topped by the modern
  // glazed pavilion, all at the tower's BAG footprint on Heuveloord.
  const tower = new T.Group();
  tower.position.set(x, 0.02, z);
  profile(tower, stone, [[5.5, 0], [5.5, 1.2], [5.15, 1.5], [5.15, 2.2]]);
  profile(tower, brick, [[5.15, 1.65], [4.6, 7], [4.2, 23.6], [4.65, 25],
    [6.43, 27.8], [6.74, 29.2], [6.74, 34.4], [6.82, 35.6]]);
  for (const [r, y] of [[4.73, 7.2], [4.55, 12.0], [4.41, 17.1], [4.43, 23.4], [5.21, 26.45], [6.79, 29.2], [6.87, 35.45]]) {
    profile(tower, stone, [[r, y - 0.13], [r, y + 0.13]]);
  }
  profile(tower, darkGlass, [[5.9, 35.25], [5.9, 38.55], [5.55, 38.84], [0, 38.84]]);
  profile(tower, stone, [[5.95, 38.52], [5.95, 38.75], [0, 38.75]]);
  for (let i = 0; i < 16; i++) {
    const a = i * (2 * Math.PI / 16);
    const x = Math.sin(a);
    const z = Math.cos(a);
    box(tower, brick, x * 6.57, 35.82, z * 6.57, 0.78, 0.71, 0.59).rotation.y = a;
    box(tower, darkGlass, x * 6.74, 32.45, z * 6.74, 0.86, 2.35, 0.065).rotation.y = a;
    box(tower, stone, x * 6.79, 31.23, z * 6.79, 1.03, 0.15, 0.23).rotation.y = a;
    box(tower, graphite, x * 5.92, 37.04, z * 5.92, 0.09, 3.27, 0.12).rotation.y = a;
    if (i % 4 === 0) {
      for (const [r, y] of [[4.91, 5], [4.64, 9.3], [4.44, 15.1], [4.34, 20.1]]) {
        box(tower, darkGlass, x * r, y, z * r, 0.56, 1.02, 0.095).rotation.y = a;
      }
    }
  }
  scene.add(tower);
}

function plaza(scene: T.Scene, outlines: Point[][], lighting: RoadLighting): void {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  for (let row = 0; row < 8; row++) {
    for (let col = -1; col < 5; col++) {
      const tone = 151 + ((row * 5 + col * 13 + 22) % 5) * 8;
      ctx.fillStyle = `rgb(${tone},${tone - 8},${tone - 16})`;
      ctx.fillRect(col * 32 + (row % 2) * 16, row * 16, 31, 15);
    }
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.anisotropy = 4;
  const material = lighting.surface({ map, transparent: true, opacity: 0.46, depthWrite: false, side: T.DoubleSide });
  for (const outline of outlines) {
    const shape = new T.Shape(outline.map(([x, z]) => new T.Vector2(x, -z)));
    const mesh = new T.Mesh(new T.ShapeGeometry(shape), material);
    const coords = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < coords.count; i++) uv.setXY(i, coords.getX(i) / 2.8, coords.getY(i) / 2.8);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.075;
    scene.add(mesh);
  }
}

type Portal = { x: number; z: number; heading: number; height: number };
const TRAIN_PLATE = 0.77;
// Rail heights are relative to the pilot's street surface. The raised
// station extents have backed ramps so the train and camera follow the deck.
const UTRECHT_HEIGHTS = [
  { at: 0, up: 5.23, start: -100, end: 93, taper: 170, left: -20, right: 34 },
  { at: 1, up: 1.55, start: -85, end: 95, taper: 95, left: -6, right: 12 },
  { at: 2, up: 5.1, start: -111, end: 105, taper: 205, left: -11, right: 10 },
];
const AMSTERDAM_HEIGHTS = [
  { at: 0, up: 4.5, start: -82, end: 78, taper: 140, left: -8, right: 9 },
  { at: 1, up: 3.9, start: -78, end: 78, taper: 170, left: -8, right: 9 },
  { at: 2, up: 1.35, start: -76, end: 76, taper: 92, left: -8, right: 9 },
];

export class LocalScenery {
  private readonly heights: typeof UTRECHT_HEIGHTS;

  constructor(scene: T.Scene, private world: Simulation, places: Places,
    private roads: Record<RoadMode, Roads>, areaId: string, lighting: RoadLighting) {
    this.heights = areaId === "utrecht" ? UTRECHT_HEIGHTS : areaId === "amsterdam" ? AMSTERDAM_HEIGHTS : [];
    if (!world.hasTrain) return;
    const station = new T.Group();
    scene.add(station);
    this.addTrack(station);
    if (areaId !== "utrecht") {
      for (const [index, stop] of world.map.stops.entries()) {
        const platform = this.frame(0, world.stopDistances[index]);
        const length = 138;
        this.parallelTrack(platform, [4.5], length);
        for (const x of [-3.8, 8.3]) {
          this.platform(platform, x, 3.8, length);
          for (const z of [-21, 21]) {
            box(platform, graphite, x, 2.08, z, 0.12, 2.62, 0.12);
            box(platform, graphite, x, 3.42, z, 3.05, 0.15, 11.2);
            box(platform, blueGlass, x + Math.sign(x) * 1.1, 2.05, z, 0.07, 2.54, 10.8);
          }
          sign(platform, stop.name, x, 2.85, -39, 4.7, Math.PI / 2);
        }
        station.add(platform);
      }
      return;
    }
    this.vaartscheRijn(station);
    this.lunetten(station);
    this.houten(station);

    const tower = places.places.find(({ id }) => id === "rotsoord");
    if (tower) waterTower(scene, tower.point);
    const waterfront = new T.Group();
    for (const [ax, az, bx, bz] of places.quayEdges) {
      // Named water polygons also close underneath bridges. Only dress the
      // surveyed segments that run along the canal, not across it.
      const span = Math.hypot(bx - ax, bz - az);
      if (Math.abs((bx - ax) * 0.43 - (bz - az) * 0.90) < span * 0.68) continue;
      box(waterfront, brick, (ax + bx) / 2, 0.035, (az + bz) / 2, 0.20, 0.51, span).rotation.y =
        Math.atan2(bx - ax, bz - az);
      box(waterfront, stone, (ax + bx) / 2, 0.30, (az + bz) / 2, 0.29, 0.09, span).rotation.y =
        Math.atan2(bx - ax, bz - az);
    }
    box(waterfront, graphite, 1634.2, 1.25, 1551.5, 0.065, 2.5, 0.065);
    sign(waterfront, "Westerkade", 1634.2, 2.55, 1551.5, 2.55, 0.3);
    scene.add(waterfront);
    plaza(scene, places.plazas, lighting);
  }

  height(at: number): number {
    for (const section of this.heights) {
      const d = at - this.world.stopDistances[section.at];
      const outside = Math.max(0, section.start - d, d - section.end);
      if (outside >= section.taper) continue;
      const t = outside / section.taper;
      return section.up * (1 - t * t * (3 - 2 * t));
    }
    return 0;
  }

  roadCameraHeight(x: number, z: number, height: number): number {
    for (const section of this.heights) {
      if (section.up < 3) continue;
      const center = this.pose(this.world.stopDistances[section.at]);
      const dx = x - center.x;
      const dz = z - center.z;
      const along = dx * Math.sin(center.heading) + dz * Math.cos(center.heading);
      const across = dx * Math.cos(center.heading) - dz * Math.sin(center.heading);
      if (along < section.start - 4 || along > section.end + 4
        || across < section.left - 4 || across > section.right + 4) continue;
      return Math.min(height, section.up - 1.50);
    }
    return height;
  }

  private extendedTrack(at: number): Point {
    const end = this.world.lengths.at(-1)!;
    if (at >= 0 && at <= end) return this.world.trackPoint(at);
    const a = at < 0 ? this.world.trackPoint(0) : this.world.trackPoint(end - 22);
    const b = at < 0 ? this.world.trackPoint(22) : this.world.trackPoint(end);
    const edge = at < 0 ? a : b;
    const distance = at < 0 ? at : at - end;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [edge[0] + distance * (b[0] - a[0]) / length, edge[1] + distance * (b[1] - a[1]) / length];
  }

  pose(at: number): Portal {
    const [x, z] = this.extendedTrack(at);
    const a = this.extendedTrack(at - 7);
    const b = this.extendedTrack(at + 7);
    return { x, z, height: this.height(at), heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }

  private frame(offset: number, at: number): T.Group {
    const p = this.pose(at);
    const frame = new T.Group();
    frame.position.set(p.x + Math.cos(p.heading) * offset, p.height,
      p.z - Math.sin(p.heading) * offset);
    frame.rotation.y = p.heading;
    return frame;
  }

  private addTrack(scene: T.Group): void {
    const end = this.world.lengths.at(-1)!;
    const railPositions: number[] = [];
    const deck: number[] = [];
    const banks: number[] = [];
    // Use the mapped curve to keep the rails and bridge deck under the
    // shuttle. Profile heights remain an approximation between stations.
    const sample = (p: Portal, offset: number, rise: number) => [
      p.x + Math.cos(p.heading) * offset, p.height + rise, p.z - Math.sin(p.heading) * offset,
    ];
    const strip = (p: Portal, q: Portal, width: number, offset: number, rise: number, out: number[]) => {
      const a = sample(p, offset - width / 2, rise);
      const b = sample(p, offset + width / 2, rise);
      const c = sample(q, offset - width / 2, rise);
      const d = sample(q, offset + width / 2, rise);
      out.push(...a, ...c, ...b, ...b, ...c, ...d);
    };
    for (let at = -100; at < end + 105; at += 5) {
      const p = this.pose(at);
      const q = this.pose(Math.min(at + 5, end + 105));
      for (const lateral of [-0.74, 0.74]) strip(p, q, 0.11, lateral, 0.137, railPositions);
      const section = this.heights.find(({ at: stop, start, end }) => {
        const t = at - this.world.stopDistances[stop];
        return t >= start && t < end;
      });
      if (section) {
        strip(p, q, section.right - section.left, (section.left + section.right) / 2, 0.025, deck);
      } else if (p.height > 0.04 || q.height > 0.04) {
        strip(p, q, 5.2, 0, 0.025, deck);
        for (const side of [-1, 1]) {
          const a = sample(p, side * 2.6, 0.025);
          const b = sample(q, side * 2.6, 0.025);
          const c = sample(p, side * (2.6 + p.height * 1.55), -p.height + 0.026);
          const d = sample(q, side * (2.6 + q.height * 1.55), -q.height + 0.026);
          banks.push(...a, ...b, ...c, ...c, ...b, ...d);
        }
      }
    }
    for (const [vertices, source] of [[railPositions, rail], [deck, ballast], [banks, grassBank]] as const) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      const material = source.clone();
      material.side = T.DoubleSide;
      scene.add(new T.Mesh(geometry, material));
    }

    for (const section of this.heights) {
      const origin = this.world.stopDistances[section.at];
      const span = section.end - section.start;
      const center = (section.left + section.right) / 2;
      const rows = Math.ceil(span / 12);
      for (let i = 0; i < rows; i++) {
        const length = span / rows;
        const group = this.frame(center, origin + section.start + (i + 0.5) * length);
        box(group, concrete, 0, -0.46, 0, section.right - section.left, 0.91, length + 0.20);
        // The mapped road and cycle paths keep clearance under the viaduct.
        if (i % 2 === 0 && section.up > 3) {
          for (const x of [-0.36, 0.36]) {
            const pier = group.localToWorld(vec(x * (section.right - section.left), 0, 0));
            const point: Point = [pier.x, pier.z];
            if (this.roads.car.nearest(point, 4) || this.roads.bike.nearest(point, 3.5)) continue;
            box(group, concrete, x * (section.right - section.left), -section.up / 2, 0, 0.9, section.up, 1.4);
          }
        }
        scene.add(group);
      }
    }
  }

  private platform(station: T.Group, x: number, width: number, length: number): void {
    box(station, concrete, x, TRAIN_PLATE / 2, 0, width, TRAIN_PLATE, length);
    for (const edge of [-1, 1]) box(station, platformEdge, x + edge * (width / 2 - 0.16),
      TRAIN_PLATE, 0, 0.26, 0.045, length - 0.3);
  }

  private parallelTrack(station: T.Group, offsets: number[], length: number): void {
    for (const center of offsets) {
      for (const side of [-0.74, 0.74]) box(station, rail, center + side, 0.13, 0, 0.11, 0.10, length);
    }
  }

  private vaartscheRijn(scene: T.Group): void {
    const stop = this.world.stopDistances[0];
    const station = this.frame(0, stop);
    // The station's platforms bridge the canal, with timber shelter ribs
    // and free-standing glass lift shafts at the two street approaches.
    this.parallelTrack(station, [-16, -12, 4, 9.5, 13.6, 25, 29], 183);
    for (const x of [-5.9, 19.3]) {
      this.platform(station, x, 5.7, 183);
      for (const z of [-63, -6, 54]) {
        box(station, graphite, x, 2.38, z, 0.18, 3.2, 0.20);
        box(station, timber, x, 4.06, z, 5.35, 0.26, 23.3);
        for (let rib = -10; rib <= 10; rib += 2.5) {
          box(station, timber, x, 3.92, z + rib, 5.04, 0.17, 0.09);
        }
      }
      sign(station, "Utrecht Vaartsche Rijn", x, 2.77, 28, 4.5, Math.PI / 2);
    }
    for (const [x, z] of [[-7.4, -38], [20.6, 29]]) {
      box(station, blueGlass, x, -0.91, z, 2.45, 8.55, 2.3);
      for (const side of [-1, 1]) {
        for (const edge of [-1, 1]) box(station, graphite, x + side * 1.21, -0.91, z + edge * 1.13,
          0.11, 8.59, 0.11);
      }
      box(station, graphite, x, 3.40, z, 2.66, 0.18, 2.51);
    }
    scene.add(station);
  }

  private lunetten(scene: T.Group): void {
    const stop = this.world.stopDistances[1];
    const station = this.frame(0, stop);
    this.parallelTrack(station, [15.5], 177);
    this.platform(station, 4.45, 5.55, 173);
    for (const z of [-31, -15, 1, 17, 33]) {
      box(station, graphite, 4.42, 2.42, z, 0.17, 3.30, 0.2);
      box(station, white, 4.42, 4.08, z, 4.92, 0.13, 16.05);
    }
    const shelter = this.frame(4.38, stop + 22);
    for (const x of [-1.8, 1.8]) {
      box(shelter, blueGlass, x, 1.79, 0, 0.06, 1.99, 5.2);
      box(shelter, graphite, x, 1.85, -2.62, 0.11, 2.15, 0.11);
      box(shelter, graphite, x, 1.85, 2.62, 0.11, 2.15, 0.11);
    }
    box(shelter, graphite, 0, 2.93, 0, 3.9, 0.16, 5.44);
    sign(shelter, "Utrecht Lunetten", 0, 2.72, -2.72, 3.48);
    scene.add(shelter);
    sign(station, "Utrecht Lunetten", 4.45, 2.61, -32, 3.7, Math.PI / 2);
    scene.add(station);
  }

  private houten(scene: T.Group): void {
    const stop = this.world.stopDistances[2];
    const station = this.frame(0, stop);
    this.parallelTrack(station, [-7.55, 3.88], 198);
    this.platform(station, -3.8, 3.9, 190);
    this.platform(station, 7.0, 3.1, 190);
    // Seven inverted V pylons, diagonal steel arms and curved glass
    // screens follow the station architect's drawings.
    for (let i = 0; i < 7; i++) {
      const z = (i - 3) * 28;
      for (const side of [-1, 1]) {
        rod(station, white, 0.17, vec(-3.8 + side * 1.23, TRAIN_PLATE, z),
          vec(-3.8, 8.45, z + 0.62));
        rod(station, white, 0.16, vec(-3.8, 6.45, z + 0.6),
          vec(side * 9.4, 3.7, z + side * 2.8));
      }
      box(station, white, -3.8, 5.19, z, 3.9, 0.12, 27.7);
    }
    rod(station, white, 0.2, vec(-3.8, 6.47, -96), vec(-3.8, 6.47, 95));
    for (const side of [-1, 1]) {
      for (let z = -92; z <= 92; z += 8) {
        rod(station, white, 0.095, vec(side * 10.1, 0.8, z), vec(side * 9.88, 2.48, z));
        rod(station, white, 0.095, vec(side * 9.88, 2.48, z), vec(side * 9.20, 3.95, z));
        box(station, greenGlass, side * 9.99, 1.64, z + 3.95, 0.035, 1.72, 7.89).rotation.z = side * 0.13;
        box(station, greenGlass, side * 9.54, 3.22, z + 3.95, 0.035, 1.60, 7.89).rotation.z = side * 0.42;
      }
    }
    sign(station, "Houten", -3.8, 2.7, -40, 3.1, Math.PI / 2);
    sign(station, "Houten · Het Rond", 10.80, -1.57, 8, 4.4, Math.PI / 2);
    sign(station, "Fietstransferium", 10.80, -1.57, 19, 3.75, Math.PI / 2);
    scene.add(station);
  }
}
