import { CAR_PAINTS, DRIVE_AREAS, driveDataUrl, fetchAsset, fetchBinary, type Corridor, type GroundMode, type Mode, type Point } from "./data";
import { DriveGraphicsError, DriveView } from "./scene";
import type { TrainSeat, TrainView } from "./train-cabin";
import { saveLook, SKIN_TONES, type Body, type TrainActivity } from "./avatar";
import { TrainAudio } from "./train-audio";
import { distance, Roads, Simulation, type Input } from "./simulation";
import { Traffic } from "./traffic";
import { PedestrianCrossings } from "./crossings";
import { DriveRoom, type Peer } from "./rooms";
import { RoadCars } from "./road-cars";
import { nearbyLandmark, StreetNames, type Landmark, type Places } from "./places";
import { TrafficSigns, type TrafficSign } from "./traffic-signs";
import { addFootwaySurfaces, addJunctionGuides, crossingsNearStarts, LocalPedestrians } from "./pedestrians";
import { Walkways, type WalkingData } from "./walking";
import { vehiclesOverlap, type RoadPose } from "./vehicle-contact";
import { TrafficRules, type SignalData } from "./traffic-rules";
import { TrafficLights } from "./traffic-lights";

const controls: Record<string, keyof Input> = {
  ArrowUp: "throttle", KeyW: "throttle",
  ArrowDown: "reverse", KeyS: "reverse",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  Space: "brake",
};

const PAINT_STORAGE_KEY = "drive.car-paint";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function savedPaint(): string {
  try {
    const stored = localStorage.getItem(PAINT_STORAGE_KEY);
    if (stored && HEX_COLOR.test(stored)) return stored.toLowerCase();
  } catch {
    // The picker still works for the session if storage is unavailable.
  }
  return CAR_PAINTS[0].color;
}

const inactive = (): Input => ({ throttle: false, reverse: false, left: false, right: false, brake: false });

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

