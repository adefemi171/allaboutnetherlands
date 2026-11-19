// Satellite pictures on a page: the list entry for one, and the dialog
// that shows it large (components/SceneDialog.astro).

import { closeup, type Closeup } from "../satellite/closeup";
import { describeScene } from "../satellite/scenes";
import { formatWhen } from "../satellite/time";
import type { Scene } from "../satellite/types";

type View = "closeup" | "frame";

let loading: AbortController | null = null;

/** Put a close-up on its canvas, and the ring on the place in it. */
export function drawCloseup(canvas: HTMLCanvasElement, pin: HTMLElement, found: Closeup): void {
  canvas.width = found.image.width;
  canvas.height = found.image.height;
  canvas.getContext("2d")?.putImageData(found.image, 0, 0);
  pin.style.left = `${(found.x / found.image.width) * 100}%`;
  pin.style.top = `${(found.y / found.image.height) * 100}%`;
}

/**
 * Show a scene large. Where the archive holds the full picture, the
 * dialog opens on a close-up of the place; the whole frame is one press away.
 */
export function openScene(scene: Scene, place: { lat: number; lon: number; label: string }): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-scene]");
  if (!dialog) return;
  const $ = <T extends HTMLElement>(name: string) =>
    dialog.querySelector<T>(`[data-scene-${name}]`)!;
  const canvas = $<HTMLCanvasElement>("canvas");
  const close = $("closeup");
  const img = $<HTMLImageElement>("img");
  const pin = $("pin");
  const note = $("note");
  const views = $("views");
  const buttons = [...views.querySelectorAll<HTMLButtonElement>("button")];

  const title = `${describeScene(scene)} · ${formatWhen(scene.datetime)}`;
  const record = document.createElement("a");
  record.href = scene.href;
  record.target = "_blank";
  record.rel = "noopener noreferrer";
  record.textContent = "Archive record";
  $("label").textContent = title;
  img.alt = `${place.label} seen by ${title}`;
  if (scene.thumbnail) img.src = scene.thumbnail;
  else img.removeAttribute("src");

  loading?.abort();
  const { signal } = (loading = new AbortController());
  dialog.addEventListener("close", () => loading?.abort(), { once: true, signal });
  let detail: "loading" | "ready" | "failed" = scene.visual ? "loading" : "failed";

  let view: View = "closeup";
  const show = (next: View) => {
    view = next;
    const near = view === "closeup";
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.sceneView === view));
    }
    close.hidden = !near || detail !== "ready";
    // The frame stands in while the close-up loads.
    const previewReady = Boolean(scene.thumbnail && img.naturalWidth);
    const previewPending = Boolean(scene.thumbnail && !img.complete);
    img.hidden = !close.hidden || !previewReady;
    const text =
      near && detail === "loading"
        ? previewReady
          ? "Loading the close-up. The full scene is shown below."
          : "Loading the close-up…"
        : near && detail === "ready"
          ? `${place.label}, 8 km across at 10 m to the pixel, as the satellite saw it. The ring marks the spot.`
          : previewPending
            ? "Loading the preview…"
            : !previewReady
              ? "Preview unavailable. You can open the archive record below."
              : scene.daily
                ? `${place.label} in the middle of the satellite's picture of that day, 240 km across.`
                : "The whole frame the satellite took, about 110 km across.";
    note.replaceChildren(`${text} `, record);
  };
  img.addEventListener("load", () => show(view), { signal });
  img.addEventListener("error", () => show(view), { signal });
  for (const button of buttons) {
    button.onclick = () => show(button.dataset.sceneView as View);
  }

  views.hidden = !scene.visual;
  show("closeup");
  if (!dialog.open) dialog.showModal();
  if (!scene.visual) return;

  closeup(scene, place.lat, place.lon)
    .then((found) => {
      if (signal.aborted) return;
      drawCloseup(canvas, pin, found);
      detail = "ready";
      show(view);
    })
    .catch(() => {
      if (signal.aborted) return;
      // Outside the frame, or the archive would not answer: the frame stays.
      detail = "failed";
      views.hidden = true;
      show("frame");
    });
}

/** A list entry for a scene: its preview, what took it and when. Opens the dialog. */
export function sceneItem(
  scene: Scene,
  place: { lat: number; lon: number; label: string },
): HTMLLIElement {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scene-item";
  if (scene.thumbnail) {
    const img = document.createElement("img");
    img.src = scene.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    button.append(img);
  } else {
    const empty = document.createElement("span");
    empty.className = "scene-item__empty";
    empty.textContent = "No preview";
    button.append(empty);
  }
  const meta = document.createElement("span");
  meta.className = "scene-item__meta";
  const when = document.createElement("strong");
  when.textContent = formatWhen(scene.datetime);
  const what = document.createElement("span");
  what.textContent = describeScene(scene);
  meta.append(when, what);
  button.append(meta);
  button.addEventListener("click", () => openScene(scene, place));
  item.append(button);
  return item;
}
