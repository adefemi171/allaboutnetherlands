import { appendFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { driveRooms } from "./scripts/drive-rooms.mjs";
import { driveAreas, roadDataPath } from "./scripts/drive-area.mjs";

const driveBounds = Object.fromEntries(driveAreas.filter(({ modes }) => modes.includes("car")).map(({ id }) => {
  const file = new URL(`./${roadDataPath(id)}/corridor.json`, import.meta.url);
  return [id, JSON.parse(readFileSync(file, "utf8")).bounds];
}));

// Set POLL=1 where file watching does not work (containers, network drives,
// sandboxes). The dev server then checks files for changes on a timer.
const poll = process.env.POLL === "1";

/**
 * The forms need somewhere to send what visitors write (see
 * src/data/report.ts). While developing, that is this: the dev server
 * takes reports at /api/report and newsletter sign-ups at /api/subscribe,
 * and adds them to .cache/reports.jsonl and .cache/subscribers.jsonl, so
 * the forms can be tried without signing up for anything. The addresses
 * the forms use end in a slash, like every address on this site
 * (trailingSlash).
 */
function formInbox() {
  const inbox = (server, path, file, field) =>
      server.middlewares.use(path, (request, response) => {
        const reply = (status, body) => {
          response.statusCode = status;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(body));
        };
        if (request.method !== "POST") return reply(405, { ok: false, error: "POST only" });
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
          if (body.length > 20000) request.destroy();
        });
        request.on("end", async () => {
          try {
            const report = JSON.parse(body);
            if (typeof report[field] !== "string" || !report[field].trim()) {
              return reply(400, { ok: false, error: `No ${field}` });
            }
            await mkdir(".cache", { recursive: true });
            await appendFile(
              file,
              JSON.stringify({ received: new Date().toISOString(), ...report }) + "\n",
            );
            reply(200, { ok: true });
          } catch {
            reply(400, { ok: false, error: "Not JSON" });
          }
        });
      });
  return {
    name: "form-inbox",
    apply: "serve",
    configureServer(server) {
      inbox(server, "/api/report", ".cache/reports.jsonl", "message");
      inbox(server, "/api/subscribe", ".cache/subscribers.jsonl", "email");
    },
  };
}

/** Say where the forms of a build send what visitors write. */
function formCheck() {
  return {
    name: "form-check",
    hooks: {
      "astro:build:done": ({ logger }) => {
        const env = loadEnv("production", process.cwd(), "PUBLIC_");
        for (const [name, what] of [
          ["PUBLIC_REPORT_ENDPOINT", '"Report a problem"'],
          ["PUBLIC_NEWSLETTER_ENDPOINT", "the newsletter sign-up"],
        ]) {
          const value = (env[name] ?? "").trim();
          logger.info(
            /^(https:\/\/|mailto:)/i.test(value)
              ? `${what} goes to ${value}`
              : `${what} opens the visitor's mail program addressed to ` +
                  "the email in src/data/site.ts.",
          );
        }
      },
    },
  };
}

export default defineConfig({
  site: "https://allaboutnetherlands.nl",
  trailingSlash: "always",
  // The site has no framework components, so the toolbar has nothing to show
  // and only gets in the way of the map controls.
  devToolbar: { enabled: false },
  // Compression drops the space between a word and a link on the next source
  // line, which glues words together in running text.
  compressHTML: false,
  integrations: [formCheck()],
  vite: {
    plugins: [formInbox(), driveRooms(driveBounds)],
    // The workers are modules (satellite.js needs that to build).
    worker: { format: "es" },
    server: {
      watch: poll ? { usePolling: true, interval: 300 } : undefined,
    },
  },
});
