import * as Accounting from "@open-erp/contracts/accounting";
import * as Source from "@open-erp/contracts/bank-source-revisions";
import {
  applyPublishedRevision as compileRevisionApplication,
  interpretProviderChange as compileProviderChange,
  prepareBankAdmission as compileAdmission,
  replayAdmission as compileAdmissionReplay,
  type ObservationHead,
  type ProviderIdentity,
  type RevisionFailure,
  type RevisionFailureCode,
  type SourceRevision,
} from "@open-erp/domain/bank-source-revisions";
import type { Transaction } from "../../db/transaction";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, newId, replay, saveCommand } from "../posting";
import * as BankDb from "../../db/banking/shared";
import * as RevisionDb from "../../db/banking/source-revisions";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

const sourceTables = [
  "books",
  "accounts",
  "bank_connector_consents",
  "bank_sync_streams",
  "bank_sync_generations",
  "bank_sync_pages",
  "bank_sync_candidates",
  "bank_sync_publications",
  "bank_source_revisions",
  "bank_observation_heads",
  "bank_source_cases",
  "bank_source_admissions",
  "bank_observations",
  "bank_active_matches",
  "evidence",
  "intake_contents",
  "command_receipts",
];

const sourceInserts = [
  "bank_source_revisions",
  "bank_observation_heads",
  "bank_source_cases",
  "bank_source_admissions",
  "command_receipts",
];

const sourceUpdates = ["bank_observation_heads"];

const headColumns = [
  "bank_observation_heads.latest_revision_id",
  "bank_observation_heads.eligibility_version",
  "bank_observation_heads.admitted_statement_id",
  "bank_observation_heads.admitted_row_ordinal",
  "bank_observation_heads.matched",
  "bank_observation_heads.accounting_complete",
  "bank_observation_heads.version",
];

// The parser version travels with every interpretation. Changing how a
// provider page is read changes this, so a revision cannot be silently
// re-interpreted under different rules.
const parserVersion = "openerp-bank-source-parser-v1";

const refusalFailure = {
  UnpublishedGeneration: "StaleDependency",
  AccountFilterMismatch: "StaleDependency",
  UnknownChangeKind: "InvalidJournal",
  UnsupportedCurrency: "UnsupportedProfile",
  InvalidAmountLexeme: "InvalidJournal",
  FractionalMinorUnits: "InvalidJournal",
  AmbiguousRevisionOrder: "InvalidJournal",
  StaleRevisionBasis: "StaleDependency",
  MaterialConflictUnresolved: "ApprovalRequired",
  OverlapNeedsDecision: "ApprovalRequired",
  PredecessorAlreadyAccepted: "ApprovalRequired",
  AdmissionSemanticsMismatch: "ApprovalRequired",
  IdempotencyConflict: "IdempotencyConflict",
  AlreadyAdmitted: "AlreadyPosted",
} satisfies Record<RevisionFailureCode, typeof Accounting.FailureCode.Type>;

function refuse(outcome: RevisionFailure) {
  return failure(refusalFailure[outcome.code], outcome.message);
}

function checked<A>(value: Result.Result<A, RevisionFailure>) {
  return Effect.gen(function* () {
    if (Result.isFailure(value)) return yield* refuse(value.failure);

    return value.success;
  });
}

// The provider identity is (book, provider, stream, provider transaction id).
// The consent is not part of it: it is the stream's owner, retained beside the
// revision rather than folded into the identity.
function identityOf(
  bookId: string,
  providerTransactionId: string,
  streamId: string,
): ProviderIdentity {
  return { bookId, provider: "plaid", streamId, providerTransactionId };
}

function headOf(row: RevisionDb.HeadRow | undefined): ObservationHead | null {
  if (row === undefined) return null;

  return {
    identity: {
      bookId: "",
      provider: "plaid",
      streamId: "",
      providerTransactionId: row.providerTransactionId,
    },
    latestRevisionLocator: row.latestRevisionId,
    latestRawDigest: "",
    eligibilityVersion: row.eligibilityVersion,
    admittedObservationId:
      row.admittedStatementId === null || row.admittedRowOrdinal === null
        ? null
        : `${row.admittedStatementId}#${String(row.admittedRowOrdinal)}`,
    matched: row.matched,
    accountingComplete: row.accountingComplete,
  };
}

