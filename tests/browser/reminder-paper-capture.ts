import { createHash } from "node:crypto";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestFixtures } from "e2e";
import type { Browser } from "@e2e-dev/web";

export type ReminderPaperFrame =
  | "M31"
  | "M32"
  | "M60"
  | "M98"
  | "M99"
  | "M100"
  | "M101"
  | "M102"
  | "M103"
  | "M104"
  | "M105";

export async function readRunArtifact(relative: string) {
  const artifactRoot = join(process.env.OPENERP_E2E_OUTPUT ?? "", "artifacts");
  const matches = [];

  for await (const path of glob(`**/${relative}`, { cwd: artifactRoot }))
    matches.push(join(artifactRoot, path));

  if (matches.length !== 1 || !matches[0]) throw new Error("Paper capture artifact is not unique");

  return readFile(matches[0]);
}

export async function captureReminderPaper(
  app: TestFixtures["app"],
  browser: Browser,
  frame: ReminderPaperFrame,
  label: string,
) {
  const referencePath = join(
    "verification/paper/domain-owners/collections-reminders",
    frame,
    "reference.png",
  );

  const reference = await readFile(referencePath);

  await browser.evaluate(async () => {
    await document.fonts.ready;

    return true;
  });

  const actual = await readRunArtifact(await app.screenshot(label));

  const comparison = await browser.evaluate(
    async ({ actual, reference }) => {
      const load = (bytes: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Paper comparison requires PNG images"));
          image.src = `data:image/png;base64,${bytes}`;
        });

      const [capture, baseline] = await Promise.all([load(actual), load(reference)]);

      if (
        capture.width !== 1440 ||
        capture.height !== 900 ||
        baseline.width !== 1440 ||
        baseline.height !== 900
      )
        throw new Error("Paper comparison requires whole 1440x900 frames");

      const pixels = (image: HTMLImageElement) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (!context) throw new Error("Paper comparison canvas unavailable");
        context.drawImage(image, 0, 0);

        return context.getImageData(0, 0, image.width, image.height);
      };

      const left = pixels(capture);
      const right = pixels(baseline);
      const diff = new ImageData(1440, 900);
      let changed = 0;

      for (let index = 0; index < left.data.length; index += 4) {
        const hit = [0, 1, 2].some(
          (channel) => Math.abs(left.data[index + channel]! - right.data[index + channel]!) > 24,
        );

        if (hit) changed += 1;
        diff.data[index] = hit ? 220 : right.data[index]!;
        diff.data[index + 1] = hit ? 30 : right.data[index + 1]!;
        diff.data[index + 2] = hit ? 30 : right.data[index + 2]!;
        diff.data[index + 3] = hit ? 255 : 90;
      }

      const canvas = document.createElement("canvas");
      canvas.width = 1440;
      canvas.height = 900;
      const context = canvas.getContext("2d");

      if (!context) throw new Error("Paper diff canvas unavailable");
      context.putImageData(diff, 0, 0);

      return {
        changedPixels: changed,
        ratio: changed / (1440 * 900),
        diff: canvas.toDataURL("image/png").split(",")[1]!,
      };
    },
    { actual: actual.toString("base64"), reference: reference.toString("base64") },
  );

  const directory = join(process.env.OPENERP_E2E_OUTPUT ?? "", "paper", frame);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "actual.png"), actual);
  await writeFile(join(directory, "diff.png"), Buffer.from(comparison.diff, "base64"));

  const verdict = {
    frame,
    reference: referencePath,
    viewport: { width: 1440, height: 900 },
    pixelTolerance: 24,
    maxDiffRatio: 0.025,
    masks: [],
    actualSha256: createHash("sha256").update(actual).digest("hex"),
    referenceSha256: createHash("sha256").update(reference).digest("hex"),
    changedPixels: comparison.changedPixels,
    diffRatio: comparison.ratio,
    pass: comparison.ratio <= 0.025,
  };

  await writeFile(join(directory, "report.json"), JSON.stringify(verdict, null, 2));

  return verdict;
}
