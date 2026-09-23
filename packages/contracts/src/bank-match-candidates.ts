import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { RowOrdinal } from "./reconciliation";

export const BankCandidateSource = Schema.Struct({
  statementId: Accounting.Identifier,
  rowOrdinal: RowOrdinal,
});
export const DiscoverBankMatchCandidates = Schema.Struct({
  ...BankCandidateSource.fields,
  previousDigest: Schema.optionalKey(Accounting.Digest),
});
export const BankCandidateBlock = Schema.Literals([
  "account_inactive", "currency_mismatch", "source_no_capacity",
  "source_period_missing", "source_period_ambiguous", "source_period_locked",
  "opposite_sign", "line_no_capacity", "tax_account_reserved", "reversing_voucher", "reversed_voucher",
  "posting_period_missing", "posting_period_ambiguous", "posting_period_locked",
]);
export const BankCandidateReason = Schema.Literals([
  "retained_relationship_history", "statement_evidence_cited", "equal_remaining_amount",
  "amount_proximity_heuristic", "date_proximity_heuristic",
]);
export const BankMatchCandidate = Schema.Struct({
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
  accountId: Accounting.Identifier,
  postedOn: Accounting.AccountingDate,
  sequence: Accounting.MinorUnits,
  description: Accounting.Description,
  amountMinor: Accounting.SignedMinorUnits,
  allocatedMinor: Accounting.SignedMinorUnits,
  remainingMinor: Accounting.SignedMinorUnits,
  eligible: Schema.Boolean,
  blockedReasons: Schema.Array(BankCandidateBlock),
  sameAccount: Schema.Literal(true),
  sameCurrency: Schema.Boolean,
  sameSign: Schema.Boolean,
  retainedRelationship: Schema.Boolean,
  statementEvidenceCited: Schema.Boolean,
  equalRemainingAmount: Schema.Boolean,
  amountDistanceMinor: Accounting.AggregateMinorUnits,
  dayDistance: Schema.Int,
  rankingReasons: Schema.Array(BankCandidateReason),
});
export const BankMatchCandidates = Schema.Struct({
  version: Schema.Literal("bank_match_candidates_v1"),
  scope: Accounting.Scope,
  currency: Schema.String,
  currencyScale: Schema.Int,
  window: Schema.Struct({
    accountId: Accounting.Identifier,
    startsOn: Accounting.AccountingDate,
    endsOn: Accounting.AccountingDate,
    lineLimit: Schema.Literal(1000),
    completeWithinScope: Schema.Literal(true),
  }),
  cutoff: Schema.Struct({
    committedSequence: Accounting.MinorUnits,
    sourceRevision: Accounting.MinorUnits,
    accountVersion: Accounting.MinorUnits,
    profileVersion: Accounting.MinorUnits,
    writerEpoch: Accounting.MinorUnits,
    periodDigest: Accounting.Digest,
  }),
  source: Schema.Struct({
    ...BankCandidateSource.fields,
    evidenceId: Accounting.Identifier,
    evidenceSha256: Schema.String,
    sourceBankAccountId: Schema.String,
    providerId: Schema.NullOr(Schema.String),
    observedOn: Accounting.AccountingDate,
    description: Accounting.Description,
    amountMinor: Accounting.SignedMinorUnits,
    allocatedMinor: Accounting.SignedMinorUnits,
    remainingMinor: Accounting.SignedMinorUnits,
    eligible: Schema.Boolean,
    blockedReasons: Schema.Array(BankCandidateBlock),
  }),
  candidates: Schema.Array(BankMatchCandidate).check(Schema.isMaxLength(1000)),
  eligibleCount: Schema.Int,
  equalAmountEligibleCount: Schema.Int,
  multipleEligibleCandidates: Schema.Boolean,
  identityEstablished: Schema.Literal(false),
  providerReferenceComparison: Schema.Literal("unavailable"),
  rankingPolicy: Schema.Literal("retained_then_amount_date_v1"),
  coverage: Schema.Literal("not_established"),
  digest: Accounting.Digest,
  previousDigestMatches: Schema.NullOr(Schema.Boolean),
});

export const BankMatchCandidatesApi = HttpApiGroup.make("bankMatchCandidates").add(
  HttpApiEndpoint.post("discoverBankMatchCandidates", "/v1/entities/:entityId/books/:bookId/bank-match-candidates", {
    params: Accounting.Scope,
    payload: DiscoverBankMatchCandidates.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankMatchCandidates,
    error: accountingErrors,
  }),
);
export const BankMatchCandidateCapabilities = {
  bank_discover_match_candidates: {
    description: "Read all bounded mapped-account lines in a retained source's statement interval. Explain effective capacity, blockers and heuristic ranking; never establish identity, select or apply a match.",
    input: Schema.Struct({ scope: Accounting.Scope, input: DiscoverBankMatchCandidates }),
    output: BankMatchCandidates,
    readOnly: true,
  },
};
