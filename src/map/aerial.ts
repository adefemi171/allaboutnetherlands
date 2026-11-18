// Live Dutch aerial orthophotos from PDOK / Beeldmateriaal.nl (CC BY).
// Tiles are cut on the same grid as the street tiles (street-tiles.ts), so
// they sit on the scene without a projection step.

import * as THREE from "three";
import { clamp } from "./math";
import { rdToWorld, worldToRD } from "./rd";
import { tileAt, tileBounds } from "./street-tiles";
import { FOG_GLSL } from "./style";
import type { SharedUniforms } from "./terrain";

/** What the ground is drawn with: the atlas model, or the aerial photo. */
export type GroundMode = "model" | "aerial";

export const AERIAL_CREDIT = "Aerial: Beeldmateriaal / PDOK (CC BY)";

const MIN_ZOOM = 6;
const MAX_ZOOM = 17;
const MAX_TILES = 56;

interface Tile {
  key: string;
  zoom: number;
  col: number;
  row: number;
  mesh: THREE.Mesh | null;
  texture: THREE.Texture | null;
  /** Set while the photo is on its way. */
  abort: AbortController | null;
}

function tileUrl(zoom: number, col: number, row: number): string {
  return (
    "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:28992/" +
    `${zoom}/${col}/${row}.jpeg`
  );
}

/** One level finer every time the camera halves its distance (km). */
function zoomForDistance(dist: number): number {
  return clamp(Math.ceil(13.68 - Math.log2(dist)), MIN_ZOOM, MAX_ZOOM);
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vWorld;
${FOG_GLSL}
void main() {
  gl_FragColor = vec4(applyFog(texture2D(uMap, vUv).rgb, vWorld), 1.0);
}
`;

type HeightAt = (x: number, z: number) => number;

export class Aerial {
  readonly group = new THREE.Group();
  private mode: GroundMode = "model";
  private tiles = new Map<string, Tile>();
  private loader = new THREE.TextureLoader();
  private lastKey = "";

  constructor(
    private shared: SharedUniforms,
    private redraw: () => void,
  ) {
    this.group.visible = false;
    this.loader.crossOrigin = "anonymous";
  }

  setMode(mode: GroundMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.group.visible = mode !== "model";
    this.lastKey = "";
    if (mode === "model") this.dispose();
    this.redraw();
  }

  /**
   * Keep tiles under the camera. Returns true while something is still
   * loading, so the engine can keep drawing.
   */
  update(view: { x: number; z: number; dist: number }, heightAt: HeightAt): boolean {
    if (this.mode === "model") return false;

    const zoom = zoomForDistance(view.dist);
    const viewKey = `${zoom}:${view.x.toFixed(2)}:${view.z.toFixed(2)}:${view.dist.toFixed(2)}`;
    if (viewKey !== this.lastKey) {
      this.lastKey = viewKey;
      this.request(view, zoom);
    }

    // The photos of the level in view may still be on their way. Until
    // they are all there, those of the level before stay as a stand-in.
    const loading = [...this.tiles.values()].some((tile) => tile.zoom === zoom && tile.abort);
    for (const tile of [...this.tiles.values()]) {
      if (tile.zoom !== zoom && (!loading || !tile.mesh)) this.drop(tile);
      // Relief and lift change with the zoom, so every tile is put back.
      else this.place(tile, heightAt);
    }
    return loading;
  }

  /** Ask for the tiles around the camera, nearest first, and let go of the rest. */
  private request(view: { x: number; z: number; dist: number }, zoom: number): void {
    const [rdX, rdY] = worldToRD(view.x, view.z);
    const [cx, cy] = tileAt(rdX, rdY, zoom);
    const { left, right } = tileBounds(cx, cy, zoom);
    const radius = Math.max(1, Math.ceil((view.dist * 1000 * 1.2) / (right - left)));
    const around: { col: number; row: number; away: number }[] = [];
    for (let row = Math.max(0, cy - radius); row <= cy + radius; row++) {
      for (let col = Math.max(0, cx - radius); col <= cx + radius; col++) {
        around.push({ col, row, away: (col - cx) ** 2 + (row - cy) ** 2 });
      }
    }
    around.sort((a, b) => a.away - b.away);

    const wanted = new Set<string>();
    for (const { col, row } of around.slice(0, MAX_TILES)) {
      const key = `${zoom}:${col}:${row}`;
      wanted.add(key);
      if (this.tiles.has(key)) continue;
      const tile: Tile = { key, zoom, col, row, mesh: null, texture: null, abort: null };
      this.tiles.set(key, tile);
      this.load(tile);
    }
    for (const tile of [...this.tiles.values()]) {
      if (tile.zoom === zoom && !wanted.has(tile.key)) this.drop(tile);
    }
  }

  dispose(): void {
    for (const tile of [...this.tiles.values()]) this.drop(tile);
  }

  private load(tile: Tile): void {
    const abort = new AbortController();
    tile.abort = abort;
    this.loader.load(
      tileUrl(tile.zoom, tile.col, tile.row),
      (texture) => {
        if (abort.signal.aborted) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        tile.texture = texture;
        tile.abort = null;

        const { left, right } = tileBounds(tile.col, tile.row, tile.zoom);
        const km = (right - left) / 1000;
        const geometry = new THREE.PlaneGeometry(km, km);
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.ShaderMaterial({
          uniforms: { ...this.shared, uMap: { value: texture } },
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          // Finer photos are drawn over the coarser ones they replace.
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: MAX_ZOOM + 1 - tile.zoom,
        });
        tile.mesh = new THREE.Mesh(geometry, material);
        tile.mesh.renderOrder = -1;
        tile.mesh.matrixAutoUpdate = false;
        this.group.add(tile.mesh);
        // The next frame puts it in its place.
        this.redraw();
      },
      undefined,
      // A photo that will not load leaves the model showing through.
      () => (tile.abort = null),
    );
  }

  private place(tile: Tile, heightAt: HeightAt): void {
    if (!tile.mesh) return;
    const { left, right, top, bottom } = tileBounds(tile.col, tile.row, tile.zoom);
    const [x, z] = rdToWorld((left + right) / 2, (top + bottom) / 2);
    const relief = this.shared.uRelief.value;
    const lift = this.shared.uLift.value;
    // Sit on the stretched terrain height so photos follow the model relief.
    const y = heightAt(x, z) * relief + lift * (1 - relief) + 0.00025;
    tile.mesh.position.set(x, y, z);
    tile.mesh.updateMatrixWorld();
  }

  private drop(tile: Tile): void {
    tile.abort?.abort();
    tile.abort = null;
    if (tile.mesh) {
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      (tile.mesh.material as THREE.Material).dispose();
      tile.mesh = null;
    }
    tile.texture?.dispose();
    tile.texture = null;
    this.tiles.delete(tile.key);
  }
}
