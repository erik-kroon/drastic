import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve, join, basename, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// No runtime is launched here: start.mjs owns the persistent synthetic stack.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

process.chdir(root);

const require = createRequire(import.meta.resolve("e2e"));

const { chromium } = require("playwright");

const { PNG } = require("pngjs");

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

const json = (path) => JSON.parse(readFileSync(path, "utf8"));

const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      theme: { type: "string", default: "light" },
      zoom: { type: "string", default: "1" },
      width: { type: "string" },
      height: { type: "string" },
      pane: { type: "string" },
      select: { type: "string" },
      output: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    console.log(
      "Usage: node verification/paper/capture.mjs K-xx [--theme light|dark] [--zoom 2] [--width 1440] [--height 900] [--pane original|decision] [--select exact-text] [--output directory]\nSession: PAPER_SESSION_FILE or ${PAPER_ARTIFACTS:-test-results/paper}/runtime.json {sessionFile}. Optional session.boards[K-xx]: {route, state, readyText, selectText, buttonClicks}. Zoom is CSS layout zoom, NOT native browser zoom.",
    );

    return;
  }

  if (positionals.length !== 1 || !/^K-\d{2}$/.test(positionals[0]))
    throw new Error("Supply exactly one K-xx board ID (see --help)");

  const entry = json("verification/paper/kanon-manifest.json").entries.find(
    (candidate) => candidate.id === positionals[0],
  );

  if (!entry) throw new Error("Unknown board ID");

  if (!["light", "dark"].includes(values.theme)) throw new Error("Theme must be light or dark");
  const zoom = Number(values.zoom);

  const viewport = {
    width: Number(values.width ?? entry.viewport.width),
    height: Number(values.height ?? entry.viewport.height),
  };

  if (!Number.isFinite(zoom) || zoom < 0.25 || zoom > 4)
    throw new Error("Zoom must be between 0.25 and 4");

  if (Object.values(viewport).some((n) => !Number.isInteger(n) || n < 320 || n > 5000))
    throw new Error("Dimensions must be integers between 320 and 5000");
  const artifacts = resolve(process.env.PAPER_ARTIFACTS ?? "test-results/paper");
  const runtimePath = join(artifacts, "runtime.json");
  const runtime = existsSync(runtimePath) ? json(runtimePath) : {};
  const sessionFile = process.env.PAPER_SESSION_FILE ?? runtime.sessionFile;

  if (!sessionFile)
    throw new Error("No ready runtime: set PAPER_SESSION_FILE or write runtime.json {sessionFile}");

  if (
    basename(sessionFile) !== "session.json" ||
    !basename(dirname(sessionFile)).startsWith("openerp-paper-")
  )
    throw new Error("Only start.mjs disposable synthetic sessions are supported");
  const session = json(sessionFile);
  const origin = new URL(session.url);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    session.workspace !== `${origin.origin}/entities/entity_synthetic/books/book_synthetic`
  )
    throw new Error("Session is not the isolated synthetic runtime");
  const board = session.boards?.[entry.id] ?? runtime.boards?.[entry.id];

  const route =
    board?.route ??
    entry.route?.replace("$entityId", "entity_synthetic").replace("$bookId", "book_synthetic");

  if (!route || route.includes("$"))
    throw new Error(
      "Board needs a resolved session.boards route/state; no candidate route is silently adopted",
    );
  const target = new URL(route, session.url);

  if (target.origin !== origin.origin)
    throw new Error("Board route must remain inside the synthetic runtime");

  const sourceHashes = Object.fromEntries(
    entry.files.map((file) => [file, hash(readFileSync(file))]),
  );

  // Read the stored board JSX as provenance, never render it instead of the application.
  const jsxHash = hash(readFileSync(entry.jsx));

  if (jsxHash !== entry.jsxSha256) throw new Error("Stored board JSX changed");

  const defaultRendering =
    zoom === 1 &&
    values.theme === "light" &&
    viewport.width === entry.viewport.width &&
    viewport.height === entry.viewport.height;

  const output = resolve(
    values.output ??
      (defaultRendering
        ? join(artifacts, entry.id)
        : join(
            artifacts,
            entry.id,
            `${values.theme}-${viewport.width}x${viewport.height}-zoom${zoom}-${values.pane ?? "default"}`,
          )),
  );

  const browser = await chromium.launch({ headless: true });
  let capture;

  try {
    const stateFile = join(dirname(sessionFile), "browser-state.json");
    const retainedSession = existsSync(stateFile);

    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      locale: "sv-SE",
      colorScheme: values.theme,
      storageState: retainedSession ? stateFile : undefined,
    });

    if (!retainedSession) {
      const login = await context.request.post(`${session.url}/api/auth/sign-in/email`, {
        headers: { origin: session.url },
        data: { email: session.email, password: session.password },
        timeout: 15000,
      });

      if (!login.ok() || !(await context.cookies()).length)
        throw new Error(`Synthetic sign-in failed: HTTP ${login.status()}`);
      writeFileSync(stateFile, JSON.stringify(await context.storageState()), { mode: 0o600 });
    }

    await context.addInitScript(
      (theme) => localStorage.setItem("drastic.theme", theme),
      values.theme,
    );
    const page = await context.newPage();
    await page.goto(target.href, { waitUntil: "networkidle", timeout: 60000 });

    const reached = new URL(page.url());

    if (
      reached.origin !== target.origin ||
      reached.pathname.replace(/\/$/, "") !== target.pathname.replace(/\/$/, "") ||
      reached.search !== target.search
    )
      throw new Error("Route redirected; requested board state was not reached");

    const selection = values.select ?? board?.selectText;

    if (selection) await page.getByText(selection, { exact: true }).click();

    for (const name of board?.buttonClicks ?? [])
      await page.getByRole("button", { name, exact: true }).first().click();

    if (board?.readyText) await page.getByText(board.readyText, { exact: true }).waitFor();
    await page.evaluate((factor) => {
      document.documentElement.style.zoom = String(factor);
    }, zoom);

    if (values.pane) {
      if (!["original", "decision"].includes(values.pane))
        throw new Error("Pane must be original or decision");
      await page
        .getByRole("button", {
          name: values.pane === "original" ? "Original" : "Beslut",
          exact: true,
        })
        .click();
    }

    await page.waitForLoadState("networkidle", { timeout: 30000 });

    // PDF decoding/rendering can still be active after network-idle.
    // A hidden decision-pane original is intentionally not part of that capture.
    if (values.pane !== "decision")
      await page
        .getByText(/^(Visar sidan…|Rendering page…)$/)
        .waitFor({ state: "hidden", timeout: 30000 });

    const rendering = await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images, (image) => image.decode().catch(() => undefined)),
      );
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

      return {
        browser: navigator.userAgent,
        fonts: {
          family: getComputedStyle(document.body).fontFamily,
          faces: Array.from(document.fonts, (font) => ({
            family: font.family,
            status: font.status,
            weight: font.weight,
          })),
        },
        dark: document.documentElement.classList.contains("dark"),
      };
    });

    if (rendering.dark !== (values.theme === "dark"))
      throw new Error("Application theme did not settle");
    mkdirSync(output, { recursive: true });
    await page.screenshot({
      path: join(output, "actual.png"),
      fullPage: false,
      animations: "disabled",
      scale: "css",
    });
    capture = {
      actual: relative(root, join(output, "actual.png")),
      command: process.argv.join(" "),
      sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      sourceHashes,
      reviewer: "Automated capture; no human review or production qualification",
      conditions: {
        browser: rendering.browser,
        fonts: rendering.fonts,
        deviceScaleFactor: 1,
        locale: "sv-SE",
        theme: values.theme,
        zoom,
        zoomMethod: "CSS layout zoom; not native browser zoom",
        pane: values.pane ?? "route default",
        viewport,
        route: entry.route ?? route,
        resolvedRoute: new URL(page.url()).pathname + new URL(page.url()).search,
        time: new Date().toISOString(),
        clockPinned: false,
        fixture: {
          synthetic: true,
          mode: session.demoMode ?? null,
          state: board?.state ?? "route default; board-specific state unverified",
          selection: values.select ?? board?.selectText ?? null,
          boardContentMatch: false,
        },
      },
      jsxSha256: jsxHash,
    };
    save(join(output, "capture.json"), capture);
  } finally {
    await browser.close();
  }

  const baselineBytes = readFileSync(entry.baseline);

  if (hash(baselineBytes) !== entry.baselineSha256) throw new Error("Baseline hash changed");
  const expected = PNG.sync.read(baselineBytes);
  const actual = PNG.sync.read(readFileSync(capture.actual));
  const sameDimensions = actual.width === expected.width && actual.height === expected.height;

  const eligible =
    sameDimensions &&
    viewport.width === entry.viewport.width &&
    viewport.height === entry.viewport.height &&
    zoom === 1 &&
    values.theme === "light" &&
    entry.adoption === "approved" &&
    Boolean(entry.comparison?.adoptedBy);

  let comparatorStatus = null;

  rmSync(join(output, "result.json"), { force: true });

  if (eligible) {
    const comparison = spawnSync(
      process.execPath,
      [
        "verification/paper/compare.mjs",
        entry.id,
        relative(root, join(output, "capture.json")),
        relative(root, output),
      ],
      { encoding: "utf8" },
    );

    comparatorStatus = comparison.status;

    if (comparison.status !== 0 && !existsSync(join(output, "result.json")))
      throw new Error(`Comparator refused capture: ${comparison.stderr}`);
  }

  const width = Math.max(expected.width, actual.width);
  const height = Math.max(expected.height, actual.height);
  const side = new PNG({ width: expected.width + actual.width + width, height });
  side.data.fill(255);
  PNG.bitblt(expected, side, 0, 0, expected.width, expected.height, 0, 0);
  PNG.bitblt(actual, side, 0, 0, actual.width, actual.height, expected.width, 0);

  const grid = Array.from({ length: 9 }, (_, index) => ({
    row: Math.floor(index / 3),
    column: index % 3,
    pixels: 0,
    changed: 0,
  }));

  const diff = new PNG({ width, height });
  const tolerance = entry.comparison?.channelTolerance;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell =
        grid[
          Math.min(2, Math.floor((y * 3) / height)) * 3 + Math.min(2, Math.floor((x * 3) / width))
        ];

      const missing =
        x >= actual.width || y >= actual.height || x >= expected.width || y >= expected.height;

      const a = (y * actual.width + x) * 4;
      const b = (y * expected.width + x) * 4;

      const mismatch =
        missing ||
        (tolerance !== undefined &&
          [0, 1, 2, 3].some(
            (channel) =>
              Math.abs(actual.data[a + channel] - expected.data[b + channel]) > tolerance,
          ));

      cell.pixels++;

      if (mismatch) cell.changed++;
      const offset = (y * width + x) * 4;

      for (let channel = 0; channel < 3; channel++)
        diff.data[offset + channel] = mismatch
          ? channel === 0
            ? 255
            : 0
          : actual.data[a + channel];
      diff.data[offset + 3] = 255;
    }
  }

  // Dimension mismatch diagnostics use a padded union canvas, never resized inputs.
  if (!eligible) writeFileSync(join(output, "diff.png"), PNG.sync.write(diff));
  PNG.bitblt(diff, side, 0, 0, width, height, expected.width + actual.width, 0);
  writeFileSync(join(output, "side-by-side.png"), PNG.sync.write(side));

  const report = {
    scope: entry.id,
    output,
    adoptedComparisonEligible: eligible,
    comparatorStatus,
    difference: eligible ? json(join(output, "result.json")).difference : null,
    parityQualified: false,
    limitations: [
      "Pixel comparison is not behavior/state or production qualification",
      ...(!eligible
        ? ["Non-default rendering, dimensions or unadopted policy: diagnostic only"]
        : []),
      ...(!board?.state ? ["Board-specific state not supplied by runtime"] : []),
      ...(tolerance === undefined
        ? ["No adopted channel tolerance: grid drift is not measured"]
        : []),
    ],
    grid: grid.map((cell) => ({
      ...cell,
      difference: tolerance === undefined ? null : cell.changed / cell.pixels,
    })),
    gridCanvas: { width, height },
    sameDimensions,
    channelTolerance: tolerance ?? null,
  };

  save(join(output, "grid-drift.json"), report);
  console.log(JSON.stringify(report));

  if (comparatorStatus !== null && comparatorStatus !== 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
