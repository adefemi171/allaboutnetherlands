import * as T from "three";

/**
 * Per-building facade facts baked by scripts/build-drive-scenery.mjs, one byte each:
 * storey height in 5 cm steps (from 3DBAG LiDAR heights and floor count), ground-floor use
 * (from the BAG register), construction era, and floor count.
 */
export const FACADE_USE = { home: 0, shop: 1, office: 2, other: 3 } as const;

/** A tile's mesh header sets this bit on its vertex count when facade facts follow the normals. */
export const FACADE_FLAG = 0x80000000;

export function facadeEra(year: number | null | undefined): number {
  if (!year || year < 1200 || year > 2100) return 0;
  if (year < 1920) return 1;
  if (year < 1945) return 2;
  if (year < 1975) return 3;
  if (year < 2000) return 4;
  return 5;
}

const vertexHead = `#include <common>
attribute float facadeSeed;
attribute vec4 facadeInfo;
uniform float tileSize;
varying vec3 vFacade;
varying vec4 vInfo;
varying vec2 vRoofUv;`;

const vertexBody = `#include <begin_vertex>
vFacade = vec3(dot(position.xz + modelMatrix[3].xz, vec2(-normal.z, normal.x)), position.y, facadeSeed);
vInfo = facadeInfo;
// Tile-local ground position, laid out like the tile's aerial photo.
vRoofUv = vec2(position.x / tileSize, 1.0 - position.z / tileSize);`;

const fragmentHead = `#include <common>
varying vec3 vFacade;
varying vec4 vInfo;
varying vec2 vRoofUv;
uniform float nightMix;
uniform sampler2D roofPhoto;
uniform float hasRoofPhoto;`;

const fragmentBody = `#include <color_fragment>
float seed = vFacade.z;
if (seed < 0.001) {
  // Roofs take their colour from the aerial photo of the same spot: real tiles, gravel,
  // solar panels and dormers. Tall roofs lean in the photo, so they keep the palette.
  if (hasRoofPhoto > 0.5 && vFacade.y < 26.0) {
    diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(roofPhoto, vRoofUv).rgb * 1.08, 0.9);
  }
} else if (vFacade.y > 0.35) {
  float storey = vInfo.x > 0.5 ? vInfo.x / 20.0 : 2.9 + 0.45 * seed;
  float use = vInfo.y;
  float era = vInfo.z;
  // Window spacing and half sizes (as a share of the bay) by period.
  vec3 bay = vec3(2.45 + 0.9 * seed, 0.23, 0.22);
  if (era > 0.5 && era < 1.5) bay = vec3(2.1 + 0.6 * seed, 0.18, 0.31);       // tall sash windows
  else if (era > 1.5 && era < 2.5) bay = vec3(2.4 + 0.7 * seed, 0.22, 0.26);  // interwar brick
  else if (era > 2.5 && era < 3.5) bay = vec3(2.7 + 0.9 * seed, 0.33, 0.21);  // post-war strips
  else if (era > 3.5 && era < 4.5) bay = vec3(2.5 + 0.7 * seed, 0.24, 0.24);
  else if (era > 4.5) bay = vec3(3.0 + 1.0 * seed, 0.31, 0.30);               // large modern glazing
  if (use > 1.5 && use < 2.5) bay.yz = vec2(0.37, 0.30);                        // offices
  bool shopfront = use > 0.5 && use < 1.5 && vFacade.y < storey;

  vec2 span = vec2(bay.x, storey);
  vec2 cell = abs(fract((vFacade.xy + vec2(12.0 * seed, 0.0)) / span) - 0.5);
  vec2 pixel = max(fwidth(vFacade.xy / span), vec2(0.003));
  vec2 brick = vec2(vFacade.x / 0.23, vFacade.y / 0.067);
  brick.x += 0.5 * mod(floor(brick.y), 2.0);
  vec2 joints = min(fract(brick), 1.0 - fract(brick));
  float mortar = (1.0 - smoothstep(0.026, 0.09, min(joints.x, joints.y)))
    * (1.0 - smoothstep(0.2, 0.75, max(fwidth(brick.x), fwidth(brick.y))));
  float isBrick = smoothstep(0.012, 0.05, diffuseColor.r - diffuseColor.g);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.31, 0.26), 0.24 * mortar * isBrick);

  if (shopfront) {
    // A glazed shopfront with mullions and a fascia, lit in the evening.
    float width = 4.2 + 1.2 * seed;
    float across = abs(fract((vFacade.x + 7.0 * seed) / width) - 0.5) * width;
    float edge = max(fwidth(vFacade.x), 0.004);
    float glass = (1.0 - smoothstep(width * 0.5 - 0.28 - edge, width * 0.5 - 0.28 + edge, across))
      * step(0.45, vFacade.y) * (1.0 - step(storey * 0.72, vFacade.y));
    float fascia = step(storey * 0.77, vFacade.y) * (1.0 - step(storey * 0.94, vFacade.y));
    vec3 sign = 0.42 + 0.3 * cos(6.2831 * (seed * 3.7 + vec3(0.0, 0.33, 0.67)));
    diffuseColor.rgb = mix(diffuseColor.rgb, sign, fascia * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.17, 0.19), glass * 0.82);
    // Each shop is lit differently in the evening, and some have closed.
    float lit = fract(sin(floor((vFacade.x + 7.0 * seed) / width) * 91.7 + seed * 311.0) * 4375.5);
    totalEmissiveRadiance += vec3(0.95, 0.70, 0.42) * glass
      * (0.03 + nightMix * (lit < 0.2 ? 0.04 : 0.18 + 0.4 * lit));
  } else if (vFacade.y > 0.65) {
    vec2 size = bay.yz;
    vec2 mask = 1.0 - smoothstep(size - pixel, size + pixel, cell);
    vec2 glassSize = size - vec2(0.037, 0.035);
    vec2 glassMask = 1.0 - smoothstep(glassSize - pixel, glassSize + pixel, cell);
    float windowMask = mask.x * mask.y * (1.0 - smoothstep(0.22, 0.42, max(pixel.x, pixel.y)));
    float trim = clamp(windowMask - glassMask.x * glassMask.y, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.070, 0.093, 0.119), windowMask * 0.76);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.40, 0.35, 0.28), trim * 0.70);
    vec2 window = floor((vFacade.xy + vec2(12.0 * seed, 0.0)) / span);
    float occupancy = fract(sin(dot(window, vec2(73.13, 43.83)) + seed * 527.0) * 9758.3);
    totalEmissiveRadiance += vec3(0.40, 0.23, 0.087) * nightMix * step(0.86, occupancy)
      * glassMask.x * glassMask.y * (1.0 - smoothstep(0.09, 0.17, max(pixel.x, pixel.y)));
  }
}`;

/** A building material for one map tile. Roofs use that tile's aerial photo once it loads. */
export function buildingMaterial(nightMix: { value: number }, tileSize: number) {
  const roofPhoto = { value: null as T.Texture | null };
  const hasRoofPhoto = { value: 0 };
  const material = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { nightMix, roofPhoto, hasRoofPhoto, tileSize: { value: tileSize } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", vertexHead)
      .replace("#include <begin_vertex>", vertexBody);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", fragmentHead)
      .replace("#include <color_fragment>", fragmentBody);
  };
  material.customProgramCacheKey = () => "drive-buildings";
  material.userData.perTile = true;
  return {
    material,
    setRoofPhoto(texture: T.Texture) {
      roofPhoto.value = texture;
      hasRoofPhoto.value = 1;
    },
  };
}
