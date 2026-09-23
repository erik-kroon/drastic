import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./reconciliation";
import { AssetDisposal, OccurrenceState, ScheduleRevision } from "./subledgers";
export { AssetDisposal } from "./subledgers";

export const RecordSubledgerBasis = Schema.Struct({
  scheduleId: Accounting.Identifier,
  expectedDigest: Accounting.Digest,
  kind: Schema.Literals(["acquisition", "imported_opening"]),
  effectiveOn: Accounting.AccountingDate,
  evidenceId: Accounting.Identifier,
  sourceLocator: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  reviewEvidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
  originalCostMinor: Accounting.MinorUnits,
  accumulatedMinor: Accounting.MinorUnits,
  carryingMinor: Accounting.MinorUnits,
  voucherId: Accounting.Identifier,
  lineIds: Schema.Array(Accounting.Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});
export const BasisLine = Schema.Struct({
  accountId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  ordinal: Schema.Int,
  debitMinor: Accounting.MinorUnits,
  creditMinor: Accounting.MinorUnits,
});
export const SubledgerBasis = Schema.Struct({
  scope: Accounting.Scope,
  input: RecordSubledgerBasis,
  scheduleDigest: Accounting.Digest,
  sourceSha256: Schema.String,
  reviewSha256: Schema.String,
  voucherSequence: Accounting.MinorUnits,
  currency: Schema.String,
  currencyScale: Schema.Int,
  lines: Schema.Array(BasisLine),
  coverage: Schema.Literal("not_established"),
  legalPolicyApproved: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
export const SubledgerBasisList = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(SubledgerBasis).check(Schema.isMaxLength(200)),
  coverage: Schema.Literal("not_established"),
});
export const CreateSubledgerControl = Schema.Struct({
  asOfDate: Accounting.AccountingDate,
  accountIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20),
  ),
  inventoryEvidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
});
export const ControlSchedule = Schema.Struct({
  revision: ScheduleRevision,
  basis: Schema.NullOr(SubledgerBasis),
  occurrences: Schema.Array(OccurrenceState),
  disposal: Schema.optional(Schema.NullOr(AssetDisposal)),
  basisReversed: Schema.Boolean,
  recognizedMinor: Accounting.AggregateMinorUnits,
  carryingMinor: Schema.NullOr(Accounting.SignedMinorUnits),
});
const EffectKind = Schema.Literals([
  "basis",
  "occurrence",
  "occurrence_reversal",
  "disposal_release",
]);
export const ExpectedSubledgerEffect = Schema.Struct({
  scheduleId: Accounting.Identifier,
  kind: EffectKind,
  voucherId: Accounting.Identifier,
  ordinal: Schema.Int,
  accountId: Accounting.Identifier,
  expectedMinor: Accounting.SignedMinorUnits,
});
export const SubledgerControlLine = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  ordinal: Schema.Int,
  sequence: Accounting.MinorUnits,
  postingDate: Accounting.AccountingDate,
  accountId: Accounting.Identifier,
  debitMinor: Accounting.MinorUnits,
  creditMinor: Accounting.MinorUnits,
  description: Schema.String,
  correctsVoucherId: Schema.NullOr(Accounting.Identifier),
  evidenceRefs: Schema.Array(
    Schema.Struct({
      evidenceId: Accounting.Identifier,
      sha256: Schema.String,
      locator: Schema.String,
    }),
  ),
  scheduleId: Schema.NullOr(Accounting.Identifier),
  effectKind: Schema.NullOr(EffectKind),
  expectedMinor: Accounting.SignedMinorUnits,
  unexplainedMinor: Accounting.SignedMinorUnits,
});
export const SubledgerAccountControl = Schema.Struct({
  accountId: Accounting.Identifier,
  code: Schema.String,
  name: Schema.String,
  version: Accounting.MinorUnits,
  active: Schema.Boolean,
  expectedMinor: Accounting.SignedMinorUnits,
  ledgerMinor: Accounting.SignedMinorUnits,
  differenceMinor: Accounting.SignedMinorUnits,
  unexplainedLineCount: Schema.Int,
  missingEffectCount: Schema.Int,
});
export const SubledgerControl = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  kind: Schema.Literal("synthetic_subledger_control_v1"),
  input: CreateSubledgerControl,
  inventorySha256: Schema.String,
  sequence: Accounting.MinorUnits,
  currency: Schema.String,
  currencyScale: Schema.Int,
  dependencyDigest: Accounting.Digest,
  knowledgeBasis: Schema.Literal("current_known_facts_at_capture"),
  coverage: Schema.Literal("not_established"),
  financialCloseReady: Schema.Literal(false),
  schedules: Schema.Array(ControlSchedule),
  expectedEffects: Schema.Array(ExpectedSubledgerEffect),
  ledgerLines: Schema.Array(SubledgerControlLine),
  controls: Schema.Array(SubledgerAccountControl),
  hasReviewGaps: Schema.Boolean,
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
export const SubledgerControlView = Schema.Struct({
  snapshot: SubledgerControl,
  dependenciesCurrent: Schema.Boolean,
  artifact: Schema.Struct({
    content: Schema.String,
    sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8388608 })),
    mediaType: Schema.Literal("application/json"),
  }),
});
export const SubledgerControlList = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      createdAt: Schema.String,
      asOfDate: Accounting.AccountingDate,
      digest: Accounting.Digest,
      sequence: Accounting.MinorUnits,
      hasReviewGaps: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(200)),
  coverage: Schema.Literal("not_established"),
});
export const PrepareAssetDisposal = Schema.Struct({
  profile: Schema.Literal("synthetic_no_proceeds_asset_disposal_v1"),
  scheduleId: Accounting.Identifier,
  expectedDigest: Accounting.Digest,
  expectedBasisDigest: Accounting.Digest,
  postingDate: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  lossAccountId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  reviewEvidenceId: Accounting.Identifier,
  rationale: Accounting.Description,
  proceedsMinor: Schema.Literal("0"),
  taxAssessment: Schema.Literal("not_applicable"),
  acknowledgeSyntheticOnly: Schema.Literal(true),
});
export const AssetDisposalBasis = Schema.Struct({
  schedule: ScheduleRevision,
  carryingBasis: SubledgerBasis,
  occurrences: Schema.Array(OccurrenceState),
  originalCostMinor: Accounting.MinorUnits,
  openingAccumulatedMinor: Accounting.MinorUnits,
  recognizedMinor: Accounting.MinorUnits,
  reversedMinor: Accounting.AggregateMinorUnits,
  totalAccumulatedMinor: Accounting.MinorUnits,
  carryingMinor: Accounting.MinorUnits,
  sourceSha256: Schema.String,
  reviewSha256: Schema.String,
});
export const AssetDisposalReview = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  ordinal: Schema.Int,
  version: Schema.Literal(1),
  input: PrepareAssetDisposal,
  basis: AssetDisposalBasis,
  evidence: Accounting.Evidence,
  postingPlan: Accounting.ChangeSet,
  coverage: Schema.Literal("not_established"),
  legalPolicyApproved: Schema.Literal(false),
  requiresPostingApproval: Schema.Literal(true),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
