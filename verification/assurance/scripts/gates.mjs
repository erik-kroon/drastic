/** Result gates are deliberately separate from execution. Unknown/empty/skip is not green. */
import { basename } from "node:path";

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
}

export function evaluateVitest(
  report,
  { requiredFiles = [], expectedPrefixes = [], notBefore = 0 } = {},
) {
  const reasons = [];
  assertObject(report, "Vitest report");

  if (!Array.isArray(report.testResults))
    return { status: "blocked", reasons: ["Missing testResults"], tests: 0 };

  if (!Number.isFinite(report.startTime) || report.startTime < notBefore - 2_000)
    reasons.push("Missing or stale report startTime");
  const assertions = [];
  const fileNames = new Set();
  const identities = new Set();
  let failedSuites = 0;

  for (const file of report.testResults) {
    if (!file || typeof file.name !== "string") {
      reasons.push("Unnamed test file");
      continue;
    }

    fileNames.add(file.name.replaceAll("\\", "/"));

    if (file.status === "failed" || file.message) failedSuites++;

    if (!Array.isArray(file.assertionResults) || file.assertionResults.length === 0) {
      reasons.push(`No executed assertions in ${basename(file.name)}`);
      continue;
    }

    for (const assertion of file.assertionResults) {
      const identity = `${file.name}\0${assertion.fullName ?? assertion.title}`;

      if (identities.has(identity))
        reasons.push(`Repeated test identity in ${basename(file.name)}`);
      identities.add(identity);

      if (!assertion.fullName && !assertion.title) reasons.push("Missing assertion identity");

      if (Number(assertion.retryCount ?? 0) > 0)
        reasons.push("Retry occurred in a no-retry qualification lane");
      assertions.push(assertion);
    }
  }

  for (const name of requiredFiles) {
    const normalized = name.replaceAll("\\", "/");

    if (![...fileNames].some((file) => file === normalized || file.endsWith("/" + normalized)))
      reasons.push(`Required file not collected: ${name}`);
  }

  for (const prefix of expectedPrefixes)
    if (!assertions.some((a) => (a.fullName ?? a.title ?? "").includes(prefix)))
      reasons.push(`Required scenario prefix missing: ${prefix}`);

  if (assertions.length === 0) reasons.push("Zero tests cannot qualify a lane");
  const failed = assertions.filter((x) => x.status === "failed").length;
  const passed = assertions.filter((x) => x.status === "passed").length;
  const other = assertions.length - failed - passed;

  if (other > 0) reasons.push(`${other} pending/skipped/todo/unknown assertions`);

  if (report.numTotalTests !== assertions.length)
    reasons.push("Reported test count differs from actual assertion records");

  if (report.numPassedTests !== passed || report.numFailedTests !== failed)
    reasons.push("Summary outcome counts disagree with records");

  if (Number(report.numPendingTests ?? 0) !== 0 || Number(report.numTodoTests ?? 0) !== 0)
    reasons.push("Nonzero pending/todo summary");

  if (Number(report.numFailedTestSuites ?? 0) > 0) failedSuites++;

  if (report.success !== true && failed === 0 && failedSuites === 0)
    reasons.push("Run did not report success");

  const status =
    failed > 0 || failedSuites > 0 ? "failed" : reasons.length > 0 ? "blocked" : "passed";

  return {
    status,
    tests: assertions.length,
    passed,
    failed,
    other,
    fileCount: fileNames.size,
    assertionIdentities: [...identities].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    reasons,
  };
}

export function evaluateBend(report, kind, notBefore = 0) {
  assertObject(report, "Bend report");
  const reasons = [];
  const timestamp = Date.parse(report.generatedAt ?? report.capturedAt ?? "");

  if (!Number.isFinite(timestamp) || timestamp < notBefore - 2_000)
    reasons.push("Missing/stale Bend report timestamp");

  if (!(Number.isInteger(report.assertions) && report.assertions > 0))
    reasons.push("No positive independently reported assertion count");

  if (report.productionReady !== false)
    reasons.push("Local verification must not claim production readiness");
  const expectedStatus = kind === "parent" ? "passed-local-verification" : "passed";

  if (report.status !== expectedStatus)
    reasons.push(`Bend local report is ${String(report.status)}`);

  if (!Array.isArray(report.runs) || report.runs.length === 0) reasons.push("No component runs");
  else if (kind === "parent" && report.runs.some((r) => r.status !== 0 || r.error || r.signal))
    reasons.push("Parent child process did not pass");
  else if (kind === "authority" && report.runs.some((r) => r.passed !== true))
    reasons.push("Authority child process did not pass");

  if (kind === "parent" && report.sourceStable !== true)
    reasons.push("Parent source stability not established");

  if (kind === "authority" && report.typeCheck?.passed !== true)
    reasons.push("Authority declaration check not passed");

  return {
    status: reasons.length ? "blocked" : "passed",
    assertions: report.assertions ?? null,
    reasons,
    productionReady: false,
  };
}

export function mutationOutcome(input) {
  const { baseline, mutant, exitCode, signal } = input;
  const timedOut = input.timedOut;

  if (baseline.status !== "passed") return "invalid_baseline";

  if (timedOut || signal) return "inconclusive_infrastructure";

  // A loader/type/collection error is not a killed financial mutant.
  if (
    exitCode !== 0 &&
    mutant &&
    mutant.failed > 0 &&
    mutant.tests === baseline.tests &&
    mutant.other === 0 &&
    Array.isArray(baseline.assertionIdentities) &&
    JSON.stringify(mutant.assertionIdentities) === JSON.stringify(baseline.assertionIdentities)
  )
    return "killed_by_assertion";

  if (exitCode === 0 && mutant?.status === "passed") return "survived";

  return "inconclusive_infrastructure";
}

export function redactLog(input) {
  return String(input)
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/Bearer\s+[^\s'"\],}]+/gi, "Bearer [REDACTED]")
    .replace(
      /("(?:[^"\\]*)(?:token|password|secret|authorization|cookie)(?:[^"\\]*)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[REDACTED]"',
    );
}

/** Node TAP is used only for this suite's own runner/oracle tests. */
export function evaluateNodeTap(output) {
  const text = String(output);
  const counts = {};

  for (const name of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const rows = [...text.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`, "gm"))];
    counts[name] = rows.length === 1 ? Number(rows[0][1]) : null;
  }

  const complete =
    Object.values(counts).every((n) => Number.isSafeInteger(n) && n >= 0) &&
    counts.tests > 0 &&
    counts.tests === counts.pass + counts.fail + counts.cancelled + counts.skipped + counts.todo;

  return {
    status: !complete
      ? "blocked"
      : counts.fail > 0
        ? "failed"
        : counts.cancelled || counts.skipped || counts.todo
          ? "blocked"
          : "passed",
    ...counts,
    meaning: "Node tooling/oracle self-tests only, not application evidence",
  };
}
