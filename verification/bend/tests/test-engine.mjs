import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEngine } from "../lib/engine.mjs";
import { compiledEngine } from "../src/compiled-engine.mjs";
import { digestBytes } from "../src/contracts.mjs";

export async function loadTestEngine() {
  if (!process.env.BEND_ARTIFACT) return loadEngine();
  const bytes = await readFile(resolve(process.env.BEND_ARTIFACT));
  const mod = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);

  if (mod.artifactFormat !== "openerp-bend-js/v1")
    throw new Error("Not an official build artifact");

  return {
    ...compiledEngine(mod.default, mod.constructors),
    definitions: mod.buildInfo.definitions,
    artifactDigest: await digestBytes(bytes),
    sourceTreeDigest: mod.buildInfo.sourceTreeDigest,
  };
}
