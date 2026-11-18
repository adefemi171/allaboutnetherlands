// Where the forms on the site send what visitors write: reports about
// mistakes, and sign-ups for the newsletter.
//
// Both open the visitor's mail program, addressed to the owner (see
// site.ts), with the message filled in. The site is static and cannot
// send email itself; the visitor presses send in their own mail program.
//
// .env can point either form somewhere else (see .env.example):
//
//   https://...   a form service that accepts a JSON POST, or
//   mailto:...    another email address.
//
// While developing, the forms post to the dev server, which writes to
// .cache/ (see astro.config.mjs), so trying them out opens no mail program.

import { owner } from "./site";

/** The owner's address, for mailto links and as the default for both forms. */
export const ownerMail = `mailto:${owner.email}`;

function endpoint(configured: string | undefined, local: string): string {
  const value = (configured ?? "").trim();
  if (/^(https:\/\/|mailto:)/i.test(value)) return value;
  return import.meta.env.DEV ? local : ownerMail;
}

export const reportEndpoint: string = endpoint(
  import.meta.env.PUBLIC_REPORT_ENDPOINT,
  "/api/report/",
);

export const newsletterEndpoint: string = endpoint(
  import.meta.env.PUBLIC_NEWSLETTER_ENDPOINT,
  "/api/subscribe/",
);
