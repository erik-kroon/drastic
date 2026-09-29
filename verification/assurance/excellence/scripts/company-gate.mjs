#!/usr/bin/env node
/** Compare an independently reviewed fixed case set with normalized actual owner observations.
 * No default fixture expectations are invented and no skeleton is promoted.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureSources, sha256 } from "../../scripts/runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const byIdentity = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";

  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );

  return JSON.stringify(v);
}

export function compareCompany(contract, observed, sourceDigest) {
  const errors = [];

  if (typeof sourceDigest !== "string" || !sourceDigest)
    return { status: "blocked", errors: ["Missing application source fingerprint"] };

  if (
    typeof contract?.scopeId !== "string" ||
    !contract.scopeId ||
    contract?.schema !== "openerp-independent-case-set/v1" ||
    !contract.review?.decisionRef ||
    !contract.fixtureDigest ||
    !Array.isArray(contract.cases) ||
    contract.cases.length === 0
  )
    return { status: "blocked", errors: ["Missing reviewed independent expected case set"] };

  if (
    observed?.schema !== "openerp-observed-case-set/v1" ||
    observed.fixtureDigest !== contract.fixtureDigest ||
    observed.scopeId !== contract.scopeId ||
    observed.applicationSourceDigest !== sourceDigest ||
    !Array.isArray(observed.cases)
  )
    return { status: "blocked", errors: ["Observed profile, fixture or source identity mismatch"] };

  const ids = contract.cases.map((c) => c.id),
    actualIds = observed.cases.map((c) => c.id);

  if (
    new Set(ids).size !== ids.length ||
    new Set(actualIds).size !== actualIds.length ||
    canonical([...ids].sort(byIdentity)) !== canonical([...actualIds].sort(byIdentity))
  )
    errors.push("Case identities are duplicate, absent or unexpected");

  for (const expected of contract.cases) {
    if (
      typeof expected.id !== "string" ||
      !expected.id ||
      typeof expected.inputDigest !== "string" ||
      !expected.inputDigest
    ) {
      errors.push("Missing expected case identity or input digest");
      continue;
    }

    const actual = observed.cases.find((c) => c.id === expected.id);

    if (
      !actual ||
      actual.status !== "passed" ||
      !Array.isArray(actual.actualTrace) ||
      actual.actualTrace.length === 0 ||
      actual.inputDigest !== expected.inputDigest
    ) {
      errors.push(`${expected.id}: case not executed against declared input`);
      continue;
    }

    if (
      actual.actualTrace.some(
        (t) =>
          !t.operation ||
          !t.requestId ||
          !["committed", "recovered", "refused_expected", "observed"].includes(t.outcome) ||
          !t.evidenceRef ||
          !t.responseDigest,
      )
    )
      errors.push(`${expected.id}: incomplete actual owner trace`);

    if (
      !expected.expected ||
      !actual.observed ||
      canonical(expected.expected) !== canonical(actual.observed)
    )
      errors.push(`${expected.id}: full normalized financial/evidence result differs`);
  }

  return {
    status: errors.length ? "blocked" : "passed",
    errors,
    scopeId: contract.scopeId,
    cases: ids.length,
    productionReady: false,
    claim:
      "Independent fixed synthetic/company-authorized case-set comparison only; live statutory qualification remains separately scoped",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parent = process.env.EXCELLENCE_PARENT_RUN ?? "manual";

  if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(parent)) throw Error("Bad parent identity");
  const out = join(root, "test-results/excellence-company", parent + ".json");
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  let result;

  try {
    const cp = process.env.EXCELLENCE_COMPANY_CASES,
      op = process.env.EXCELLENCE_COMPANY_OBSERVED;

    if (!cp || !op)
      throw Error(
        "EXCELLENCE_COMPANY_CASES and EXCELLENCE_COMPANY_OBSERVED are required. The supplied six-books skeleton is not completed financial execution. See the integration handoff.",
      );

    const cb = await readFile(cp),
      ob = await readFile(op);

    if (cb.length > 20000000 || ob.length > 50000000)
      throw Error("Case-set size exceeds bounded profile");
    const source = await captureSources(root);
    result = {
      ...compareCompany(JSON.parse(cb), JSON.parse(ob), source.digest),
      sourceDigest: source.digest,
      contractSHA256: sha256(cb),
      observedSHA256: sha256(ob),
    };
  } catch (error) {
    result = {
      status: "blocked",
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  result.generatedAt = new Date().toISOString();
  await writeFile(out, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "passed" ? 0 : 2;
}
