import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadEngine as loadVerifiedEngine } from "./checker.mjs";

export { BEND_PIN, CHECKER_BLOB } from "./checker.mjs";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function loadEngine(entry = resolve(ROOT, "bend/Kernel.bend")) {
  return loadVerifiedEngine(entry);
}
