// The Earth the model sits on: a dark sphere, land drawn as dots, a thin
// glow of atmosphere, and the real line between day and night.

import * as THREE from "three";
import { smoothstep } from "./math";
import { EARTH_RADIUS_KM, globePoint, latLonToWorld } from "./rd";
import {
  FOG_GLSL,
  GLOBE_LAND_DAY,
  GLOBE_LAND_NIGHT,
  GLOBE_NEAR_DAY,
  GLOBE_NEAR_NIGHT,
  GLOBE_SEA,
  LIGHTING_GLSL,
  type RGB,
} from "./style";
import type { SharedUniforms } from "./terrain";

export interface Globe {
  group: THREE.Group;
  /** Call every frame with the camera's distance to its target (km). */
  update(distance: number): void;
  dispose(): void;
}

// The sphere sits a little below the model so the deepest polder clears it.
const SURFACE = EARTH_RADIUS_KM - 1.5;
const DOT_ALTITUDE = EARTH_RADIUS_KM + 1;
const CENTRE = new THREE.Vector3(0, -EARTH_RADIUS_KM, 0);

const SPHERE_VERTEX = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SPHERE_FRAGMENT = /* glsl */ `
uniform vec3 uSea;
varying vec3 vNormal;
${LIGHTING_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  gl_FragColor = vec4(toDisplay(shade(toLinear(uSea), n, n, 1.0)), 1.0);
}
`;

// Each dot is a small disc lying flat on the ground, so the dots thin out
// towards the edge of the globe the way print on a ball would.
const DOT_VERTEX = /* glsl */ `
attribute vec3 aCentre;
uniform float uRadius;  // km
uniform vec3 uGlobeCentre;
varying vec2 vDisc;
varying float vDay;
varying vec3 vWorld;
${LIGHTING_GLSL}
void main() {
  vec3 up = normalize(aCentre - uGlobeCentre);
  vec3 axis = abs(up.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 east = normalize(cross(axis, up));
  vec3 north = cross(up, east);
  vec3 p = aCentre + (east * position.x + north * position.y) * uRadius;
  vDisc = position.xy;
  vDay = dayAmount(up);
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const DOT_FRAGMENT = /* glsl */ `
uniform vec3 uDayColour;
uniform vec3 uNightColour;
uniform float uOpacity;
varying vec2 vDisc;
varying float vDay;
varying vec3 vWorld;
${LIGHTING_GLSL}
${FOG_GLSL}
void main() {
  float r = length(vDisc);
  float soft = fwidth(r) * 1.5;
  // The dots vanish into the same haze as the model.
  float alpha = (1.0 - smoothstep(1.0 - soft, 1.0, r)) * uOpacity * (1.0 - fogAmount(vWorld));
  if (alpha < 0.004) discard;
  vec3 colour = mix(toLinear(uNightColour), toLinear(uDayColour), vDay);
  gl_FragColor = vec4(toDisplay(colour), alpha);
}
`;

const AIR_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vNormal = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const AIR_FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vWorld;
${LIGHTING_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  vec3 toCamera = normalize(cameraPosition - vWorld);
  // Only the back of the shell is drawn, so this is a ring around the globe:
  // strongest right at the limb, fading outwards.
  float t = clamp(-dot(n, toCamera) / 0.26, 0.0, 1.0);
  float glow = t * t * (0.18 + 0.82 * dayAmount(n));
  gl_FragColor = vec4(vec3(0.36, 0.62, 1.0) * glow * uOpacity, 1.0);
}
`;

function vector(colour: RGB): THREE.Vector3 {
  return new THREE.Vector3(colour[0] / 255, colour[1] / 255, colour[2] / 255);
}

/** See Terrain.dotHeight: where the model wants a land dot, if at all. */
export type DotPlacer = (wx: number, wz: number) => number | null | undefined;

interface DotStyle {
  /** Radius of a dot, km. */
  radius: number;
  day: RGB;
  night: RGB;
}

type DotCloud = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

