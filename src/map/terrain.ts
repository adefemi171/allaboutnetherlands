// Turns the grid into the voxel model: terraced ground, water, and a block
// of buildings on every square where people live.

import * as THREE from "three";
import { Grid, KIND_FOREIGN, KIND_NL, KIND_WATER } from "./grid";
import {
  BUILDINGS,
  FLOOD,
  FOG_GLSL,
  GLOBE_SEA,
  INLAND_WATER,
  LEVEL,
  LIGHTING_GLSL,
  SEA_SIDE,
  SOIL,
  abroadColour,
  hash,
  heightOf,
  hex,
  landColour,
  levelOf,
  metresOf,
  mix,
  seaColour,
  type RGB,
} from "./style";

export interface SharedUniforms {
  uSunDir: { value: THREE.Vector3 };
  uOvercast: { value: number };
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  /**
   * How much of the stretched relief is left: 1 from afar, 0 at street
   * level, where the ground is drawn flat.
   */
  uRelief: { value: number };
  /** How far street-level detail floats above the flat ground, km. */
  uLift: { value: number };
  [name: string]: THREE.IUniform;
}

export interface Terrain {
  group: THREE.Group;
  /** Height of the ground at each cell, in scene km. */
  ground: Float32Array;
  /** Height of the tallest thing at each cell (ground or roof), scene km. */
  roof: Float32Array;
  /**
   * What to do with one of the globe's land dots at this spot. Null hides
   * it, because the model is drawn solidly there. A number is the height to
   * draw it at, just above the model's faded edge. Undefined means the spot
   * is outside the model and the dot belongs on the globe.
   */
  dotHeight(wx: number, wz: number): number | null | undefined;
  /** Show the land below a water level (metres to NAP), or null to hide. */
  setFlood(level: number | null): void;
  /**
   * When photo is true, hide the atlas-coloured ground tops so aerial
   * photography can sit underneath. Population blocks stay visible;
   * streets and 3DBAG buildings are drawn separately.
   */
  setPhoto(photo: boolean): void;
  /** Called every frame with the relief that is left (see uRelief). */
  update(relief: number): void;
  dispose(): void;
}

// Faces of a box, in the order the vertex shader expects.
const FACE_TOP = 0;
const FACE_EAST = 1;
const FACE_WEST = 2;
const FACE_SOUTH = 3;
const FACE_NORTH = 4;

// The surroundings fade out between these distances from the Netherlands,
// and in a band along the edge of the grid. All in cells (500 m each).
const FADE_START = 24;
const FADE_END = 96;
const EDGE_FADE = 28;
/** The globe's dots show through once the model is fainter than this. */
const DOTS_BELOW = 0.45;

const GROUND_VERTEX = /* glsl */ `
attribute vec4 aBase;   // column, level, row, face
attribute vec2 aSize;   // run length in cells, rise in levels
attribute vec4 aColor;  // rgb, and whether to draw the cell grid
uniform vec3 uGridOrigin;
uniform float uCell;
uniform float uLevel;
uniform float uRelief;
varying vec3 vAlbedo;
varying float vGridded;
varying vec3 vNormal;
varying vec3 vWorld;
${LIGHTING_GLSL}
void main() {
  float face = aBase.w;
  vec3 base = vec3(
    uGridOrigin.x + aBase.x * uCell,
    aBase.y * uLevel * uRelief,
    uGridOrigin.z + aBase.z * uCell
  );
  float along = position.x * aSize.x * uCell;
  float rise = position.y * aSize.y * uLevel * uRelief;
  vec3 p;
  vec3 n;
  if (face < 0.5) {
    p = base + vec3(along, 0.0, position.y * uCell);
    n = vec3(0.0, 1.0, 0.0);
  } else if (face < 1.5) {
    p = base + vec3(uCell, rise, along);
    n = vec3(1.0, 0.0, 0.0);
  } else if (face < 2.5) {
    p = base + vec3(0.0, rise, along);
    n = vec3(-1.0, 0.0, 0.0);
  } else if (face < 3.5) {
    p = base + vec3(along, rise, uCell);
    n = vec3(0.0, 0.0, 1.0);
  } else {
    p = base + vec3(along, rise, 0.0);
    n = vec3(0.0, 0.0, -1.0);
  }
  vAlbedo = toLinear(aColor.rgb);
  vGridded = aColor.a;
  vNormal = n;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const GROUND_FRAGMENT = /* glsl */ `
