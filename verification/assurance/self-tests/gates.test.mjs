import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateVitest,
  evaluateBend,
  mutationOutcome,
  redactLog,
  evaluateNodeTap,
} from "../scripts/gates.mjs";

function report(overrides = {}) {
  return {
    startTime: 5000,
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    testResults: [
      {
        name: "/repo/apps/api/tests/a.e2e.test.ts",
        status: "passed",
        message: "",
        assertionResults: [{ fullName: "[REAL] balances persist", status: "passed" }],
      },
    ],
    ...overrides,
  };
}

test("positive report requires named real records and expected paths", () => {
  assert.equal(
    evaluateVitest(report(), {
      requiredFiles: ["apps/api/tests/a.e2e.test.ts"],
      expectedPrefixes: ["[REAL]"],
      notBefore: 5000,
    }).status,
    "passed",
  );
});

test("zero tests cannot pass", () => {
  assert.equal(
    evaluateVitest(report({ numTotalTests: 0, numPassedTests: 0, testResults: [] })).status,
    "blocked",
  );
});

test("an omitted required file is blocked even when another file has the same basename", () => {
  assert.equal(
    evaluateVitest(report(), { requiredFiles: ["apps/api/tests/another/a.e2e.test.ts"] }).status,
    "blocked",
  );
});

test("skipped assertions cannot pass", () => {
  const r = report();
  r.testResults[0].assertionResults[0].status = "pending";
  r.numPassedTests = 0;
  r.numPendingTests = 1;
  assert.equal(evaluateVitest(r).status, "blocked");
});

test("fabricated summary counts cannot pass", () => {
  assert.equal(
    evaluateVitest(report({ numTotalTests: 100, numPassedTests: 100 })).status,
    "blocked",
  );
});

test("stale saved green report cannot pass", () => {
  assert.equal(evaluateVitest(report(), { notBefore: 100000 }).status, "blocked");
});

test("collection failure is a failure, not an assertion-mutant kill", () => {
  const baseline = evaluateVitest(report());

  const r = report({
    success: false,
    numTotalTests: 0,
    numPassedTests: 0,
    numFailedTestSuites: 1,
    testResults: [
      { name: "/repo/a", status: "failed", message: "cannot import", assertionResults: [] },
    ],
  });

  const gate = evaluateVitest(r);
  assert.equal(gate.status, "failed");
  assert.equal(
    mutationOutcome({ baseline, mutant: gate, exitCode: 1 }),
    "inconclusive_infrastructure",
  );
});

test("one failed assertion can kill a mutant only with the same completed population", () => {
  const baseline = evaluateVitest(report());
  const r = report();
  r.success = false;
  r.numPassedTests = 0;
  r.numFailedTests = 1;
  r.testResults[0].assertionResults[0].status = "failed";
  const mutant = evaluateVitest(r);
  assert.equal(mutant.status, "failed");
  assert.equal(mutationOutcome({ baseline, mutant, exitCode: 1 }), "killed_by_assertion");
  assert.equal(
    mutationOutcome({ baseline, mutant, exitCode: 1, timedOut: true }),
    "inconclusive_infrastructure",
  );
});

test("surviving mutant stays visible", () => {
  const passed = evaluateVitest(report());
  assert.equal(mutationOutcome({ baseline: passed, mutant: passed, exitCode: 0 }), "survived");
});

test("a retry cannot erase initial failure in a strict lane", () => {
  const r = report();
  r.testResults[0].assertionResults[0].retryCount = 1;
  assert.equal(evaluateVitest(r).status, "blocked");
});

test("Bend local output must keep production readiness false", () => {
  const r = {
    generatedAt: new Date(5000).toISOString(),
    status: "passed",
    productionReady: false,
    assertions: 5,
    runs: [{ passed: true }],
    typeCheck: { passed: true },
  };

  assert.equal(evaluateBend(r, "authority", 5000).status, "passed");
  assert.equal(evaluateBend({ ...r, productionReady: true }, "authority", 5000).status, "blocked");
  assert.equal(evaluateBend({ ...r, assertions: 0 }, "authority", 5000).status, "blocked");
});

test("Bend parent requires source stability and every component success", () => {
  const r = {
    capturedAt: new Date(5000).toISOString(),
    status: "passed-local-verification",
    productionReady: false,
    assertions: 10,
    runs: [{ status: 0 }],
    sourceStable: true,
  };

  assert.equal(evaluateBend(r, "parent", 5000).status, "passed");
  assert.equal(evaluateBend({ ...r, sourceStable: false }, "parent", 5000).status, "blocked");
});

test("known credentials in process logs are redacted", () => {
  const value =
    'postgresql://user:secret@127.0.0.1:123/db Authorization: Bearer abc123 {"accessToken":"xyz", "book":"safe"}';

  const out = redactLog(value);
  assert.ok(!out.includes("secret"));
  assert.ok(!out.includes("abc123"));
  assert.ok(!out.includes("xyz"));
  assert.ok(out.includes("safe"));
});

function tap(tests, pass, fail = 0, skipped = 0, cancelled = 0, todo = 0) {
  return `TAP version 13\n1..${tests}\n# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n`;
}

test("Node self-test lane requires complete positive TAP counts", () => {
  assert.equal(evaluateNodeTap(tap(2, 2)).status, "passed");
  assert.equal(evaluateNodeTap(tap(0, 0)).status, "blocked");
  assert.equal(evaluateNodeTap("unstructured success").status, "blocked");
});

test("Node skipped/cancelled/todo cases cannot be called a pass", () => {
  assert.equal(evaluateNodeTap(tap(2, 1, 0, 1)).status, "blocked");
  assert.equal(evaluateNodeTap(tap(2, 1, 0, 0, 1)).status, "blocked");
  assert.equal(evaluateNodeTap(tap(2, 1, 0, 0, 0, 1)).status, "blocked");
});

test("Node failed assertions remain failed and inconsistent counts remain blocked", () => {
  assert.equal(evaluateNodeTap(tap(2, 1, 1)).status, "failed");
  assert.equal(evaluateNodeTap(tap(3, 2)).status, "blocked");
});

test("Node repeated summary blocks cannot forge the last green result", () => {
  assert.equal(evaluateNodeTap(tap(2, 1, 1) + tap(2, 2)).status, "blocked");
});
