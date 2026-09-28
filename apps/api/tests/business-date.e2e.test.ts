import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createTestHarness } from "wrangler";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import { createDraft, supplierFixture } from "./support/supplier-review";
import { apiDirectory, database, environment, run } from "./support/fixtures";

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("No test port allocated");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );

  return address.port;
}

test("real overview crosses Stockholm midnight and supplier UI follows retained-history pages", async () => {
  const { book, content } = await supplierFixture();
  const setup = await database();

  try {
    await setup.query(
      "INSERT INTO openerp.fiscal_years(book_id,id,starts_on,ends_on) VALUES ($1,'fy_2027','2027-01-01','2027-12-31')",
      [book.bookId],
    );
    await setup.query(
      "INSERT INTO openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) VALUES ($1,'period_2027','fy_2027','2027-01-01','2027-12-31')",
      [book.bookId],
    );
  } finally {
    await setup.end();
  }

  const email = `${book.actorId}@e2e.invalid`;
  const password = randomBytes(24).toString("hex");
  await run("bun", ["scripts/create-user.ts", book.actorId], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: environment().adminUrl,
      OPENERP_EMAIL: email,
      OPENERP_PASSWORD: password,
    },
  });

  for (let ordinal = 0; ordinal < 201; ordinal += 1) {
    await createDraft(book, { ...content, title: `Browser supplier ${ordinal}` });
  }

  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;

  const worker = createTestHarness({
    root: apiDirectory,
    workers: [
      {
        configPath: "wrangler.jsonc",
        secrets: {
          DATABASE_URL: environment().runtimeUrl,
          BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
          BETTER_AUTH_URL: url,
        },
      },
    ],
  });

  const listening = await worker.listen();

  const web = spawn(
    "bun",
    [
      "run",
      "dev",
      "--config",
      "tests/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: resolve(apiDirectory, "../web"),
      env: { ...process.env, OPENERP_E2E_API_URL: listening.url.origin },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );

  let webLog = "";
  web.stdout.on("data", (chunk: Buffer) => {
    webLog += chunk.toString();
  });
  web.stderr.on("data", (chunk: Buffer) => {
    webLog += chunk.toString();
  });

  try {
    const browser = await chromium.launch();

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
    });

    const page = await context.newPage();
    const errors: string[] = [];
    const dates: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const requested = new URL(request.url());

      if (requested.pathname.endsWith("/bank-workspace"))
        dates.push(requested.searchParams.get("endsOn") ?? "");
    });

    try {
      await expect
        .poll(
          async () => {
            if (web.exitCode !== null) throw new Error(`Web exited: ${webLog}`);

            return fetch(url).then(
              (response) => response.ok,
              () => false,
            );
          },
          { timeout: 60000 },
        )
        .toBe(true);

      await page.goto(`${url}/companies`);
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByText("Synthetic E2E book", { exact: true }).first().waitFor();
      const workspace = `${url}/entities/${book.entityId}/books/${book.bookId}`;

      await page.clock.install({ time: new Date("2026-09-30T21:59:00Z") });
      await page.clock.pauseAt(new Date("2026-09-30T21:59:00Z"));
      await page.goto(`${workspace}/overview`);
      await page.clock.runFor(1000);
      await expect
        .poll(
          async () => {
            await page.clock.runFor(100);

            return dates.at(-1);
          },
          { timeout: 15000 },
        )
        .toBe("2026-09-30");
      await page.clock.runFor(61000);
      await expect
        .poll(async () => {
          await page.clock.runFor(100);

          return dates.at(-1);
        })
        .toBe("2026-10-01");
      await page.screenshot({
        path: join(environment().artifacts, "stockholm-midnight-desktop.png"),
        fullPage: true,
      });

      const vectors = [
        { instant: "2026-12-31T23:30:00Z", expected: "2027-01-01" },
        { instant: "2026-01-31T23:30:00Z", expected: "2026-02-01" },
        { instant: "2026-06-30T22:30:00Z", expected: "2026-07-01" },
        { instant: "2026-03-29T01:30:00Z", expected: "2026-03-29" },
        { instant: "2026-10-25T01:30:00Z", expected: "2026-10-25" },
      ];

      const admin = await database();

      try {
        for (const vector of vectors) {
          const sql = await admin.query<{ day: string }>(
            "SELECT ($1::timestamptz AT TIME ZONE 'Europe/Stockholm')::date::text AS day",
            [vector.instant],
          );

          expect(sql.rows[0]?.day).toBe(vector.expected);
          expect(Accounting.swedishBusinessDate(new Date(vector.instant))).toBe(vector.expected);
          await page.clock.setSystemTime(new Date(vector.instant));
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect
            .poll(async () => {
              await page.clock.runFor(100);

              return dates.at(-1);
            })
            .toBe(vector.expected);
        }
      } finally {
        await admin.end();
      }

      // Advance wall time without running timers: focus must repair a suspended tab.
      await page.clock.setSystemTime(new Date("2026-12-31T23:30:00Z"));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect
        .poll(async () => {
          await page.clock.runFor(100);

          return dates.at(-1);
        })
        .toBe("2027-01-01");
      await page.clock.setSystemTime(new Date("2026-06-30T22:30:00Z"));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect
        .poll(async () => {
          await page.clock.runFor(100);

          return dates.at(-1);
        })
        .toBe("2026-07-01");

      await page.clock.resume();
      await page.goto(`${workspace}/purchases?view=supplier-drafts`);
      const more = page.getByRole("button", { name: "Load more drafts", exact: true });
      await more.waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await more.click();
      await expect.poll(() => more.count()).toBe(0);
      await page.getByLabel("Search invoice drafts", { exact: true }).fill("Browser supplier 200");
      await page.getByText("Browser supplier 200", { exact: true }).waitFor();
      await page.screenshot({
        path: join(environment().artifacts, "supplier-search-mobile.png"),
        fullPage: true,
      });
      expect(errors).toEqual([]);
      await writeFile(
        join(environment().artifacts, "business-date-browser.json"),
        JSON.stringify(
          {
            browserTimezone: "America/Los_Angeles",
            dates,
            vectors,
            midnightWithoutReload: true,
            focusAndVisibilityRefresh: true,
            retainedDrafts: 201,
            loadMore: true,
            search: "Browser supplier 200",
            errors,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await writeFile(
        join(environment().artifacts, "business-date-failure.json"),
        JSON.stringify(
          {
            url: page.url(),
            body: await page.locator("body").innerText(),
            dates,
            errors,
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await writeFile(join(environment().artifacts, "business-date-web.log"), webLog);
      await browser.close();
    }
  } finally {
    if (web.pid && web.exitCode === null) {
      const exited = once(web, "exit");
      process.kill(-web.pid, "SIGTERM");
      await exited;
    }

    await worker.close();
  }
}, 180000);