uniform vec3 uGridOrigin;
uniform float uCell;
varying vec3 vAlbedo;
varying float vGridded;
varying vec3 vNormal;
varying vec3 vWorld;
${LIGHTING_GLSL}
${FOG_GLSL}
float cellNoise(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec3 albedo = vAlbedo;
  bool top = vNormal.y > 0.5;
  if (top && vGridded > 0.5) {
    // Draw each 500 m square: a faint edge and a slightly different shade.
    // Both fade out once a square is only a few pixels wide.
    vec2 g = (vWorld.xz - uGridOrigin.xz) / uCell;
    vec2 w = fwidth(g);
    float perPixel = max(w.x, w.y);
    float show = clamp(1.0 - perPixel * 3.0, 0.0, 1.0);
    vec2 f = abs(fract(g) - 0.5);
    float line = smoothstep(0.46 - perPixel, 0.5 - perPixel * 0.5, max(f.x, f.y));
    albedo *= 1.0 + (cellNoise(floor(g)) - 0.5) * 0.10 * show;
    albedo *= 1.0 - 0.17 * line * show;
  }
  vec3 colour = shade(albedo, vNormal, vec3(0.0, 1.0, 0.0), 1.0);
  if (!top) colour *= 0.86;
  gl_FragColor = vec4(toDisplay(applyFog(colour, vWorld)), 1.0);
}
`;

const BUILDING_VERTEX = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aScale;
attribute vec4 aColor;  // rgb, and how brightly the windows are lit
uniform float uRelief;
varying vec3 vAlbedo;
varying float vLit;
varying vec3 vNormal;
varying vec3 vWorld;
${LIGHTING_GLSL}
void main() {
  vec3 p = position * aScale + aOffset;
  // The blocks shrink with the relief, and sink into the ground just
  // before real buildings take their place.
  p.y = p.y * uRelief - 0.06 * (1.0 - smoothstep(0.0, 0.22, uRelief));
  vAlbedo = toLinear(aColor.rgb);
  vLit = aColor.a;
  vNormal = normal;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const BUILDING_FRAGMENT = /* glsl */ `
varying vec3 vAlbedo;
varying float vLit;
varying vec3 vNormal;
varying vec3 vWorld;
${LIGHTING_GLSL}
${FOG_GLSL}
void main() {
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 colour = shade(vAlbedo, vNormal, up, 1.0);
  bool top = vNormal.y > 0.5;
  if (!top) colour *= 0.9;
  // Lights come on as the sun goes down.
  float night = 1.0 - dayAmount(up);
  colour += vec3(1.0, 0.66, 0.32) * night * vLit * (top ? 0.12 : 0.5);
  gl_FragColor = vec4(toDisplay(applyFog(colour, vWorld)), 1.0);
}
`;

const FLOOD_VERTEX = /* glsl */ `
uniform float uFloodHeight;
uniform float uRelief;
uniform float uLift;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Just above the level, and above the streets when those are showing.
  world.y = uFloodHeight * uRelief + uLift * (1.0 - uRelief) + 0.0012;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FLOOD_FRAGMENT = /* glsl */ `
uniform vec3 uFloodColor;
uniform vec4 uBounds;        // xMin, zMin, xMax, zMax
uniform sampler2D uPresence; // how solidly the model is drawn, per cell
uniform sampler2D uGround;   // height of the ground, per cell
uniform float uFloodHeight;
uniform float uOpacity;
varying vec3 vWorld;
${LIGHTING_GLSL}
${FOG_GLSL}
void main() {
  vec3 colour = shade(toLinear(uFloodColor), vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), 1.0);
  // The water fades out where the model does.
  vec2 cell = (vWorld.xz - uBounds.xy) / (uBounds.zw - uBounds.xy);
  // Only squares that lie below the level are under water. Asking the
  // grid, instead of letting the sheet cut through the model, also works
  // at street level, where the ground is drawn flat.
  if (texture2D(uGround, cell).r > uFloodHeight - 0.001) discard;
  float alpha = uOpacity * texture2D(uPresence, cell).r;
  gl_FragColor = vec4(toDisplay(applyFog(colour, vWorld)), alpha);
}
`;

