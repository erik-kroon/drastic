import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

export const CorrectionIntent = Schema.Struct({
  datePolicy: Schema.Literal("explicit_open_period"),
  accountingPeriodId: Accounting.Identifier,
  postingDate: Accounting.AccountingDate,
  rationale: Accounting.Description,
  replacement: Schema.Struct({
    description: Accounting.Description,
    lines: Schema.Array(Accounting.JournalLine).check(
      Schema.isMinLength(2),
      Schema.isMaxLength(500),
    ),
  }),
});
export const ImpactReference = Schema.Struct({
  id: Accounting.Identifier,
  digest: Accounting.Digest,
});
export const PrepareCorrectionBundle = Schema.Struct({
  ...CorrectionIntent.fields,
  impactReview: Schema.optional(ImpactReference),
});
export const CorrectionBundle = Schema.Struct({
  id: Accounting.Identifier,
  version: Schema.Literal(1),
  scope: Accounting.Scope,
  originalVoucher: Accounting.Voucher,
  datePolicy: Schema.Literal("explicit_open_period"),
  rationale: Accounting.Description,
  reversal: Accounting.ChangeSet,
  replacement: Accounting.ChangeSet,
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  bundleDigest: Accounting.Digest,
  impactReview: Schema.optional(ImpactReference),
});
export const ApproveCorrectionBundle = Schema.Struct({
  bundleDigest: Accounting.Digest,
  version: Schema.Literal(1),
});
export const CorrectionBundleApproval = Schema.Struct({
  id: Accounting.Identifier,
  bundleId: Accounting.Identifier,
  bundleDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
});
export const ExecuteCorrectionBundle = Schema.Struct({
  ...ApproveCorrectionBundle.fields,
  approvalId: Accounting.Identifier,
});
export const CorrectionBundleReceipt = Schema.Struct({
  id: Accounting.Identifier,
  bundleId: Accounting.Identifier,
  bundleDigest: Accounting.Digest,
  approvalId: Accounting.Identifier,
  originalVoucherId: Accounting.Identifier,
  reversal: Accounting.ExecutionReceipt,
  replacement: Accounting.ExecutionReceipt,
  committedAt: Schema.String,
});
export const CorrectionBundleView = Schema.Struct({
  bundle: CorrectionBundle,
  approval: Schema.NullOr(CorrectionBundleApproval),
  receipt: Schema.NullOr(CorrectionBundleReceipt),
});

export const CorrectionChain = Schema.Struct({
  scope: Accounting.Scope,
  selectedVoucherId: Accounting.Identifier,
  rootVoucherId: Accounting.Identifier,
  sequence: Accounting.MinorUnits,
  vouchers: Schema.Array(Accounting.Voucher),
  receipts: Schema.Array(CorrectionBundleReceipt),
  balances: Schema.Array(
    Schema.Struct({
      accountId: Accounting.Identifier,
      debitMinor: Accounting.AggregateMinorUnits,
      creditMinor: Accounting.AggregateMinorUnits,
      balanceMinor: Accounting.SignedMinorUnits,
    }),
  ),
});
export const CorrectionImpactResource = Schema.Struct({
  kind: Schema.Literals([
    "bank_match",
    "tax_account_match",
    "bank_allocation",
    "invoice",
    "payment_allocation",
    "schedule",
    "report",
    "closing",
    "owner_record",
  ]),
  id: Accounting.Identifier,
  detail: Schema.String,
  path: Schema.String,
  blocks: Schema.Boolean,
  dependencyDigest: Schema.optional(Accounting.Digest),
  taxAccountMatch: Schema.optional(
    Schema.Struct({
      statementId: Accounting.Identifier,
      statementDigest: Accounting.Digest,
      eventId: Accounting.Identifier,
      voucherId: Accounting.Identifier,
      lineId: Accounting.Identifier,
      matchDigest: Accounting.Digest,
      usable: Schema.Boolean,
    }),
  ),
});
export const CorrectionBlocker = Schema.Struct({
  code: Accounting.FailureCode,
  message: Schema.String,
});
export const CorrectionImpactBasis = Schema.Struct({
  intent: CorrectionIntent,
  chain: CorrectionChain,
  resources: Schema.Array(CorrectionImpactResource),
  blockers: Schema.Array(CorrectionBlocker),
  configurationDigest: Accounting.Digest,
  netChange: Schema.Array(
    Schema.Struct({ accountId: Accounting.Identifier, deltaMinor: Accounting.SignedMinorUnits }),
  ),
  executable: Schema.Literal(false),
  limitations: Schema.Array(Schema.String),
});
export const CorrectionImpact = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  voucherId: Accounting.Identifier,
  createdBy: Accounting.Identifier,
  createdAt: Schema.String,
  basis: CorrectionImpactBasis,
  digest: Accounting.Digest,
});
export const CorrectionImpactView = Schema.Struct({
  impact: CorrectionImpact,
  snapshotCurrent: Schema.Boolean,
  executable: Schema.Literal(false),
});
export const CorrectionBundlePage = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      originalVoucherId: Accounting.Identifier,
      createdAt: Schema.String,
      bundleDigest: Accounting.Digest,
      receipt: Schema.NullOr(CorrectionBundleReceipt),
    }),
  ),
  next: Schema.NullOr(Accounting.Identifier),
});
export const CorrectionRequestRecovery = Schema.Struct({
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  checkedAt: Schema.String,
  status: Schema.Literals(["recorded", "not_recorded_at_check"]),
  operation: Schema.NullOr(Schema.String),
  result: Schema.NullOr(
    Schema.Union([
      CorrectionBundle,
      CorrectionBundleApproval,
      CorrectionBundleReceipt,
      CorrectionImpact,
    ]),
  ),
});

