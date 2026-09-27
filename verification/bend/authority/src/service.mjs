import {
  OPERATIONS,
  record,
  text,
  context,
  snapshot,
  digest,
  sha,
  fail,
  freeze,
  oneOf,
  canonical,
} from "./contracts.mjs";
import { validateInput, runOperation, verifyOutput } from "./operations.mjs";

function request(value) {
  const x = snapshot(value);
  record(x, "request", ["operation", "context", "input"]);
  oneOf(x.operation, OPERATIONS, "operation");
  context(x.context);

  // Selection order is significant. No hidden sorting of periods or contributions.
  return freeze({
    operation: x.operation,
    context: x.context,
    input: snapshot(validateInput(x.operation, x.input)),
  });
}

/** Offline or bounded shadow use. It can never issue an authoritative record. */
export function createShadowService(engine, legacy) {
  if (typeof legacy !== "function") fail("InvalidInput", "A legacy authority callback is required");

  return Object.freeze({
    async compare(raw) {
      const req = request(raw),
        inputDigest = await digest(req);

      const authoritative = snapshot(await legacy(req.operation, req.input));

      // A TS failure is not replaced by Bend. A Bend failure does not suppress TS.
      let candidate = null,
        status = "unavailable",
        diagnostic = null;

      try {
        candidate = snapshot(runOperation(engine, req.operation, req.input));
        status = canonical(authoritative) === canonical(candidate) ? "equal" : "different";
      } catch (error) {
        diagnostic = { code: error.code ?? "KernelUnavailable", message: String(error.message) };
      }

      return freeze({
        mode: "shadow",
        authoritativeOwner: "typescript",
        inputDigest,
        authoritative,
        candidate,
        comparison: status,
        diagnostic,
        mayExecute: false,
      });
    },
  });
}

/** Internal constructor. The public production entrypoint is loadAuthority(),
 * which checks artifact bytes, out-of-band deployment trust and build receipts.
 * A compromised application process remains inside the existing trusted boundary.
 */
export function qualifiedService(engine, qualification) {
  const release = snapshot(qualification);

  if (engine?.authority !== "official-js-artifact" || release.status !== "qualified-for-runtime")
    fail("UnqualifiedRelease", "Development backends cannot become authoritative");

  return Object.freeze({
    release,
    // Synchronous calculator for a pure jurisdiction dependency-injection seam.
    calculate(operation, input) {
      if (!release.operations.includes(operation))
        fail("UnqualifiedOperation", `${operation} is not promoted for this runtime`);

      if (operation === "cover.suggest.v1")
        fail("SuggestionOnly", "Cover search never enters the financial authority path");

      return snapshot(runOperation(engine, operation, snapshot(input)));
    },
    async prepare(raw) {
      const req = request(raw);

      if (!release.operations.includes(req.operation))
        fail("UnqualifiedOperation", `${req.operation} is not promoted for this runtime`);

      if (req.operation === "cover.suggest.v1")
        fail("SuggestionOnly", "Cover search is suggestion-only");
      const output = snapshot(runOperation(engine, req.operation, req.input));

      const body = {
        schema: "openerp-bend-calculation/v1",
        owner: "bend",
        operation: req.operation,
        semantics: release.semantics[req.operation],
        context: req.context,
        input: req.input,
        output,
        releaseId: release.releaseId,
        manifestDigest: release.manifestDigest,
        artifactDigest: release.artifactDigest,
        runtimeId: release.runtimeId,
        inputDigest: await digest(req),
        mayExecute: false,
      };

      return freeze({ ...body, calculationDigest: await digest(body) });
    },
  });
}

/** Inspects a retained calculation without loading any current kernel or recomputing with a new release. */
export async function verifyRetained(raw) {
  const value = snapshot(raw);
  record(value, "calculation", [
    "schema",
    "owner",
    "operation",
    "semantics",
    "context",
    "input",
    "output",
    "releaseId",
    "manifestDigest",
    "artifactDigest",
    "runtimeId",
    "inputDigest",
    "mayExecute",
    "calculationDigest",
  ]);

  if (
    value.schema !== "openerp-bend-calculation/v1" ||
    value.owner !== "bend" ||
    value.mayExecute !== false
  )
    fail("InvalidCalculation", "Wrong calculation record kind");

  for (const key of ["semantics", "releaseId", "runtimeId"]) text(value[key], key);

  for (const key of ["manifestDigest", "artifactDigest", "inputDigest", "calculationDigest"])
    sha(value[key], key);
  const body = { ...value };
  delete body.calculationDigest;

  if ((await digest(body)) !== value.calculationDigest)
    fail("DigestMismatch", "Retained calculation changed");
  const req = request({ operation: value.operation, context: value.context, input: value.input });

  if ((await digest(req)) !== value.inputDigest) fail("DigestMismatch", "Captured input changed");

  if (value.operation === "cover.suggest.v1")
    fail("SuggestionOnly", "Suggestions are not authoritative calculations");
  verifyOutput(value.operation, value.input, value.output);

  return value;
}

/** An extra binding check, NOT an authorization check or a database transaction.
 * The caller still locks and rechecks actor/book/period/approval/semantic identity.
 */
export async function assertExecutionBinding(raw, binding) {
  const value = await verifyRetained(raw);
  record(binding, "execution binding", [
    "approvedCalculationDigest",
    "currentContext",
    "allowedManifestDigests",
  ]);
  sha(binding.approvedCalculationDigest, "approvedCalculationDigest");

  if (value.calculationDigest !== binding.approvedCalculationDigest)
    fail("ApprovalMismatch", "Approval did not bind this calculation");

  if (
    !Array.isArray(binding.allowedManifestDigests) ||
    !binding.allowedManifestDigests.includes(value.manifestDigest)
  )
    fail("ReleaseRevoked", "This release is not allowed for new execution");
  context(binding.currentContext);

  if (canonical(value.context) !== canonical(binding.currentContext))
    fail("StaleBasis", "Basis, policy or dependency revision changed; prepare and review again");

  return value; // No writes and no mayExecute:true state.
}