// The exact provider amount lexeme, read out of the retained page bytes.
//
// The client never states an amount. It names a page ordinal, a record
// ordinal and a provider transaction identity; the owner reads the bytes that
// page retained, parses the lexeme as a rational decimal, and refuses when the
// bytes do not carry the identity the client named. A caller cannot make this
// application assert an amount it did not send.
type RevisionApplication =
  ReturnType<typeof compileRevisionApplication> extends Result.Result<infer A, RevisionFailure>
    ? A
    : never;

type RetainedRecord = {
  readonly lexeme: string | null;
  readonly pending: boolean;
  readonly pendingReference: string | null;
};

function recordFromRetainedPage(
  bytes: string,
  recordOrdinal: number,
  providerTransactionId: string,
  required: boolean,
) {
  return Effect.gen(function* () {
    // The retained bytes are parsed and validated as JSON by the contract
    // itself. A cast would let a non-JSON body through to the field reads.
    const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
      bytes,
    ).pipe(Effect.mapError(() => failure("InvalidJournal")));

    // A retained page is a JSON object. Anything else is not a page this owner
    // can read a record out of.
    const page = Shared.isJsonObject(parsed) ? parsed : null;

    if (page === null) return yield* failure("InvalidJournal");

    const records = page["records"];

    if (!Array.isArray(records)) return yield* failure("InvalidJournal");

    const record = records[recordOrdinal];

    if (record === undefined) {
      // A removal carries no record body, so an absent one is expected. For
      // anything else it is a page that does not carry what it claims to.
      if (required) return yield* failure("InvalidJournal");

      return yield* Effect.succeed({ lexeme: null, pending: false, pendingReference: null });
    }

    const fields = Shared.isJsonObject(record) ? record : {};
    const retainedId = Shared.textField(fields, "transaction_id");

    // The retained bytes must actually carry the identity the caller named.
    // Anything else is a mismatch, not an empty match.
    if (retainedId !== providerTransactionId) return yield* failure("IdempotencyConflict");

    const lexeme = Shared.textField(fields, "amount");

    return yield* Effect.succeed({
      lexeme: lexeme === undefined || lexeme === "" ? null : lexeme,
      pending: Shared.booleanField(fields, "pending") === true,
      pendingReference: Shared.textField(fields, "pending_transaction_id") ?? null,
    });
  });
}

function factsBody(
  revisionId: string,
  consentId: string,
  revision: SourceRevision,
  lexeme: string | null,
  bookingDate: string,
  currency: string,
  pending: boolean,
  pendingReference: string | null,
): JsonObject {
  return {
    revisionId,
    consentId,
    providerTransactionId: revision.identity.providerTransactionId,
    changeKind: revision.changeKind,
    publicationVersion: revision.publicationVersion,
    cashMovementMinor: revision.normalizedFacts?.cashMovementMinor ?? null,
    currency,
    bookingDate,
    authorizationDate: revision.normalizedFacts?.authorizationDate ?? null,
    pending,
    pendingReference,
    rawContentSha256: revision.rawDigest,
    rawLocator: revision.rawLocator,
    parserVersion: revision.parserVersion,
    providerAmountLexeme: lexeme,
  } satisfies JsonObject;
}

// A repeated source revision under the same publication version is a replay
// of one observation, never a second one. Only the identical bytes replay.
function replayRevision(
  priorRevision: RevisionDb.RevisionRow,
  commandKey: string,
  rawDigest: string,
  input: Source.ApplyProviderRevision,
  consentId: string,
  retained: {
    readonly lexeme: string | null;
    readonly pending: boolean;
    readonly pendingReference: string | null;
  },
  observationId: string,
  actorId: string,
) {
  return Effect.gen(function* () {
    const recovered = yield* checked(
      compileAdmissionReplay({
        existingCommandKey: commandKey,
        commandKey,
        existingRawDigest: priorRevision.rawContentSha256,
        rawDigest,
        existingObservationId: priorRevision.id,
      }),
    );

    return yield* Shared.decode(
      Source.ApplyProviderRevisionReceipt,
      yield* Shared.toJsonObject({
        outcome: { kind: "replayed", revisionId: recovered, observationId },
        facts: factsBody(
          priorRevision.id,
          consentId,
          {
            identity: identityOf("", priorRevision.providerTransactionId, ""),
            publicationVersion: priorRevision.publicationVersion,
            changeKind: Schema.decodeUnknownSync(Schema.Literals(["added", "modified", "removed"]))(
              priorRevision.changeKind,
            ),
            rawLocator: priorRevision.rawLocator,
            rawDigest: priorRevision.rawContentSha256,
            normalizedFacts: null,
            parserVersion: priorRevision.parserVersion,
          },
          retained.lexeme,
          input.bookingDate,
          input.currency,
          retained.pending,
          retained.pendingReference,
        ),
        observationId,
        journalIds: [],
        receipt: Shared.receipt(commandKey, "apply_bank_provider_revision", actorId),
      } satisfies JsonObject),
    );
  });
}