const path = "/v1/entities/:entityId/books/:bookId";
const identified = { params: Accounting.ChangePath, error: accountingErrors };
const mutation = { ...identified, headers: Accounting.IdempotencyHeaders };
export const CorrectionApi = HttpApiGroup.make("corrections").add(
  HttpApiEndpoint.post(
    "prepareCorrectionImpact",
    `${path}/vouchers/:id/correction-impact-reviews`,
    {
      ...mutation,
      payload: CorrectionIntent.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CorrectionImpact,
    },
  ),
  HttpApiEndpoint.get("getCorrectionImpact", `${path}/correction-impact-reviews/:id`, {
    ...identified,
    success: CorrectionImpactView,
  }),
  HttpApiEndpoint.get("getCorrectionChain", `${path}/vouchers/:id/correction-chain`, {
    ...identified,
    success: CorrectionChain,
  }),
  HttpApiEndpoint.get("listCorrectionBundles", `${path}/correction-bundles`, {
    params: Accounting.Scope,
    error: accountingErrors,
    query: Schema.Struct({ after: Schema.optional(Accounting.Identifier) }),
    success: CorrectionBundlePage,
  }),
  HttpApiEndpoint.get("recoverCorrectionRequest", `${path}/correction-requests/:key`, {
    params: Schema.Struct({
      ...Accounting.Scope.fields,
      key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    }),
    error: accountingErrors,
    success: CorrectionRequestRecovery,
  }),
  HttpApiEndpoint.post("prepareCorrectionBundle", `${path}/vouchers/:id/correction-bundles`, {
    ...mutation,
    payload: PrepareCorrectionBundle.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CorrectionBundle,
  }),
  HttpApiEndpoint.get("getCorrectionBundleForVoucher", `${path}/vouchers/:id/correction-bundle`, {
    ...identified,
    success: CorrectionBundleView,
  }),
  HttpApiEndpoint.get("getCorrectionBundle", `${path}/correction-bundles/:id`, {
    ...identified,
    success: CorrectionBundleView,
  }),
  HttpApiEndpoint.post("approveCorrectionBundle", `${path}/correction-bundles/:id/approvals`, {
    ...mutation,
    payload: ApproveCorrectionBundle.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CorrectionBundleApproval,
  }),
  HttpApiEndpoint.post("executeCorrectionBundle", `${path}/correction-bundles/:id/execute`, {
    ...mutation,
    payload: ExecuteCorrectionBundle.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: CorrectionBundleReceipt,
  }),
);

const scoped = { scope: Accounting.Scope };
const command = {
  ...scoped,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};
export const CorrectionCapabilities = {
  corrections_review_impact: {
    description:
      "Freeze an exact replacement intent, connected correction chain and represented downstream impacts. Blockers prevent sealing. Never a permission to post.",
    input: Schema.Struct({ ...command, voucherId: Accounting.Identifier, input: CorrectionIntent }),
    output: CorrectionImpact,
    readOnly: false,
  },
  corrections_get_impact: {
    description:
      "Read an immutable impact snapshot and compare its live basis. Snapshot-current is not full executability.",
    input: Schema.Struct({ ...scoped, impactId: Accounting.Identifier }),
    output: CorrectionImpactView,
    readOnly: true,
  },
  corrections_chain: {
    description:
      "Read the connected retained original, reversals and replacements and exact cumulative account totals. Includes standalone reversals.",
    input: Schema.Struct({ ...scoped, voucherId: Accounting.Identifier }),
    output: CorrectionChain,
    readOnly: true,
  },
  corrections_list: {
    description:
      "Discover retained correction bundles and committed paired receipts using a stable identifier cursor.",
    input: Schema.Struct({ ...scoped, after: Schema.optional(Accounting.Identifier) }),
    output: CorrectionBundlePage,
    readOnly: true,
  },
  corrections_recover_request: {
    description:
      "Recover this actor's scoped correction command receipt. Not recorded at check is not proof of request failure or permission to repost.",
    input: Schema.Struct({
      ...scoped,
      key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    }),
    output: CorrectionRequestRecovery,
    readOnly: true,
  },
  corrections_prepare: {
    description:
      "Seal an exact linked reversal and replacement bundle. Both use an explicit open-period correction date. Does not approve or post.",
    input: Schema.Struct({
      ...command,
      voucherId: Accounting.Identifier,
      input: PrepareCorrectionBundle,
    }),
    output: CorrectionBundle,
    readOnly: false,
  },
  corrections_get: {
    description:
      "Recover a correction bundle, current approval and atomic paired receipt by bundle ID.",
    input: Schema.Struct({ ...scoped, bundleId: Accounting.Identifier }),
    output: CorrectionBundleView,
    readOnly: true,
  },
  corrections_for_voucher: {
    description:
      "Recover the committed correction bundle, or latest unposted bundle, for an original voucher. NotFound does not establish that a standalone reversal is absent.",
    input: Schema.Struct({ ...scoped, voucherId: Accounting.Identifier }),
    output: CorrectionBundleView,
    readOnly: true,
  },
  corrections_execute: {
    description:
      "Commit both approved correction parts in one transaction. A new request ID cannot duplicate either posting. Replacement content cannot be changed during execution.",
    input: Schema.Struct({
      ...command,
      bundleId: Accounting.Identifier,
      input: ExecuteCorrectionBundle,
    }),
    output: CorrectionBundleReceipt,
    readOnly: false,
  },
};
