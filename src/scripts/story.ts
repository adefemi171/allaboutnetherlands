// The home page: scrolling flies the camera from orbit down to a street.
//
// Every scene is a section whose words stay pinned to the screen while the
// section scrolls by. For that stretch the camera holds its position. Over
// the next screen of scrolling the words leave and the camera travels to
// the following scene.

import { findPlace } from "../data/places";
import { bootStage } from "../map/boot";
import { formatTime } from "../map/clock";
import type { MapEngine, Pose } from "../map/engine";
import type { LabelKind } from "../map/labels";
import { ORIGIN, latLonToWorld, rdToWorld } from "../map/rd";
import { sunPosition, sunTimes } from "../map/sun";

interface Scene {
  /** Camera on a wide screen, where the words are on the left. */
  wide: Pose;
  /** Camera on a phone, where the words are at the bottom. */
  narrow: Pose;
  /** Which names to show: highest rank, and which kinds. */
  labels: [number, LabelKind[]];
}

const amsterdam = findPlace("amsterdam");
const [ax, az] = amsterdam ? latLonToWorld(amsterdam.lat, amsterdam.lon) : [0, 0];
// Amsterdam's town hall, the Stopera at Amstel 1, on the national grid.
const [hx, hz] = rdToWorld(121829, 486752);

const STREET_KINDS: LabelKind[] = [
  "city",
  "street",
  "canal",
  "hood",
  "station",
  "civic",
  "campus",
  "area",
  "building",
];

const SCENES: Record<string, Scene> = {
  globe: {
    wide: { x: 0, z: 0, dist: 21000, az: 0, tilt: 0.6, shiftX: 0.21, shiftY: 0.02 },
    narrow: { x: 0, z: 0, dist: 30000, az: 0, tilt: 0.6, shiftX: 0, shiftY: -0.2 },
    labels: [0, ["country"]],
  },
  country: {
    wide: { x: -12, z: 4, dist: 660, az: 0, tilt: 16, shiftX: 0.17, shiftY: 0 },
    narrow: { x: -12, z: -6, dist: 1150, az: 0, tilt: 12, shiftX: 0, shiftY: -0.2 },
    labels: [5, ["city", "province", "water"]],
  },
  // Looking east from above the North Sea, across the low west.
  "sea-level": {
    wide: { x: -42, z: 6, dist: 225, az: 80, tilt: 57, shiftX: 0.13, shiftY: 0.05 },
    narrow: { x: -40, z: 6, dist: 330, az: 80, tilt: 52, shiftX: 0, shiftY: -0.16 },
    labels: [2, ["city"]],
  },
  // Down at the streets, in front of Amsterdam's town hall.
  "town-hall": {
    wide: { x: hx, z: hz, dist: 0.95, az: -32, tilt: 62, shiftX: 0.17, shiftY: 0.03 },
    narrow: { x: hx, z: hz, dist: 1.25, az: -32, tilt: 58, shiftX: 0, shiftY: -0.2 },
    labels: [30, STREET_KINDS],
  },
};

/**
 * The last scene as it was before the map had streets: the whole city.
 * Used when the streets cannot be loaded, or the visitor has asked their
 * browser to save data.
 */
const CITY: Scene = {
  wide: { x: ax, z: az, dist: 46, az: -28, tilt: 61, shiftX: 0.16, shiftY: 0.04 },
  narrow: { x: ax, z: az, dist: 62, az: -28, tilt: 58, shiftX: 0, shiftY: -0.18 },
  labels: [6, ["city", "landmark"]],
};

/** The water starts below the deepest polder, so nothing is covered yet. */
const DRY = -7;
/** The gauge next to the words runs from DRY up to this level (metres). */
const GAUGE_TOP = 5;

