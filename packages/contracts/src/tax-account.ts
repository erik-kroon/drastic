import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./reconciliation";

const SourceKey = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/));
const SourceAmount = Schema.String.check(Schema.isPattern(/^(0|-?[1-9][0-9]{0,37})$/));
export const TaxAccountEventInput = Schema.Struct({
  eventKey: SourceKey,
  occurredOn: A.AccountingDate,
  amountMinor: SourceAmount,
  classification: Schema.Literals([
    "unknown",
    "tax_charge",
    "tax_credit",
    "interest",
    "payment",
    "transfer",
    "other",
  ]),
  description: A.Description,
});
export const RecordTaxAccountStatement = Schema.Struct({
  recordClass: Schema.Literal("synthetic"),
  balanceConvention: Schema.Literal("debit_minus_credit"),
  accountId: A.Identifier,
  sourceAccountKey: SourceKey,
  statementKey: SourceKey,
  evidenceId: A.Identifier,
  sourceLocator: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  reviewEvidenceId: A.Identifier,
  rationale: A.Description,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  openingMinor: SourceAmount,
  closingMinor: SourceAmount,
  rows: Schema.Array(TaxAccountEventInput).check(Schema.isMaxLength(1000)),
});
export const TaxAccountStatement = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  scope: A.Scope,
  input: RecordTaxAccountStatement,
  evidenceSha256: Schema.String,
  reviewEvidenceSha256: Schema.String,
  movementMinor: A.SignedMinorUnits,
  events: Schema.Array(
    Schema.Struct({ id: A.Identifier, ordinal: Schema.Int, input: TaxAccountEventInput }),
  ),
  coverage: Schema.Literal("not_established"),
  taxReturnEffect: Schema.Literal("none"),
  createdAt: Schema.String,
  receipt: CommandReceipt,
});
export const TaxAccountStatementList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      digest: A.Digest,
      accountId: A.Identifier,
      sourceAccountKey: SourceKey,
      statementKey: SourceKey,
      startsOn: A.AccountingDate,
      endsOn: A.AccountingDate,
      createdAt: Schema.String,
    }),
  ),
});
export const SelectTaxAccountMatch = Schema.Struct({
  eventId: A.Identifier,
  statementDigest: A.Digest,
  voucherId: A.Identifier,
  lineId: A.Identifier,
});
export const TaxAccountMatchBasis = Schema.Struct({
  scope: A.Scope,
  selection: SelectTaxAccountMatch,
  statementId: A.Identifier,
  accountId: A.Identifier,
  accountVersion: A.MinorUnits,
  currency: Schema.String,
  currencyScale: Schema.Int,
  profileVersion: A.MinorUnits,
  writerEpoch: A.MinorUnits,
  period: Schema.Struct({ id: A.Identifier, version: A.MinorUnits }),
  event: Schema.Struct({ id: A.Identifier, ordinal: Schema.Int, input: TaxAccountEventInput }),
  sourceEvidenceId: A.Identifier,
  sourceEvidenceSha256: Schema.String,
  line: Schema.Struct({
    voucherId: A.Identifier,
    lineId: A.Identifier,
    ordinal: Schema.Int,
    sequence: A.MinorUnits,
    postingDate: A.AccountingDate,
    debitMinor: A.MinorUnits,
    creditMinor: A.MinorUnits,
    description: Schema.String,
    postingPurpose: Schema.String,
    correctsVoucherId: Schema.NullOr(A.Identifier),
    evidenceRefs: Schema.Array(Schema.Struct({ evidenceId: A.Identifier, sha256: Schema.String })),
  }),
  digest: A.Digest,
});
export const MatchTaxAccountEvent = Schema.Struct({
  selection: SelectTaxAccountMatch,
  expectedBasisDigest: A.Digest,
  evidenceId: A.Identifier,
  rationale: A.Description,
});
export const UnmatchTaxAccountEvent = Schema.Struct({
  expectedDigest: A.Digest,
  evidenceId: A.Identifier,
  rationale: A.Description,
});
export const TaxAccountMatch = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  scope: A.Scope,
  input: MatchTaxAccountEvent,
  basis: TaxAccountMatchBasis,
  evidenceSha256: Schema.String,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});
export const TaxAccountUnmatch = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  scope: A.Scope,
  matchId: A.Identifier,
  input: UnmatchTaxAccountEvent,
  evidenceSha256: Schema.String,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});
