import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { selectCase, evaluateProfile } from "../scripts/release-gate.mjs";
import { evaluateVitest, mutationOutcome } from "../../scripts/gates.mjs";

const report = (status = "passed") => ({
  startTime: 10000,
  success: status === "passed",
  numTotalTests: 1,
  numPassedTests: status === "passed" ? 1 : 0,
  numFailedTests: status === "failed" ? 1 : 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numFailedTestSuites: 0,
  testResults: [
    {
      name: "/repo/apps/api/tests/a.e2e.test.ts",
      status: "passed",
      message: "",
      assertionResults: [{ fullName: "[EXC-CASE] actual model journey", status }],
    },
  ],
});

const c = {
  id: "EXC-CASE",
  file: "apps/api/tests/a.e2e.test.ts",
  marker: "EXC-CASE",
  lane: "native",
  evidence: "case.json",
};

function inputs() {
  const body = { schema: "excellence-evidence/v1", caseId: "EXC-CASE", outcome: "passed" },
    raw = Buffer.from(JSON.stringify(body));

  return {
    sourceBefore: "hash",
    sourceAfter: "hash",
    stages: [{ id: "foundation", status: "passed" }],
    reports: { native: report() },
    evidence: {
      "case.json": {
        body,
        raw,
        sha256: createHash("sha256").update(raw).digest("hex"),
        mtimeMs: 11000,
      },
    },
    startedAt: { native: 10000 },
  };
}

const p = {
  id: "synthetic-case",
  claim: "test-only",
  stages: ["foundation"],
  cases: [c],
  limitations: [],
};

test("case must exist in the expected source file with the required cardinality", () => {
  assert.equal(selectCase(report(), c, 10000).status, "passed");
  assert.equal(
    selectCase(report(), { ...c, file: "wrong/a.e2e.test.ts" }, 10000).status,
    "blocked",
  );
  assert.equal(selectCase(report(), { ...c, expectedAssertions: 2 }, 10000).status, "blocked");
});

test("missing, stale, skipped and retried case outcomes do not pass", () => {
  assert.equal(selectCase(null, c).status, "blocked");
  assert.equal(selectCase(report(), c, 50000).status, "blocked");
  assert.equal(selectCase(report("pending"), c).status, "blocked");
  const r = report();
  r.testResults[0].assertionResults[0].retryCount = 1;
  assert.equal(selectCase(r, c).status, "blocked");
});

test("profile requires report plus fresh matching retained case evidence", () => {
  assert.equal(evaluateProfile(p, inputs()).status, "passed");
  const v = inputs();
  delete v.evidence["case.json"];
  assert.equal(evaluateProfile(p, v).status, "blocked");
});

test("wrong evidence hash, source change and missing stage block the verdict", () => {
  for (const change of [
    (v) => (v.evidence["case.json"].sha256 = "wrong"),
    (v) => (v.sourceAfter = "changed"),
    (v) => (v.stages = []),
  ]) {
    const v = inputs();
    change(v);
    assert.equal(evaluateProfile(p, v).status, "blocked");
  }
});

test("assertion failure stays failed even if a sidecar says passed", () => {
  const v = inputs();
  v.reports.native = report("failed");
  assert.equal(evaluateProfile(p, v).status, "failed");
});

test("six-books skeleton cannot be accepted as completed financial qualification", () => {
  const v = inputs();
  v.evidence["six.json"] = {
    body: {
      schema: "six-books/v1",
      finalVerdict: "NOT_RUN",
      cases: [{ status: "BLOCKED_UNSUPPORTED" }],
      applicationSourceDigest: "hash",
    },
  };

  const profile = {
    ...p,
    externalQualifications: [
      { id: "six", evidence: "six.json", schema: "six-books/v1", minimumCases: 1 },
    ],
  };

  assert.equal(evaluateProfile(profile, v).status, "blocked");
});

test("a changed test with the same count is not a killed semantic mutant", () => {
  const base = evaluateVitest(report(), { notBefore: 10000 }),
    r = report("failed");

  r.testResults[0].assertionResults[0].fullName = "substituted unrelated assertion";
  const mutant = evaluateVitest(r, { notBefore: 10000 });
  assert.equal(
    mutationOutcome({ baseline: base, mutant, exitCode: 1 }),
    "inconclusive_infrastructure",
  );
});

test("missing numeric report time cannot bypass stale-result guard", () => {
  const r = report();
  delete r.startTime;
  assert.equal(selectCase(r, c, 10000).status, "blocked");
  r.startTime = NaN;
  assert.equal(selectCase(r, c, 10000).status, "blocked");
});

test("empty or duplicate required profile membership is blocked", () => {
  assert.equal(evaluateProfile({ ...p, cases: [] }, inputs()).status, "blocked");
  assert.equal(evaluateProfile({ ...p, cases: [c, c] }, inputs()).status, "blocked");
  assert.equal(evaluateProfile({ ...p, stages: [] }, inputs()).status, "blocked");
});

test("missing sidecar timestamp and a failed required stage stay visible", () => {
  const v = inputs();
  delete v.evidence["case.json"].mtimeMs;
  assert.equal(evaluateProfile(p, v).status, "blocked");
  const w = inputs();
  w.stages[0].status = "failed";
  assert.equal(evaluateProfile(p, w).status, "failed");
});
