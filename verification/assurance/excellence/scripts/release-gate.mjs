/** Evidence checker, not a source of test results. Passing is always profile-scoped. */
import { createHash } from "node:crypto";

const hash = (x) => createHash("sha256").update(x).digest("hex");

export function selectCase(report, { id, file, marker, expectedAssertions = 1 }, notBefore = 0) {
  if (
    !report ||
    !Array.isArray(report.testResults) ||
    !Number.isFinite(report.startTime) ||
    !Number.isFinite(notBefore) ||
    report.startTime < notBefore - 2000
  )
    return { id, status: "blocked", reason: "missing_or_stale_report" };
  const normalized = file.replaceAll("\\", "/");

  const matching = report.testResults.filter(
    (r) => r.name === normalized || r.name?.replaceAll("\\", "/").endsWith("/" + normalized),
  );

  if (matching.length !== 1) return { id, status: "blocked", reason: "file_not_collected_once" };

  const assertions = (matching[0].assertionResults ?? []).filter((a) =>
    (a.fullName ?? a.title ?? "").includes("[" + marker + "]"),
  );

  if (assertions.length !== expectedAssertions)
    return { id, status: "blocked", reason: "wrong_case_cardinality", observed: assertions.length };

  if (assertions.some((a) => a.status === "failed"))
    return { id, status: "failed", reason: "assertion_failed" };

  if (assertions.some((a) => a.status !== "passed" || Number(a.retryCount ?? 0) > 0))
    return { id, status: "blocked", reason: "not_first_attempt_pass" };

  return { id, status: "passed", assertions: assertions.length };
}

export function evaluateProfile(profile, input) {
  const { sourceBefore, sourceAfter, stages } = input;
  const results = [];
  const reports = input.reports;
  const evidence = input.evidence;
  const startedAt = input.startedAt;

  if (
    !Array.isArray(profile.cases) ||
    profile.cases.length === 0 ||
    new Set(profile.cases.map((c) => c.id)).size !== profile.cases.length ||
    !Array.isArray(profile.stages) ||
    profile.stages.length === 0 ||
    new Set(profile.stages).size !== profile.stages.length
  )
    return {
      schema: "openerp-excellence-verdict/v1",
      profile: profile.id,
      status: "blocked",
      results: [
        {
          id: "profile-contract",
          status: "blocked",
          reason: "empty_or_duplicate_required_membership",
        },
      ],
      productionReady: false,
    };

  if (!sourceBefore || sourceBefore !== sourceAfter)
    results.push({ id: "source-stability", status: "blocked", reason: "not_same_source" });

  for (const required of profile.stages) {
    const matches = stages.filter((x) => x.id === required);

    if (matches.length !== 1 || matches[0].status !== "passed")
      results.push({
        id: required,
        status: matches.length === 1 && matches[0].status === "failed" ? "failed" : "blocked",
        reason: "required_stage_not_passed",
      });
  }

  for (const c of profile.cases) {
    const actual = selectCase(reports[c.lane], c, startedAt[c.lane] ?? 0);
    results.push(actual);

    if (c.evidence) {
      const found = evidence[c.evidence];

      if (
        !found ||
        found.body?.schema !== "excellence-evidence/v1" ||
        found.body.caseId !== c.id ||
        found.body.outcome !== "passed" ||
        !Number.isFinite(found.mtimeMs) ||
        found.mtimeMs < (startedAt[c.lane] ?? 0) - 2000 ||
        hash(found.raw) !== found.sha256
      )
        results.push({
          id: c.id + "-evidence",
          status: "blocked",
          reason: "missing_stale_or_mismatched_evidence",
        });
    }
  }

  // Claimed business certification needs actual normalized company/corpus results.
  // A passing test that asserts BLOCKED_UNSUPPORTED is useful diagnostics, not completion.
  for (const contract of profile.externalQualifications ?? []) {
    const body = evidence[contract.evidence]?.body;

    const allowed =
      body?.schema === contract.schema &&
      body?.finalVerdict === "passed" &&
      Array.isArray(body?.cases) &&
      body.cases.length >= contract.minimumCases &&
      body.cases.every((c) => c.status === "passed" && c.actualTrace?.length > 0) &&
      body.applicationSourceDigest === sourceBefore;

    results.push({
      id: contract.id,
      status: allowed ? "passed" : "blocked",
      reason: allowed
        ? "complete_bound_qualified_cases"
        : "external_qualification_missing_or_blocked",
    });
  }

  return {
    schema: "openerp-excellence-verdict/v1",
    profile: profile.id,
    status: results.some((x) => x.status === "failed")
      ? "failed"
      : results.some((x) => x.status !== "passed")
        ? "blocked"
        : "passed",
    sourceDigest: sourceBefore,
    results,
    scope: profile.claim,
    productionReady: false,
    limitations: profile.limitations,
  };
}