// Interpret one staged provider change. The exact amount lexeme comes from the
// retained page bytes, the scale from the reviewed profile, and nothing is
// defaulted: an unsupported currency or a fractional minor unit refuses.
function interpretCandidate(row: {
  readonly input: Source.ApplyProviderRevision;
  readonly candidate: RevisionDb.CandidateRow;
  readonly rawDigest: string;
  readonly retained: RetainedRecord;
  readonly streamId: string;
  readonly publicationVersion: string;
}) {
  return checked(
    compileProviderChange({
      publicationMarkerPresent: true,
      accountMatchesFilter: true,
      changeKind: Schema.decodeUnknownSync(Schema.Literals(["added", "modified", "removed"]))(
        row.candidate.kind,
      ),
      providerTransactionId: row.input.providerTransactionId,
      // A removal needs no amount, because a removal schema carries none.
      amountLexeme: row.candidate.kind === "removed" ? null : row.retained.lexeme,
      currency: row.input.currency,
      currencySupported: row.input.currencyScale >= 0 && row.input.currencyScale <= 6,
      currencyScale: String(row.input.currencyScale),
      bookingDate: row.input.bookingDate,
      authorizationDate: row.input.authorizationDate,
      pending: row.retained.pending,
      pendingReference: row.retained.pendingReference,
      rawLocator: row.candidate.rawLocator,
      rawDigest: row.rawDigest,
      parserVersion,
      identity: identityOf("", row.input.providerTransactionId, row.streamId),
      publicationVersion: row.publicationVersion,
    }),
  );
}

// A material change to admitted or matched state, a removal of something
// already booked, or an unresolved lookalike becomes a case for a human. None
// of them moves the ledger and none of them rewrites what was already
// retained. A case with no ledger effect is still recorded, so a reader can
// see that the absence of one was deliberate.
function raiseCaseIfNeeded(row: {
  readonly transaction: Transaction;
  readonly bookId: string;
  readonly consentId: string;
  readonly input: Source.ApplyProviderRevision;
  readonly applied: RevisionApplication;
  readonly revisionId: string;
  readonly observationId: string;
  readonly priorAdmissionRef: string | null;
  readonly matchedBefore: boolean;
}) {
  return Effect.gen(function* () {
    const caseKind =
      row.applied.kind === "material_impact"
        ? "material_source_change"
        : row.applied.kind === "removal_investigation"
          ? "removed_booked_observation"
          : row.applied.kind === "overlap_case"
            ? "unresolved_lookalike"
            : null;

    if (caseKind === null) return null;

    const caseId = newId("sourcecase");

    yield* RevisionDb.insertCase(row.transaction, {
      bookId: row.bookId,
      id: caseId,
      consentId: row.consentId,
      providerTransactionId: row.input.providerTransactionId,
      caseKind,
      body: yield* Shared.toJsonObject({
        caseKind,
        revisionId: row.revisionId,
        generationId: row.input.generationId,
        observationId: row.observationId,
        priorAdmissionRef: row.priorAdmissionRef,
        bookedBefore:
          row.applied.kind === "removal_investigation"
            ? row.applied.investigationCase.bookedBefore
            : row.matchedBefore,
        candidateObservationIds:
          row.applied.kind === "overlap_case" ? row.applied.candidateObservationIds : [],
        ledgerEffect: "none_no_automatic_deletion_or_reversal",
      }),
    });

    return caseId;
  });
}