function dotCloud(
  lonLat: Int16Array,
  style: DotStyle,
  shared: SharedUniforms,
  place: DotPlacer | null,
): DotCloud {
  const positions = new Float32Array((lonLat.length / 2) * 3);
  let count = 0;
  for (let k = 0; k < lonLat.length / 2; k++) {
    const lat = lonLat[k * 2 + 1] / 100;
    const lon = lonLat[k * 2] / 100;
    let [x, y, z] = globePoint(lat, lon, DOT_ALTITUDE);
    // Only dots near the Netherlands can meet the model. There the model is
    // flat while the globe curves away under it, so the dots that show
    // through its faded edge are lifted onto the model.
    if (place && lat > 49.5 && lat < 55 && lon > 1.5 && lon < 9) {
      const [wx, wz] = latLonToWorld(lat, lon);
      const height = place(wx, wz);
      if (height === null) continue;
      if (height !== undefined) [x, y, z] = [wx, height, wz];
    }
    positions.set([x, y, z], count * 3);
    count++;
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute(
    "aCentre",
    new THREE.InstancedBufferAttribute(positions.slice(0, count * 3), 3),
  );
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uRadius: { value: style.radius },
      uGlobeCentre: { value: CENTRE },
      uDayColour: { value: vector(style.day) },
      uNightColour: { value: vector(style.night) },
      uOpacity: { value: 1 },
    },
    vertexShader: DOT_VERTEX,
    fragmentShader: DOT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

export async function buildGlobe(
  dots: Promise<ArrayBuffer | null>,
  shared: SharedUniforms,
  place: DotPlacer,
): Promise<Globe> {
  const group = new THREE.Group();

  const sphereGeometry = new THREE.SphereGeometry(SURFACE, 128, 96);
  const sphereMaterial = new THREE.ShaderMaterial({
    uniforms: { ...shared, uSea: { value: vector(GLOBE_SEA) } },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: SPHERE_FRAGMENT,
  });
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphere.position.copy(CENTRE);
  sphere.frustumCulled = false;
  group.add(sphere);

  const airGeometry = new THREE.SphereGeometry(EARTH_RADIUS_KM * 1.035, 96, 64);
  const airMaterial = new THREE.ShaderMaterial({
    uniforms: { ...shared, uOpacity: { value: 1 } },
    vertexShader: AIR_VERTEX,
    fragmentShader: AIR_FRAGMENT,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const air = new THREE.Mesh(airGeometry, airMaterial);
  air.position.copy(CENTRE);
  air.frustumCulled = false;
  group.add(air);

  let world: DotCloud | null = null;
  let europe: DotCloud | null = null;
  // Without the dots the globe is a plain dark sphere, which still works.
  const buffer = await dots;
  if (buffer) {
    const worldCount = new Int32Array(buffer, 0, 1)[0];
    // From orbit the dots are the picture, so they are bright. Next to the
    // model they are only its surroundings, so they are small and quiet.
    world = dotCloud(
      new Int16Array(buffer, 4, worldCount * 2),
      { radius: 27, day: GLOBE_LAND_DAY, night: GLOBE_LAND_NIGHT },
      shared,
      null,
    );
    europe = dotCloud(
      new Int16Array(buffer, 4 + worldCount * 4),
      { radius: 2.7, day: GLOBE_NEAR_DAY, night: GLOBE_NEAR_NIGHT },
      shared,
      place,
    );
    group.add(world, europe);
  }

  return {
    group,
    update(distance) {
      // From far away the coarse dots draw the continents. Closer in, the
      // fine dots take over and show the coasts around the North Sea.
      const far = smoothstep(1500, 3200, distance);
      if (world) {
        world.material.uniforms.uOpacity.value = far;
        world.visible = far > 0.01;
      }
      if (europe) {
        const near = 1 - far;
        europe.material.uniforms.uOpacity.value = near;
        europe.visible = near > 0.01;
      }
      // Up close the camera is inside the shell and the glow makes no sense.
      const airOpacity = smoothstep(1800, 5000, distance);
      airMaterial.uniforms.uOpacity.value = airOpacity;
      air.visible = airOpacity > 0.01;
    },
    dispose() {
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      airGeometry.dispose();
      airMaterial.dispose();
      for (const cloud of [world, europe]) {
        cloud?.geometry.dispose();
        cloud?.material.dispose();
      }
    },
  };
}