export const ApproveAssetDisposal = Schema.Struct({
  version: Schema.Literal(1),
  digest: Accounting.Digest,
  acknowledgeSyntheticOnly: Schema.Literal(true),
});
export const ExecuteAssetDisposal = Schema.Struct({
  ...ApproveAssetDisposal.fields,
  approvalId: Accounting.Identifier,
});
export const AssetDisposalApproval = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  reviewId: Accounting.Identifier,
  reviewDigest: Accounting.Digest,
  actorId: Accounting.Identifier,
  expiresAt: Schema.String,
  legalPolicyApproved: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: Accounting.Digest,
});
export const AssetDisposalReviewView = Schema.Struct({
  review: AssetDisposalReview,
  approvals: Schema.Array(AssetDisposalApproval).check(Schema.isMaxLength(20)),
  disposal: Schema.NullOr(AssetDisposal),
  liveAuthorizationChecked: Schema.Literal(false),
});
export const AssetDisposalReviewList = Schema.Struct({
  scope: Accounting.Scope,
  scheduleId: Accounting.Identifier,
  items: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      ordinal: Schema.Int,
      digest: Accounting.Digest,
      createdAt: Schema.String,
      postingDate: Accounting.AccountingDate,
    }),
  ).check(Schema.isMaxLength(20)),
  disposal: Schema.NullOr(AssetDisposal),
  coverage: Schema.Literal("not_established"),
});
const path = "/v1/entities/:entityId/books/:bookId/subledger-controls";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
export const SubledgerControlsApi = HttpApiGroup.make("subledgerControls").add(
  HttpApiEndpoint.post("prepareAssetDisposal", `${path}/disposals/prepare`, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: PrepareAssetDisposal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AssetDisposalReview,
  }),
  HttpApiEndpoint.post("approveAssetDisposal", `${path}/disposals/:id/approve`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: ApproveAssetDisposal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AssetDisposalApproval,
  }),
  HttpApiEndpoint.post("executeAssetDisposal", `${path}/disposals/:id/execute`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: ExecuteAssetDisposal.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: AssetDisposal,
  }),
  HttpApiEndpoint.get("getAssetDisposalReview", `${path}/disposals/:id`, {
    ...identified,
    success: AssetDisposalReviewView,
  }),
  HttpApiEndpoint.get("listAssetDisposalReviews", `${path}/disposals/for-schedule/:id`, {
    ...identified,
    success: AssetDisposalReviewList,
  }),

  HttpApiEndpoint.post("recordSubledgerBasis", `${path}/bases`, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: RecordSubledgerBasis.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SubledgerBasis,
  }),
  HttpApiEndpoint.get("getSubledgerBasis", `${path}/bases/:id`, {
    ...identified,
    success: SubledgerBasis,
  }),
  HttpApiEndpoint.get("listSubledgerBases", `${path}/bases`, {
    ...scoped,
    success: SubledgerBasisList,
  }),
  HttpApiEndpoint.post("createSubledgerControl", `${path}/snapshots`, {
    ...scoped,
    headers: Accounting.IdempotencyHeaders,
    payload: CreateSubledgerControl.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: SubledgerControl,
  }),
  HttpApiEndpoint.get("getSubledgerControl", `${path}/snapshots/:id`, {
    ...identified,
    success: SubledgerControlView,
  }),
  HttpApiEndpoint.get("listSubledgerControls", `${path}/snapshots`, {
    ...scoped,
    success: SubledgerControlList,
  }),
);
// Basis review is operator-only REST, never an ordinary MCP review tool.
export const SubledgerControlCapabilities = {
  subledger_get_basis: {
    description:
      "Read one immutable synthetic carrying basis by schedule ID. Does not establish legal treatment or current voucher validity.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SubledgerBasis,
    readOnly: true,
  },
  subledger_list_bases: {
    description:
      "Read all bounded retained synthetic carrying bases. This is not a complete company asset inventory.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: SubledgerBasisList,
    readOnly: true,
  },
  subledger_create_control: {
    description:
      "Freeze known schedules and every GL contribution on declared control accounts at one committed cutoff. Reports differences without posting, legal activation or complete-source certification.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: CreateSubledgerControl,
    }),
    output: SubledgerControl,
    readOnly: false,
  },
  subledger_get_control: {
    description:
      "Read immutable schedule/control contributions and exact retained JSON bytes, with separate live dependency currentness.",
    input: Schema.Struct({ scope: Accounting.Scope, id: Accounting.Identifier }),
    output: SubledgerControlView,
    readOnly: true,
  },
  subledger_list_controls: {
    description:
      "Discover all bounded saved schedule control snapshots. Reload recovery does not assert complete source coverage.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: SubledgerControlList,
    readOnly: true,
  },
};