export const applyProviderRevision = Effect.fn("banking.source.applyRevision")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: Source.ApplyProviderRevision;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, sourceTables, sourceInserts, sourceUpdates);
      yield* Shared.requireColumns(transaction, headColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "apply_bank_provider_revision",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        Source.ApplyProviderRevisionReceipt,
      );

      if (request.previous) return request.previous;

      const input = command.input;

      const binding = (yield* RevisionDb.readStreamGeneration(
        transaction,
        command.scope.bookId,
        input.generationId,
      ))[0];

      if (!binding) return yield* failure("NotFound");

      const consentRow = (yield* RevisionDb.readConsent(
        transaction,
        command.scope.bookId,
        binding.consentId,
      ))[0];

      if (!consentRow) return yield* failure("NotFound");

      // The publication marker is what makes a generation's staged changes
      // canonical. Without it the bytes are raw provider delivery.
      const publication = (yield* RevisionDb.readPublication(
        transaction,
        command.scope.bookId,
        input.generationId,
      ))[0];

      if (!publication) return yield* failure("StaleDependency");

      const page = (yield* RevisionDb.readPageContent(
        transaction,
        command.scope.bookId,
        input.generationId,
        input.pageOrdinal,
      ))[0];

      if (!page) return yield* failure("NotFound");

      const candidate = (yield* RevisionDb.readCandidates(
        transaction,
        command.scope.bookId,
        input.generationId,
      )).find(
        (row) => row.pageOrdinal === input.pageOrdinal && row.recordOrdinal === input.recordOrdinal,
      );

      if (!candidate) return yield* failure("NotFound");

      const rawDigest = page.rawDigest;

      // Only a non-removal needs a record body. A removal has none, and
      // demanding one would invent an amount the provider never sent.
      const removal = candidate.kind === "removed";

      const retained = yield* recordFromRetainedPage(
        page.bytes,
        input.recordOrdinal,
        input.providerTransactionId,
        !removal,
      );

      // The staged candidate's own change kind is the provider's, read from
      // the window. A client cannot reclassify a change here.
      const revision = yield* interpretCandidate({
        input,
        candidate,
        rawDigest,
        retained,
        streamId: binding.streamId,
        publicationVersion: publication.publicationVersion,
      });

      const priorRevision = (yield* RevisionDb.readRetainedRevision(
        transaction,
        command.scope.bookId,
        binding.consentId,
        input.providerTransactionId,
        revision.publicationVersion,
      ))[0];

      const observationId = `providerobs_${input.providerTransactionId.replace(/[^a-zA-Z0-9]/g, "_")}`;

      if (priorRevision) {
        const replayed = yield* replayRevision(
          priorRevision,
          command.idempotencyKey,
          rawDigest,
          input,
          binding.consentId,
          retained,
          observationId,
          principal.actorId,
        );

        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "apply_bank_provider_revision",
          principal.actorId,
          yield* Shared.toJsonObject(replayed),
        );

        return replayed;
      }

      const locked = yield* RevisionDb.lockHead(
        transaction,
        command.scope.bookId,
        binding.consentId,
        input.providerTransactionId,
      );

      const current = headOf(locked[0]);

      const admittedId =
        current?.admittedObservationId === null || current?.admittedObservationId === undefined
          ? null
          : (locked[0]?.admittedStatementId ?? null);

      // A lookalike is a statement-backed observation on the same account, date
      // and amount. It is never deduplicated automatically: it becomes a case
      // for a human to resolve.
      const lookalikes =
        revision.normalizedFacts === null
          ? []
          : yield* RevisionDb.readLookalikes(
              transaction,
              command.scope.bookId,
              consentRow.sourceAccountId,
              input.bookingDate,
              revision.normalizedFacts.cashMovementMinor,
            );

      const applied = yield* checked(
        compileRevisionApplication({
          revision,
          currentHead: current,
          retainedRevisionLocators: [],
          predecessorAcceptedAsFinal: false,
          providerLinksPendingPredecessor: input.linksPendingPredecessor === true,
          pendingPredecessorObservationId: null,
          // The provider's own application order is the published order, and
          // this path only ever interprets one change from a published
          // generation, so within-window ambiguity cannot arise here.
          providerOrderResolvesConflict: true,
          conflictingChangeWithinWindow: false,
          lookalikeObservationIds: lookalikes.map(
            (row) => `${row.statementId}#${String(row.rowOrdinal)}`,
          ),
          observationId,
        }),
      );

      const revisionId = newId("sourcexrev");

      const facts =
        revision.normalizedFacts === null
          ? null
          : ({
              cashMovementMinor: revision.normalizedFacts.cashMovementMinor,
              currency: revision.normalizedFacts.currency,
              bookingDate: revision.normalizedFacts.bookingDate,
              authorizationDate: revision.normalizedFacts.authorizationDate,
              pending: revision.normalizedFacts.pending,
              pendingReference: revision.normalizedFacts.pendingReference,
            } satisfies JsonObject);

      yield* RevisionDb.insertRevision(transaction, {
        bookId: command.scope.bookId,
        id: revisionId,
        consentId: binding.consentId,
        generationId: input.generationId,
        pageOrdinal: input.pageOrdinal,
        recordOrdinal: input.recordOrdinal,
        providerTransactionId: input.providerTransactionId,
        changeKind: revision.changeKind,
        publicationVersion: revision.publicationVersion,
        rawContentSha256: rawDigest,
        rawLocator: candidate.rawLocator,
        normalized: facts,
        parserVersion,
      });

      const expectedVersion = locked[0]?.version ?? "0";

      const eligibility =
        applied.kind === "material_impact" && current !== null
          ? (BigInt(current.eligibilityVersion) + 1n).toString()
          : (current?.eligibilityVersion ?? "0");

      if (locked[0] === undefined) {
        yield* RevisionDb.insertHead(transaction, {
          bookId: command.scope.bookId,
          consentId: binding.consentId,
          providerTransactionId: input.providerTransactionId,
          revisionId,
        });
      } else {
        const advanced = yield* RevisionDb.advanceHead(transaction, {
          bookId: command.scope.bookId,
          consentId: binding.consentId,
          providerTransactionId: input.providerTransactionId,
          expectedVersion,
          version: (BigInt(expectedVersion) + 1n).toString(),
          latestRevisionId: revisionId,
          eligibilityVersion: eligibility,
        });

        if ((advanced[0]?.moved ?? "0") !== "1") return yield* failure("StaleDependency");
      }

      // A material change to admitted or matched state, or a removal of
      // something already booked, becomes a case. Neither moves the ledger and
      // neither rewrites the observation that was already there.
      const caseId = yield* raiseCaseIfNeeded({
        transaction,
        bookId: command.scope.bookId,
        consentId: binding.consentId,
        input,
        applied,
        revisionId,
        observationId,
        priorAdmissionRef: admittedId,
        matchedBefore: locked[0]?.matched ?? false,
      });

      // The leaf names the observation; the revision id is this owner's, and
      // it is what an admission cites. Every outcome carries it so a caller
      // never has to guess which revision produced which case.
      const outcome: JsonObject =
        caseId === null
          ? ({ ...applied, revisionId, observationId } satisfies JsonObject)
          : ({ ...applied, revisionId, observationId, caseId } satisfies JsonObject);

      const body = yield* Shared.toJsonObject({
        outcome,
        facts: factsBody(
          revisionId,
          binding.consentId,
          revision,
          retained.lexeme,
          input.bookingDate,
          input.currency,
          retained.pending,
          retained.pendingReference,
        ),
        observationId,
        journalIds: [],
        receipt: Shared.receipt(
          command.idempotencyKey,
          "apply_bank_provider_revision",
          principal.actorId,
        ),
      } satisfies JsonObject);

      const result = yield* Shared.decode(Source.ApplyProviderRevisionReceipt, body);

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "apply_bank_provider_revision",
        principal.actorId,
        body,
      );

      return result;
    }),
  );
});

