import * as T from "three";
import { daylightAt } from "./daylight";
import type { Point } from "./data";
import type { RoadPose } from "./vehicle-contact";

const daySky = new T.Color("#c4dce9");
const nightSky = new T.Color("#111d32");
const dayAmbient = new T.Color("#e1edff");
const nightAmbient = new T.Color("#9abdea");
const dayBounce = new T.Color("#b2a17c");
const nightBounce = new T.Color("#67758e");
const sunlight = new T.Color("#fff2d7");
const moonlight = new T.Color("#a9c6f0");

export function vehicleLamps() {
  return {
    front: new T.MeshStandardMaterial({ color: "#ffefcf", emissive: "#fff0ce", emissiveIntensity: 0, roughness: 0.46 }),
    rear: new T.MeshStandardMaterial({ color: "#bf362c", emissive: "#ff2418", emissiveIntensity: 0, roughness: 0.48 }),
  };
}

export type VehicleLamps = ReturnType<typeof vehicleLamps>;

export class RoadLighting {
  readonly lamps = vehicleLamps();
  readonly darkness = { value: 0 };
  private readonly sky = new T.Color();
  private readonly fog = new T.Fog(daySky, 200, 780);
  private readonly ambient = new T.HemisphereLight();
  private readonly sun = new T.DirectionalLight();
  private readonly beams = Array.from({ length: 4 }, (_, i) =>
    new T.SpotLight("#fff4de", 0, i < 2 ? 54 : 38, i < 2 ? 0.26 : 0.33, 0.77, 2));
  private minute = -1;
  private daylight;

  constructor(scene: T.Scene, private readonly location: [number, number]) {
    this.daylight = daylightAt(new Date(), location);
    scene.background = this.sky;
    scene.fog = this.fog;
    this.sun.position.set(-100, 210, 135);
    scene.add(this.ambient, this.sun);
    for (const beam of this.beams) scene.add(beam, beam.target);
    this.refresh();
  }

  get state() { return this.daylight; }

  refresh(now = Date.now()): void {
    const minute = Math.floor(now / 60_000);
    if (minute === this.minute) return;
    this.minute = minute;
    this.daylight = daylightAt(new Date(now), this.location);
    const { darkness, headlights } = this.daylight;
    this.darkness.value = darkness;
    this.sky.copy(daySky).lerp(nightSky, darkness);
    this.fog.color.copy(this.sky);
    this.fog.near = T.MathUtils.lerp(200, 110, darkness);
    this.fog.far = T.MathUtils.lerp(780, 620, darkness);
    this.ambient.color.copy(dayAmbient).lerp(nightAmbient, darkness);
    this.ambient.groundColor.copy(dayBounce).lerp(nightBounce, darkness);
    this.ambient.intensity = T.MathUtils.lerp(2.05, 0.8, darkness);
    this.sun.color.copy(sunlight).lerp(moonlight, darkness);
    this.sun.intensity = T.MathUtils.lerp(2.05, 0.26, darkness);
    this.lamps.front.emissiveIntensity = headlights ? 2 : 0;
    this.lamps.rear.emissiveIntensity = headlights ? 1.35 : 0;
  }

  surface(parameters: T.MeshLambertMaterialParameters, aerial = false): T.MeshLambertMaterial {
    const material = new T.MeshLambertMaterial(parameters);
    material.customProgramCacheKey = () => aerial ? "drive-aerial-lighting" : "drive-surface-lighting";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.nightMix = this.darkness;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float nightMix;")
        .replace("#include <opaque_fragment>",
          "outgoingLight = mix(diffuseColor.rgb, outgoingLight, nightMix);\n#include <opaque_fragment>");
      if (aerial) {
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
          if (any(lessThan(vMapUv, vec2(0.0))) || any(greaterThan(vMapUv, vec2(1.0)))) discard;
          vec3 ortho = texture2D(map, vMapUv).rgb;
          vec2 grainCell = floor(vMapUv * 12400.0);
          float grain = fract(sin(dot(grainCell, vec2(14.33, 73.97))) * 9175.45) - 0.5;
          float detail = 1.0 - smoothstep(0.25, 0.9, length(fwidth(vMapUv)) * 12400.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, ortho, 0.88) * (1.0 + 0.12 * grain * detail);
        `);
      }
    };
    return material;
  }

  headlamps(player: RoadPose | null, cars: readonly RoadPose[], [x, z]: Point): void {
    const nearby = this.daylight.headlights ? cars.map((car) => ({
      car, distance: (car.point[0] - x) ** 2 + (car.point[1] - z) ** 2,
    })).filter((entry) => entry.distance < 51 ** 2).sort((a, b) => a.distance - b.distance) : [];
    for (const [i, beam] of this.beams.entries()) {
      const pose = this.daylight.headlights ? (i < 2 ? player : nearby[i - 2]?.car) : null;
      beam.intensity = pose ? (i < 2 ? 780 : 440) : 0;
      if (!pose) continue;
      const dx = Math.sin(pose.angle), dz = Math.cos(pose.angle);
      const [px, pz] = pose.point;
      const side = i === 0 ? -0.68 : i === 1 ? 0.68 : 0;
      beam.position.set(px + dz * side + dx * 2.12, 0.94, pz - dx * side + dz * 2.12);
      beam.target.position.set(px + dz * side * 1.6 + dx * 22, 0.07, pz - dx * side * 1.6 + dz * 22);
    }
  }
}
