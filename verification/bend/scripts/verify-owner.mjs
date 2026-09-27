import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEngine, ROOT } from "../lib/engine.mjs";
import { loadVatOwner } from "../lib/owner.mjs";
import { roundReference } from "../lib/money.mjs";
import { calculateVat } from "../lib/vat.mjs";

const reportFile = resolve(ROOT, "evidence/owner-verification.json");

await writeFile(reportFile, JSON.stringify({ status: "running", releaseVerified: false }) + "\n");

let comparisons = 0;

try {
  if (!process.env.OPENERP_REPO)
    throw new Error("OPENERP_REPO is required. Owner verification is never silently skipped.");
  const owner = await loadVatOwner({ repoRoot: process.env.OPENERP_REPO });
  const engine = await loadEngine();
  const roundings = ["half_up", "half_even", "toward_zero", "floor"];

  for (const rounding of roundings)
    for (const numerator of [-1000n, -300n, -250n, -100n, -1n, 0n, 1n, 150n, 10n ** 38n - 1n])
      for (const denominator of [1n, 2n, 10n, 100n, 1000000n]) {
        const expected = roundReference(numerator, denominator, rounding).value;
        assert.equal(owner.round(numerator, denominator, rounding), expected);
        comparisons++;
      }

  const populations = [
    [],
    [
      { box: "10", signedMinor: "199", included: true },
      { box: "48", signedMinor: "101", included: true },
    ],
    [
      { box: "10", signedMinor: "-199", included: true },
      { box: "48", signedMinor: "-101", included: true },
    ],
    [
      { box: "10", signedMinor: "100", included: true },
      { box: "10", signedMinor: "-100", included: true },
    ],
    [
      { box: "05", signedMinor: "100000", included: true },
      { box: "10", signedMinor: "25000", included: true },
      { box: "11", signedMinor: "-100", included: true },
      { box: "12", signedMinor: "250", included: true },
      { box: "48", signedMinor: "101", included: true },
      { box: "48", signedMinor: "999", included: false },
    ],
  ];

  for (const rounding of roundings)
    for (let currencyScale = 0; currencyScale <= 6; currencyScale++)
      for (let filingUnitScale = 0; filingUnitScale <= currencyScale; filingUnitScale++)
        for (const contributions of populations)
          for (const declareNet of [false, true]) {
            const input = { contributions, currencyScale, filingUnitScale, rounding, declareNet };
            assert.deepEqual(
              calculateVat(engine, input),
              owner.boxRows(
                { filingUnitScale, rounding },
                contributions.filter((row) => row.included),
                declareNet,
                currencyScale,
              ),
            );
            comparisons++;
          }

  assert.equal(owner.round(-100n, 100n, "floor"), -1n);
  comparisons++;
  assert.deepEqual(
    owner.boxRows({ filingUnitScale: 3, rounding: "floor" }, populations[1], true, 2),
    [],
  );
  comparisons++;

  const report = {
    status: "owner-monetary-differential-passed",
    comparisons,
    checker: engine.authority,
    sourceHashes: owner.sourceHashes,
    fullEligibilityOrFilingVerified: false,
  };

  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(
    reportFile,
    JSON.stringify(
      { status: "failed", comparisons, error: String(error), releaseVerified: false },
      null,
      2,
    ) + "\n",
  );
  throw error;
}
