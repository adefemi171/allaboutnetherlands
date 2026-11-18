// The map page: wires the panels and readouts to the engine.

import { findPlace, type Place } from "../data/places";
import { bootStage } from "../map/boot";
import {
  dayOfYear,
  formatDay,
  formatMinutes,
  formatTime,
  fromDayOfYear,
  fromLocal,
  toLocal,
  type LocalTime,
} from "../map/clock";
import { AERIAL_CREDIT } from "../map/aerial";
import type { GroundMode, MapEngine, Picked, Pose } from "../map/engine";
import type { LabelKind } from "../map/labels";
import { ORIGIN, latLonToWorld, rdToWorld, worldToLatLon } from "../map/rd";
import type { StreetStatus } from "../map/streets";
import { sunTimes } from "../map/sun";
import { SCENE_DAYS, SENTINEL_2, searchScenes } from "../satellite/scenes";
import meta from "../data/grid-meta.json";
import { sceneItem } from "./scene-dialog";

const number = new Intl.NumberFormat("en-GB");
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);

/** "−1.2 m", with a real minus sign and an explicit plus. */
function metres(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded < 0 ? "−" : rounded > 0 ? "+" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} m`;
}

function setText(selector: string, text: string): void {
  const element = $(selector);
  if (element) element.textContent = text;
}

// ---------------------------------------------------------------- readout --

function describe(picked: Picked | null): string {
  if (!picked) {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    return touch
      ? "Tap a square to read it, or a dot to see what it is. Drag, pinch and twist to move. Pinch in for streets."
      : "Point at a square to read it. Drag to move, scroll to zoom, right-drag to turn. Zoom in for streets and people.";
  }
  const { cell } = picked;
  const where =
    `<b>${Math.abs(cell.lat).toFixed(4)}°${cell.lat >= 0 ? "N" : "S"} ` +
    `${Math.abs(cell.lon).toFixed(4)}°${cell.lon >= 0 ? "E" : "W"}</b>` +
    ` · RD ${(cell.rdX / 1000).toFixed(1)} / ${(cell.rdY / 1000).toFixed(1)} km`;
  let what: string;
  if (cell.kind === "land" && cell.elevation !== null) {
    const people = cell.people
      ? `<b>${number.format(cell.people)}</b> residents in this square`
      : "nobody lives in this square";
    what = `<b>${cell.province}</b> · NAP <b>${metres(cell.elevation)}</b> · ${people}`;
  } else if (cell.kind === "water") {
    what = `<b>${cell.province}</b> · open water`;
  } else if (cell.kind === "abroad") {
    what = "Outside the Netherlands";
  } else {
    what = "Open water";
  }
  return `${where}<br>${what}`;
}

// ------------------------------------------------------------- place card --

type Focus = { lat: number; lon: number; label: string };

let placeFocus: Focus | null = null;
/** Set once the "what watched here" panel is wired up. */
let refreshOverhead = () => {};

function showPlace(engine: MapEngine, place: Place, fly: boolean): void {
  const card = $("[data-place]");
  if (!card) return;
  const [x, z] = latLonToWorld(place.lat, place.lon);
  const cell = engine.grid.cellAt(x, z);
  const info = cell >= 0 ? engine.grid.info(cell) : null;

  const kinds = {
    city: "City",
    university: "University",
    landmark: "Landmark",
    water: "Water",
  };
  const kind = [kinds[place.kind], info?.province].filter(Boolean).join(" · ");
  setText("[data-place-kind]", kind);
  setText(
    "[data-place-name]",
    place.english ? `${place.name} (${place.english})` : place.name,
  );
  setText("[data-place-blurb]", place.blurb);

  const nearby = Math.round(engine.grid.peopleWithin(x, z, 5) / 1000) * 1000;
  setText(
    "[data-place-people]",
    nearby ? `about ${number.format(nearby)} people` : "nobody",
  );
  setText(
    "[data-place-level]",
    info?.elevation != null ? `NAP ${metres(info.elevation)}` : "open water",
  );
  const links = $("[data-place-links]");
  if (links) links.hidden = place.kind !== "city";
  // There are no streets on open water.
  const streets = $<HTMLButtonElement>("[data-place-streets]");
  if (streets) {
    // Nor is the button needed for a place the map shows from its street.
    streets.hidden = place.kind === "water" || !!place.streets;
    streets.onclick = () => {
      engine.flyToStreets(x, z);
      // On a phone the card covers half the map, and the streets are
      // what was asked for.
      if (window.matchMedia("(max-width: 720px)").matches) hidePlace();
    };
  }

  placeFocus = {
    lat: place.lat,
    lon: place.lon,
    label: place.english ? `${place.name} (${place.english})` : place.name,
  };
  card.hidden = false;
  engine.setMarker(null);
  if (fly) engine.flyToPlace(place);
  refreshOverhead();

  const url = new URL(window.location.href);
  url.searchParams.set("place", place.id);
  history.replaceState(null, "", url);
}

function hidePlace(): void {
  const card = $("[data-place]");
  if (card) card.hidden = true;
  placeFocus = null;
  refreshOverhead();
  const url = new URL(window.location.href);
  url.searchParams.delete("place");
  history.replaceState(null, "", url);
}

// -------------------------------------------------------------- overhead --

function bindOverhead(
  engine: MapEngine,
  getFocus: () => Focus,
): () => void {
  const panel = $("[data-overhead]");
  const list = $("[data-overhead-list]");
  const status = $("[data-overhead-status]");
  const where = $("[data-overhead-where]");
  const toggle = $<HTMLInputElement>("[data-overhead-toggle]");
  const satLink = $<HTMLAnchorElement>("[data-overhead-satellite]");
  if (!panel || !list || !status || !where || !toggle) return () => {};

  let abort: AbortController | null = null;
  let open = false;

  const say = (text: string) => {
    status.textContent = text;
    status.hidden = !text;
  };

  const refresh = () => {
    if (!open) return;
    const focus = getFocus();
    where.textContent = focus.label;
    // The satellite page takes over from the same spot.
    if (satLink) {
      const at = `${focus.lat.toFixed(5)},${focus.lon.toFixed(5)}`;
      satLink.href = `/satellite/?at=${at}&name=${encodeURIComponent(focus.label)}`;
    }

    abort?.abort();
    abort = new AbortController();
    const { signal } = abort;
    list.replaceChildren();
    say("Looking up recent satellite photos…");

    searchScenes(focus.lat, focus.lon, { signal, collections: [SENTINEL_2], limit: 8 })
      .then((scenes) => {
        if (signal.aborted) return;
        list.replaceChildren(...scenes.map((scene) => sceneItem(scene, focus)));
        say(
          scenes.length
            ? ""
            : `No Sentinel-2 photos in the last ${SCENE_DAYS} days over this spot. Try another place, or check back after the next clear pass.`,
        );
      })
      .catch(() => {
        if (!signal.aborted) say("Could not reach Earth Search just now. Try again in a moment.");
      });
  };

  const setOpen = (next: boolean) => {
    open = next;
    panel.hidden = !next;
    toggle.checked = next;
    if (next) refresh();
    else abort?.abort();
  };

  toggle.addEventListener("change", () => setOpen(toggle.checked));
  $("[data-overhead-close]")?.addEventListener("click", () => setOpen(false));
  $("[data-overhead-from-place]")?.addEventListener("click", () => setOpen(true));

  // Follow the map centre when nothing is picked and the panel is open.
  let moveTimer = 0;
  engine.on("move", () => {
    if (!open || placeFocus) return;
    window.clearTimeout(moveTimer);
    moveTimer = window.setTimeout(refresh, 700);
  });

  return refresh;
}

// ---------------------------------------------------------------- streets --

/** Camera distance (km) below which the map counts as down at the streets. */
const STREET_LEVEL = 4.4;
/** Where the button goes back up to: the view of a whole city. */
const CITY_LEVEL = 62;

function bindStreets(engine: MapEngine): void {
  const status = $("[data-street-status]");
  const toggle = $<HTMLButtonElement>("[data-streets-toggle]");
  const legends = document.querySelectorAll<HTMLElement>("[data-legend]");

  const show = (state: StreetStatus) => {
    for (const legend of legends) {
      legend.hidden = (legend.dataset.legend === "streets") !== state.visible;
    }
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(state.visible));
      toggle.setAttribute(
        "aria-label",
        state.visible ? "Back up to the city" : "Go down to the streets",
      );
      toggle.title = state.visible ? "Back up to the city" : "Go down to the streets";
    }
    if (status) {
      const text = state.failed
        ? "Streets could not be loaded here. Trying again shortly."
        : state.loading && state.visible
          ? "Loading streets and buildings"
          : "";
      status.textContent = text;
      status.hidden = !text;
      status.classList.toggle("is-failed", state.failed);
    }
  };
  engine.on("streets", show);
  show(engine.getStreets());

  toggle?.addEventListener("click", () => {
    const goal = engine.getGoal();
    if (goal.dist < STREET_LEVEL) engine.setGoal({ dist: CITY_LEVEL, tilt: 54 }, 2.6);
    else engine.flyToStreets(goal.x, goal.z);
  });

  // A street or an address picked in the search box (see scripts/search.ts).
  window.addEventListener("aan:address", (event) => {
    const { title, rd } = (event as CustomEvent<{ title: string; rd: [number, number] }>)
      .detail;
    if (showSpot(engine, ...rdToWorld(rd[0], rd[1]), title)) event.preventDefault();
  });
}

/** Pin a spot that is not one of the map's own places, and go down to its street. */
function showSpot(engine: MapEngine, x: number, z: number, title: string): boolean {
  // Only inside the model. The streets cover nothing else.
  if (engine.grid.cellAt(x, z) < 0) return false;
  hidePlace();
  const [lat, lon] = worldToLatLon(x, z);
  placeFocus = { lat, lon, label: title };
  refreshOverhead();
  engine.setMarker({ x, z, text: title });
  engine.flyToStreets(x, z);
  return true;
}

// ------------------------------------------------------------------ names --

/** The switches for what is shown on top of the map. */
function bindShown(engine: MapEngine): void {
  const kinds: Record<string, LabelKind[]> = {
    university: ["university", "campus"],
    landmark: ["landmark"],
  };
  for (const box of document.querySelectorAll<HTMLInputElement>("[data-show]")) {
    const apply = () => {
      const what = box.dataset.show ?? "";
      if (what === "people") engine.setPeople(box.checked);
      else if (kinds[what]) engine.setLabelKinds(kinds[what], box.checked);
    };
    box.addEventListener("change", apply);
    // A browser may bring back the state of the boxes from an earlier visit.
    if (!box.checked) apply();
  }
}

/** The ground as the atlas model, or as the aerial photo. */
function bindGround(engine: MapEngine): void {
  const credit = $("[data-map-credit]");
  const base =
    `Heights AHN · People CBS ${meta.stats.populationYear} · Streets Kadaster · ` +
    `Buildings 3DBAG · <a href="/about/#data">Sources</a>`;
  const photo =
    `Heights AHN · ${AERIAL_CREDIT} · Streets Kadaster · Buildings 3DBAG · ` +
    `<a href="/about/#data">Sources</a>`;

  const apply = (mode: GroundMode) => {
    engine.setGroundMode(mode);
    if (credit) credit.innerHTML = mode === "model" ? base : photo;
  };

  for (const radio of document.querySelectorAll<HTMLInputElement>("[data-ground]")) {
    radio.addEventListener("change", () => {
      if (radio.checked) apply(radio.value as GroundMode);
    });
    if (radio.checked) apply(radio.value as GroundMode);
  }
}

// ------------------------------------------------------------------ light --

function bindLight(engine: MapEngine): void {
  const timeInput = $<HTMLInputElement>("[data-time]");
  const dayInput = $<HTMLInputElement>("[data-day]");
  const nowButton = $<HTMLButtonElement>("[data-now]");
  if (!timeInput || !dayInput || !nowButton) return;

  let live = true;
  let local: LocalTime = toLocal(new Date());

  const apply = (date: Date) => {
    engine.setDate(date);
    setText(
      "[data-time-label]",
      `${formatMinutes(local.minutes)}, ${formatDay(date)}${live ? " (now)" : ""}`,
    );
    const { altitude } = engine.getSun();
    const { rise, set } = sunTimes(date, ORIGIN.lat, ORIGIN.lon);
    const height =
      altitude >= 0
        ? `The sun is ${Math.round(altitude)}° above the horizon.`
        : `The sun is ${Math.round(-altitude)}° below the horizon.`;
    const times =
      rise && set ? ` Sunrise ${formatTime(rise)}, sunset ${formatTime(set)}.` : "";
    setText("[data-sun]", height + times);
    nowButton.hidden = live;
  };

  const showNow = () => {
    const now = new Date();
    local = toLocal(now);
    timeInput.value = String(local.minutes);
    dayInput.value = String(dayOfYear(local));
    apply(now);
  };

  const fromSliders = () => {
    live = false;
    const picked = fromDayOfYear(local.year, Number(dayInput.value));
    local = { ...local, ...picked, minutes: Number(timeInput.value) };
    apply(fromLocal(local));
  };

  timeInput.addEventListener("input", fromSliders);
  dayInput.addEventListener("input", fromSliders);
  nowButton.addEventListener("click", () => {
    live = true;
    showNow();
  });
  window.setInterval(() => live && showNow(), 30000);
  showNow();

  for (const radio of document.querySelectorAll<HTMLInputElement>("[data-sky]")) {
    radio.addEventListener("change", () => {
      if (radio.checked) engine.setOvercast(Number(radio.value));
    });
  }
}

// ------------------------------------------------------------------ water --

function bindWater(engine: MapEngine, reducedMotion: boolean): void {
  const toggle = $<HTMLInputElement>("[data-flood]");
  const slider = $<HTMLInputElement>("[data-level]");
  const gauge = $("[data-gauge]");
  if (!toggle || !slider || !gauge) return;

  const min = Number(slider.min);
  const max = Number(slider.max);
  let animation = 0;

  const show = (level: number) => {
    const on = toggle.checked;
    engine.setFlood(on ? level : null);
    gauge.style.setProperty("--fill", `${((level - min) / (max - min)) * 100}%`);
    gauge.classList.toggle("is-on", on);
    const share = Math.round(engine.grid.shareBelow(on ? level : 0) * 100);
    setText("[data-level-label]", on ? `NAP ${metres(level)}` : "NAP");
    setText(
      "[data-share]",
      on
        ? `${share}% of Dutch land lies below this level.`
        : `${share}% of Dutch land lies below NAP, the Dutch zero for height. Dunes, dikes and pumps keep it dry.`,
    );
  };

  /** Let the water rise from the bottom of the gauge to the chosen level. */
  const rise = () => {
    cancelAnimationFrame(animation);
    const target = Number(slider.value);
    if (reducedMotion) return show(target);
    const started = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - started) / 2400);
      const eased = 1 - (1 - t) ** 3;
      show(min + (target - min) * eased);
      if (t < 1) animation = requestAnimationFrame(frame);
    };
    animation = requestAnimationFrame(frame);
  };

  toggle.addEventListener("change", () => {
    if (toggle.checked) rise();
    else {
      cancelAnimationFrame(animation);
      show(Number(slider.value));
    }
  });
  slider.addEventListener("input", () => {
    cancelAnimationFrame(animation);
    toggle.checked = true;
    show(Number(slider.value));
  });
  show(Number(slider.value));
}

// ------------------------------------------------------------------- boot --

async function main(): Promise<void> {
  const stage = $("[data-stage]");
  if (!stage) return;

  const narrow = window.matchMedia("(max-width: 720px)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // On a phone the panel starts closed so the map is what you see first.
  const controls = $<HTMLDetailsElement>("[data-controls]");
  if (controls && narrow) controls.open = false;

  const start: Pose = {
    x: -12,
    z: -6,
    dist: narrow ? 1150 : 640,
    az: 0,
    tilt: 30,
    shiftX: 0,
    shiftY: 0,
  };
  const engine = await bootStage(stage, start, true);
  if (!engine) return;

  const readout = $("[data-readout]");
  let pinned: Picked | null = null;
  const write = (picked: Picked | null) => {
    if (readout) readout.innerHTML = describe(picked ?? pinned);
  };
  engine.on("hover", write);
  engine.on("pick", (picked) => {
    pinned = picked;
    write(picked);
  });
  write(null);

  const select = (id: string, fly = true) => {
    const place = findPlace(id);
    if (place) showPlace(engine, place, fly);
    return !!place;
  };
  engine.on("select", (id) => select(id));
  window.addEventListener("aan:place", (event) => {
    if (select((event as CustomEvent<string>).detail)) event.preventDefault();
  });
  $("[data-place-close]")?.addEventListener("click", hidePlace);

  bindLight(engine);
  bindWater(engine, reducedMotion);
  bindStreets(engine);
  bindShown(engine);
  bindGround(engine);
  refreshOverhead = bindOverhead(engine, () => {
    if (placeFocus) return placeFocus;
    const pose = engine.getPose();
    const [lat, lon] = worldToLatLon(pose.x, pose.z);
    return {
      lat,
      lon,
      label: `Map centre · ${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`,
    };
  });

  // The streets button has its own handler in bindStreets().
  const nudges: Record<string, () => void> = {
    in: () => engine.zoomBy(0.7),
    out: () => engine.zoomBy(1 / 0.7),
    left: () => engine.rotateBy(-30),
    right: () => engine.rotateBy(30),
    flat: () => engine.tiltTo(engine.getGoal().tilt > 20 ? 0.6 : 55),
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-nudge]")) {
    button.addEventListener("click", () => nudges[button.dataset.nudge ?? ""]?.());
  }

  // A report about the map says where the map was looking (scripts/report.ts).
  window.addEventListener("aan:report", (event) => {
    const pose = engine.getPose();
    const [lat, lon] = worldToLatLon(pose.x, pose.z);
    const far =
      pose.dist < 10 ? `${pose.dist.toFixed(1)} km` : `${Math.round(pose.dist)} km`;
    (event as CustomEvent<{ notes: string[] }>).detail.notes.push(
      `Map view: ${lat.toFixed(5)}, ${lon.toFixed(5)}, camera ${far} away`,
    );
  });

  // A link can open the map on a place, or on a spot ("at=52.37,4.89").
  const params = new URL(window.location.href).searchParams;
  const [lat, lon] = (params.get("at") ?? "").split(",").map(Number);
  const wanted = params.get("place");
  if (wanted) select(wanted);
  else if (Number.isFinite(lat) && Number.isFinite(lon)) {
    showSpot(engine, ...latLonToWorld(lat, lon), params.get("name") || "Here");
  }
}

main();
