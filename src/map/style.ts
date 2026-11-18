// How data turns into shapes and colours.

export type RGB = readonly [number, number, number];

/** Height of one terrace in the model, in scene kilometres. */
export const LEVEL = 0.05;

const HEIGHT_SCALE = 0.234;
const HEIGHT_POWER = 0.68;

/**
 * Model height (km) for a real height (metres to NAP).
 *
 * The country is 300 km long and its relief is measured in metres, so true
 * scale would be flat as paper. This stretches heights by a power curve:
 * a 4 m deep polder sits 0.6 km down, the 322 m Vaalserberg rises about
 * 12 km. Small differences near sea level stay readable and the hills in
 * Limburg do not turn into spikes.
 */
export function heightOf(metres: number): number {
  return Math.sign(metres) * HEIGHT_SCALE * Math.abs(metres) ** HEIGHT_POWER;
}

/** Inverse of heightOf. */
export function metresOf(height: number): number {
  return (
    Math.sign(height) * (Math.abs(height) / HEIGHT_SCALE) ** (1 / HEIGHT_POWER)
  );
}

/** Terrace number for a real height. Level 0 is NAP. */
export function levelOf(metres: number): number {
  return Math.round(heightOf(metres) / LEVEL);
}

export function hex(value: string): RGB {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function ramp(stops: readonly (readonly [number, RGB])[], value: number): RGB {
  if (value <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    const [at, colour] = stops[k];
    if (value <= at) {
      const [prevAt, prev] = stops[k - 1];
      return mix(prev, colour, (value - prevAt) / (at - prevAt));
    }
  }
  return stops[stops.length - 1][1];
}

// Land is tinted by height the way a Dutch school atlas does it: blue-green
// below sea level, fresh green just above, then yellow, then brown. The
// break at zero is deliberate. It draws the NAP line across the country.
const LAND: readonly (readonly [number, RGB])[] = [
  [-7, hex("#2a8a86")],
  [-4, hex("#439b85")],
  [-2, hex("#5faa7d")],
  [-0.05, hex("#7fb873")],
  [0.05, hex("#a5c669")],
  [2, hex("#b6cc6a")],
  [6, hex("#c9d273")],
  [12, hex("#d9d17b")],
  [25, hex("#dcc079")],
  [50, hex("#c9a767")],
  [100, hex("#b08c5a")],
  [200, hex("#9a744f")],
  [330, hex("#8a6248")],
];

const ABROAD: readonly (readonly [number, RGB])[] = [
  [0, hex("#1f2932")],
  [60, hex("#28333d")],
  [400, hex("#35414b")],
];

export const SEA_DEEP = hex("#12324b");
export const SEA_SHALLOW = hex("#1f5677");
export const SEA_SIDE = hex("#0d2639");
export const INLAND_WATER = hex("#3b8ec2");
export const SOIL = hex("#6d5a45");
export const FLOOD = hex("#3f93cf");

/** What the globe's surface looks like where the model ends. */
export const GLOBE_SEA = hex("#0d1c29");
export const GLOBE_LAND_DAY = hex("#cfc8b6");
export const GLOBE_LAND_NIGHT = hex("#40505f");
/** The same land seen close up, where it is only the model's surroundings. */
export const GLOBE_NEAR_DAY = hex("#566573");
export const GLOBE_NEAR_NIGHT = hex("#2b3947");
export const BACKGROUND = hex("#0b1620");

export function landColour(metres: number): RGB {
  return ramp(LAND, metres);
}

export function abroadColour(metres: number): RGB {
  return ramp(ABROAD, metres);
}

/** Sea colour by distance from the nearest land, in cells. */
export function seaColour(cellsFromLand: number): RGB {
  const t = Math.min(1, Math.max(0, (cellsFromLand - 1) / 7));
  return mix(SEA_SHALLOW, SEA_DEEP, t);
}

// Buildings. Dutch towns are brick and clay roof tile; the big cities add
// pale stone, concrete and glass.
export const BUILDINGS = {
  village: ["#b4573d", "#a8503a", "#c2694a", "#8f4a3a", "#b4573d", "#d8c7a6"],
  town: ["#b4573d", "#9c4b39", "#d6c4a2", "#c9b28d", "#a8503a", "#8d8f93"],
  city: ["#d9cbb0", "#a34f3a", "#9aa3ab", "#c7d2da", "#6f7780", "#e3dccb"],
} as const;

// Street level. The ground is drawn like a town plan: pale paving, dark
// carriageways, and the red asphalt of Dutch cycle paths.
export const STREET = {
  built: "#cdc4b3",
  other: "#c3c1ad",
  grass: "#9cc46c",
  field: "#cbbf7f",
  wood: "#5f9a57",
  conifer: "#4f8c5c",
  orchard: "#86b866",
  heath: "#a88da4",
  sand: "#e0d2a1",
  cemetery: "#9db58a",
  fallow: "#b9ae93",
  railbed: "#918c82",
  jetty: "#8a7a66",
  stone: "#6e7275",
  water: "#3f8fc4",
  sea: "#2f6f9f",
  tidal: "#9db3ad",
  footprint: "#a69d8f",
  motorway: "#4e545c",
  main: "#596069",
  regional: "#636970",
  local: "#6e7379",
  street: "#8a8783",
  otherRoad: "#9d9b95",
  parking: "#8d9094",
  runway: "#777c82",
  cycle: "#b4533f",
  foot: "#d8d1c0",
  bus: "#6a6e74",
  dirt: "#c2a878",
  gravel: "#b8ab8e",
  rail: "#454950",
  tram: "#63676d",
  trunk: "#6b4f3a",
  leaves: ["#4f8f4a", "#5a9a52", "#467f45", "#6aa558"],
  roofTile: ["#a3543a", "#964c37", "#8a4634", "#5a5f66", "#51565c"],
  roofFlat: ["#8e8f8c", "#7c7f81", "#9c9a93", "#6f7376"],
  glass: "#c9dcd9",
} as const;

/**
 * Wall colours by the year a building was finished. They are a key, not a
 * survey: old towns come out in dark brick, post-war districts in yellow
 * brick and concrete, new ones pale. `until` is the first year of the
 * next period.
 */
export const BUILDING_ERAS = [
  { until: 1850, label: "Before 1850", walls: ["#7f4636", "#8a4f3d", "#74402f", "#96604a"] },
  { until: 1920, label: "1850 to 1919", walls: ["#9a5540", "#8b4a39", "#a8644c"] },
  { until: 1945, label: "1920 to 1944", walls: ["#b06a40", "#b8744a", "#a05c3c"] },
  { until: 1970, label: "1945 to 1969", walls: ["#c7a877", "#bb9a6a", "#d0b98c"] },
  { until: 1990, label: "1970 to 1989", walls: ["#b3a694", "#a39886", "#c0b5a2"] },
  { until: 2010, label: "1990 to 2009", walls: ["#cdc6ba", "#bdb8ae", "#d6d0c5"] },
  { until: Infinity, label: "2010 and later", walls: ["#e3e0d9", "#cfd3d6", "#d9d5cc"] },
] as const;
/** Buildings whose year is not recorded. */
export const BUILDING_UNDATED = ["#b9ae9e", "#aa9f90", "#c4baab"] as const;

/** Cheap repeatable noise in [0, 1) from an integer. */
export function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** GLSL for the haze that hides the far distance when the camera is low. */
export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
float fogAmount(vec3 world) {
  return smoothstep(uFogNear, uFogFar, distance(world, cameraPosition));
}
vec3 applyFog(vec3 colour, vec3 world) {
  return mix(colour, uFogColor, fogAmount(world));
}
`;

/** GLSL shared by everything that is lit by the sun. */
export const LIGHTING_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform float uOvercast;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

// 0 at night, 1 in daylight, for a place whose "up" is given.
float dayAmount(vec3 up) {
  return smoothstep(-0.10, 0.14, dot(up, uSunDir));
}

vec3 shade(vec3 albedo, vec3 n, vec3 up, float moonlight) {
  float s = dot(up, uSunDir);
  float day = smoothstep(-0.10, 0.14, s);
  vec3 ambient = mix(vec3(0.105, 0.14, 0.21), vec3(0.40, 0.45, 0.52), day);
  ambient *= 1.0 + 0.45 * uOvercast * day;
  vec3 sun = mix(vec3(1.25, 0.62, 0.30), vec3(1.0, 0.96, 0.90), smoothstep(0.02, 0.45, s));
  sun *= day * 0.62 * (1.0 - 0.85 * uOvercast);
  float ndl = max(dot(n, uSunDir), 0.0);
  // A little fixed light at night so the relief does not vanish.
  vec3 moon = vec3(0.07, 0.09, 0.14) * max(dot(n, normalize(vec3(-0.4, 0.8, -0.45))), 0.0);
  moon *= (1.0 - day) * moonlight;
  vec3 lit = albedo * (ambient + sun * ndl + moon);
  // Overcast light is flat and a little grey.
  float grey = dot(lit, vec3(0.3, 0.55, 0.15));
  return mix(lit, vec3(grey), 0.25 * uOvercast);
}
`;
