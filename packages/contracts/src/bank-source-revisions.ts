import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import * as Bank from "./reconciliation";
import { accountingErrors as errors } from "./accounting-errors";

// NEXT-10 owner contract: provider revisions to reviewed bank observations,
// extending the bank connector and sync-window owners.
//
// A published sync window records what the provider said. This surface turns
// that into reviewed bank observations, and it is deliberately narrow about
// what it will do.
//
// The amount is never taken from the request. The caller names the page
// ordinal, the record ordinal and the provider transaction identity; the owner
// reads the retained provider bytes for that page, parses the exact amount
// lexeme as a rational decimal, converts it to whole minor units at the
// currency's scale, and flips the sign because the Transactions API's positive
// means money leaving the account. A caller that names a transaction the
// retained bytes do not carry is refused, not believed.
//
// Admission adopts; it never creates. `bank_observations` is keyed by
// statement, so a provider change on its own cannot be an observation, and
// this contract does not invent a second observation register to work around
// that. An admission either adopts an existing statement-backed observation
// with cited retained evidence, or it records that none exists yet.
//
// Nothing here posts, matches or reverses. A removal of an already booked
// observation becomes a case for a human, and the ledger does not move.

const Ref = Accounting.Identifier;

const ChangeKind = Schema.Literals(["added", "modified", "removed"]);

// A provider change inside a published generation. Everything here is
// structural: which page, which record, which identity, and which of the
// provider's own dates applies. No amount and no cash figure is accepted.
export const ApplyProviderRevision = Schema.Struct({
  generationId: Ref,
  pageOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 199 })),
  recordOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 19 })),
  providerTransactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  // The provider's own dates, retained independently rather than collapsed
  // into one booking date by the caller.
  bookingDate: Accounting.AccountingDate,
  authorizationDate: Schema.NullOr(Accounting.AccountingDate),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  // The reviewed profile's booking-date mapping and currency metadata. A
  // currency with no qualified scale refuses; nothing is defaulted.
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  pending: Schema.Boolean,
  pendingReference: Schema.NullOr(Ref),
  // Set when the provider explicitly links this change to a pending
  // predecessor, naming the observation that predecessor is retained as.
  linksPendingPredecessor: Schema.optional(Schema.Boolean),
});

export type ApplyProviderRevision = typeof ApplyProviderRevision.Type;

