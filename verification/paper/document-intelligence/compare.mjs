import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const { PNG } = createRequire(import.meta.resolve("e2e"))("pngjs");

export async function compareSourceHighlight(actual, output) {
  const expected = await readFile(new URL("./highlight.paper.png", import.meta.url));
  const reference = PNG.sync.read(expected);
  const observed = PNG.sync.read(actual);

  if ([reference, observed].some((image) => image.width !== 375 || image.height !== 375))
    throw new Error("Source highlight comparison requires the Paper 375 by 375 component");

  const diff = new PNG({ width: 375, height: 375 });

  let changed = 0;

  for (let pixel = 0; pixel < 375 * 375; pixel++) {
    const offset = pixel * 4;

    const mismatch = [0, 1, 2, 3].some(
      (channel) =>
        Math.abs(reference.data[offset + channel] - observed.data[offset + channel]) > 24,
    );

    if (mismatch) changed++;

    diff.data[offset] = mismatch ? 255 : observed.data[offset];
    diff.data[offset + 1] = mismatch ? 0 : observed.data[offset + 1];
    diff.data[offset + 2] = mismatch ? 0 : observed.data[offset + 2];
    diff.data[offset + 3] = 255;
  }

  const ratio = changed / (375 * 375);

  const result = {
    scope: "selected source-highlight SVG only, not the document screen or optical accuracy",
    width: 375,
    height: 375,
    channelTolerance: 24,
    gate: 0.01,
    changed,
    ratio,
    passed: ratio <= 0.01,
    expectedHash: createHash("sha256").update(expected).digest("hex"),
    actualHash: createHash("sha256").update(actual).digest("hex"),
  };

  await writeFile(join(output, "highlight.actual.png"), actual);
  await writeFile(join(output, "highlight.diff.png"), PNG.sync.write(diff));
  await writeFile(join(output, "highlight-parity.json"), JSON.stringify(result, null, 2));

  return result;
}
