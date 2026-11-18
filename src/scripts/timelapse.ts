// A place through the years (components/Timelapse.astro).

import { closeup, type Closeup } from "../satellite/closeup";
import { SENTINEL_2, searchScenes } from "../satellite/scenes";
import { formatWhen } from "../satellite/time";
import { drawCloseup } from "./scene-dialog";

/** The archive starts in the summer of 2017. */
const FIRST_YEAR = 2017;
/** Side of a frame in pixels of 10 m. Smaller than a close-up: there are many. */
const SIDE = 512;
const FRAME_MS = 1100;

interface Frame {
  year: number;
  when: string;
  found: Closeup;
}

let running: AbortController | null = null;

/** The clearest picture of a summer that has the place in it. */
async function summerOf(
  year: number,
  lat: number,
  lon: number,
  signal: AbortSignal,
): Promise<Frame | null> {
  const scenes = await searchScenes(lat, lon, {
    signal,
    collections: [SENTINEL_2],
    from: new Date(Date.UTC(year, 4, 1)),
    to: new Date(Math.min(Date.UTC(year, 8, 15), Date.now())),
    maxCloud: 20,
    limit: 4,
  });
  for (const scene of scenes) {
    if (signal.aborted) return null;
    try {
      return { year, when: scene.datetime, found: await closeup(scene, lat, lon, SIDE) };
    } catch {
      // The strip missed the place: the next clearest may not have.
    }
  }
  return null;
}

export function openTimelapse(place: { lat: number; lon: number; label: string }): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-lapse]");
  if (!dialog) return;
  const $ = <T extends HTMLElement>(name: string) =>
    dialog.querySelector<T>(`[data-lapse-${name}]`)!;
  const canvas = $<HTMLCanvasElement>("canvas");
  const pin = $("pin");
  const note = $("note");
  const play = $<HTMLButtonElement>("play");

  running?.abort();
  const { signal } = (running = new AbortController());
  // This year only once its summer is under way.
  const now = new Date();
  const last = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  const years = Array.from({ length: last - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
  const frames = new Map<number, Frame>();
  let shown = 0;
  let playing = true;
  let waiting = years.length;

  const buttons = new Map(
    years.map((year) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(year);
      button.disabled = true;
      button.onclick = () => {
        setPlaying(false);
        show(year);
      };
      return [year, button];
    }),
  );
  $("years").replaceChildren(play, ...buttons.values());
  $("label").textContent = `${place.label} · year by year`;
  canvas.width = canvas.height = SIDE;
  pin.hidden = true;

  const tell = () => {
    const frame = frames.get(shown);
    const progress = waiting ? `Fetching ${waiting} more summers from the archive. ` : "";
    note.textContent = frame
      ? `${progress}${formatWhen(frame.when)}, ${frame.year}: the clearest summer picture Sentinel-2 took, 5 km across.`
      : waiting
        ? "Looking up the clearest summer picture of every year since 2017…"
        : "The archive has no clear summer picture of this place.";
  };
  const show = (year: number) => {
    const frame = frames.get(year);
    if (!frame) return;
    shown = year;
    drawCloseup(canvas, pin, frame.found);
    pin.hidden = false;
    for (const [each, button] of buttons) button.setAttribute("aria-pressed", String(each === year));
    tell();
  };
  const setPlaying = (on: boolean) => {
    playing = on;
    play.textContent = on ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(on));
  };
  play.onclick = () => setPlaying(!playing);
  setPlaying(true);
  tell();

  const timer = window.setInterval(() => {
    const have = [...frames.keys()].sort();
    if (playing && have.length > 1) show(have[(have.indexOf(shown) + 1) % have.length]);
  }, FRAME_MS);
  dialog.addEventListener(
    "close",
    () => {
      window.clearInterval(timer);
      running?.abort();
    },
    { once: true },
  );
  if (!dialog.open) dialog.showModal();

  // Two at a time: quick enough, and light on a phone's line.
  const queue = [...years];
  const work = async () => {
    for (let year = queue.shift(); year && !signal.aborted; year = queue.shift()) {
      const frame = await summerOf(year, place.lat, place.lon, signal).catch(() => null);
      if (signal.aborted) return;
      waiting--;
      if (frame) {
        frames.set(year, frame);
        buttons.get(year)!.disabled = false;
        if (!shown) show(year);
      }
      tell();
    }
  };
  void Promise.all([work(), work()]);
}