export const TaxAccountMatchView = Schema.Struct({
  match: TaxAccountMatch,
  unmatch: Schema.NullOr(TaxAccountUnmatch),
  active: Schema.Boolean,
  usable: Schema.Boolean,
});
export const TaxAccountMatchList = Schema.Struct({ items: Schema.Array(TaxAccountMatchView) });

export const CreateTaxAccountControl = Schema.Struct({
  accountId: A.Identifier,
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
});
export const TaxAccountControl = Schema.Struct({
  id: A.Identifier,
  digest: A.Digest,
  scope: A.Scope,
  input: CreateTaxAccountControl,
  kind: Schema.Literals([
    "synthetic_tax_account_gl_control_v1",
    "synthetic_tax_account_gl_control_v2",
  ]),
  matches: Schema.optional(Schema.Array(TaxAccountMatchView)),
  unmatchedLedgerLines: Schema.optional(
    Schema.Array(Schema.Struct({ voucherId: A.Identifier, lineId: A.Identifier })),
  ),
  dependencyDigest: A.Digest,
  sequence: A.MinorUnits,
  currency: Schema.String,
  currencyScale: Schema.Int,
  account: Schema.Struct({
    id: A.Identifier,
    code: Schema.String,
    name: Schema.String,
    version: A.MinorUnits,
    active: Schema.Boolean,
  }),
  statements: Schema.Array(TaxAccountStatement),
  ledgerLines: Schema.Array(
    Schema.Struct({
      voucherId: A.Identifier,
      lineId: A.Identifier,
      ordinal: Schema.Int,
      sequence: A.MinorUnits,
      postingDate: A.AccountingDate,
      part: Schema.Literals(["opening", "movement"]),
      debitMinor: A.MinorUnits,
      creditMinor: A.MinorUnits,
      amountMinor: A.SignedMinorUnits,
      description: Schema.String,
      postingPurpose: Schema.String,
      correctsVoucherId: Schema.NullOr(A.Identifier),
      reversedByVoucherIds: Schema.Array(A.Identifier),
    }),
  ),
  sourceGaps: Schema.Array(Schema.Struct({ startsOn: A.AccountingDate, endsOn: A.AccountingDate })),
  sourceOverlaps: Schema.Array(
    Schema.Struct({ leftStatementId: A.Identifier, rightStatementId: A.Identifier }),
  ),
  balanceBreaks: Schema.Array(
    Schema.Struct({
      leftStatementId: A.Identifier,
      rightStatementId: A.Identifier,
      differenceMinor: A.SignedMinorUnits,
    }),
  ),
  sourceOpeningMinor: Schema.NullOr(A.SignedMinorUnits),
  sourceMovementMinor: Schema.NullOr(A.SignedMinorUnits),
  sourceClosingMinor: Schema.NullOr(A.SignedMinorUnits),
  ledgerOpeningMinor: A.SignedMinorUnits,
  ledgerMovementMinor: A.SignedMinorUnits,
  ledgerClosingMinor: A.SignedMinorUnits,
  openingDifferenceMinor: Schema.NullOr(A.SignedMinorUnits),
  movementDifferenceMinor: Schema.NullOr(A.SignedMinorUnits),
  closingDifferenceMinor: Schema.NullOr(A.SignedMinorUnits),
  unmatchedEventIds: Schema.Array(A.Identifier),
  unmatchedLedgerLineIds: Schema.Array(A.Identifier),
  unknownClassificationEventIds: Schema.Array(A.Identifier),
  diagnostics: Schema.Array(
    Schema.Literals([
      "missing_source",
      "source_gaps",
      "source_overlaps",
      "source_balance_chain",
      "inactive_account",
      "unknown_classifications",
      "source_ledger_difference",
      "row_matching_unavailable",
      "coverage_unestablished",
      "unmatched_events",
      "unmatched_ledger_lines",
      "invalid_matches",
    ]),
  ),
  coverage: Schema.Literal("not_established"),
  reconciled: Schema.Literal(false),
  financialCloseReady: Schema.Literal(false),
  taxReturnEffect: Schema.Literal("none"),
  createdAt: Schema.String,
  receipt: CommandReceipt,
});
export const TaxAccountControlView = Schema.Struct({
  snapshot: TaxAccountControl,
  dependenciesCurrent: Schema.Boolean,
  artifact: Schema.Struct({
    content: Schema.String,
    sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8388608 })),
    mediaType: Schema.Literal("application/json"),
  }),
});
export const TaxAccountControlList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      digest: A.Digest,
      input: CreateTaxAccountControl,
      createdAt: Schema.String,
    }),
  ),
});
const scoped = { params: A.Scope, error: accountingErrors };
const identified = { params: A.ChangePath, error: accountingErrors };
const path = "/v1/entities/:entityId/books/:bookId/tax-account";
export const TaxAccountApi = HttpApiGroup.make("taxAccount").add(
  HttpApiEndpoint.post("previewTaxAccountMatch", `${path}/matches/preview`, {
    ...scoped,
    payload: SelectTaxAccountMatch.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxAccountMatchBasis,
  }),
  HttpApiEndpoint.post("matchTaxAccountEvent", `${path}/matches`, {
    ...scoped,
    headers: A.IdempotencyHeaders,
    payload: MatchTaxAccountEvent.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxAccountMatch,
  }),
  HttpApiEndpoint.post("unmatchTaxAccountEvent", `${path}/matches/:id/unmatch`, {
    ...identified,
    headers: A.IdempotencyHeaders,
    payload: UnmatchTaxAccountEvent.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxAccountUnmatch,
  }),
  HttpApiEndpoint.get("getTaxAccountMatch", `${path}/matches/:id`, {
    ...identified,
    success: TaxAccountMatchView,
  }),
  HttpApiEndpoint.get("listTaxAccountMatches", `${path}/matches`, {
    ...scoped,
    success: TaxAccountMatchList,
  }),
  HttpApiEndpoint.post("recordTaxAccountStatement", `${path}/statements`, {
    ...scoped,
    headers: A.IdempotencyHeaders,
    payload: RecordTaxAccountStatement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxAccountStatement,
  }),
  HttpApiEndpoint.get("getTaxAccountStatement", `${path}/statements/:id`, {
    ...identified,
    success: TaxAccountStatement,
  }),
  HttpApiEndpoint.get("listTaxAccountStatements", `${path}/statements`, {
    ...scoped,
    success: TaxAccountStatementList,
  }),
  HttpApiEndpoint.post("createTaxAccountControl", `${path}/controls`, {
    ...scoped,
    headers: A.IdempotencyHeaders,
    payload: CreateTaxAccountControl.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: TaxAccountControl,
  }),
  HttpApiEndpoint.get("getTaxAccountControl", `${path}/controls/:id`, {
    ...identified,
    success: TaxAccountControlView,
  }),
  HttpApiEndpoint.get("listTaxAccountControls", `${path}/controls`, {
    ...scoped,
    success: TaxAccountControlList,
  }),
);
// Statement capture/classification is an operator review, not an ordinary MCP mutation.
export const TaxAccountCapabilities = {
  tax_account_preview_match: {
    input: Schema.Struct({ scope: A.Scope, input: SelectTaxAccountMatch }),
    output: TaxAccountMatchBasis,
    readOnly: true,
    description:
      "Read an exact eligible event/posted-line basis for operator review. Does not approve or reserve capacity.",
  },
  tax_account_get_match: {
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: TaxAccountMatchView,
    readOnly: true,
    description:
      "Read immutable tax-account match/unmatch history with separate active and usable status.",
  },
  tax_account_list_matches: {
    input: Schema.Struct({ scope: A.Scope }),
    output: TaxAccountMatchList,
    readOnly: true,
    description: "List all bounded tax-account reviews and effective matching status.",
  },
  tax_account_get_statement: {
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: TaxAccountStatement,
    readOnly: true,
    description:
      "Read retained synthetic tax-account statement and stable event identities. Does not recognize taxable activity or a payment.",
  },
  tax_account_list_statements: {
    input: Schema.Struct({ scope: A.Scope }),
    output: TaxAccountStatementList,
    readOnly: true,
    description: "List the complete bounded synthetic tax-account statement inventory.",
  },
  tax_account_create_control: {
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      input: CreateTaxAccountControl,
    }),
    output: TaxAccountControl,
    readOnly: false,
    description:
      "Capture exact source and full selected-account GL rollforwards with effective reviewed one-to-one matches and unresolved items. Complete coverage, full reconciliation and financial-close readiness remain unavailable even with zero differences.",
  },
  tax_account_get_control: {
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: TaxAccountControlView,
    readOnly: true,
    description:
      "Read immutable synthetic tax-account GL control bytes with separate live dependency currentness.",
  },
  tax_account_list_controls: {
    input: Schema.Struct({ scope: A.Scope }),
    output: TaxAccountControlList,
    readOnly: true,
    description: "Rediscover all bounded retained synthetic tax-account GL controls.",
  },
};