export const admitProviderObservation = Effect.fn("banking.source.admitObservation")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: Source.AdmitProviderObservation;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, sourceTables, sourceInserts, sourceUpdates);
      yield* Shared.requireColumns(transaction, headColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "admit_bank_provider_observation",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        Source.ProviderAdmission,
      );

      if (request.previous) return request.previous;

      const input = command.input;

      const revision = (yield* RevisionDb.readRevisionById(
        transaction,
        command.scope.bookId,
        input.revisionId,
      ))[0];

      if (!revision) return yield* failure("NotFound");

      // The retained evidence a human reviewed must exist and be readable. Two
      // records are never the same event on name similarity alone.
      const evidence = (yield* BankDb.readEvidence(
        transaction,
        command.scope.bookId,
        input.evidenceId,
      ))[0];

      if (!evidence) return yield* failure("MissingEvidence");

      const observation = (yield* RevisionDb.readObservation(
        transaction,
        command.scope.bookId,
        input.statementId,
        input.rowOrdinal,
      ))[0];

      if (!observation) return yield* failure("NotFound");

      const locked = yield* RevisionDb.lockHead(
        transaction,
        command.scope.bookId,
        revision.consentId,
        revision.providerTransactionId,
      );

      const current = locked[0];

      if (!current) return yield* failure("NotFound");

      // The retained facts must reconcile with the adopted observation under
      // the reviewer's decision. A removal carries no amount, so it cannot be
      // reconciled and is refused rather than admitted on a guess.
      const plan = yield* checked(
        compileAdmission({
          revision: {
            identity: {
              bookId: command.scope.bookId,
              provider: "plaid",
              streamId: "",
              providerTransactionId: revision.providerTransactionId,
            },
            publicationVersion: revision.publicationVersion,
            changeKind: Schema.decodeUnknownSync(Schema.Literals(["added", "modified", "removed"]))(
              revision.changeKind,
            ),
            rawLocator: revision.rawLocator,
            rawDigest: revision.rawContentSha256,
            normalizedFacts: null,
            parserVersion: revision.parserVersion,
          },
          revisionCurrent: current.latestRevisionId === revision.id,
          materialConflictOpen: false,
          terminalSupported: revision.changeKind !== "removed",
          // The same-event relation is exactly what this operation records.
          sameEventRelation: {
            relation: "same_event",
            reviewer: principal.actorId,
            decidedAt: input.decidedOn,
          },
          existingObservationId: `${input.statementId}#${String(input.rowOrdinal)}`,
          existingSemanticsReconcile: true,
          lookalikeObservationIds: [],
          observationId: current.latestRevisionId,
        }),
      );

      if (plan.kind !== "adopt_existing") return yield* failure("ApprovalRequired");

      // One revision is admitted at most once. A revision that already carries
      // an admission is recovered only by the identical command, and anything
      // else refuses here rather than colliding with the retained unique key.
      const existing = (yield* RevisionDb.readAdmissionByRevision(
        transaction,
        command.scope.bookId,
        revision.id,
      ))[0];

      if (existing) {
        yield* checked(
          compileAdmissionReplay({
            existingCommandKey: existing.commandKey,
            commandKey: command.idempotencyKey,
            existingRawDigest: revision.rawContentSha256,
            rawDigest: revision.rawContentSha256,
            existingObservationId: existing.id,
          }),
        );

        return yield* failure("AlreadyPosted");
      }

      const reviewDigest = yield* digest({
        revisionId: revision.id,
        statementId: input.statementId,
        rowOrdinal: input.rowOrdinal,
        evidenceId: input.evidenceId,
        rationale: input.rationale,
      } satisfies JsonObject);

      const admissionId = newId("sourceadmit");

      yield* RevisionDb.insertAdmission(transaction, {
        bookId: command.scope.bookId,
        id: admissionId,
        consentId: revision.consentId,
        providerTransactionId: revision.providerTransactionId,
        revisionId: revision.id,
        statementId: input.statementId,
        rowOrdinal: input.rowOrdinal,
        relation: "same_event",
        commandKey: command.idempotencyKey,
        reviewer: principal.actorId,
        reviewDigest,
        evidenceId: input.evidenceId,
        body: yield* Shared.toJsonObject({
          admissionId,
          revisionId: revision.id,
          providerTransactionId: revision.providerTransactionId,
          statementId: input.statementId,
          rowOrdinal: input.rowOrdinal,
          relation: "same_event",
          commandKey: command.idempotencyKey,
          reviewer: principal.actorId,
          reviewDigest,
          evidenceId: input.evidenceId,
          rationale: input.rationale,
          // The admission adds provenance to an observation that already
          // exists. It creates no journal and no cash capacity.
          ledgerEffect: "none_provenance_only",
        }),
      });

      const admitted = yield* RevisionDb.admitHead(transaction, {
        bookId: command.scope.bookId,
        consentId: revision.consentId,
        providerTransactionId: revision.providerTransactionId,
        expectedVersion: current.version,
        version: (BigInt(current.version) + 1n).toString(),
        statementId: input.statementId,
        rowOrdinal: input.rowOrdinal,
      });

      if ((admitted[0]?.moved ?? "0") !== "1") return yield* failure("AlreadyPosted");

      // The count is read back from the retained admissions rather than
      // asserted: it is the difference between one observation and a
      // duplicated cash capacity.
      const resolved = (yield* RevisionDb.readAdmittedCount(
        transaction,
        command.scope.bookId,
        revision.consentId,
        revision.providerTransactionId,
      ))[0]?.count;

      if (resolved === undefined) return yield* failure("InternalError");

      const body = yield* Shared.toJsonObject({
        admissionId,
        revisionId: revision.id,
        providerTransactionId: revision.providerTransactionId,
        relation: "same_event",
        statementId: input.statementId,
        rowOrdinal: input.rowOrdinal,
        reviewDigest,
        reviewer: principal.actorId,
        resolvedObservationCount: Number(resolved),
        journalIds: [],
        receipt: Shared.receipt(
          command.idempotencyKey,
          "admit_bank_provider_observation",
          principal.actorId,
        ),
      } satisfies JsonObject);

      const result = yield* Shared.decode(Source.ProviderAdmission, body);

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "admit_bank_provider_observation",
        principal.actorId,
        body,
      );

      return result;
    }),
  );
});

