// Visual parity gate: renders each manifest route in the disposable synthetic runtime at the
// design viewport and compares it with the exported Paper frame. A screen is not "done" until
// this passes for it. Failure cases written first: a missing session file, a baseline that is
// not a PNG, a viewport that differs from the baseline size, a route that redirects to sign-in,
// and a diff above the entry's maxDiffRatio must all fail with a non-zero exit code.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "../..");

const { chromium } = createRequire(join(root, "apps/api/package.json"))("playwright");

const sessionFile = resolve(process.argv[2] ?? "");

if (
  basename(sessionFile) !== "session.json" ||
  !basename(dirname(sessionFile)).startsWith("openerp-paper-")
)
  throw new Error("Use the private session file produced by the Paper launcher");

const session = JSON.parse(await readFile(sessionFile, "utf8"));

const manifest = JSON.parse(
  await readFile(
    process.env.PARITY_MANIFEST ?? join(import.meta.dirname, "parity-manifest.json"),
    "utf8",
  ),
);

const only = process.argv[3];

const out = resolve(process.env.PARITY_OUT ?? join(root, "test-results/paper/parity"));

await mkdir(out, { recursive: true });

const browser = await chromium.launch();

const context = await browser.newContext({
  viewport: manifest.viewport,
  deviceScaleFactor: 1,
  locale: "sv-SE",
  colorScheme: "light",
  reducedMotion: "reduce",
});

let page = await context.newPage();

await page.goto(session.url);

await page.getByLabel(/e-post|email/i).fill(session.email);

await page.getByLabel(/lösenord|password/i).fill(session.password);

await page.getByRole("button", { name: /logga in|sign in/i }).click();

await page.getByLabel(/lösenord|password/i).waitFor({ state: "detached", timeout: 20000 });

const results = [];

const fixturePages = new Map([["main", page]]);

const milestones = [0.05, 0.025, 0.01];

