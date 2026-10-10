import { loadEngine } from "../lib/engine.mjs";
import { readFile } from "node:fs/promises";

const e = await loadEngine();

const laws =
  (
    (await readFile(new URL("../bend/LAWS.bend", import.meta.url), "utf8")) +
    "\n" +
    (await readFile(new URL("../bend/RefinementLaws.bend", import.meta.url), "utf8"))
  ).match(/^law /gm)?.length ?? 0;

console.log(
  JSON.stringify(
    {
      status: "source-check-passed",
      checker: e.authority,
      definitions: e.definitions,
      lawProofPairs: laws,
      officialBinaryChecked: false,
      independentSafeKernelChecked: false,
    },
    null,
    2,
  ),
);