function pack(colour: RGB, flag: number): number {
  return (
    (Math.round(colour[0]) |
      (Math.round(colour[1]) << 8) |
      (Math.round(colour[2]) << 16) |
      (flag << 24)) >>>
    0
  );
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function buildTerrain(grid: Grid, shared: SharedUniforms): Terrain {
  const W = grid.width;
  const H = grid.height;
  const N = W * H;

  /** Steps from the nearest cell that matches, counted up to a limit. */
  const stepsFrom = (matches: (c: number) => boolean, limit: number) => {
    const steps = new Uint8Array(N).fill(255);
    let frontier: number[] = [];
    for (let c = 0; c < N; c++) {
      if (matches(c)) {
        steps[c] = 0;
        frontier.push(c);
      }
    }
    for (let d = 1; d <= limit && frontier.length; d++) {
      const next: number[] = [];
      for (const c of frontier) {
        const i = c % W;
        const neighbours = [
          i + 1 < W ? c + 1 : -1,
          i > 0 ? c - 1 : -1,
          c + W < N ? c + W : -1,
          c - W >= 0 ? c - W : -1,
        ];
        for (const n of neighbours) {
          if (n >= 0 && steps[n] === 255) {
            steps[n] = d;
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return steps;
  };

  // How far each cell is from any land (for the shallow-water tint) and
  // from the Netherlands (for fading the surroundings out).
  const coast = stepsFrom((c) => grid.kind(c) !== KIND_WATER, 9);
  const abroad = stepsFrom((c) => grid.kind(c) === KIND_NL, FADE_END);

  // The model is the Netherlands plus a halo of sea and neighbours that
  // dissolves into the globe. 1 is fully drawn, 0 is left to the globe.
  // Quantised so neighbouring cells share colours and merge into strips.
  const presence = new Float32Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      const border = Math.min(i, W - 1 - i, j, H - 1 - j);
      const fade =
        (1 - smoothstep(FADE_START, FADE_END, abroad[c])) *
        smoothstep(0, EDGE_FADE, border);
      presence[c] = Math.round(fade * 12) / 12;
    }
  }

  // ---- terrace level and colours of every cell
  const level = new Int16Array(N);
  const topColour = new Uint32Array(N);
  const sideColour = new Uint32Array(N);
  const landByLevel = new Map<number, [number, number]>();
  const abroadByLevel = new Map<number, RGB>();

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      const kind = grid.kind(c);
      const metres = grid.elevation[c] / 10;
      const inside = presence[c];

      if (kind === KIND_NL) {
        if (grid.isInlandWater(c)) {
          level[c] = levelOf(metres) - 2;
          topColour[c] = pack(INLAND_WATER, 0);
          sideColour[c] = pack(mix(INLAND_WATER, SEA_SIDE, 0.5), 0);
        } else {
          const l = levelOf(metres);
          level[c] = l;
          let colours = landByLevel.get(l);
          if (!colours) {
            const top = landColour(metresOf(l * LEVEL));
            colours = [pack(top, 255), pack(mix(top, SOIL, 0.5), 0)];
            landByLevel.set(l, colours);
          }
          topColour[c] = colours[0];
          sideColour[c] = colours[1];
        }
      } else if (kind === KIND_FOREIGN) {
        // Neighbours keep their relief but lose their colour, and sink
        // into the globe towards the edge of the grid.
        const l = Math.round(levelOf(Math.min(400, Math.max(0, metres))) * inside);
        level[c] = l;
        let colour = abroadByLevel.get(l);
        if (!colour) {
          colour = abroadColour(metresOf(l * LEVEL));
          abroadByLevel.set(l, colour);
        }
        const faded = mix(GLOBE_SEA, colour, inside);
        topColour[c] = pack(faded, 0);
        sideColour[c] = pack(mix(faded, [0, 0, 0], 0.3), 0);
      } else {
        level[c] = 0;
        topColour[c] = pack(mix(GLOBE_SEA, seaColour(coast[c]), inside), 0);
        sideColour[c] = pack(mix(GLOBE_SEA, SEA_SIDE, inside), 0);
      }
    }
  }

  // ---- faces. One instance per face: tops merged into strips along a row
  // where neighbours match, sides only where a cell stands above its neighbour.
  let capacity = N;
  let base = new Int16Array(capacity * 4);
  let size = new Uint16Array(capacity * 2);
  let colour = new Uint32Array(capacity);
  let count = 0;
  const push = (
    i: number,
    l: number,
    j: number,
    face: number,
    length: number,
    rise: number,
    packed: number,
  ) => {
    if (count === capacity) {
      capacity *= 2;
      const b = new Int16Array(capacity * 4);
      b.set(base);
      base = b;
      const s = new Uint16Array(capacity * 2);
      s.set(size);
      size = s;
      const k = new Uint32Array(capacity);
      k.set(colour);
      colour = k;
    }
    base[count * 4] = i;
    base[count * 4 + 1] = l;
    base[count * 4 + 2] = j;
    base[count * 4 + 3] = face;
    size[count * 2] = length;
    size[count * 2 + 1] = rise;
    colour[count] = packed;
    count++;
  };

  for (let j = 0; j < H; j++) {
    let i = 0;
    while (i < W) {
      const c = j * W + i;
      let end = i + 1;
      while (
        end < W &&
        level[j * W + end] === level[c] &&
        topColour[j * W + end] === topColour[c] &&
        presence[j * W + end] > 0 === presence[c] > 0
      ) {
        end++;
      }
      if (presence[c] > 0) {
        push(i, level[c], j, FACE_TOP, end - i, 0, topColour[c]);
      }
      i = end;
    }
    for (let k = 0; k < W; k++) {
      const c = j * W + k;
      if (presence[c] === 0) continue;
      const l = level[c];
      if (k + 1 < W && level[c + 1] < l) {
        push(k, level[c + 1], j, FACE_EAST, 1, l - level[c + 1], sideColour[c]);
      }
      if (k > 0 && level[c - 1] < l) {
        push(k, level[c - 1], j, FACE_WEST, 1, l - level[c - 1], sideColour[c]);
      }
      if (j + 1 < H && level[c + W] < l) {
        push(k, level[c + W], j, FACE_SOUTH, 1, l - level[c + W], sideColour[c]);
      }
      if (j > 0 && level[c - W] < l) {
        push(k, level[c - W], j, FACE_NORTH, 1, l - level[c - W], sideColour[c]);
      }
    }
  }

  const groundGeometry = new THREE.InstancedBufferGeometry();
  groundGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      3,
    ),
  );
  groundGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  groundGeometry.setAttribute(
    "aBase",
    new THREE.InstancedBufferAttribute(base.slice(0, count * 4), 4),
  );
  groundGeometry.setAttribute(
    "aSize",
    new THREE.InstancedBufferAttribute(size.slice(0, count * 2), 2),
  );
  groundGeometry.setAttribute(
    "aColor",
    new THREE.InstancedBufferAttribute(
      new Uint8Array(colour.buffer.slice(0, count * 4)),
      4,
      true,
    ),
  );
  groundGeometry.instanceCount = count;

  const gridUniforms = {
    uGridOrigin: { value: new THREE.Vector3(grid.x0, 0, grid.z0) },
    uCell: { value: grid.cell },
    uLevel: { value: LEVEL },
  };
  const groundMaterial = new THREE.ShaderMaterial({
    uniforms: { ...shared, ...gridUniforms },
    vertexShader: GROUND_VERTEX,
    fragmentShader: GROUND_FRAGMENT,
    side: THREE.DoubleSide,
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.frustumCulled = false;

  // ---- buildings
  const ground = new Float32Array(N);
  const roof = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    ground[c] = level[c] * LEVEL;
    roof[c] = ground[c];
  }

  const palettes = {
    village: BUILDINGS.village.map(hex),
    town: BUILDINGS.town.map(hex),
    city: BUILDINGS.city.map(hex),
  };
  const offsets: number[] = [];
  const scales: number[] = [];
  const tints: number[] = [];
  const quarter = grid.cell / 4;

  for (let c = 0; c < N; c++) {
    const people = grid.people(c);
    if (!people || !grid.isDryLand(c)) continue;
    const [cx, cz] = grid.cellCentre(c);
    // Square-root scale: 50 residents is a low block, 7,000 a tower. Kept
    // squat on purpose so a city reads as a mass and not as a bed of nails.
    const height = 0.07 + 0.013 * Math.sqrt(people);
    const blocks = people < 60 ? 1 : people < 400 ? 2 : people < 1500 ? 3 : 4;
    const footprint =
      grid.cell * (people < 60 ? 0.32 : people < 400 ? 0.38 : 0.42);
    const palette =
      people < 300
        ? palettes.village
        : people < 2200
          ? palettes.town
          : palettes.city;
    const first = Math.floor(hash(c) * 4);
    for (let k = 0; k < blocks; k++) {
      const seed = c * 4 + k;
      const corner = (first + k) % 4;
      const jitter = quarter * 0.18;
      const x =
        cx + (corner & 1 ? quarter : -quarter) + (hash(seed + 7) - 0.5) * jitter;
      const z =
        cz + (corner & 2 ? quarter : -quarter) + (hash(seed + 13) - 0.5) * jitter;
      let h = height * (0.7 + 0.6 * hash(seed + 29));
      // Dense squares get one block that stands well above the rest.
      if (people > 3000 && k === 0) h *= 1.4;
      const tint = palette[Math.floor(hash(seed + 41) * palette.length)];
      offsets.push(x, ground[c], z);
      scales.push(
        footprint * (0.82 + 0.26 * hash(seed + 53)),
        h,
        footprint * (0.82 + 0.26 * hash(seed + 67)),
      );
      // About a third of the blocks stay dark at night.
      const lit = hash(seed + 79) < 0.32 ? 0 : 0.35 + 0.65 * hash(seed + 83);
      tints.push(tint[0], tint[1], tint[2], Math.round(lit * 255));
      if (ground[c] + h > roof[c]) roof[c] = ground[c] + h;
    }
  }

  // A unit box without a bottom, standing on y = 0.
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const buildingGeometry = new THREE.InstancedBufferGeometry();
  buildingGeometry.setAttribute("position", box.getAttribute("position"));
  buildingGeometry.setAttribute("normal", box.getAttribute("normal"));
  buildingGeometry.setIndex(box.getIndex());
  buildingGeometry.setAttribute(
    "aOffset",
    new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3),
  );
  buildingGeometry.setAttribute(
    "aScale",
    new THREE.InstancedBufferAttribute(new Float32Array(scales), 3),
  );
  buildingGeometry.setAttribute(
    "aColor",
    new THREE.InstancedBufferAttribute(new Uint8Array(tints), 4, true),
  );
  buildingGeometry.instanceCount = offsets.length / 3;
  const buildingMaterial = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: BUILDING_VERTEX,
    fragmentShader: BUILDING_FRAGMENT,
  });
  const buildingMesh = new THREE.Mesh(buildingGeometry, buildingMaterial);
  buildingMesh.frustumCulled = false;

  // ---- the sheet of water for "what lies below this level"
  const presenceTexture = new THREE.DataTexture(
    Uint8Array.from(presence, (value) => Math.round(value * 255)),
    W,
    H,
    THREE.RedFormat,
  );
  presenceTexture.magFilter = THREE.LinearFilter;
  presenceTexture.minFilter = THREE.LinearFilter;
  presenceTexture.needsUpdate = true;
  const groundTexture = new THREE.DataTexture(
    ground,
    W,
    H,
    THREE.RedFormat,
    THREE.FloatType,
  );
  groundTexture.magFilter = THREE.NearestFilter;
  groundTexture.minFilter = THREE.NearestFilter;
  groundTexture.needsUpdate = true;
  const floodUniforms = {
    uFloodColor: {
      value: new THREE.Vector3(FLOOD[0] / 255, FLOOD[1] / 255, FLOOD[2] / 255),
    },
    uBounds: {
      value: new THREE.Vector4(grid.x0, grid.z0, grid.xMax, grid.zMax),
    },
    uPresence: { value: presenceTexture },
    uGround: { value: groundTexture },
    uFloodHeight: { value: 0 },
    uOpacity: { value: 0.82 },
  };
  const floodMaterial = new THREE.ShaderMaterial({
    uniforms: { ...shared, ...floodUniforms },
    vertexShader: FLOOD_VERTEX,
    fragmentShader: FLOOD_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const floodGeometry = new THREE.PlaneGeometry(
    grid.xMax - grid.x0,
    grid.zMax - grid.z0,
  ).rotateX(-Math.PI / 2);
  const floodMesh = new THREE.Mesh(floodGeometry, floodMaterial);
  floodMesh.position.set((grid.x0 + grid.xMax) / 2, 0, (grid.z0 + grid.zMax) / 2);
  floodMesh.visible = false;
  floodMesh.frustumCulled = false;
  // After the streets, which are drawn in the same pass.
  floodMesh.renderOrder = 10;

  const group = new THREE.Group();
  group.add(groundMesh, buildingMesh, floodMesh);
  let photo = false;

  return {
    group,
    ground,
    roof,
    dotHeight(wx, wz) {
      const cell = grid.cellAt(wx, wz);
      if (cell < 0) return undefined;
      if (presence[cell] > DOTS_BELOW) return null;
      return presence[cell] > 0 ? ground[cell] + 0.4 : undefined;
    },
    setFlood(metres) {
      floodMesh.visible = metres !== null;
      if (metres !== null) floodUniforms.uFloodHeight.value = heightOf(metres);
    },
    setPhoto(next) {
      photo = next;
      groundMesh.visible = !photo;
    },
    update(relief) {
      buildingMesh.visible = relief > 0.001;
      groundMesh.visible = !photo;
    },
    dispose() {
      groundGeometry.dispose();
      groundMaterial.dispose();
      buildingGeometry.dispose();
      buildingMaterial.dispose();
      box.dispose();
      floodGeometry.dispose();
      floodMaterial.dispose();
      presenceTexture.dispose();
      groundTexture.dispose();
    },
  };
}
