// Starts the map inside a .stage element and deals with the cases where it
// cannot run. The rest of the site never depends on the map.

import { MapEngine, type Pose } from "./engine";

export async function bootStage(
  stage: HTMLElement,
  pose: Pose,
  interactive: boolean,
): Promise<MapEngine | null> {
  const canvas = stage.querySelector<HTMLCanvasElement>(".stage__canvas");
  const labels = stage.querySelector<HTMLElement>(".stage__labels");
  const notice = stage.querySelector<HTMLElement>(".stage__notice");
  if (!canvas || !labels) return null;

  const fail = (message: string) => {
    if (notice) notice.textContent = message;
    stage.classList.add("has-failed");
    return null;
  };

  // Making the WebGL context holds up the page. Let the text be painted
  // first; the map fades in once it is ready.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  // A WebGL context is slow to make, on phones most of all, so there is no
  // separate test for one: the renderer's own attempt is the test.
  let engine: MapEngine;
  try {
    engine = new MapEngine({
      canvas,
      labels,
      gridUrl: `${base}/data/nl-grid.dat`,
      globeUrl: `${base}/data/globe-land.bin`,
      interactive,
      pose,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  } catch {
    return fail("This browser cannot draw the 3D map. The guides work without it.");
  }

  try {
    await engine.init();
  } catch (error) {
    console.error(error);
    engine.dispose();
    return fail("The map could not be loaded. The guides work without it.");
  }

  stage.classList.add("is-ready");
  // Handy in the console while working on the map: __map.setGoal({ ... }).
  if (import.meta.env.DEV) {
    (window as unknown as { __map: MapEngine }).__map = engine;
  }
  return engine;
}
