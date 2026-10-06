import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

const require = createRequire(join(root, "apps/web/package.json"));

const { createServer } = require("vite");

const { chromium } = createRequire(join(root, "apps/api/package.json"))("playwright");

const frame = process.argv[2] ?? "q45";

if (!["q45", "q46", "q47"].includes(frame)) throw new Error("Unknown correction reference frame");

const output = resolve(
  process.env.CORRECTION_PARITY_OUT ?? join(root, "test-results/components/corrections"),
);

const baseline = await readFile(join(import.meta.dirname, `${frame}.paper.png`));

if (!baseline.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  throw new Error("Correction baseline is not a PNG");

if (baseline.readUInt32BE(16) !== 1440 || baseline.readUInt32BE(20) !== 900)
  throw new Error("Correction requires the 1440 by 900 Paper export");

await mkdir(output, { recursive: true });

const server = await createServer({ configFile: join(import.meta.dirname, "vite.config.ts") });

let browser;

try {
  await server.listen();

  const address = server.httpServer.address();

  if (!address || typeof address === "string" || address.address !== "127.0.0.1")
    throw new Error("Correction renderer must bind to loopback");
  browser = await chromium.launch();

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
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

  await page.goto(`http://127.0.0.1:${address.port}/?state=${frame}`, { waitUntil: "networkidle" });

  await page.locator("#component-board").waitFor();

  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;

    return document.fonts.check('13px "Inter"');
  });

  if (!fontLoaded) throw new Error("Local Inter font did not load");

  const geometry = await page.evaluate(() =>
    [...document.querySelectorAll("table tr, aside li, aside h3, aside div")]
      .filter(
        (element) =>
          element.matches("table tr, aside li, aside h3") || element.children.length === 2,
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);

        return {
          tag: element.tagName,
          text: element.textContent,
          y: rect.y,
          height: rect.height,
          lineHeight: style.lineHeight,
          boxSizing: style.boxSizing,
          borderTop: style.borderTopWidth,
          borderBottom: style.borderBottomWidth,
        };
      }),
  );

  const actual = await page.screenshot({ animations: "disabled" });

  await writeFile(join(output, `${frame}.actual.png`), actual);

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
        actualImage.height !== 900 ||
        expectedImage.width !== 1440 ||
        expectedImage.height !== 900
      )
        throw new Error("Comparison image dimensions changed");

      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1440;
        canvas.height = 900;

        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);

        return context.getImageData(0, 0, 1440, 900);
      };

      const observed = pixels(actualImage);

      const reference = pixels(expectedImage);

      const diff = new ImageData(1440, 900);

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
      canvas.height = 900;
      canvas.getContext("2d").putImageData(diff, 0, 0);

      return {
        changedPixels: changed,
        ratio: changed / (1440 * 900),
        diff: canvas.toDataURL("image/png").split(",")[1],
      };
    },
    { actual: actual.toString("base64"), expected: baseline.toString("base64") },
  );

  await writeFile(join(output, `${frame}.diff.png`), Buffer.from(result.diff, "base64"));

  const sources = [
    "board.tsx",
    "index.html",
    `${frame}.paper.jsx.txt`,
    `${frame}.paper-styles.json`,
    `${frame}.paper.png`,
    "fixture.ts",
    "vite.config.ts",
    "parity.mjs",
    "tsconfig.json",
    "env.d.ts",
    "q45.paper-node-styles.json",
  ];

  const hashes = {};

  for (const source of sources)
    hashes[source] = createHash("sha256")
      .update(await readFile(join(import.meta.dirname, source)))
      .digest("hex");

  const sharedSources = [
    "packages/ui/src/components/button.tsx",
    "packages/ui/src/components/correction-bundle-review.tsx",
    "apps/web/src/components/corrections/bundle-workspace.tsx",
    "apps/web/src/components/corrections/blocked-impact-workspace.tsx",
    "apps/web/src/components/corrections/workspace-copy.ts",
    "apps/web/src/components/corrections/presentation-evidence.ts",
    "apps/web/src/components/corrections/stale-bundle-workspace.tsx",
    "apps/web/src/components/corrections/stale-copy.ts",
    "apps/web/src/components/corrections/blocked-impact-copy.ts",
    "packages/ui/src/components/correction-impact-review.tsx",
    "packages/ui/src/components/command-search.tsx",
    "packages/ui/src/components/workspace.tsx",
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
    frame,
    capturedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 900 },
    pixelTolerance: 24,
    maxDiffRatio: 0.01,
    ratio: result.ratio,
    changedPixels: result.changedPixels,
    fontLoaded,
    errors,
    pass: result.ratio <= 0.01 && errors.length === 0,
    sourceHashes: hashes,
    geometry,
    limitations: [
      "Visual parity of production correction presentation in an isolated synthetic board only. Financial execution, recovery, authority refusal and live owner effects require the real browser/API journeys.",
    ],
  };

  await writeFile(join(output, `${frame}.report.json`), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, output }, null, 2));

  if (!report.pass) process.exitCode = 1;
} finally {
  if (browser) await browser.close();

  await server.close();
}
