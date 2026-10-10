import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { chromium, type Page } from "playwright";
import { createTestHarness } from "wrangler";
import { expect } from "vitest";
import { apiDirectory, database, environment, run, type BookFixture } from "./fixtures";

export async function withWorkspaceBrowser(
  book: BookFixture,
  artifact: string,
  observe: (
    page: Page,
    workspace: string,
    signInAs: (actorId: string) => Promise<void>,
  ) => Promise<void>,
  options?: { existingSessionUser: boolean; additionalActors?: readonly string[] },
) {
  const email = `${book.actorId}@e2e.invalid`;
  const password = randomBytes(24).toString("hex");

  if (options?.existingSessionUser) {
    const admin = await database();
    const passwordHash = await hashPassword(password);

    try {
      for (const actorId of [book.actorId, ...(options.additionalActors ?? [])]) {
        await admin.query(
          "INSERT INTO openerp_auth.account(id,account_id,provider_id,user_id,password) VALUES($1,$2,'credential',$2,$3)",
          [randomBytes(16).toString("hex"), actorId, passwordHash],
        );
      }
    } finally {
      await admin.end();
    }
  } else {
    await run("bun", ["scripts/create-user.ts", book.actorId], {
      cwd: apiDirectory,
      env: {
        ...process.env,
        DATABASE_ADMIN_URL: environment().adminUrl,
        OPENERP_EMAIL: email,
        OPENERP_PASSWORD: password,
      },
    });
  }

  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No browser port allocated");
  const port = address.port;
  await new Promise<void>((done, reject) =>
    socket.close((error) => (error ? reject(error) : done())),
  );
  const url = `http://127.0.0.1:${port}`;

  const worker = createTestHarness({
    root: apiDirectory,
    workers: [
      {
        configPath: "wrangler.jsonc",
        env: "e2e",
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
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    browser = await chromium.launch();
    await expect
      .poll(
        async () => {
          if (web.exitCode !== null) throw new Error(webLog);

          return fetch(url).then(
            (response) => response.ok,
            () => false,
          );
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
    await page.goto(`${url}/companies`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText(book.bookName, { exact: true }).first().waitFor();

    const sessions = new Map([[book.actorId, await page.context().cookies()]]);

    const signInAs = async (actorId: string) => {
      if (![book.actorId, ...(options?.additionalActors ?? [])].includes(actorId))
        throw new Error("Actor is outside the synthetic browser fixture");

      let cookies = sessions.get(actorId);

      if (!cookies) {
        const actorContext = await page.context().browser()!.newContext();

        try {
          const response = await actorContext.request.post(`${url}/api/auth/sign-in/email`, {
            data: { email: `${actorId}@e2e.invalid`, password },
            headers: { origin: url },
          });

          if (!response.ok()) throw new Error(`Synthetic sign-in returned ${response.status()}`);

          cookies = await actorContext.cookies();
          sessions.set(actorId, cookies);
        } finally {
          await actorContext.close();
        }
      }

      await page.context().clearCookies();
      await page.context().addCookies(cookies);
    };

    try {
      await observe(page, `${url}/entities/${book.entityId}/books/${book.bookId}`, signInAs);
    } catch (error) {
      await page.screenshot({ path: join(environment().artifacts, `${artifact}-failure.png`) });
      await writeFile(
        join(environment().artifacts, `${artifact}-failure.txt`),
        await page.locator("body").innerText(),
      );
      throw error;
    }
  } finally {
    await browser?.close();
    await writeFile(join(environment().artifacts, `${artifact}-web.log`), webLog);

    if (web.pid && web.exitCode === null) {
      const exited = once(web, "exit");
      process.kill(-web.pid, "SIGTERM");
      await exited;
    }

    try {
      await worker.close();
    } finally {
      await writeFile(
        join(environment().artifacts, `${artifact}-worker.json`),
        JSON.stringify(worker.getLogs(), null, 2),
      );
    }
  }
}