class Minimap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly base = document.createElement("canvas");
  private mode: Mode | null = null;
  private returning = false;
  private readonly center: Point;
  private readonly extent: Point;

  constructor(private canvas: HTMLCanvasElement, private map: Corridor, private roads: Float32Array,
    private landmarks: Landmark[]) {
    this.ctx = canvas.getContext("2d");
    const points = [...map.guides.car, ...(map.carReturn?.track ?? []), ...map.guides.bike, ...map.track,
      ...map.stops.map((stop) => stop.point)];
    const xs = points.map(([x]) => x);
    const zs = points.map(([, z]) => z);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...zs), bottom = Math.max(...zs);
    this.center = [(left + right) / 2, (top + bottom) / 2];
    this.extent = [Math.max(320, right - left) * 1.18, Math.max(320, bottom - top) * 1.18];
  }

  private project([x, z]: Point): Point {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scale = Math.min(w / this.extent[0], h / this.extent[1]);
    return [w * 0.5 + (x - this.center[0]) * scale, h * 0.5 + (z - this.center[1]) * scale];
  }

  private line(ctx: CanvasRenderingContext2D, points: Point[], color: string, width: number): void {
    ctx.beginPath();
    points.forEach((point, i) => {
      const [x, y] = this.project(point);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  private redraw(mode: Mode, returning: boolean): void {
    const w = this.base.width = this.canvas.width;
    const h = this.base.height = this.canvas.height;
    const ctx = this.base.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#10262d";
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    for (let x = 20; x < w; x += 24) {
      for (let y = 15; y < h; y += 24) ctx.rect(x, y, 1, 1);
    }
    ctx.fillStyle = "#527078";
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < this.roads.length;) {
      const count = this.roads[i++];
      i++;
      for (let n = 0; n < count; n++) {
        const [x, y] = this.project([this.roads[i++], this.roads[i++]]);
        if (n === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "#2d4a50";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    this.line(ctx, this.map.track, mode === "train" ? "#f4d378" : "#75868e", mode === "train" ? 2.2 : 1.1);
    if (mode === "car" || mode === "bike") {
      const route = mode === "car" && returning ? this.map.carReturn?.track : undefined;
      this.line(ctx, route ?? this.map.guides[mode], "#96e7cd", 1.7);
    }
    ctx.fillStyle = "#d3ae79";
    for (const mark of this.landmarks) {
      if (this.map.stops.some((stop) => distance(stop.point, mark.point) < 95)) continue;
      const [x, y] = this.project(mark.point);
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 3, y);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x - 3, y);
      ctx.closePath();
      ctx.fill();
    }
    for (const stop of this.map.stops) {
      const [x, y] = this.project(stop.point);
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = "#12282f";
      ctx.fill();
      ctx.strokeStyle = "#e1e8df";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    this.mode = mode;
    this.returning = returning;
  }

  draw(world: Simulation, peers: Peer[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = Math.round(this.canvas.clientWidth * Math.min(devicePixelRatio, 1.5));
    const h = Math.round(this.canvas.clientHeight * Math.min(devicePixelRatio, 1.5));
    if (w < 1 || h < 1) return;
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.mode = null;
    }
    if (this.mode !== world.mode || this.returning !== world.returning) this.redraw(world.mode, world.returning);
    ctx.drawImage(this.base, 0, 0);
    if (world.hasTrain && world.mode !== "train") {
      const [tx, ty] = this.project(world.trackPoint(world.train.distance));
      ctx.fillStyle = "#f4d378";
      ctx.fillRect(tx - 2, ty - 2, 4, 4);
    }
    for (const peer of peers) {
      const [x, y] = this.project(peer.point);
      ctx.fillStyle = "#8fd6ff";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    const [x, y] = this.project(world.position);
    ctx.save();
    ctx.translate(Math.max(7, Math.min(w - 7, x)), Math.max(7, Math.min(h - 7, y)));
    ctx.rotate(-world.angle);
    ctx.beginPath();
    ctx.moveTo(0, 7.5);
    ctx.lineTo(-5.1, -5.2);
    ctx.lineTo(0, -3.5);
    ctx.lineTo(5.1, -5.2);
    ctx.closePath();
    ctx.fillStyle = "#fff6dd";
    ctx.strokeStyle = "#10262d";
    ctx.lineWidth = 1.4;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function km(points: Point[]): string {
  const length = points.slice(1).reduce((sum, point, i) => sum + distance(point, points[i]), 0);
  return `${(length / 1000).toFixed(1)} km`;
}

export async function startDrive(root: HTMLElement): Promise<void> {
  const query = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const viewport = query("[data-viewport]");
  const load = query("[data-load]");
  const reload = query<HTMLButtonElement>("[data-reload]");
  const trainSeats = root.querySelector<HTMLElement>("[data-train-seats]");
  const seatButtons = [...(trainSeats?.querySelectorAll<HTMLButtonElement>("[data-train-seat]") ?? [])];
  const trainViewButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-train-view]")];
  const activityButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-train-activity]")];
  const soundButton = root.querySelector<HTMLButtonElement>("[data-train-sound]");
  const reader = root.querySelector<HTMLElement>("[data-reader]");
  const readerGuide = root.querySelector<HTMLSelectElement>("[data-reader-guide]");
  const readerPage = root.querySelector<HTMLElement>("[data-reader-page]");
  const modeButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-mode]")];
  const stationButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-start]")];
  const dock = query("[data-drive-dock]");
  const driveButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-input]")];
  const action = query<HTMLButtonElement>("[data-action]");
  const camera = query<HTMLButtonElement>("[data-camera]");
  const clock = root.querySelector<HTMLTimeElement>("[data-local-time]");
  let driveView: DriveView | undefined;
  const showProblem = (title: string, detail: string) => {
    load.hidden = false;
    query("[data-spinner]").hidden = true;
    setText(query("[data-load-title]"), title);
    setText(query("[data-load-detail]"), detail);
    reload.hidden = false;
  };
  reload.addEventListener("click", () => location.reload());

  try {
    const area = DRIVE_AREAS.find(({ id }) => id === root.dataset.drive);
    if (!area) throw new Error("Unknown Drive & Ride area");
    const { first, last } = area;
    const assetUrl = driveDataUrl(area);
    const [map, buffer, places, signData, walking, signals] = await Promise.all([
      fetchAsset(`${assetUrl}/corridor.json`).then((response) => response.json() as Promise<Corridor>),
      fetchBinary(`${assetUrl}/roads.bin`),
      fetchAsset(`${assetUrl}/places.json`).then((response) => response.json() as Promise<Places>),
      fetchAsset(`${assetUrl}/signs.json`).then((response) => response.json() as Promise<TrafficSign[]>),
      fetchBinary(`${assetUrl}/walking.bin`).then((data) => JSON.parse(new TextDecoder().decode(data)) as WalkingData),
      fetchAsset(`${assetUrl}/signals.json`).then((response) => response.json() as Promise<SignalData>),
    ]);
    const [carCount, bikeCount] = new Uint32Array(buffer, 0, 2);
    const cars = new Float32Array(buffer, 8, carCount);
    const bikes = new Float32Array(buffer, 8 + carCount * 4, bikeCount);
    const roads = { car: new Roads(cars), bike: new Roads(bikes) };
    const walkways = new Walkways(walking.surfaces, walking.links);
    // Painted zebras from OpenStreetMap. Older bundles place them from the NDW crossing signs.
    const zebras = await fetchAsset(`${assetUrl}/zebras.json`)
      .then((response) => response.json() as Promise<Point[]>).catch(() => undefined);
    const signs = new TrafficSigns(signData, roads, walkways, zebras);
    const world = new Simulation(map, roads, walkways, area.modes);
    const view = driveView = new DriveView(viewport, world, places, roads, signs, area, assetUrl);
    signs.addTo(view.scene, signData);
    addFootwaySurfaces(view.scene, walking.surfaces, view.lighting);
    const links = walking.links ?? [];
    const junctionGuides = addJunctionGuides(view.scene, links);
    const crossings = new PedestrianCrossings([...signs.zebraCrossings, ...links.filter(([, , , junction]) => junction)]);
    const carReturn = map.carReturn?.track ?? map.guides.car.toReversed();
    const rules = new TrafficRules(signals, signs.carStops(), places.roundabouts ?? []);
    const traffic = new Traffic([map.guides.car, carReturn], roads.car, rules, crossings);
    const crossingWalks = crossingsNearStarts(crossings.trafficLinks(), map.stops.map((stop) => stop.access.car), walkways);
    const pedestrians = new LocalPedestrians(view.scene, walking.pedestrians, crossingWalks);
    const lights = new TrafficLights(view.scene, rules, roads.car);
    const roadCars = new RoadCars(view.lighting.lamps);
    view.scene.add(roadCars.group);
    const carPaint = query("[data-car-paint]");
    const shades = [...carPaint.querySelectorAll<HTMLButtonElement>("[data-paint]")];
    const customPaint = query<HTMLInputElement>("[data-custom-paint]");
    const paintName = query("[data-paint-name]");
    let selectedPaint: string = CAR_PAINTS[0].color;
    function applyPaint(color: string) {
      if (!HEX_COLOR.test(color)) return;
      const shade = color.toLowerCase();
      selectedPaint = shade;
      view.setCarPaint(shade);
      if (customPaint.value !== shade) customPaint.value = shade;
      setText(paintName, CAR_PAINTS.find((preset) => preset.color === shade)?.name ?? shade.toUpperCase());
      for (const button of shades) button.setAttribute("aria-pressed", String(button.dataset.paint === shade));
    }
    function savePaint(color: string) {
      applyPaint(color);
      try {
        localStorage.setItem(PAINT_STORAGE_KEY, color);
      } catch {
        // Keep the paint on the current car when storage is blocked.
      }
    }
    applyPaint(savedPaint());
    for (const button of shades) {
      button.addEventListener("click", () => savePaint(button.dataset.paint!));
    }
    customPaint.addEventListener("input", () => applyPaint(customPaint.value));
    customPaint.addEventListener("change", () => savePaint(customPaint.value));
    const minimap = new Minimap(query<HTMLCanvasElement>("[data-minimap]"), map, area.modes.includes("car") ? cars : bikes, places.places);
    const streetNames = new StreetNames(places);
    const placeCard = query("[data-place-card]");
    const placeName = query("[data-place-name]");
    const placeDetail = query("[data-place-detail]");
    const lengths = { car: km(map.guides.car), carReturn: km(carReturn), bike: km(map.guides.bike), train: km(map.track) };
    const status = query("[data-status]");
    const roadAlert = query("[data-road-alert]");
    const forwardLabel = query("[data-forward-label]");
    const reverseLabel = query("[data-reverse-label]");
    const speed = query("[data-speed]");
    const position = query("[data-viewport-status]");
    const routeDistance = query("[data-route-distance]");
    const indicators = stationButtons.map((button) => button.querySelector<HTMLElement>("[data-station-indicator]")!);
    const roomForm = query<HTMLFormElement>("[data-room-form]");
    const roomCode = query<HTMLInputElement>("[data-room-code]");
    const roomJoin = query<HTMLButtonElement>("[data-room-join]");
    const roomStatus = query("[data-room-status]");
    const roomActions = query("[data-room-actions]");
    const roomLink = query<HTMLInputElement>("[data-room-link]");
    const room = new DriveRoom(area.id, (message) => {
      roomJoin.disabled = Boolean(room.code);
      roomCode.readOnly = Boolean(room.code);
      if (room.code) roomCode.value = room.code;
      roomActions.hidden = !room.connected;
      if (!room.connected) roomLink.hidden = true;
      setText(roomStatus, message ?? (room.connected
        ? `${room.players} ${room.players === 1 ? "driver" : "drivers"} in room ${room.code} · AI traffic on`
        : "AI traffic is on. Join a room to see other players."));
    });
    let renderedPeers: Peer[] = [];
    const playerPose = (input?: Input): RoadPose | null => {
      if (world.mode === "train") return null;
      const pose: RoadPose = { point: world.position, angle: world.angle, mode: world.mode };
      if (world.mode === "walk" && input && !input.brake) {
        if (input.reverse) pose.travelHeading = world.angle + Math.PI;
        else if (input.throttle) pose.travelHeading = world.angle;
      }
      return pose;
    };
    const peerOccupied = (pose: RoadPose) => room.peers.some((peer) => vehiclesOverlap(pose, peer))
      || renderedPeers.some((peer) => vehiclesOverlap(pose, peer));
    world.roadObstacle = (point, angle, mode) => {
      const pose = { point, angle, mode };
      if (traffic.visible.some((car) => vehiclesOverlap(pose, car)) || peerOccupied(pose)) return "traffic";
      if (mode !== "walk" && pedestrians.visible.some((person) => vehiclesOverlap(pose, person))) return "traffic";
      if (!view.isTileLoaded(point)) return "scenery";
      if (view.buildings.vehicle(point, angle, mode)) return "building";
      return null;
    };
    roomForm.addEventListener("submit", (event) => {
      event.preventDefault();
      room.join(roomCode.value);
    });
    query("[data-room-copy]").addEventListener("click", async () => {
      const link = room.invite();
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(link);
          setText(roomStatus, `Invite copied · ${room.players} in room ${room.code}`);
          return;
        } catch { /* Offer a selectable link if automatic copying is unavailable. */ }
      }
      roomLink.value = link;
      roomLink.hidden = false;
      roomLink.select();
    });
    query("[data-room-leave]").addEventListener("click", () => {
      room.leave();
      roomCode.value = "";
      if (new URL(location.href).searchParams.has("room")) history.replaceState(null, "", location.pathname);
      roomCode.focus();
    });
    window.addEventListener("pagehide", () => room.leave(false));
    const held = new Map<string, keyof Input>();
    const pressed = new Map<number, keyof Input>();
    let notice = { message: "", until: 0 };
    let elapsed = 0;
    const say = (message: string) => { notice = { message, until: performance.now() + 3800 }; };

    const resetInput = () => {
      held.clear();
      pressed.clear();
      driveButtons.forEach((button) => delete button.dataset.held);
    };
    const focus = () => {
      resetInput();
      viewport.focus({ preventScroll: true });
    };
    window.addEventListener("blur", resetInput);
    document.addEventListener("visibilitychange", resetInput);
    window.addEventListener("keydown", (event) => {
      if (world.mode === "train" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || (target !== document.body && !root.contains(target))) return;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const driveButton = target.closest<HTMLButtonElement>("button[data-input]");
      const activating = event.code === "Space" || event.code === "Enter";
      if (activating && !driveButton && target.closest("button, a")) return;
      const control = activating && driveButton ? driveButton.dataset.input as keyof Input : controls[event.code];
      if (!control) return;
      event.preventDefault();
      held.set(event.code, control);
    });
    window.addEventListener("keyup", (event) => held.delete(event.code));
    viewport.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof HTMLButtonElement)) viewport.focus({ preventScroll: true });
    });
    for (const button of driveButtons) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        pressed.set(event.pointerId, button.dataset.input as keyof Input);
      });
      function release(event: PointerEvent) {
        pressed.delete(event.pointerId);
      }
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    }

    function clearRoadSpawn(): void {
      void view.loadAround(world.position).then(() => world.ensureClearSpawn()).catch(() => {});
    }

    const alightLabels = { car: "Alight and drive", bike: "Alight and cycle", walk: "Alight and walk" };
    let boardMode: GroundMode = world.mode === "train" ? "car" : world.mode;
    function trainAction(): void {
      if (world.mode === "train") {
        if (world.alight(boardMode)) {
          focus();
          clearRoadSpawn();
        }
        return;
      }
      const mode = world.mode;
      if (world.board()) {
        boardMode = mode;
        audio.start();
        focus();
        return;
      }
      if (world.callTrain()) {
        say(`The shuttle will stop at ${map.stops[world.nearbyStop].name}.`);
        return;
      }
      say(world.nearbyStop < 0 ? "Go to a station to board." : "Brake to a stop before boarding.");
    }

    action.addEventListener("click", trainAction);
    for (const button of modeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode as Mode;
        if (mode === "train") {
          if (world.mode !== "train") trainAction();
          return;
        }
        if (world.switchGroundMode(mode)) {
          notice.until = 0;
          focus();
          clearRoadSpawn();
        } else if (world.mode === "train" || Math.abs(world.speed) >= 0.8) {
          say(world.mode === "train" ? "You can get off at the next stop." : "Brake to a stop before changing vehicles.");
        } else {
          const places = { car: "street", bike: "cycle path or street", walk: "footpath" };
          say(`Move closer to a ${places[mode]} to switch modes.`);
        }
      });
    }
    for (const button of stationButtons) {
      button.addEventListener("click", () => {
        if (!world.restart(Number(button.dataset.start))) {
          say("That starting point is blocked. Wait for a gap.");
          return;
        }
        clearRoadSpawn();
        notice.until = 0;
        focus();
      });
    }
    camera.addEventListener("click", () => {
      view.nearCamera = !view.nearCamera;
      camera.setAttribute("aria-pressed", String(view.nearCamera));
      setText(camera, view.nearCamera ? "Wide camera" : "Close camera");
      focus();
    });
    for (const button of seatButtons) {
      button.addEventListener("click", () => {
        view.trainSeat = button.dataset.trainSeat as TrainSeat;
        audio.start();
        updateUI();
      });
    }
    for (const button of trainViewButtons) {
      button.addEventListener("click", () => {
        view.trainView = button.dataset.trainView as TrainView;
        audio.start();
        updateUI();
      });
    }

    // What you do on the train: look out, read a guide, listen to music, or sit quietly.
    const audio = new TrainAudio();
    let activity: TrainActivity = "look";
    let loadedGuide = "";
    async function showGuide(id: string): Promise<void> {
      if (!readerPage || loadedGuide === id) return;
      loadedGuide = id;
      readerPage.textContent = "Opening the guide…";
      try {
        const page = new DOMParser().parseFromString(await (await fetchAsset(`/guides/${id}/`)).text(), "text/html");
        const prose = page.querySelector(".prose");
        if (!prose || loadedGuide !== id) return;
        const title = document.createElement("h2");
        title.textContent = readerGuide?.selectedOptions[0]?.textContent ?? "";
        readerPage.replaceChildren(title, ...[...prose.childNodes].map((node) => document.importNode(node, true)));
        // Keep the ride going: links open in a new tab.
        for (const link of readerPage.querySelectorAll("a")) {
          link.target = "_blank";
          link.rel = "noopener";
        }
        readerPage.scrollTop = 0;
      } catch {
        loadedGuide = "";
        readerPage.textContent = "This guide couldn’t load. Choose it again to retry.";
      }
    }
    readerGuide?.addEventListener("change", () => void showGuide(readerGuide.value));
    for (const button of activityButtons) {
      button.addEventListener("click", () => {
        activity = button.dataset.trainActivity as TrainActivity;
        view.trainActivity = activity;
        audio.start();
        if (activity === "read" && readerGuide) void showGuide(readerGuide.value);
        updateUI();
      });
    }
    soundButton?.addEventListener("click", () => {
      audio.start();
      audio.setMuted(!audio.muted);
      soundButton.setAttribute("aria-pressed", String(!audio.muted));
      setText(soundButton, audio.muted ? "Sound off" : "Sound on");
    });

    // How you look as driver, cyclist, walker and passenger.
    const bodyButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-you-body]")];
    const skinButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-you-skin]")];
    const youName = query("[data-you-name]");
    function showLook(): void {
      const { body, skin } = view.you.look;
      for (const button of bodyButtons) button.setAttribute("aria-pressed", String(button.dataset.youBody === body));
      for (const button of skinButtons) button.setAttribute("aria-pressed", String(button.dataset.youSkin === skin));
      const tone = SKIN_TONES.find(({ color }) => color === skin)?.name ?? "";
      setText(youName, `${body === "woman" ? "Woman" : "Man"} · ${tone}`);
    }
    const changeLook = (change: Partial<typeof view.you.look>) => {
      view.you.set({ ...view.you.look, ...change });
      saveLook(view.you.look);
      showLook();
    };
    for (const button of bodyButtons) button.addEventListener("click", () => changeLook({ body: button.dataset.youBody as Body }));
    for (const button of skinButtons) button.addEventListener("click", () => changeLook({ skin: button.dataset.youSkin! }));
    showLook();

    function updateUI(): void {
      const train = world.mode === "train";
      const walk = world.mode === "walk";
      camera.hidden = train && trainSeats !== null;
      if (trainSeats) trainSeats.hidden = !train;
      if (train) {
        for (const button of seatButtons) button.setAttribute("aria-pressed", String(button.dataset.trainSeat === view.trainSeat));
        for (const button of trainViewButtons) button.setAttribute("aria-pressed", String(button.dataset.trainView === view.trainView));
        for (const button of activityButtons) button.setAttribute("aria-pressed", String(button.dataset.trainActivity === activity));
      }
      if (reader) {
        reader.hidden = !train || activity !== "read" || view.trainView === "outside";
        // Keep the page clear of you: in the view of you, you sit on the window side of the screen.
        reader.dataset.side = view.trainView === "you" && view.trainSeat === "left" ? "left" : "right";
      }
      const { localTime, phase, headlights } = view.lighting.state;
      const lighting = world.mode === "car" && headlights ? "Headlights on" : phase;
      if (clock) {
        setText(clock, `${localTime} NL · ${lighting}`);
        if (clock.dateTime !== localTime) clock.dateTime = localTime;
        clock.hidden = false;
      }
      junctionGuides.visible = walk;
      const stopped = Math.abs(world.speed) < 0.8;
      const near = world.nearbyStop;
      const at = world.currentStop;
      const next = world.train.next;
      const current = train ? at : near;
      const trainName = map.stops[next].name;
      let message: string;
      if (train) {
        message = at === null
          ? `Next stop: ${trainName}.`
          : `Doors open at ${map.stops[at].name}. Next stop: ${trainName}.`;
      } else if (world.obstacle) {
        message = {
          building: walk ? "Building ahead. Stay on the footpath." : "Building ahead. Reverse and stay on the street.",
          traffic: "Traffic ahead. Brake and wait for a gap.",
          scenery: "Loading the next part of the corridor…",
        }[world.obstacle];
      } else if (world.hasTrain && near >= 0) {
        if (at === near) message = stopped ? "The shuttle is at the platform. Board when ready." : "Brake to a stop to board the shuttle.";
        else message = world.pendingStop === near ? `Waiting for the shuttle at ${map.stops[near].name}.` : "Stop here to wait for the shuttle.";
      } else if (walk) {
        message = world.roadLimit ? "Footpath edge. Turn onto the pavement or look for mint crossing dots."
          : "Follow the sidewalks. Mint dots show where you can cross when clear.";
      } else {
        message = world.roadLimit
          ? (world.mode === "car" ? "Road edge. Reverse or steer back onto the street." : "Path edge. Steer back onto the cycle path or street.")
          : `Follow the mint arrows toward ${world.returning ? first : last}.`;
      }
      if (view.incomplete) message += " Some scenery could not load.";
      setText(status, notice.until > performance.now() ? notice.message : message);
      setText(speed, String(Math.round(Math.abs(world.speed) * 3.6)));
      const street = world.mode === "train" ? null : streetNames.at(world.position, world.angle, world.mode);
      const local = nearbyLandmark(places.places, world.position, train ? "westerkade" : undefined);
      setText(position, street ?? (train && at === null ? `To ${trainName}`
        : current !== null && current >= 0 ? map.stops[current].name : local?.name ?? (train ? "Train" : "On the route")));
      placeCard.hidden = !local;
      if (local) {
        setText(placeName, local.name);
        setText(placeDetail, local.description);
      }
      const routeLength = world.mode === "car" && world.returning ? lengths.carReturn
        : world.mode !== "walk" ? lengths[world.mode] : null;
      setText(routeDistance, routeLength ? `${routeLength} route` : "On foot");
      setText(forwardLabel, walk ? "Walk forward" : "Accelerate");
      setText(reverseLabel, walk ? "Step back" : "Reverse");
      const signAhead = world.mode === "car" || world.mode === "bike"
        ? signs.ahead(world.position, world.angle, world.mode) : null;
      const signalAhead = world.mode === "car" ? rules.ahead(world.position, world.angle) : null;
      const ahead = signalAhead && (!signAhead || signalAhead.distance < signAhead.distance) ? signalAhead : signAhead;
      roadAlert.hidden = !ahead;
      if (ahead) {
        const labels = { stop: "Stop", yield: "Give way", crossing: "Zebra crossing", "no-entry": "No entry",
          red: "Red light", amber: "Amber light", green: "Green light" };
        roadAlert.dataset.kind = ahead.kind;
        setText(roadAlert, `${labels[ahead.kind]} ${ahead.distance < 1 ? "here" : `in ${Math.round(ahead.distance)} m`}`);
      }
      dock.hidden = train;
      carPaint.hidden = world.mode !== "car";
      if (world.hasTrain) {
        action.disabled = train ? at === null : near < 0 || !stopped || world.pendingStop === near;
        setText(action, train
          ? (at === null ? "Alight at next stop" : alightLabels[boardMode])
          : at === near ? "Board train" : (world.pendingStop === near ? "Waiting for shuttle" : near >= 0 ? "Wait for shuttle" : "Board at a station"));
      }
      for (const button of modeButtons) button.setAttribute("aria-pressed", String(world.mode === button.dataset.mode));
      stationButtons.forEach((button, index) => {
        if (index === current) button.setAttribute("aria-current", "location");
        else button.removeAttribute("aria-current");
        setText(indicators[index], index === at ? "Shuttle" : train && index === next ? "Next" : index === near && !train ? "Nearby" : "");
      });
      minimap.draw(world, room.peers);
    }

    let graphicsLost = false;
    let started = false;
    const canvas = view.renderer.domElement;
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      graphicsLost = true;
      resetInput();
      showProblem("Graphics interrupted", "The simulator will resume if the browser restores graphics. You can also reload the pilot.");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      graphicsLost = false;
      if (started) load.hidden = true;
    });
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) {
        view.renderer.setAnimationLoop(null);
        view.renderer.dispose();
        view.renderer.forceContextLoss();
      }
    });
    await view.loadAround(world.position);
    world.ensureClearSpawn();
    lights.frame(world.position);
    view.frame(world, 0);
    started = true;
    load.hidden = !graphicsLost;
    [...modeButtons, ...stationButtons, camera].forEach((button) => { button.disabled = false; });
    // A first-time visitor sees the scene before the controls, so point at them once.
    const startHint = query("[data-start-hint]");
    startHint.innerHTML = matchMedia("(pointer: coarse)").matches
      ? "Hold <kbd>Accelerate</kbd> below to move. <kbd>Left</kbd> and <kbd>Right</kbd> steer."
      : "Press <kbd>↑</kbd> or <kbd>W</kbd> to move. <kbd>←</kbd> <kbd>→</kbd> steer, <kbd>Space</kbd> brakes.";
    startHint.hidden = false;
    updateUI();
    roomJoin.disabled = false;
    const inviteRoom = new URL(location.href).searchParams.get("room");
    if (inviteRoom && area.modes.includes("car")) room.join(inviteRoom);
    let previous = performance.now();
    let wasTrain = false;
    view.renderer.setAnimationLoop((now) => {
      const dt = Math.max(0, Math.min((now - previous) / 1000, 0.075));
      previous = now;
      if (graphicsLost) return;
      if (!startHint.hidden && (held.size || pressed.size || world.mode === "train")) startHint.hidden = true;
      const inputs = inactive();
      for (const key of held.values()) inputs[key] = true;
      for (const input of pressed.values()) inputs[input] = true;
      for (const button of driveButtons) button.toggleAttribute("data-held", inputs[button.dataset.input as keyof Input]);
      const correction = room.takeCorrection();
      if (world.mode === "car" && correction && distance(world.position, correction[0]) < 3.5) {
        const [x, z, angle] = correction[1];
        world.position = [x, z];
        world.angle = angle;
        world.speed = 0;
      }
      const player = playerPose();
      if (player && peerOccupied(player)) world.ensureClearSpawn();
      const peers = [...room.peers, ...renderedPeers.filter((peer) => room.peers.some(({ id }) => id === peer.id))];
      pedestrians.update(world.position, dt, walkways,
        (point) => view.isTileLoaded(point) && !view.buildings.circle(point, 0.27),
        (pose) => traffic.visible.some((car) => vehiclesOverlap(pose, car)) || peerOccupied(pose)
          || (player !== null && player.mode !== "walk" && vehiclesOverlap(pose, player)));
      const occupants = [...peers, ...pedestrians.visible];
      // Advance both sides of a collision in the same small physics steps.
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      for (let i = 0; i < steps; i++) {
        const pose = playerPose(inputs);
        traffic.step(dt / steps, world.position, pose ? [pose, ...occupants] : occupants,
          (point, angle) => view.buildings.vehicle(point, angle, "car"));
        world.step(dt / steps, inputs);
      }
      room.publish(world.mode === "car" ? { point: world.position, angle: world.angle, color: selectedPaint } : null, now);
      const current = playerPose();
      renderedPeers = roadCars.update(traffic.visible, room.peers, world.position, dt,
        (pose) => (current !== null && vehiclesOverlap(pose, current))
          || traffic.visible.some((car) => vehiclesOverlap(pose, car)));
      lights.frame(world.position);
      if (world.mode === "train") {
        audio.update(world.train.speed, activity === "music", activity === "read" || activity === "quiet");
        view.beat = audio.beat;
      } else if (wasTrain) {
        audio.stop();
      }
      wasTrain = world.mode === "train";
      view.frame(world, dt, [...traffic.visible, ...renderedPeers]);
      elapsed += dt;
      if (elapsed >= 0.09) {
        elapsed = 0;
        updateUI();
      }
    });
  } catch (error) {
    driveView?.renderer.dispose();
    console.error("Drive & Ride", error);
    if (error instanceof DriveGraphicsError) {
      showProblem("Graphics couldn’t start", "Reload the pilot to retry, or open it in a browser with WebGL 2 and hardware acceleration.");
    } else {
      showProblem("The corridor couldn’t load", "Reload the pilot to try loading the streets and scenery again.");
    }
  }
}