for (const entry of manifest.entries.filter((item) => !only || item.frame.startsWith(only))) {
  try {
    let entrySession = session;

    if (entry.fixture) {
      if (
        ![
          "vouchers",
          "onboarding-history",
          "onboarding-verification",
          "onboarding-delta",
          "onboarding-review",
          "onboarding-pending",
          "onboarding-cutover",
        ].includes(entry.fixture)
      )
        throw new Error("Unknown parity fixture");
      entrySession = JSON.parse(
        await readFile(
          join(dirname(sessionFile), `openerp-paper-${entry.fixture}/session.json`),
          "utf8",
        ),
      );
      const fixtureOrigin = new URL(entrySession.url);

      if (
        fixtureOrigin.protocol !== "http:" ||
        fixtureOrigin.hostname !== "127.0.0.1" ||
        new URL(entrySession.workspace).origin !== fixtureOrigin.origin
      )
        throw new Error("Parity fixture origin mismatch");

      if (!fixturePages.has(entry.fixture)) {
        const fixtureContext = await browser.newContext({
          viewport: manifest.viewport,
          deviceScaleFactor: 1,
          locale: "sv-SE",
          colorScheme: "light",
          reducedMotion: "reduce",
        });

        const fixturePage = await fixtureContext.newPage();
        await fixturePage.goto(entrySession.url);
        await fixturePage.getByLabel(/e-post|email/i).fill(entrySession.email);
        await fixturePage.getByLabel(/lösenord|password/i).fill(entrySession.password);
        await fixturePage.getByRole("button", { name: /logga in|sign in/i }).click();
        await fixturePage
          .getByLabel(/lösenord|password/i)
          .waitFor({ state: "detached", timeout: 20000 });
        fixturePages.set(entry.fixture, fixturePage);
      }
    }

    page = fixturePages.get(entry.fixture ?? "main");
    await page.goto(`${entrySession.workspace}${entry.path}`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);

    if (entry.selectText) {
      const target = page.getByRole("button", { name: entry.selectText });

      if (entry.selectIndex !== undefined) {
        if (!Number.isInteger(entry.selectIndex) || entry.selectIndex < 0)
          throw new Error("Selection index must be a nonnegative integer");

        await target.nth(entry.selectIndex).click();
      } else {
        await target.click();
      }

      await page
        .getByRole("heading", { name: entry.headingText ?? entry.selectText, exact: true })
        .waitFor();
      await page.waitForLoadState("networkidle");
    }

    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('[role="status"]')].some((element) =>
          element.textContent.includes("Begäran pågår"),
        ),
    );

    if (await page.getByLabel(/lösenord|password/i).count())
      throw new Error(`${entry.frame}: showing the sign-in form, not the screen`);

    if (
      entry.headingText &&
      !entry.selectText &&
      !(await page.getByRole("heading", { name: entry.headingText, exact: true }).isVisible())
    ) {
      results.push({
        frame: entry.frame,
        fixture: entry.fixture ?? "main",
        pass: false,
        error: "Required Paper screen heading is not visible",
      });
      continue;
    }

    const requiredTexts = [
      ...(entry.requiredTexts ?? []),
      ...(entry.requiredText ? [entry.requiredText] : []),
    ];

    let missingFixtureState = false;

    for (const required of requiredTexts) {
      if (!(await page.getByText(required, { exact: true }).first().isVisible())) {
        missingFixtureState = true;
        break;
      }
    }

    if (missingFixtureState) {
      results.push({
        frame: entry.frame,
        fixture: entry.fixture ?? "main",
        pass: false,
        error: "Required Paper fixture state is not visible",
      });
      continue;
    }

    const clip = entry.clip;
    const shot = { animations: "disabled" };

    if (clip) shot.clip = clip;

    const actual = await page.screenshot(shot);
    const expected = await readFile(join(import.meta.dirname, "baseline", entry.baseline));
    const slug = entry.frame.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await writeFile(join(out, `${slug}.actual.png`), actual);

    const verdict = await page.evaluate(
      async ({ a, e, tolerance, clip }) => {
        const load = (b64) =>
          new Promise((done, fail) => {
            const img = new Image();
            img.onload = () => done(img);
            img.onerror = () => fail(new Error("not a PNG"));
            img.src = `data:image/png;base64,${b64}`;
          });

        const [ia, ie] = await Promise.all([load(a), load(e)]);

        const crop = clip ?? { x: 0, y: 0, width: ie.width, height: ie.height };

        if (ia.width !== crop.width || ia.height !== crop.height)
          return {
            error: `size ${ia.width}x${ia.height} differs from baseline ${crop.width}x${crop.height}`,
          };

        const draw = (img, origin) => {
          const c = document.createElement("canvas");
          c.width = crop.width;
          c.height = crop.height;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(img, -origin.x, -origin.y);

          return g.getImageData(0, 0, c.width, c.height);
        };

        const da = draw(ia, { x: 0, y: 0 });
        const de = draw(ie, crop);
        const diff = new ImageData(ia.width, ia.height);
        let bad = 0;
        const cells = new Map();

        for (let i = 0; i < da.data.length; i += 4) {
          const d = Math.max(
            Math.abs(da.data[i] - de.data[i]),
            Math.abs(da.data[i + 1] - de.data[i + 1]),
            Math.abs(da.data[i + 2] - de.data[i + 2]),
          );

          const hit = d > tolerance;

          if (hit) {
            bad++;

            const pixel = i / 4;
            const key = `x${Math.floor(((pixel % ia.width) / ia.width) * 12) * 120},y${Math.floor(Math.floor(pixel / ia.width) / 100) * 100}`;
            cells.set(key, (cells.get(key) ?? 0) + 1);
          }

          diff.data[i] = hit ? 220 : de.data[i];
          diff.data[i + 1] = hit ? 30 : de.data[i + 1];
          diff.data[i + 2] = hit ? 30 : de.data[i + 2];
          diff.data[i + 3] = hit ? 255 : 90;
        }

        const c = document.createElement("canvas");
        c.width = ia.width;
        c.height = ia.height;
        c.getContext("2d").putImageData(diff, 0, 0);

        return {
          ratio: bad / (ia.width * ia.height),
          hotspots: [...cells.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8),
          diff: c.toDataURL("image/png").split(",")[1],
        };
      },
      {
        a: actual.toString("base64"),
        e: expected.toString("base64"),
        tolerance: manifest.pixelTolerance,
        clip,
      },
    );

    if (verdict.error) {
      results.push({
        frame: entry.frame,
        fixture: entry.fixture ?? "main",
        pass: false,
        error: verdict.error,
      });
      continue;
    }

    await writeFile(join(out, `${slug}.diff.png`), Buffer.from(verdict.diff, "base64"));
    results.push({
      frame: entry.frame,
      fixture: entry.fixture ?? "main",
      pass: verdict.ratio <= entry.maxDiffRatio,
      diffRatio: Number(verdict.ratio.toFixed(4)),
      maxDiffRatio: entry.maxDiffRatio,
      milestones: milestones.map((maxDiffRatio) => ({
        maxDiffRatio,
        pass: verdict.ratio < maxDiffRatio,
      })),
      hotspots: verdict.hotspots,
    });
  } catch (error) {
    results.push({
      frame: entry.frame,
      fixture: entry.fixture ?? "main",
      pass: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await browser.close();

await writeFile(
  join(out, "report.json"),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      viewport: manifest.viewport,
      pixelTolerance: manifest.pixelTolerance,
      rendering: {
        browser: "chromium",
        deviceScaleFactor: 1,
        locale: "sv-SE",
        colorScheme: "light",
        reducedMotion: "reduce",
      },
      milestones: milestones.map((maxDiffRatio) => ({
        maxDiffRatio,
        passed: results.filter((result) =>
          result.milestones?.some((stage) => stage.maxDiffRatio === maxDiffRatio && stage.pass),
        ).length,
        total: results.length,
      })),
      results,
    },
    null,
    2,
  ),
);

console.table(
  results.map((result) => ({
    frame: result.frame,
    pass: result.pass,
    diffRatio: result.diffRatio,
    maxDiffRatio: result.maxDiffRatio,
    error: result.error,
  })),
);

if (results.some((result) => !result.pass)) process.exit(1);
