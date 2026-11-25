import { sunPosition } from "../map/sun";

export type Daylight = {
  darkness: number;
  headlights: boolean;
  phase: "Daylight" | "Twilight" | "Night";
  localTime: string;
};

const timeInTheNetherlands = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function daylightAt(date: Date, [latitude, longitude]: [number, number]): Daylight {
  const { altitude } = sunPosition(date, latitude, longitude);
  const twilight = Math.max(0, Math.min(1, (1 - altitude) / 8));
  return {
    darkness: twilight * twilight * (3 - 2 * twilight),
    headlights: altitude <= -0.833,
    phase: altitude >= 1 ? "Daylight" : altitude > -7 ? "Twilight" : "Night",
    localTime: timeInTheNetherlands.format(date),
  };
}