export const ProviderRevisionOutcome = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("replayed"),
    revisionId: Ref,
    observationId: Ref,
  }),
  Schema.Struct({
    kind: Schema.Literal("pending_observation"),
    revisionId: Ref,
    observationId: Ref,
  }),
  Schema.Struct({
    kind: Schema.Literal("lineage_linked"),
    revisionId: Ref,
    observationId: Ref,
    predecessorObservationId: Ref,
  }),
  Schema.Struct({
    kind: Schema.Literal("new_head"),
    revisionId: Ref,
    observationId: Ref,
  }),
  Schema.Struct({
    kind: Schema.Literal("material_impact"),
    revisionId: Ref,
    observationId: Ref,
    caseId: Ref,
    impactCase: Schema.Struct({
      caseKind: Schema.Literal("material_source_change"),
      priorAdmissionRef: Ref,
      matchedBefore: Schema.Boolean,
      staleEligibilityVersion: Accounting.MinorUnits,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("removal_investigation"),
    revisionId: Ref,
    observationId: Ref,
    caseId: Ref,
    investigationCase: Schema.Struct({
      caseKind: Schema.Literal("removed_booked_observation"),
      bookedBefore: Schema.Boolean,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("overlap_case"),
    revisionId: Ref,
    caseId: Ref,
    candidateObservationIds: Schema.Array(Ref).check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal("ambiguous_order"),
    revisionId: Ref,
    rawLocator: Ref,
  }),
]);

export type ProviderRevisionOutcome = typeof ProviderRevisionOutcome.Type;

export const InterpretedProviderFacts = Schema.Struct({
  revisionId: Ref,
  consentId: Ref,
  providerTransactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  changeKind: ChangeKind,
  publicationVersion: Accounting.MinorUnits,
  // Exact cash movement in whole minor units, already sign-flipped. A removal
  // has no amount at all, so it is null rather than zero.
  cashMovementMinor: Schema.NullOr(Accounting.SignedMinorUnits),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  bookingDate: Accounting.AccountingDate,
  authorizationDate: Schema.NullOr(Accounting.AccountingDate),
  pending: Schema.Boolean,
  pendingReference: Schema.NullOr(Ref),
  // The bytes this was derived from, so the interpretation is falsifiable.
  rawContentSha256: Accounting.Digest,
  rawLocator: Ref,
  parserVersion: Accounting.Identifier,
  // The verbatim provider lexeme, retained. Converting it to a number would
  // lose the evidence that it was exact.
  providerAmountLexeme: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
});

export type InterpretedProviderFacts = typeof InterpretedProviderFacts.Type;

export const ApplyProviderRevisionReceipt = Schema.Struct({
  outcome: ProviderRevisionOutcome,
  facts: InterpretedProviderFacts,
  observationId: Ref,
  // The exact ledger effect of applying this revision. It is always empty: no
  // posting, no match, no reversal happens here.
  journalIds: Schema.Array(Ref),
  receipt: Bank.CommandReceipt,
});

export type ApplyProviderRevisionReceipt = typeof ApplyProviderRevisionReceipt.Type;

export const AdmitProviderObservation = Schema.Struct({
  revisionId: Ref,
  // The statement-backed observation this provider identity is the same event
  // as. Naming an observation that does not exist refuses.
  statementId: Ref,
  rowOrdinal: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  // The retained evidence a human reviewed before deciding two records are the
  // same event. Name similarity is never sufficient and is not accepted.
  evidenceId: Ref,
  rationale: Accounting.Description,
  // The calendar date the review was decided on. It is retained rather than
  // derived, because the owner's clock is not the reviewer's statement.
  decidedOn: Accounting.AccountingDate,
});

export type AdmitProviderObservation = typeof AdmitProviderObservation.Type;

export const ProviderAdmission = Schema.Struct({
  admissionId: Ref,
  revisionId: Ref,
  providerTransactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  relation: Schema.Literal("same_event"),
  // The adopted observation. An admission never mints a second one.
  statementId: Ref,
  rowOrdinal: Schema.Int,
  reviewDigest: Accounting.Digest,
  reviewer: Ref,
  // How many observations this provider identity now resolves to. It is one:
  // the adopted one. Two would be a duplicate cash capacity.
  resolvedObservationCount: Schema.Int,
  journalIds: Schema.Array(Ref),
  receipt: Bank.CommandReceipt,
});

export type ProviderAdmission = typeof ProviderAdmission.Type;

export const ReadProviderObservation = Schema.Struct({
  consentId: Ref,
  providerTransactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});

export type ReadProviderObservation = typeof ReadProviderObservation.Type;

export const ProviderObservationState = Schema.Struct({
  consentId: Ref,
  providerTransactionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  // The interpreted history, oldest first. A removed change appears with no
  // amount, because a removal carries none.
  revisions: Schema.Array(
    Schema.Struct({
      revisionId: Ref,
      changeKind: ChangeKind,
      publicationVersion: Accounting.MinorUnits,
      cashMovementMinor: Schema.NullOr(Accounting.SignedMinorUnits),
      rawContentSha256: Accounting.Digest,
      recordedAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(50)),
  // The adopted observation, or null when the identity has not been admitted.
  admitted: Schema.NullOr(
    Schema.Struct({
      admissionId: Ref,
      statementId: Ref,
      rowOrdinal: Schema.Int,
      relation: Schema.Literal("same_event"),
      reviewDigest: Accounting.Digest,
    }),
  ),
  matched: Schema.Boolean,
  accountingComplete: Schema.Boolean,
  // Raised when a material change made existing eligibility stale. It means a
  // re-check is owed, not that anything is already wrong.
  eligibilityVersion: Accounting.MinorUnits,
  openCases: Schema.Array(
    Schema.Struct({
      caseId: Ref,
      caseKind: Schema.Literals([
        "material_source_change",
        "removed_booked_observation",
        "unresolved_lookalike",
      ]),
      bookedBefore: Schema.Boolean,
      recordedAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(50)),
});

export type ProviderObservationState = typeof ProviderObservationState.Type;

const path = "/v1/entities/:entityId/books/:bookId/banking/provider-observations";

export const BankSourceRevisionsApi = HttpApiGroup.make("bankSourceRevisions")
  .add(
    HttpApiEndpoint.post("applyProviderRevision", path, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: ApplyProviderRevision.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: ApplyProviderRevisionReceipt,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("admitProviderObservation", `${path}/admissions`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: AdmitProviderObservation.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: ProviderAdmission,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("readProviderObservation", `${path}/state`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: ReadProviderObservation.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: ProviderObservationState,
      error: errors,
    }),
  );

// Agent surface. Read-only. An agent may ask what a provider identity
// resolves to and which cases are open. It may not interpret a revision or
// admit an observation: interpreting one commits the interpretation of exact
// money from retained bytes, and admitting one records that two retained
// records are the same economic event, which is a reviewed human decision.
export const BankSourceRevisionsCapabilities = {
  banking_read_provider_observation: {
    description:
      "Read one bank provider transaction identity: its interpreted revision history with exact cash movements, the statement-backed observation it was admitted as, whether matching and accounting are complete, the eligibility version, and any open material-change, removal or lookalike case. A removal appears with no amount because a removal carries none.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ReadProviderObservation,
    }),
    output: ProviderObservationState,
    readOnly: true,
  },
};
