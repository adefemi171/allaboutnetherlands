export const site = {
  name: "All About Netherlands",
  description:
    "Plain-language guides to Dutch paperwork, housing and money for people moving to the Netherlands, with a 3D map of the country built from open data.",
};

/** The three parts of a move. Guides are grouped and ordered by these. */
export const stages = {
  plan: { label: "Plan", hint: "Before you move" },
  arrive: { label: "Arrive", hint: "Your first weeks" },
  settle: { label: "Settle", hint: "Once you are registered" },
} as const;

export type Stage = keyof typeof stages;

/** Who makes the site, and where to write to them. */
export const owner = {
  name: "Runeward Labs",
  email: "adefemi@runeward.io",
};

/** Other sites by the same maker, shown at the foot of every page. */
export const alsoBy = [
  {
    href: "https://compears.shop/",
    name: "Compear",
    what: "compare supermarket prices",
  },
];

export const nav = [
  { href: "/guides/", label: "Guides" },
  { href: "/map/", label: "Map" },
  { href: "/satellite/", label: "Satellite" },
  { href: "/about/", label: "About" },
];

/** Pages that are linked from the foot of every page only. */
export const footerNav = [
  { href: "/newsletter/", label: "Newsletter" },
  { href: "/contact/", label: "Contact" },
];
