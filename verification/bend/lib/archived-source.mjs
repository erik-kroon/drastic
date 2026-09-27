import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

// Immutable external source assets are checked before they become executable.
export async function readArchivedSource(url, expectedSha256) {
  const bytes = gunzipSync(await readFile(url));
  const actual = createHash("sha256").update(bytes).digest("hex");

  if (actual !== expectedSha256) throw new Error(`Archived source pin mismatch: ${url}`);

  return bytes.toString("utf8");
}
