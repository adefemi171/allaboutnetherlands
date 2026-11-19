// The satellite page: pick a place, find the passes over it and the
// pictures that match, and show any of them on the globe.

import { findPlace, type Place } from "../data/places";
import { fromRD } from "../map/rd";
import { loadGlobeCatalog, loadSearchCatalog } from "../satellite/catalog";
import { addDaily } from "../satellite/gibs";
import { SatelliteGlobe } from "../satellite/globe";
import { matchPasses } from "../satellite/match";
import { defaultWindow, watchers } from "../satellite/passes";
import { findPasses } from "../satellite/pool";
import { LABEL_COPY } from "../satellite/profile";
import { describeScene, searchWeekOfScenes } from "../satellite/scenes";
import { formatAway, formatClock, formatWhen } from "../satellite/time";
import { ROWS, Timeline } from "../satellite/timeline";
import type { GpRecord, MatchedPass, PassLabel, SatKind } from "../satellite/types";
import { Gallery } from "./gallery";
import { ReplayCapture } from "../satellite/replay-capture";
import { openScene } from "./scene-dialog";
import { openTimelapse } from "./timelapse";

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);

function setText(selector: string, text: string): void {
  const element = $(selector);
  if (element) element.textContent = text;
}

const BADGE: Record<PassLabel, string> = {
  watched: "◆",
  likely: "◇",
  could: "□",
  overhead: "+",
};

/** Which passes head the list. */
const RANK: Record<PassLabel, number> = { watched: 0, likely: 1, could: 2, overhead: 3 };

const KIND_COPY: Record<SatKind, string> = {
  imaging: "Takes pictures of the ground",
  radar: "Sees the ground by radar, through cloud and at night",
  weather: "Watches the weather",
  crew: "Has people on board",
  other: "Not known to take pictures",
};

/** Kilometres on the ground for one degree at the centre of the Earth. */
const KM_PER_DEGREE = 111.2;

/** Where the Dutch national map service can name a spot, and the map can show it. */
const DUTCH = { south: 50.7, north: 53.7, west: 3.2, east: 7.3 };
const REVERSE_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse";

/** The place the page is about. One of the map's own places has an id. */
interface Focus {
  lat: number;
  lon: number;
  label: string;
  id?: string;
  /** The visitor's own position: kept out of the address bar. */
  own?: boolean;
}

function inNetherlands({ lat, lon }: { lat: number; lon: number }): boolean {
  return lat > DUTCH.south && lat < DUTCH.north && lon > DUTCH.west && lon < DUTCH.east;
}

/** "52.091°N 5.122°E" */
function coordinates(lat: number, lon: number): string {
  const part = (value: number, plus: string, minus: string) =>
    `${Math.abs(value).toFixed(3)}°${value < 0 ? minus : plus}`;
  return `${part(lat, "N", "S")} ${part(lon, "E", "W")}`;
}

/** The address nearest a spot in the Netherlands, if the map service knows one. */
async function nameOf(lat: number, lon: number): Promise<string | null> {
  if (!inNetherlands({ lat, lon })) return null;
  try {
    const response = await fetch(
      `${REVERSE_URL}?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&rows=1&distance=500&fl=weergavenaam`,
    );
    const data = (await response.json()) as { response?: { docs?: { weergavenaam?: string }[] } };
    return data.response?.docs?.[0]?.weergavenaam ?? null;
  } catch {
    return null;
  }
}

type Filter = "all" | "photo" | SatKind;

function focusOn(place: Place): Focus {
  return {
    lat: place.lat,
    lon: place.lon,
    label: place.english ? `${place.name} (${place.english})` : place.name,
    id: place.id,
  };
}

/** The place a link asks for: "?place=utrecht", or "?at=52.09,5.12&name=Dom". */
function focusFromUrl(): Focus | null {
  const params = new URL(window.location.href).searchParams;
  const place = findPlace(params.get("place") ?? "");
  if (place) return focusOn(place);
  const [lat, lon] = (params.get("at") ?? "").split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: params.get("name") || coordinates(lat, lon) };
}

/** The same place as a query string, for this page and for the map. */
function queryFor(focus: Focus): string {
  return focus.id
    ? `?place=${encodeURIComponent(focus.id)}`
    : `?at=${focus.lat.toFixed(5)},${focus.lon.toFixed(5)}&name=${encodeURIComponent(focus.label)}`;
}

