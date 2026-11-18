// The search index: every guide and every named place on the map.

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { places } from "../data/places";
import { stages } from "../data/site";

const kinds = {
  city: "City",
  university: "University",
  landmark: "Landmark",
  water: "Water",
} as const;

export const GET: APIRoute = async () => {
  const guides = await getCollection("guides");
  const entries = [
    ...guides
      .sort((a, b) => a.data.order - b.data.order)
      .map((guide) => ({
        type: "guide",
        title: guide.data.title,
        also: "",
        detail: guide.data.summary,
        tag: `Guide · ${stages[guide.data.stage].label}`,
        url: `/guides/${guide.id}/`,
      })),
    ...places.map((place) => ({
      type: "place",
      title: place.name,
      also: place.english ?? "",
      detail: place.english ? `${place.english}. ${place.blurb}` : place.blurb,
      tag: kinds[place.kind],
      url: `/map/?place=${place.id}`,
      id: place.id,
    })),
  ];
  return new Response(JSON.stringify(entries), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
