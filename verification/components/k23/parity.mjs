import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

const require = createRequire(join(root, "apps/web/package.json"));

const { createServer } = require("vite");

const { chromium } = createRequire(join(root, "apps/api/package.json"))("playwright");

const output = resolve(process.env.K23_PARITY_OUT ?? join(root, "test-results/components/k23"));

const baseline = await readFile(join(import.meta.dirname, "paper.png"));

if (!baseline.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  throw new Error("K23 baseline is not a PNG");

if (baseline.readUInt32BE(16) !== 1440 || baseline.readUInt32BE(20) !== 1080)
  throw new Error("K23 requires the 1440 by 1080 Paper export");

await mkdir(output, { recursive: true });

const server = await createServer({ configFile: join(import.meta.dirname, "vite.config.ts") });

let browser;

try {
  await server.listen();

  const address = server.httpServer.address();

  if (!address || typeof address === "string" || address.address !== "127.0.0.1")
    throw new Error("K23 renderer must bind to loopback");
  browser = await chromium.launch();

  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
    locale: "sv-SE",
    colorScheme: "light",
    reducedMotion: "reduce",
  });

  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());

    if (url.hostname !== "127.0.0.1" || Number(url.port) !== address.port) {
      errors.push(`Nonlocal request refused: ${url.origin}`);

      return route.abort();
    }

    return route.continue();
  });

  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });

  await page.locator("#component-board").waitFor();

  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;

    return document.fonts.check('13px "Inter"');
  });

  if (!fontLoaded) throw new Error("Local Inter font did not load");

  const actual = await page.screenshot({ animations: "disabled" });

  await writeFile(join(output, "k23.actual.png"), actual);

  const result = await page.evaluate(
    async ({ actual, expected }) => {
      const load = (bytes) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Invalid comparison PNG"));
          image.src = `data:image/png;base64,${bytes}`;
        });

      const actualImage = await load(actual);

      const expectedImage = await load(expected);

      if (
        actualImage.width !== 1440 ||
        actualImage.height !== 1080 ||
        expectedImage.width !== 1440 ||
        expectedImage.height !== 1080
      )
        throw new Error("Comparison image dimensions changed");

      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1440;
        canvas.height = 1080;

        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);

        return context.getImageData(0, 0, 1440, 1080);
      };

      const observed = pixels(actualImage);

      const reference = pixels(expectedImage);

      const diff = new ImageData(1440, 1080);

      let changed = 0;

      for (let index = 0; index < observed.data.length; index += 4) {
        const hit =
          Math.max(
            ...[0, 1, 2].map((channel) =>
              Math.abs(observed.data[index + channel] - reference.data[index + channel]),
            ),
          ) > 24;

        if (hit) changed += 1;
        diff.data[index] = hit ? 220 : reference.data[index];
        diff.data[index + 1] = hit ? 30 : reference.data[index + 1];
        diff.data[index + 2] = hit ? 30 : reference.data[index + 2];
        diff.data[index + 3] = hit ? 255 : 90;
      }

      const canvas = document.createElement("canvas");
      canvas.width = 1440;
      canvas.height = 1080;
      canvas.getContext("2d").putImageData(diff, 0, 0);

      return {
        changedPixels: changed,
        ratio: changed / (1440 * 1080),
        diff: canvas.toDataURL("image/png").split(",")[1],
      };
    },
    { actual: actual.toString("base64"), expected: baseline.toString("base64") },
  );

  await writeFile(join(output, "k23.diff.png"), Buffer.from(result.diff, "base64"));

  await page.goto(`http://127.0.0.1:${address.port}/?natural=1`, { waitUntil: "networkidle" });

  await page.evaluate(() => document.fonts.ready);

  const readState = async (locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);

      return {
        focusVisible: element.matches(":focus-visible"),
        borderWidth: style.borderTopWidth,
        borderColor: style.borderTopColor,
        background: style.backgroundColor,
        shadow: style.boxShadow,
        outline: style.outline,
        paddingInline: style.paddingLeft,
        weight: style.fontWeight,
        errorAssociation: element.getAttribute("aria-describedby"),
      };
    });

  await page.locator("#focus").focus();

  await page.keyboard.press("Shift+Tab");

  const editable = await readState(page.locator("#editable"));

  await page.screenshot({ path: join(output, "k23.focus.png"), animations: "disabled" });

  await page.locator("#invalid").focus();

  const invalid = await readState(page.locator("#invalid"));

  await page.screenshot({ path: join(output, "k23.invalid.png"), animations: "disabled" });

  const ghost = page.getByRole("button", { name: "Ghost, hovrad", exact: true });

  await ghost.hover();

  const ghostHover = await readState(ghost);

  await page.screenshot({ path: join(output, "k23.hover.png"), animations: "disabled" });

  const primary = page.getByRole("button", { name: "Primär", exact: true });

  await primary.focus();

  const primaryFocus = await readState(primary);

  const inlineControl = page.getByRole("button", {
    name: "Fokus: ram runt kontrollen, ingen fyllnad",
    exact: true,
  });

  await inlineControl.focus();

  const inlineFocus = await readState(inlineControl);

  await page.screenshot({ path: join(output, "k23.row-focus.png"), animations: "disabled" });

  const nativeStates = {
    previewsDisabled: true,
    editable,
    invalid,
    ghostHover,
    primaryFocus,
    inlineFocus,
    pass:
      editable.focusVisible &&
      editable.borderWidth === "2px" &&
      editable.borderColor === "rgb(36, 72, 165)" &&
      editable.paddingInline === "9px" &&
      invalid.borderColor === "rgb(180, 35, 42)" &&
      invalid.errorAssociation === "amount-error" &&
      ghostHover.background === "rgb(238, 241, 245)" &&
      ghostHover.paddingInline === "10px" &&
      ghostHover.weight === "400" &&
      primaryFocus.focusVisible &&
      primaryFocus.shadow !== "none" &&
      inlineFocus.focusVisible &&
      inlineFocus.outline === "rgb(36, 72, 165) solid 2px" &&
      inlineFocus.background === "rgba(0, 0, 0, 0)",
  };

  const sources = [
    "board.tsx",
    "index.html",
    "paper.jsx.txt",
    "paper-styles.json",
    "paper.png",
    "vite.config.ts",
    "parity.mjs",
    "tsconfig.json",
    "env.d.ts",
  ];

  const hashes = {};

  for (const source of sources)
    hashes[source] = createHash("sha256")
      .update(await readFile(join(import.meta.dirname, source)))
      .digest("hex");

  const sharedSources = [
    "packages/ui/src/components/button.tsx",
    "packages/ui/src/components/input.tsx",
    "packages/ui/src/components/selection-controls.tsx",
    "packages/ui/src/components/semantic-note.tsx",
    "packages/ui/src/components/register-workspace.tsx",
    "packages/ui/src/components/settings-workspace.tsx",
    "packages/ui/src/components/typography.tsx",
    "packages/ui/src/components/link.tsx",
    "packages/ui/src/lib/stylex.ts",
    "packages/ui/src/theme/tokens.stylex.ts",
    "packages/ui/src/styles/globals.css",
    "packages/ui/src/styles/preflight.css",
    "apps/web/public/fonts/InterVariable.woff2",
  ];

  for (const source of sharedSources)
    hashes[source] = createHash("sha256")
      .update(await readFile(join(root, source)))
      .digest("hex");

  const report = {
    frame: "K23",
    capturedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 1080 },
    pixelTolerance: 24,
    maxDiffRatio: 0.01,
    ratio: result.ratio,
    changedPixels: result.changedPixels,
    fontLoaded,
    errors,
    nativeStates,
    pass: result.ratio <= 0.01 && errors.length === 0 && nativeStates.pass,
    sourceHashes: hashes,
    limitations: [
      "Component-board parity and bounded native visual states only. Full keyboard interaction, runtime accessibility, Button invalid state and product-screen parity are separate checks.",
    ],
  };

  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, output }, null, 2));

  if (!report.pass) process.exitCode = 1;
} finally {
  if (browser) await browser.close();

  await server.close();
}