function main(): void {
  const canvas = $<HTMLCanvasElement>("[data-sat-canvas]");
  const report = $("[data-sat-report]");
  const status = $("[data-sat-status]");
  const progress = $<HTMLProgressElement>("[data-sat-progress]");
  const card = $("[data-sat-pass]");
  const tip = $("[data-sat-tip]");
  const strip = $<HTMLCanvasElement>("[data-sat-timeline-canvas]");
  const pictures = $("[data-sat-gallery]");
  if (!canvas || !report || !status || !progress || !card || !tip || !strip || !pictures) return;

  /** The label that follows the pointer, or nothing. */
  const hint = (text: string | null, x = 0, y = 0) => {
    tip.hidden = !text;
    if (!text) return;
    tip.textContent = text;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  const replayCapture = new ReplayCapture($<HTMLElement>("[data-sat-replay-capture]")!);
  const replayHud = $<HTMLElement>("[data-sat-replay]");
  const replayProgress = $<HTMLInputElement>("[data-sat-replay-progress]");
  const replayPlayback = $<HTMLButtonElement>("[data-sat-replay-playback]");
  const replayFollow = $<HTMLButtonElement>("[data-sat-replay-follow]");
  const globe = new SatelliteGlobe(canvas, {
    onHover(hovered) {
      hint(
        hovered && `${hovered.name} · ${Math.round(hovered.altitudeKm)} km up`,
        hovered?.x,
        hovered?.y,
      );
    },
    onTime(date, live, frame) {
      const what = live ? "Now" : date.getTime() > Date.now() ? "Still to come" : "Replay";
      setText("[data-sat-clock]", `${what} · ${formatClock(date)}`);
      if (replayHud) replayHud.hidden = !frame;
      if (frame) {
        replayCapture.update(frame.scan, frame.scanDirection);
        if (replayProgress) {
          replayProgress.value = String(Math.round(frame.progress * 1000));
          replayProgress.setAttribute("aria-valuetext", formatClock(date));
        }
        const playbackLabel = frame.playing ? "Pause" : "Play";
        if (replayPlayback && replayPlayback.textContent !== playbackLabel) replayPlayback.textContent = playbackLabel;
        replayFollow?.setAttribute("aria-pressed", String(frame.following));
        setText("[data-sat-replay-phase]", frame.phase);
        setText("[data-sat-replay-altitude]", `${Math.round(frame.altitudeKm)} km up`);
      }
    },
    onPick(lat, lon) {
      const spot: Focus = { lat, lon, label: coordinates(lat, lon) };
      void run(spot);
      void nameOf(lat, lon).then((name) => {
        if (!name || focus !== spot) return;
        spot.label = name;
        setText("[data-sat-where]", name);
        link(spot);
      });
    },
  });
  const timeline = new Timeline(strip, {
    onPick: (pass) => select(pass),
    onHover: (pass, x, y) => hint(pass && `${pass.name} · ${formatWhen(pass.time)}`, x, y),
  });
  const gallery = new Gallery(pictures, {
    onOpen: (scene) => focus && openScene(scene, focus),
    onReplay: (pass, selectPhoto) => {
      select(pass, selectPhoto);
      canvas.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
  });

  let catalog: { search: GpRecord[]; globe: GpRecord[] } | null = null;
  let abort: AbortController | null = null;
  let focus: Focus | null = null;
  let matched: MatchedPass[] = [];
  let filter: Filter = "all";
  let selected: MatchedPass | null = null;
  let span = defaultWindow();

  const busy = (text: string, done = 0) => {
    status.textContent = text;
    status.hidden = !text;
    progress.hidden = !text;
    progress.value = done;
  };

  // --------------------------------------------------------- one pass --

  const select = (pass: MatchedPass | null, selectPhoto = true) => {
    selected = pass;
    replayCapture.set(pass, focus);
    globe.showPass(pass);
    timeline.select(pass?.id ?? null);
    if (pass && selectPhoto) gallery.show(pass);
    for (const item of document.querySelectorAll<HTMLElement>("[data-pass-id]")) {
      item.classList.toggle("is-active", item.dataset.passId === pass?.id);
    }
    card.hidden = !pass;
    if (!pass) return;
    setText("[data-sat-pass-name]", pass.name);
    setText("[data-sat-pass-label]", `${LABEL_COPY[pass.label]} · ${KIND_COPY[pass.kind]}`);
    setText("[data-sat-pass-when]", `${formatWhen(pass.time)} · ${formatAway(pass.time)}`);
    setText(
      "[data-sat-pass-near]",
      `${Math.round(pass.angleDeg * KM_PER_DEGREE)} km from straight overhead`,
    );
    const photo = $<HTMLButtonElement>("[data-sat-pass-photo]");
    if (photo) photo.hidden = !pass.scene;
  };

  $("[data-sat-pass-photo]")?.addEventListener("click", () => {
    if (selected?.scene && focus) openScene(selected.scene, focus);
  });
  $("[data-sat-pass-replay]")?.addEventListener("click", () => globe.replayPass());
  replayProgress?.addEventListener("input", () => globe.seekReplay(Number(replayProgress.value) / 1000));
  replayPlayback?.addEventListener("click", () => globe.toggleReplayPlayback());
  $("[data-sat-replay-closest]")?.addEventListener("click", () => globe.seekClosestApproach());
  replayFollow?.addEventListener("click", () => globe.toggleReplayFollow());
  $("[data-sat-pass-now]")?.addEventListener("click", () => select(null));

  const passItem = (pass: MatchedPass): HTMLLIElement => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sat__item";
    button.dataset.passId = pass.id;
    button.classList.toggle("is-active", pass.id === selected?.id);

    const badge = document.createElement("span");
    badge.className = `sat__badge sat__badge--${pass.label}`;
    badge.textContent = BADGE[pass.label];
    badge.title = LABEL_COPY[pass.label];

    const meta = document.createElement("span");
    meta.className = "sat__meta";
    const name = document.createElement("strong");
    name.textContent = pass.name;
    const when = document.createElement("span");
    when.textContent = `${formatWhen(pass.time)} · ${formatAway(pass.time)}`;
    const what = document.createElement("span");
    what.textContent = pass.scene ? describeScene(pass.scene) : LABEL_COPY[pass.label];
    meta.append(name, when, what);

    button.append(badge, meta);
    button.addEventListener("click", () => {
      select(pass);
      // On a phone the globe is above the list, out of sight.
      canvas.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    item.append(button);
    return item;
  };

  // ---------------------------------------------------------- the lists --

  const fits = (pass: MatchedPass, kind: Filter) =>
    kind === "all" || (kind === "photo" ? !!pass.scene : pass.kind === kind);

  const renderLists = () => {
    const shown = matched.filter((pass) => fits(pass, filter));
    // The next pass first. Of those gone by, the ones most likely to have
    // looked come first, and the latest of each.
    const upcoming = shown.filter((pass) => pass.upcoming);
    const past = shown
      .filter((pass) => !pass.upcoming)
      .sort((a, b) => RANK[a.label] - RANK[b.label] || b.time.localeCompare(a.time));
    const fill = (name: string, passes: MatchedPass[], limit: number) => {
      $(`[data-sat-${name}]`)?.replaceChildren(...passes.slice(0, limit).map(passItem));
      const note = $(`[data-sat-${name}-note]`);
      if (!note) return;
      note.hidden = passes.length > 0 && passes.length <= limit;
      note.textContent = passes.length
        ? `Showing the first ${limit} of ${passes.length}. Narrow it down with the buttons above.`
        : "Nothing here.";
    };
    fill("upcoming", upcoming, 40);
    fill("past", past, 80);
    if (focus) timeline.set(shown, focus, span);

    for (const chip of document.querySelectorAll<HTMLButtonElement>("[data-sat-filter]")) {
      const kind = chip.dataset.satFilter as Filter;
      const count = matched.filter((pass) => fits(pass, kind)).length;
      chip.setAttribute("aria-pressed", String(kind === filter));
      chip.hidden = kind !== "all" && count === 0;
      const counter = chip.querySelector("span");
      if (counter) counter.textContent = String(count);
    }
  };

  for (const chip of document.querySelectorAll<HTMLButtonElement>("[data-sat-filter]")) {
    chip.addEventListener("click", () => {
      filter = chip.dataset.satFilter as Filter;
      renderLists();
    });
  }

  // ---------------------------------------------------------- one place --

  /** Put the place in the address bar and in the link to the map. */
  const link = (place: Focus) => {
    const query = queryFor(place);
    history.replaceState(null, "", `${window.location.pathname}${place.own ? "" : query}`);
    const mapLink = $<HTMLAnchorElement>("[data-sat-map-link]");
    if (!mapLink) return;
    mapLink.href = `/map/${query}`;
    mapLink.hidden = !inNetherlands(place);
  };

  const run = async (next: Focus) => {
    abort?.abort();
    abort = new AbortController();
    const { signal } = abort;
    const place = (focus = next);

    report.hidden = false;
    setText("[data-sat-where]", place.label);
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sat-pick]")) {
      button.setAttribute("aria-pressed", String(button.dataset.satPick === place.id));
    }
    setText("[data-sat-summary]", "");
    busy("Looking up orbits…");
    matched = [];
    filter = "all";
    span = defaultWindow();
    select(null);
    renderLists();
    gallery.set([], place);
    for (const block of document.querySelectorAll<HTMLElement>("[data-sat-block]")) {
      block.hidden = true;
    }

    globe.setPlace(place.lat, place.lon);
    link(place);

    try {
      if (!catalog) {
        const [search, dots] = await Promise.all([
          loadSearchCatalog(signal),
          loadGlobeCatalog(signal),
        ]);
        catalog = { search: search.records, globe: dots };
        globe.setCatalog(catalog.globe);
      }
      const records = catalog.search;

      const [passes, archive] = await Promise.all([
        findPasses(records, place.lat, place.lon, {
          window: span,
          signal,
          onProgress: (done, total) => busy("Checking a week of orbits…", done / total),
        }),
        // Without the archive there are still the passes.
        searchWeekOfScenes(place.lat, place.lon, signal).catch(() => null),
      ]);
      if (signal.aborted) return;

      matched = matchPasses(passes, archive?.scenes ?? [], records);
      addDaily(matched, place.lat, place.lon);
      const past = matched.filter((pass) => !pass.upcoming);
      const photos = gallery.set(matched, place, archive?.scenes, archive?.clearLook);
      const upcoming = matched.length - past.length;
      const satellites = new Set(past.map((pass) => pass.noradId)).size;
      busy("");
      setText(
        "[data-sat-summary]",
        `${satellites} satellites in the past 7 days · ${photos} public images · ${upcoming} upcoming passes.` +
          (archive ? "" : " The detailed imagery archive is temporarily unavailable."),
      );
      for (const label of ROWS) {
        setText(
          `[data-sat-count="${label}"]`,
          String(past.filter((pass) => pass.label === label).length),
        );
      }

      const always = watchers(records, place.lat, place.lon).map((profile) => profile.name);
      setText(
        "[data-sat-always]",
        `${always.join(", ")}. Weather satellites that hang 35,786 km over the equator and photograph this side of the Earth every few minutes.`,
      );
      const blocks: Record<string, boolean> = {
        always: always.length > 0,
        lapse: true,
        timeline: true,
        passes: true,
      };
      for (const block of document.querySelectorAll<HTMLElement>("[data-sat-block]")) {
        block.hidden = !blocks[block.dataset.satBlock ?? ""];
      }
      renderLists();
    } catch {
      if (!signal.aborted) busy("Could not finish the orbit search. Try again in a moment.");
    }
  };

  // ------------------------------------------------------------ choosing --

  const pick = (id: string): boolean => {
    const place = findPlace(id);
    if (place) void run(focusOn(place));
    return !!place;
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sat-pick]")) {
    button.addEventListener("click", () => pick(button.dataset.satPick ?? ""));
  }
  // What the search box found (see scripts/search.ts): a place of the map's
  // own, or a street or an address on the Dutch national grid.
  window.addEventListener("aan:place", (event) => {
    if (pick((event as CustomEvent<string>).detail)) event.preventDefault();
  });
  window.addEventListener("aan:address", (event) => {
    const { title, rd } = (event as CustomEvent<{ title: string; rd: [number, number] }>).detail;
    const [lat, lon] = fromRD(rd[0], rd[1]);
    event.preventDefault();
    void run({ lat, lon, label: title });
  });

  const locate = $<HTMLButtonElement>("[data-sat-locate]");
  if (locate && "geolocation" in navigator) {
    locate.hidden = false;
    locate.addEventListener("click", () => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          void run({
            lat: coords.latitude,
            lon: coords.longitude,
            label: "Where you are",
            own: true,
          }),
        () => (locate.textContent = "Your location is not available"),
        { maximumAge: 600_000, timeout: 10_000 },
      );
    });
  }
  $("[data-sat-lapse]")?.addEventListener("click", () => {
    if (focus) openTimelapse(focus);
  });

  const zooms: Record<string, number> = { in: 0.7, out: 1 / 0.7 };
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sat-zoom]")) {
    button.addEventListener("click", () => globe.zoomBy(zooms[button.dataset.satZoom ?? ""] ?? 1));
  }
  const day = $<HTMLInputElement>("[data-sat-day]");
  day?.addEventListener("change", () => globe.setDayPicture(day.checked));

  // Keep the fixed header readable over the report on a narrow screen.
  const globePanel = $(".sat__globe");
  const header = document.querySelector(".site-header");
  const panel = $(".sat__panel");
  const updateHeader = () => {
    if (!globePanel || !header || header.classList.contains("is-menu")) return;
    const solid = Boolean(panel?.scrollTop) || globePanel.getBoundingClientRect().bottom <= header.clientHeight;
    header.classList.toggle("is-solid", solid);
  };
  window.addEventListener("scroll", updateHeader, { passive: true });
  panel?.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();

  const start = focusFromUrl();
  if (start) void run(start);
  else pick("amsterdam");
}

// Making the globe's WebGL context holds up the page: paint the text first.
requestAnimationFrame(() => setTimeout(main));