const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mixPose(a: Pose, b: Pose, t: number): Pose {
  const turn = ((((b.az - a.az) % 360) + 540) % 360) - 180;
  // Distance on a log scale, so the zoom feels even from orbit to street.
  const dist = Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), t));
  // On a deep zoom the target moves in step with the distance. Moving it
  // at an even pace would drag the ground past at speed near the end.
  const deep = Math.abs(Math.log(a.dist / b.dist)) > 0.7;
  const k = deep ? (dist - a.dist) / (b.dist - a.dist) : t;
  return {
    x: lerp(a.x, b.x, k),
    z: lerp(a.z, b.z, k),
    dist,
    az: a.az + turn * t,
    tilt: lerp(a.tilt, b.tilt, t),
    shiftX: lerp(a.shiftX, b.shiftX, t),
    shiftY: lerp(a.shiftY, b.shiftY, t),
  };
}

/** "−1.2 m", with a real minus sign. */
function metres(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded < 0 ? "−" : rounded > 0 ? "+" : ""}${Math.abs(rounded).toFixed(1)} m`;
}

interface Frame {
  /** Index of the scene whose section is on screen. */
  index: number;
  /** 0 to 1 through the stretch where that scene's words are pinned. */
  hold: number;
  /** 0 to 1 through the journey to the next scene. */
  travel: number;
  /** The map is completely covered by the rest of the page. */
  past: boolean;
}

async function main(): Promise<void> {
  const story = document.querySelector<HTMLElement>(".story");
  const stage = document.querySelector<HTMLElement>("[data-stage]");
  const after = document.querySelector<HTMLElement>("[data-after]");
  const sections = [...document.querySelectorAll<HTMLElement>("[data-scene]")];
  if (!story || !stage || !after || !sections.length) return;

  const ids = sections.map((section) => section.dataset.scene ?? "");
  const narrowQuery = window.matchMedia("(max-width: 820px)");
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData === true;
  let noStreets = saveData;
  const sceneOf = (index: number): Scene =>
    ids[index] === "town-hall" && noStreets ? CITY : SCENES[ids[index]];
  const poseOf = (index: number) => {
    const scene = sceneOf(index);
    return narrowQuery.matches ? scene.narrow : scene.wide;
  };

  const measure = (): Frame => {
    const y = window.scrollY;
    const screen = window.innerHeight;
    const past = after.getBoundingClientRect().top <= 0;
    for (let index = 0; index < sections.length; index++) {
      const top = sections[index].offsetTop;
      const height = sections[index].offsetHeight;
      const last = index === sections.length - 1;
      if (y < top + height || last) {
        const pinned = Math.max(0, height - screen);
        return {
          index,
          hold: pinned > 0 ? clamp((y - top) / pinned) : y >= top ? 1 : 0,
          travel: last ? 0 : clamp((y - top - pinned) / screen),
          past,
        };
      }
    }
    return { index: 0, hold: 0, travel: 0, past };
  };

  const poseAt = (frame: Frame): Pose => {
    const here = poseOf(frame.index);
    if (frame.travel <= 0 || frame.index >= sections.length - 1) return here;
    return mixPose(here, poseOf(frame.index + 1), smooth(0.04, 0.96, frame.travel));
  };

  const engine: MapEngine | null = await bootStage(stage, poseAt(measure()), false);

  // ---- light. The globe shows the real line between day and night. The
  // model is easier to read in daylight, so on the way down the clock moves
  // to midday today, unless it is already broad daylight.
  let now = new Date();
  const light = (frame: Frame): { date: Date; live: boolean } => {
    const high = sunPosition(now, ORIGIN.lat, ORIGIN.lon).altitude > 14;
    const { rise, set } = sunTimes(now, ORIGIN.lat, ORIGIN.lon);
    if (high || !rise || !set) return { date: now, live: true };
    const midday = (rise.getTime() + set.getTime()) / 2;
    const amount = frame.index === 0 ? smooth(0.1, 0.9, frame.travel) : 1;
    return {
      date: new Date(lerp(now.getTime(), midday, amount)),
      live: amount === 0,
    };
  };

  const clock = document.querySelector<HTMLElement>("[data-clock]");
  const heroClock = document.querySelector<HTMLElement>("[data-clock-hero]");
  const levelValue = document.querySelector<HTMLElement>("[data-level-value]");
  const levelShare = document.querySelector<HTMLElement>("[data-level-share]");
  const gauge = document.querySelector<HTMLElement>(".level [data-gauge]");
  const ticks = [...document.querySelectorAll<HTMLAnchorElement>("[data-tick]")];
  const lowest = engine ? engine.grid.meta.stats.lowest.metres : DRY;

  let shownScene = -1;
  let wasPast = false;
  let preloaded = false;

  const render = () => {
    const frame = measure();

    // The scene counts as current from halfway through the journey to it.
    const current =
      frame.travel > 0.5 ? Math.min(frame.index + 1, ids.length - 1) : frame.index;
    if (current !== shownScene) {
      shownScene = current;
      for (const tick of ticks) {
        if (tick.dataset.tick === ids[current]) tick.setAttribute("aria-current", "step");
        else tick.removeAttribute("aria-current");
      }
      engine?.setLabelFilter(...sceneOf(current).labels);
    }
    // The streets of the last scene start loading one scene early, so they
    // are there when the camera arrives.
    const last = ids.indexOf("town-hall");
    const near = !noStreets && last > 0 && frame.index >= last - 1 && !frame.past;
    if (engine && near !== preloaded) {
      preloaded = near;
      engine.preloadStreets(near ? poseOf(last) : null);
    }
    if (frame.past !== wasPast) {
      wasPast = frame.past;
      story.classList.toggle("is-past", frame.past);
      engine?.setActive(!frame.past);
    }
    // Over the map the header is see-through. Over the rest of the page it
    // needs a solid background, or the text scrolls through the menu.
    const header = document.querySelector<HTMLElement>(".site-header");
    if (header) {
      const under = after.getBoundingClientRect().top <= header.offsetHeight;
      header.classList.toggle("is-solid", under);
    }

    // ---- water. It rises while the sea-level words are pinned, and drains
    // again on the way to the next scene.
    let level: number | null = null;
    if (ids[frame.index] === "sea-level") {
      level =
        frame.travel > 0
          ? lerp(0, DRY, smooth(0, 0.7, frame.travel))
          : lerp(DRY, 0, smooth(0.06, 0.86, frame.hold));
    }
    // Before and after the scene the readout shows the end result.
    const shown = level ?? 0;
    if (levelValue) levelValue.textContent = shown > -0.05 ? "NAP" : `NAP ${metres(shown)}`;
    if (gauge) {
      const fill = ((shown - DRY) / (GAUGE_TOP - DRY)) * 100;
      gauge.style.setProperty("--fill", `${fill}%`);
    }
    if (engine) {
      if (levelShare) {
        levelShare.textContent = `${Math.round(engine.grid.shareBelow(shown) * 100)}%`;
      }
      engine.setFlood(level !== null && level > lowest ? level : null);
      engine.setGoal(poseAt(frame), 5);

      const { date, live } = light(frame);
      engine.setDate(date);
      const { altitude } = engine.getSun();
      const sun =
        altitude >= 0
          ? `sun ${Math.round(altitude)}° above the horizon`
          : `sun ${Math.round(-altitude)}° below the horizon`;
      if (clock) {
        clock.innerHTML = live
          ? `Amsterdam <b>${formatTime(date)}</b> · ${sun}`
          : `Shown in the light of <b>${formatTime(date)}</b> today · ${sun}`;
      }
    }
    if (heroClock) heroClock.textContent = ` · Amsterdam ${formatTime(now)}`;
  };

  let queued = false;
  // Without its streets the last scene falls back to the view of the city.
  engine?.on("streets", (status) => {
    if (!status.failed || noStreets) return;
    // Once the camera is down there, a tile that is late is no reason to
    // pull it back up.
    if (ids[shownScene] === "town-hall") return;
    noStreets = true;
    shownScene = -1;
    engine.preloadStreets(null);
    queue();
  });
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  narrowQuery.addEventListener("change", queue);
  window.setInterval(() => {
    now = new Date();
    queue();
  }, 30000);
  render();
}

main();
