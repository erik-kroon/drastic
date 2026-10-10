import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Coverage from "@open-erp/domain/verification-coverage";
import { accountingErrors } from "./accounting-errors";

export const CaptureClosePredicate = Schema.Struct({
  bankInventoryPlanId: Schema.NullOr(A.Identifier),
  bankSourceCoverageReportId: Schema.optionalKey(Schema.NullOr(A.Identifier)),
  actualVatReturnId: Schema.NullOr(A.Identifier),
});

export const CloseCapture = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  period: Coverage.FrozenMonth,
  builderVersion: Schema.Literal(Coverage.builderVersion),
  selection: CaptureClosePredicate,
  gated: Schema.Array(Coverage.CheckRecord),
  reported: Schema.Array(Coverage.CheckRecord),
  inventoryDigest: A.Digest,
  createdAt: Schema.String,
  digest: A.Digest,
  receipt: Schema.Struct({
    key: Schema.String,
    operation: Schema.Literal("capture_close_predicate"),
    actorId: A.Identifier,
  }),
});

export const ClosePredicate = Schema.Struct({
  scope: A.Scope,
  period: Coverage.FrozenMonth,
  capture: Schema.NullOr(CloseCapture),
  gated: Schema.Array(Coverage.CheckView),
  reported: Schema.Array(Coverage.CheckView),
  verdict: Coverage.Verdict,
});

const path = "/v1/entities/:entityId/books/:bookId/periods/:periodId/close-predicate";

const params = Schema.Struct({ ...A.Scope.fields, periodId: A.Identifier });

export const CoverageApi = HttpApiGroup.make("verificationCoverage")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("captureClosePredicate", path, {
      params,
      headers: A.IdempotencyHeaders,
      payload: CaptureClosePredicate,
      success: ClosePredicate,
      error: accountingErrors,
    }),
    HttpApiEndpoint.get("getClosePredicate", path, {
      params,
      query: Schema.Struct({ captureId: Schema.optionalKey(A.Identifier) }),
      success: ClosePredicate,
      error: accountingErrors,
    }),
  );

export const CoverageCapabilities = {
  periods_close_predicate: {
    description:
      "Read one retained calendar-month close capture and separate current owner freshness. Missing voucher support and complete-fact owners remain required not-established gates. An inconclusive result is not done. No capture, approval, posting or other write is performed.",
    input: Schema.Struct({
      scope: A.Scope,
      periodId: A.Identifier,
      captureId: Schema.optionalKey(A.Identifier),
    }),
    output: ClosePredicate,
    readOnly: true,
  },
};
