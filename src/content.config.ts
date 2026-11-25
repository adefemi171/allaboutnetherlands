import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/**
 * Guides are the core of the site. One Markdown file per guide in
 * src/content/guides. The file name is the URL slug.
 */
const guides = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string(),
    /** One sentence. Shown on cards and as the meta description. */
    summary: z.string().max(180),
    /** Where the guide sits in a typical move. */
    stage: z.enum(["plan", "arrive", "settle"]),
    /** Position in the checklist. Lower comes first. */
    order: z.number(),
    supplemental: z.boolean().default(false),
    /** Id of a place in src/data/places.ts, to pin the guide on the map. */
    place: z.string().optional(),
    updated: z.coerce.date(),
    /** Short label/value pairs shown in a box at the top of the guide. */
    keyFacts: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .default([]),
    /** Official pages the guide is based on. */
    sources: z
      .array(z.object({ title: z.string(), url: z.url() }))
      .default([]),
    /** Claims that still need checking against an official source. */
    needsCheck: z.array(z.string()).default([]),
  }),
});

export const collections = { guides };
