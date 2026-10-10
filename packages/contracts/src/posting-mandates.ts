import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Acceptance from "./supplier-acceptance";
import { accountingErrors } from "./accounting-errors";

// ADR 0020 / PST-05. A standing mandate pre-authorizes one grantee to execute a
// bounded class of supplier-invoice acceptances. It never authorizes payment,
// signature or filing, and it is never inferred from rules or repeated approvals.

const PositiveMinorUnits = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,37}$/));

const Instant = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/),
);

export const MandateCounterparty = Schema.Struct({
  counterpartyId: Accounting.Identifier,
  revision: Commerce.Version,
});

export const MandateTerms = Schema.Struct({
  granteeId: Accounting.Identifier,
  family: Schema.Literal("supplier_acceptance"),
  profiles: Schema.Array(Acceptance.SupplierAcceptanceReview.fields.profile).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(3),
  ),
  counterparties: Schema.Array(MandateCounterparty).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  perEventLimitMinor: PositiveMinorUnits,
  aggregateLimitMinor: PositiveMinorUnits,
  maxEvents: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  validFrom: Instant,
  validUntil: Instant,
});

export const GrantPostingMandate = Schema.Struct({
  ...MandateTerms.fields,
  reason: Accounting.Description,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const RevokePostingMandate = Schema.Struct({
  digest: Accounting.Digest,
  reason: Accounting.Description,
});

export const PostingMandate = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  grantorId: Accounting.Identifier,
  terms: MandateTerms,
  reason: Accounting.Description,
  digest: Accounting.Digest,
  grantedAt: Schema.String,
  revocation: Schema.NullOr(
    Schema.Struct({
      actorId: Accounting.Identifier,
      reason: Accounting.Description,
      revokedAt: Schema.String,
    }),
  ),
  consumedEvents: Schema.Int,
  consumedGrossMinor: Accounting.AggregateMinorUnits,
});

export const PostingMandateList = Schema.Array(PostingMandate).check(Schema.isMaxLength(100));

export const ExecuteSupplierAcceptanceUnderMandate = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  mandateId: Accounting.Identifier,
  mandateDigest: Accounting.Digest,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});

export const MandateExecution = Schema.Struct({
  mandateId: Accounting.Identifier,
  ordinal: Schema.Int,
  grossMinor: PositiveMinorUnits,
  remainingGrossMinor: Accounting.AggregateMinorUnits,
  remainingEvents: Schema.Int,
  acceptance: Acceptance.SupplierAcceptanceReceipt,
});

const path = "/v1/entities/:entityId/books/:bookId";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

export const PostingMandateApi = HttpApiGroup.make("postingMandates")
  .add(
    HttpApiEndpoint.post("grantPostingMandate", `${path}/posting-mandates`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: GrantPostingMandate.annotate(strict),
      success: PostingMandate,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("revokePostingMandate", `${path}/posting-mandates/:id/revocation`, {
      params: Accounting.ChangePath,
      headers: Accounting.IdempotencyHeaders,
      payload: RevokePostingMandate.annotate(strict),
      success: PostingMandate,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getPostingMandate", `${path}/posting-mandates/:id`, {
      params: Accounting.ChangePath,
      success: PostingMandate,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listPostingMandates", `${path}/posting-mandates`, {
      params: Accounting.Scope,
      success: PostingMandateList,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "executeSupplierAcceptanceUnderMandate",
      `${path}/commerce/supplier-acceptance-reviews/:id/mandate-executions`,
      {
        params: Accounting.ChangePath,
        headers: Accounting.IdempotencyHeaders,
        payload: ExecuteSupplierAcceptanceUnderMandate.annotate(strict),
        success: MandateExecution,
        error: accountingErrors,
      },
    ),
  );
