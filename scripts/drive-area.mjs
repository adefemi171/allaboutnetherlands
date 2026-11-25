import { resolve } from "node:path";
import { readFileSync } from "node:fs";

export const driveAreas = JSON.parse(readFileSync(new URL("../src/drive/areas.json", import.meta.url), "utf8"));
const settings = {
  utrecht: {
    origin: [489, 520],
    columns: [
      [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3, 4], [1, 2, 3, 4, 5],
      [2, 3, 4, 5, 6], [3, 4, 5, 6, 7], [3, 4, 5, 6, 7], [4, 5, 6, 7], [4, 5, 6, 7],
    ],
    stations: [[52.0786, 5.1225], [52.0630, 5.1439], [52.0344, 5.1675]],
    municipalities: ["GM0344", "GM0321", "GM0312"],
    roadStart: { car: { point: [1625, 1567.5], radius: 7 }, bike: { point: [1643, 1617], radius: 16 } },
    residential: [
      ["Westerkade", 3, [1624, 1544]], ["Oosterkade", 3], ["Wulpstraat", 2], ["Gansstraat", 2],
      ["Hoogravenseweg", 3], ["Apennijnen", 2], ["Karpaten", 2], ["Oud-Wulvenplantsoen", 2],
      ["Lobbendijk", 3], ["Standerdmolen", 3], ["Randhoeve", 3],
    ],
  },
  amsterdam: {
    origin: [474, 484],
    columns: [[0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [3, 4, 5]],
    stations: [[52.3606, 4.9313], [52.3528, 4.9484], [52.3456, 4.9679]],
    municipalities: ["GM0363", "GM0384"],
    roadStart: { car: { point: [1705.4, 1069.3], radius: 6 }, bike: { point: [1717.7, 1084.65], radius: 9 } },
    stopDetails: [
      "The station sits between the Dapperbuurt and the Indische Buurt, where the railway branches.",
      "The station at Kruislaan serves the science campus in Watergraafsmeer.",
      "The station sits beside the Ouddiemerlaan underpass and the green route to Spoorzicht.",
    ],
    landmarks: [
      ["flevopark", "Flevopark", 52.3625, 4.9507, "A park at the eastern edge of the Indische Buurt, beside the Nieuwe Diep."],
      ["frankendael", "Park Frankendael", 52.3499, 4.9325, "The Watergraafsmeer park surrounds the historic Frankendael estate."],
    ],
    residential: [
      ["Celebesstraat", 3], ["Lombokstraat", 3], ["Sumatrastraat", 3],
      ["Hogeweg", 3], ["Copernicusstraat", 3], ["Linnaeuskade", 3],
      ["Landbouwstraat", 3], ["Akkerstraat", 3], ["Prins Bernhardlaan", 3], ["Ouddiemerlaan", 3],
    ],
  },
  scheveningen: {
    origin: [422, 516],
    columns: [[0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1]],
    stations: [[52.0968, 4.2704], [52.1044, 4.2725], [52.11245, 4.28185]],
    municipalities: ["GM0518"],
    roadRadius: 150,
    roadStart: { car: { point: [901.85, 2465.82], radius: 6 } },
    carReturnEnd: { point: [892.78, 2462.39], radius: 7 },
    roundabouts: [{ center: [1047.5, 2138.5], radius: 15.6 }],
    // Side-street mouths separated from Westduinweg's centreline by its cycle lanes.
    walkingCrossingProbes: [
      [[927.2, 2428.5], [931.73, 2426.62]], // Tarbotstraat cycle lane
      [[935.8, 2420.17], [935.8, 2427.88]], // Tarbotstraat
      [[986.98, 2326.43], [997, 2322.28]], // Oesterstraat cycle lane
      [[993.61, 2327.76], [996.15, 2321.61]], // Oesterstraat
      [[1008.63, 2293.1], [1012.48, 2293.1]], // Schelvisstraat cycle lane
      [[1014.68, 2293.1], [1017.09, 2287.28]], // Schelvisstraat
    ],
    stopDetails: [
      "Fishing boats and the fish auction share the Eerste Haven waterfront.",
      "Keizerstraat runs through the old fishing village toward the beach.",
      "The Kurhaus stands between Gevers Deynootplein and the seafront promenade.",
    ],
    residential: [
      ["Kompasstraat", 3], ["Kistenstraat", 3], ["Werfstraat", 3], ["Pansierstraat", 3],
      ["Maaswijkstraat", 3], ["Haringkade", 3], ["Neptunusstraat", 3],
    ],
  },
};

export function roadDataPath(id) {
  return id === "utrecht" ? "public/data/drive" : `public/data/drive/${id}`;
}

export function buildArea(id = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "utrecht") {
  const item = driveAreas.find((area) => area.id === id);
  if (!item) throw new Error(`Unknown Drive & Ride area: ${id}`);
  const { columns, stations, ...rest } = settings[id];
  return {
    ...item, ...rest,
    target: resolve(roadDataPath(id)),
    tiles: columns.flatMap((values, row) => values.map((col) => [col, row])),
    stationSeeds: stations.map((point, i) => [item.stops[i], ...point]),
    cache: (path) => path && (id === "utrecht" ? path : resolve(path, id)),
  };
}
