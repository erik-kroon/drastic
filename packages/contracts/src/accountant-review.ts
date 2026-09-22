import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import * as Reports from "./reports";
import { accountingErrors } from "./accounting-errors";

export const PrepareReviewPack = Schema.Struct({
  reportId: Accounting.Identifier,
  openingExplanation: Accounting.Description,
  openingEvidenceIds: Schema.Array(Accounting.Identifier).check(Schema.isMaxLength(20)),
  accountantNotes: Accounting.Description,
  excludedSources: Schema.Array(Schema.Struct({ name: Accounting.Description, reason: Accounting.Description })).check(Schema.isMaxLength(20)),
});
export const ReviewSection = Schema.Literals(["balances", "journal", "evidence", "coverage"]);
export const ReviewFormat = Schema.Literals(["json", "balances_csv", "journal_csv", "evidence_csv", "coverage_csv"]);
export const ReviewCoverage = Schema.Struct({
  section: Schema.Literal("coverage"),
  code: Schema.String,
  status: Schema.Literals(["observed", "missing", "unavailable", "unverified", "excluded"]),
  detail: Schema.String,
});
export const ReviewBalance = Schema.Struct({
  section: Schema.Literal("balances"),
  accountId: Accounting.Identifier,
  code: Schema.String,
  name: Schema.String,
  recordedOpeningMinor: Accounting.SignedMinorUnits,
  movementDebitMinor: Accounting.AggregateMinorUnits,
  movementCreditMinor: Accounting.AggregateMinorUnits,
  recordedClosingMinor: Accounting.SignedMinorUnits,
});
export const ReviewJournalLine = Schema.Struct({
  section: Schema.Literal("journal"),
  part: Schema.Literals(["opening", "movement", "excluded_after_end"]),
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  ordinal: Schema.Int,
  sequence: Accounting.MinorUnits,
  postingDate: Accounting.AccountingDate,
  fiscalYearId: Accounting.Identifier,
  periodId: Accounting.Identifier,
  series: Schema.String,
  voucherNumber: Accounting.MinorUnits,
  accountId: Accounting.Identifier,
  accountCode: Schema.String,
  description: Schema.String,
  debitMinor: Accounting.MinorUnits,
  creditMinor: Accounting.MinorUnits,
  eventId: Accounting.Identifier,
  postingPurpose: Schema.String,
  correctsVoucherId: Schema.NullOr(Accounting.Identifier),
  changeSetId: Accounting.Identifier,
  planDigest: Accounting.Digest,
  receiptId: Accounting.Identifier,
  approvalId: Accounting.Identifier,
  approvedBy: Accounting.Identifier,
  committedAt: Schema.String,
  evidenceRefs: Accounting.PostingAction.fields.evidenceRefs,
});
export const ReviewEvidence = Schema.Struct({
  section: Schema.Literal("evidence"),
  id: Accounting.Identifier,
  title: Schema.String,
  origin: Schema.String,
  mediaType: Schema.String,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  content: Schema.String,
  createdAt: Schema.String,
  usedForOpeningExplanation: Schema.Boolean,
  includedVoucherIds: Schema.Array(Accounting.Identifier),
  excludedVoucherIds: Schema.Array(Accounting.Identifier),
  disposition: Schema.Literals(["included_in_ledger_basis", "opening_explanation_only", "excluded_later_posting", "no_included_posting"]),
});
export const ReviewRow = Schema.Union([ReviewBalance, ReviewJournalLine, ReviewEvidence, ReviewCoverage]);
const BankBasis = Schema.Struct({
  sources: Schema.Array(Schema.Struct({
    accountId: Accounting.Identifier, sourceId: Schema.String, revision: Accounting.MinorUnits,
    reconciliationId: Schema.NullOr(Accounting.Identifier), reconciliationKind: Schema.NullOr(Schema.String),
    reconciliationCreatedAt: Schema.NullOr(Schema.String),
  })),
  allRepresentedReady: Schema.Boolean,
});
const CommerceBasis = Schema.Struct({
  schemaVersion: Schema.Literal(1), coverage: Schema.Literal("not_established"),
  startsOn: Accounting.AccountingDate, endsOn: Accounting.AccountingDate,
  registeredInvoiceCount: Schema.Int, invalidRecognitionCount: Schema.Int, invalidAllocationCount: Schema.Int,
  conservationFailureCount: Schema.Int, sourceDigest: Accounting.Digest, blockers: Schema.Array(Schema.String),
});
const ScheduleBasis = Schema.Struct({
  coverageEstablished: Schema.Literal(false), scheduleRevisionDigest: Accounting.Digest,
  scheduleCount: Schema.Int, dueUnpreparedCount: Schema.Int, dueUnpostedCount: Schema.Int,
  reversedOccurrenceCount: Schema.Int, conflictedOccurrenceCount: Schema.Int, limitation: Schema.String,
});
export const ReviewBasis = Schema.Struct({
  sequence: Accounting.MinorUnits,
  profile: Schema.String, profileVersion: Accounting.MinorUnits, writerAuthority: Schema.String,
  writerEpoch: Accounting.MinorUnits, currency: Schema.String, currencyScale: Schema.Int,
  configurationDigest: Accounting.Digest, evidenceInventoryDigest: Accounting.Digest,
  closingStateDigest: Accounting.Digest,
  bank: BankBasis, commerce: CommerceBasis, schedules: ScheduleBasis,
  declaredBankInventories: Schema.Array(Schema.Struct({
    periodId: Accounting.Identifier, inventoryId: Schema.NullOr(Accounting.Identifier),
    evidenceId: Schema.NullOr(Accounting.Identifier), expectedAccountIds: Schema.NullOr(Schema.Array(Accounting.Identifier)),
  })),
});
export const ReviewPack = Schema.Struct({
  id: Accounting.Identifier, kind: Schema.Literal("accountant_review_pack_v1"),
  scope: Accounting.Scope, report: Reports.ReportSnapshot,
  openingBasis: Schema.Struct({
    status: Schema.Literal("not_verified"), method: Schema.Literal("recorded_pre_interval_postings_only"),
    explanation: Accounting.Description, evidenceIds: Schema.Array(Accounting.Identifier),
    earlierVoucherCount: Schema.Int,
  }),
  accountantNotes: Accounting.Description,
  basis: ReviewBasis,
  basisDigest: Accounting.Digest, rowsDigest: Accounting.Digest, digest: Accounting.Digest,
  counts: Schema.Struct({ balances: Schema.Int, journal: Schema.Int, evidence: Schema.Int, coverage: Schema.Int }),
  companyCompleteness: Schema.Literal("not_established"), statutoryReady: Schema.Literal(false),
  generatorVersion: Schema.Literal("accountant-review-v1"), createdBy: Accounting.Identifier, createdAt: Schema.String,
});
export const ReviewArtifactDescriptor = Schema.Struct({
  format: ReviewFormat, filename: Schema.String,
  mediaType: Schema.Literals(["application/json", "text/csv"]),
  encoding: Schema.Literal("UTF-8"), byteLength: Schema.Int,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  cellEncoding: Schema.Literals(["json_exact", "apostrophe_prefixed_text_v1"]),
});
export const ReviewPackView = Schema.Struct({
  pack: ReviewPack, artifacts: Schema.Array(ReviewArtifactDescriptor), dependenciesCurrent: Schema.Boolean,
});
export const ReviewPage = Schema.Struct({
  packId: Accounting.Identifier, packDigest: Accounting.Digest, section: ReviewSection,
  total: Schema.Int, items: Schema.Array(ReviewRow), next: Schema.NullOr(Accounting.MinorUnits),
});
export const ReviewArtifact = Schema.Struct({
  packId: Accounting.Identifier, packDigest: Accounting.Digest,
  descriptor: ReviewArtifactDescriptor, content: Schema.String,
});
export const ReviewPackList = Schema.Struct({
  items: Schema.Array(Schema.Struct({
    id: Accounting.Identifier, digest: Accounting.Digest, reportId: Accounting.Identifier,
    startsOn: Accounting.AccountingDate, endsOn: Accounting.AccountingDate,
    sequence: Accounting.MinorUnits, createdAt: Schema.String,
  })), next: Schema.NullOr(Accounting.MinorUnits),
});
export const ReviewPagePath = Schema.Struct({ ...Accounting.ChangePath.fields, section: ReviewSection });
export const ReviewArtifactPath = Schema.Struct({ ...Accounting.ChangePath.fields, format: ReviewFormat });
const cursor = Schema.Struct({ after: Schema.optional(Accounting.MinorUnits) });
const scoped = { params: Accounting.Scope, error: accountingErrors };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
const path = "/v1/entities/:entityId/books/:bookId/accountant-review-packs";
export const AccountantReviewApi = HttpApiGroup.make("accountantReview").add(
  HttpApiEndpoint.post("prepareReviewPack", path, { ...scoped, headers: Accounting.IdempotencyHeaders,
    payload: PrepareReviewPack.annotate({ parseOptions: { onExcessProperty: "error" } }), success: ReviewPackView }),
  HttpApiEndpoint.get("listReviewPacks", path, { ...scoped, query: cursor, success: ReviewPackList }),
  HttpApiEndpoint.get("getReviewPack", `${path}/:id`, { ...identified, success: ReviewPackView }),
  HttpApiEndpoint.get("reviewPackRows", `${path}/:id/rows/:section`, { params: ReviewPagePath, error: accountingErrors, query: cursor, success: ReviewPage }),
  HttpApiEndpoint.get("reviewPackArtifact", `${path}/:id/artifacts/:format`, { params: ReviewArtifactPath, error: accountingErrors, success: ReviewArtifact }),
);
const scope = { scope: Accounting.Scope };
export const AccountantReviewCapabilities = {
  accountant_review_prepare: {
    description: "Retain a synthetic accountant-review pack with exact ledger/report/source basis, unverified opening explanation, visible missing controls and stable JSON/CSV bytes. Not a statutory report or Visma format.",
    input: Schema.Struct({ ...scope, idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"], input: PrepareReviewPack }), output: ReviewPackView, readOnly: false,
  },
  accountant_review_list: {
    description: "List retained historical accountant-review pack identities.",
    input: Schema.Struct({ ...scope, after: Schema.optional(Accounting.MinorUnits) }), output: ReviewPackList, readOnly: true,
  },
  accountant_review_get: {
    description: "Inspect a retained pack and its exact artifact hashes. Live unchanged dependencies never imply completeness.",
    input: Schema.Struct({ ...scope, packId: Accounting.Identifier }), output: ReviewPackView, readOnly: true,
  },
  accountant_review_rows: {
    description: "Page immutable balances, journal lineage, evidence or missing/excluded coverage from one pack. No live page mixing.",
    input: Schema.Struct({ ...scope, packId: Accounting.Identifier, section: ReviewSection, after: Schema.optional(Accounting.MinorUnits) }), output: ReviewPage, readOnly: true,
  },
  accountant_review_artifact: {
    description: "Read exact retained UTF-8 JSON/CSV review bytes and SHA-256. May contain sensitive original evidence; not a filing or provider export.",
    input: Schema.Struct({ ...scope, packId: Accounting.Identifier, format: ReviewFormat }), output: ReviewArtifact, readOnly: true,
  },
};