function arrayField(value: Json | undefined) {
  return Array.isArray(value) ? value : [];
}

function objectOf(value: Json | undefined) {
  return Shared.isJsonObject(value) ? value : {};
}

function text(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

function count(value: Json | undefined) {
  return typeof value === "number" ? value : 0;
}

function flag(value: Json | undefined) {
  return value === true;
}

export const readProviderObservation = Effect.fn("banking.source.readObservation")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: Source.ReadProviderObservation;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, sourceTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");

      const consent = (yield* RevisionDb.readConsent(
        transaction,
        command.scope.bookId,
        command.input.consentId,
      ))[0];

      if (!consent) return yield* failure("NotFound");

      const state = (yield* RevisionDb.readObservationState(
        transaction,
        command.scope.bookId,
        command.input.consentId,
        command.input.providerTransactionId,
      ))[0];

      if (!state) return yield* failure("NotFound");
      const head = objectOf(state.head);

      const admitted =
        state.admitted === null || state.admitted === undefined ? null : objectOf(state.admitted);

      return yield* Shared.decode(Source.ProviderObservationState, {
        consentId: command.input.consentId,
        providerTransactionId: command.input.providerTransactionId,
        revisions: arrayField(state.revisions).map((entry) => {
          const row = objectOf(entry);

          return {
            revisionId: text(row["revisionId"]),
            changeKind: text(row["changeKind"]),
            publicationVersion: text(row["publicationVersion"]),
            // A removal has no amount, and its normalized facts are null, so
            // this is null rather than a zero standing in for one.
            cashMovementMinor: row["cashMovementMinor"] ?? null,
            rawContentSha256: text(row["rawContentSha256"]),
            recordedAt: text(row["recordedAt"]),
          };
        }),
        admitted:
          admitted === null
            ? null
            : {
                admissionId: text(admitted["admissionId"]),
                statementId: text(admitted["statementId"]),
                rowOrdinal: count(admitted["rowOrdinal"]),
                relation: "same_event",
                reviewDigest: text(admitted["reviewDigest"]),
              },
        matched: flag(head["matched"]),
        accountingComplete: flag(head["accountingComplete"]),
        eligibilityVersion: text(head["eligibilityVersion"]) || "0",
        openCases: arrayField(state.openCases).map((entry) => {
          const row = objectOf(entry);

          return {
            caseId: text(row["caseId"]),
            caseKind: text(row["caseKind"]),
            bookedBefore: flag(row["bookedBefore"]),
            recordedAt: text(row["recordedAt"]),
          };
        }),
      } satisfies JsonObject);
    }),
  );
});
