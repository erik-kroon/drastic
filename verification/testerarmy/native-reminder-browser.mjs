import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const dependency = createRequire(createRequire(import.meta.url).resolve("@e2e-dev/web"));

const { chromium } = dependency("playwright-core");

export function nativeReminderBrowser() {
  const browsers = new Map();

  return {
    name: "dedicated-native-reminder-zoom",
    scope: "attempt",
    async acquire(request) {
      const target = new URL(request.env.OPENERP_E2E_APP_URL ?? "http://invalid.test");

      if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port)
        throw new Error("Native reminder browser requires the allocated synthetic loopback app");

      request.signal.throwIfAborted();

      if (!request.env.OPENERP_E2E_OUTPUT)
        throw new Error("Missing allocated synthetic artifact directory");

      const output = resolve(request.env.OPENERP_E2E_OUTPUT);
      const profile = await mkdtemp(join(output, "native-reminder-profile-"));

      const preferences = JSON.stringify({
        partition: {
          per_host_zoom_levels: { x: { "127.0.0.1": { zoom_level: Math.log(2) / Math.log(1.2) } } },
        },
      });

      let context;

      try {
        await mkdir(join(profile, "Default"));
        await writeFile(join(profile, "Default/Preferences"), preferences, { mode: 0o600 });
        context = await chromium.launchPersistentContext(profile, {
          headless: false,
          viewport: { width: 1440, height: 900 },
          locale: "sv-SE",
          timezoneId: "Europe/Stockholm",
          args: ["--remote-debugging-port=0"],
          timeout: 15000,
        });
        request.signal.throwIfAborted();

        const port = Number(
          (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0],
        );

        if (!Number.isInteger(port) || port <= 0 || port > 65535)
          throw new Error("Invalid dedicated browser CDP port");

        browsers.set(profile, context);
        await writeFile(
          join(output, "native-reminder-browser.json"),
          JSON.stringify(
            {
              browser: "locked TesterArmy Chromium",
              origin: target.origin,
              preference: "partition.per_host_zoom_levels.x.127.0.0.1",
              factor: 2,
              preferencesSha256: createHash("sha256").update(preferences).digest("hex"),
              isolation: "fresh disposable profile",
              viewport: { width: 1440, height: 900 },
            },
            null,
            2,
          ),
        );

        request.signal.throwIfAborted();

        return { id: profile, cdpEndpoint: `http://127.0.0.1:${port}` };
      } catch (error) {
        try {
          await context?.close();
        } finally {
          browsers.delete(profile);
          await rm(profile, { recursive: true, force: true });
        }

        throw error;
      }
    },
    async release(lease) {
      const context = browsers.get(lease.id);

      if (!context) throw new Error("Native reminder browser lease is not owned");

      try {
        await context.close();
      } finally {
        browsers.delete(lease.id);
        await rm(lease.id, { recursive: true, force: true });
      }
    },
  };
}
