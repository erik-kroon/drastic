import * as ExpenseSources from "../../db/vat/expense-tax";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "../identity";
import { isoNow, newId, replay, saveCommand } from "../posting";
import * as Db from "../../db/posting";
import * as VatDrafts from "../../db/vat-return-drafts";
import * as RecognitionDb from "../../db/purchases/recognition";
import * as VatDb from "../../db/vat/returns";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { exactKeys, toJsonObject } from "../commerce/support";
import { digestBody, maximumFacts, readBasis, toJsonList, toJsonObjectList } from "./basis";
import { buildImpact } from "./draft-impact";

type Scope = typeof Accounting.Scope.Type;

type Principal = VerifiedPrincipal;

type ReclassificationInput = typeof Vat.PrepareVatControlReclassification.Type;

type ReclassificationApprovalInput = typeof Vat.ApproveVatControlReclassification.Type;

type ReclassificationExecutionInput = typeof Vat.ExecuteVatControlReclassification.Type;

type FactWithdrawalInput = typeof Vat.WithdrawVatFact.Type;

type DraftComparisonInput = typeof Vat.CompareVatDrafts.Type;

type AmendmentInput = typeof Vat.ReviewVatAmendment.Type;

type FactInput = typeof Vat.VatFactInput.Type;

type JsonObject = Schema.JsonObject;

type Json = Schema.Json;

const DraftListSchema = Vat.VatDraftList;

const RecoverySchema = Vat.VatControlReclassificationRecovery;

const FactSchema = Vat.VatFact;

const FactViewSchema = Vat.VatFactView;

const WithdrawalSchema = Vat.VatFactWithdrawal;

const DraftSchema = Vat.VatDraft;

const DraftViewSchema = Vat.VatDraftView;

const ImpactSchema = Vat.VatDraftImpact;

const ImpactViewSchema = Vat.VatDraftImpactView;

const AmendmentSchema = Vat.VatAmendment;

const AmendmentViewSchema = Vat.VatAmendmentView;

const AmendmentListSchema = Vat.VatAmendmentList;

const draftInventoryBound = 500;

const factRevisionBound = 20;

const lineageByteBound = 8388608;

const amendmentInventoryBound = 500;

const reclassificationOperations: ReadonlyArray<string> = [
  "prepare_vat_control_reclassification",
  "approve_vat_control_reclassification",
  "execute_vat_control_reclassification",
];

const factInputKeys = [
  "sourceKey",
  "expectedDigest",
  "recordClass",
  "evidenceId",
  "sourceLocator",
  "description",
  "reviewEvidenceId",
  "reviewRationale",
  "treatment",
  "netMinor",
  "vatMinor",
  "grossMinor",
  "currency",
  "issuedOn",
  "receivedOn",
  "suppliedOn",
  "taxPointOn",
  "dateBasis",
  "periodEvidenceId",
  "registration",
  "registrationEvidenceId",
  "method",
  "methodEvidenceId",
  "domesticEligibility",
  "treatmentEvidenceId",
  "fullDeduction",
  "deductionEvidenceId",
  "voucherId",
  "taxLineIds",
  "expenseLink",
] as const;

const describedFactFields = [
  "recordClass",
  "treatment",
  "registration",
  "method",
  "domesticEligibility",
  "fullDeduction",
  "sourceLocator",
  "description",
  "reviewRationale",
] as const;

const factEvidenceFields = [
  "evidenceId",
  "reviewEvidenceId",
  "periodEvidenceId",
  "registrationEvidenceId",
  "methodEvidenceId",
  "treatmentEvidenceId",
  "deductionEvidenceId",
] as const;

function decode<A>(schema: Schema.Decoder<A>, value: unknown) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function withVatBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function unsupported() {
  return failure("UnsupportedProfile");
}

function field(value: Json, key: string) {
  return isJsonObject(value) ? (value[key] ?? null) : null;
}

function textField(value: Json, key: string) {
  const found = field(value, key);

  return typeof found === "string" ? found : null;
}

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFactAccess(transaction: Transaction, inserts: ReadonlyArray<string>) {
  return VatDb.readFactAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== VatDb.factReadTables.length) return unsupported();

      const denied = rows.some((row) => {
        const write = inserts.includes(row.tableName);

        return !row.canSelect || (write && !row.canInsert);
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function requireDescribedFactFields(input: JsonObject) {
  for (const key of describedFactFields) {
    const value = textField(input, key);

    if (value === null || value.length < 1 || value.length > 2000) {
      return failure("InvalidJournal");
    }
  }

  return Effect.void;
}

function requireTaxLineSelection(input: FactInput) {
  if (input.taxLineIds.length > 20) return failure("InvalidJournal");

  if (new Set(input.taxLineIds).size !== input.taxLineIds.length) return failure("InvalidJournal");

  if (input.voucherId === null && input.taxLineIds.length > 0) return failure("InvalidJournal");

  return Effect.void;
}

function readFactEvidenceRefs(transaction: Transaction, bookId: string, input: FactInput) {
  return Effect.gen(function* () {
    const cited = factEvidenceFields
      .map((key) => input[key])
      .filter((value): value is string => value !== null);

    const digests = new Map(
      (yield* VatDb.readEvidenceDigests(transaction, bookId, cited)).map((row) => [
        row.id,
        row.sha256,
      ]),
    );

    const refs = [];

    for (const key of factEvidenceFields) {
      const evidenceId = input[key];

      if (evidenceId === null) continue;
      const sha256 = digests.get(evidenceId);

      if (sha256 === undefined) return yield* failure("MissingEvidence");
      refs.push({ evidenceId, sha256 });
    }

    return yield* toJsonObjectList(refs);
  });
}

// An owned purchase recognition already published signed components for that
// voucher. An independent admission over the same voucher would recognize one
// economic event twice, so it is refused here rather than deduplicated.
function requireUnownedPurchaseComponents(
  transaction: Transaction,
  bookId: string,
  input: FactInput,
) {
  if (input.voucherId === null) return Effect.void;

  return RecognitionDb.readRecognizedVoucher(transaction, bookId, input.voucherId).pipe(
    Effect.flatMap((rows) => (rows[0]?.present === true ? failure("AlreadyPosted") : Effect.void)),
  );
}

function requireVoucherLink(transaction: Transaction, bookId: string, input: FactInput) {
  return Effect.gen(function* () {
    if (input.voucherId === null) return;

    if (
      (yield* Db.readVoucher(transaction, bookId, input.voucherId))[0]?.postingPurpose ===
      "vat_control_reclassification_v1"
    )
      return yield* failure("StaleDependency");
    const voucher = (yield* VatDb.readVoucherEvidenceRefs(transaction, bookId, input.voucherId))[0];

    if (!voucher) return yield* failure("MissingEvidence");
    const refs = voucher.evidenceRefs;

    const cites =
      Array.isArray(refs) &&
      refs.some((ref) => isJsonObject(ref) && ref.evidenceId === input.evidenceId);

    if (!cites) return yield* failure("MissingEvidence");

    const lines = yield* VatDb.readVoucherLineIds(
      transaction,
      bookId,
      input.voucherId,
      input.taxLineIds,
    );

    if (lines.length !== input.taxLineIds.length) return yield* failure("NotFound");
  });
}

function readExpenseLinkState(
  transaction: Transaction,
  bookId: string,
  payload: JsonObject,
  input: FactInput,
) {
  return Effect.gen(function* () {
    if (input.expenseLink === null) return null;
    const link = yield* toJsonObject(input.expenseLink);
    const sourceId = textField(link, "sourceId");

    if (sourceId === null) return yield* failure("InvalidJournal");

    if ((yield* ExpenseSources.readWithdrawal(transaction, bookId, sourceId)).length)
      return yield* failure("StaleDependency");
    const state = (yield* VatDb.readExpenseLink(transaction, bookId, sourceId, link, payload))[0];

    if (!state || !state.found) return yield* failure("NotFound");

    if (input.treatment !== "domestic_purchase" || !state.digestsCurrent) {
      return yield* failure("StaleDependency");
    }

    if (!state.compatible) return yield* failure("InvalidJournal");

    return state;
  });
}

function openComponent(transaction: Transaction, bookId: string, input: FactInput) {
  return Effect.gen(function* () {
    const component = (yield* VatDb.readFactComponent(transaction, bookId, input.sourceKey))[0];

    if (!component) {
      if (input.expectedDigest !== null) return yield* failure("StaleDependency");
      const counted = yield* VatDrafts.countFactComponents(transaction, bookId);

      if ((counted[0]?.total ?? 0) >= maximumFacts) return yield* unsupported();

      return { factId: newId("vatfact"), revision: 1, previousDigest: null, opened: true } as const;
    }

    if ((yield* VatDb.readFactWithdrawal(transaction, bookId, component.id)).length)
      return yield* failure("StaleDependency");

    const current = (yield* VatDb.readCurrentFactRevision(
      transaction,
      bookId,
      component.id,
      "update",
    ))[0];

    const previousDigest = current ? textField(current.body, "digest") : null;

    if (input.expectedDigest !== previousDigest) return yield* failure("StaleDependency");

    if (component.recordClass !== input.recordClass) return yield* failure("InvalidJournal");
    const revision = (current?.revision ?? 0) + 1;

    if (revision > factRevisionBound) return yield* unsupported();

    return { factId: component.id, revision, previousDigest, opened: false } as const;
  });
}

function readLineage(transaction: Transaction, bookId: string, factId: string) {
  return Effect.gen(function* () {
    const drafts = (yield* VatDb.countDrafts(transaction, bookId))[0]?.drafts ?? 0;
    const amendments = (yield* VatDb.countAmendments(transaction, bookId))[0]?.amendments ?? 0;

    if (drafts > draftInventoryBound || amendments > draftInventoryBound) {
      return yield* unsupported();
    }

    const row = (yield* VatDb.readFactLineage(transaction, bookId, factId))[0];

    if (!row || row.rejected) return yield* unsupported();

    return yield* toJsonObject({
      interpretation: "retained_fact_membership",
      currentnessChecked: false,
      legalObligationAssessed: false,
      drafts: yield* toJsonList(row.drafts),
      amendments: yield* toJsonList(row.amendments),
    });
  });
}

function readRetainedDrafts(transaction: Transaction, bookId: string, input: DraftComparisonInput) {
  return Effect.gen(function* () {
    const original = (yield* VatDb.readRetainedDraft(
      transaction,
      bookId,
      input.originalDraftId,
    ))[0];

    const replacement = (yield* VatDb.readRetainedDraft(
      transaction,
      bookId,
      input.replacementDraftId,
    ))[0];

    if (original === undefined || replacement === undefined) return yield* failure("NotFound");

    if (
      original.body.digest !== input.originalDraftDigest ||
      replacement.body.digest !== input.replacementDraftDigest
    ) {
      return yield* failure("StaleDependency");
    }

    return {
      original: {
        ordinal: original.ordinal,
        draft: yield* decode(DraftSchema, original.body),
      },
      replacement: {
        ordinal: replacement.ordinal,
        draft: yield* decode(DraftSchema, replacement.body),
      },
    };
  });
}

export {
  approveReclassification,
  executeReclassification,
  getReclassification,
  listReclassifications,
  prepareReclassification,
} from "./reclassification";

export const recoverReclassification = Effect.fn("vat.recoverReclassification")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withVatBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireFactAccess(transaction, []);
      yield* Db.lockBookForShare(transaction, command.scope);

      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(command.key)) return yield* failure("IdempotencyConflict");

      const rows = yield* Db.readCommandReceipt(
        transaction,
        command.scope.bookId,
        command.key,
        "share",
      );

      const receipt = rows.find(
        (row) =>
          row.actorId === principal.actorId && reclassificationOperations.includes(row.operation),
      );

      if (!receipt) return yield* failure("NotFound");
      const result = yield* toJsonObject(receipt.result);

      return yield* decode(RecoverySchema, { state: "committed", result });
    }),
  );
});

export const withdrawFact = Effect.fn("vat.withdrawFact")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: FactWithdrawalInput },
) {
  return yield* withVatBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "withdraw_vat_fact",
          principal.actorId,
          payload,
          WithdrawalSchema,
        );

        if (request.previous) return request.previous;
        yield* requireFactAccess(transaction, ["vat_fact_withdrawals", "command_receipts"]);
        yield* Db.lockBookForUpdate(transaction, command.scope);

        const current = (yield* VatDb.readCurrentFactRevision(
          transaction,
          command.scope.bookId,
          command.id,
          "update",
        ))[0];

        if (current === undefined) return yield* failure("NotFound");

        if (current.body.digest !== command.input.expectedDigest) {
          return yield* failure("StaleDependency");
        }

        if (
          (yield* VatDb.readFactWithdrawal(transaction, command.scope.bookId, command.id))[0] !==
          undefined
        ) {
          return yield* failure("StaleDependency");
        }

        const evidence = yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          command.input.evidenceId,
        );

        const sha256 = evidence[0]?.sha256;

        if (sha256 === undefined) return yield* failure("MissingEvidence");

        const body = yield* digestBody({
          id: newId("vatwithdrawal"),
          scope: command.scope,
          factId: command.id,
          revisionId: current.id,
          revision: current.revision,
          revisionDigest: current.body.digest,
          input: command.input,
          evidenceSha256: sha256,
          permanent: true,
          recordedAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "withdraw_vat_fact",
            actorId: principal.actorId,
          },
        });

        const withdrawal = yield* decode(WithdrawalSchema, body);
        yield* VatDb.insertFactWithdrawal(transaction, {
          bookId: command.scope.bookId,
          factId: command.id,
          revision: current.revision,
          id: withdrawal.id,
          evidenceId: command.input.evidenceId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "withdraw_vat_fact",
          principal.actorId,
          withdrawal,
        );

        return withdrawal;
      }),
    "update",
  );
});

export const compareDrafts = Effect.fn("vat.compareDrafts")(function* (
  token: string,
  command: { scope: Scope; input: DraftComparisonInput },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireFactAccess(transaction, []);
      yield* Db.lockBookForShare(transaction, command.scope);
      const retained = yield* readRetainedDrafts(transaction, command.scope.bookId, command.input);
      const body = yield* buildImpact(retained.original, retained.replacement);
      const impact = yield* decode(ImpactSchema, body);
      const basis = yield* readBasis(transaction, command.scope.bookId);

      return yield* decode(ImpactViewSchema, {
        impact,
        replacementBasisCurrent: basis.digest === impact.replacement.basisDigest,
      });
    }),
  );
});

export const reviewAmendment = Effect.fn("vat.reviewAmendment")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: AmendmentInput },
) {
  return yield* withVatBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "review_vat_amendment",
          principal.actorId,
          payload,
          AmendmentSchema,
        );

        if (request.previous) return request.previous;
        yield* requireFactAccess(transaction, ["vat_draft_amendments", "command_receipts"]);
        yield* Db.lockBookForUpdate(transaction, command.scope);

        const comparison: DraftComparisonInput = {
          originalDraftId: command.input.originalDraftId,
          originalDraftDigest: command.input.originalDraftDigest,
          replacementDraftId: command.input.replacementDraftId,
          replacementDraftDigest: command.input.replacementDraftDigest,
        };

        const retained = yield* readRetainedDrafts(transaction, command.scope.bookId, comparison);
        const body = yield* buildImpact(retained.original, retained.replacement);
        const impact = yield* decode(ImpactSchema, body);

        if (impact.digest !== command.input.expectedImpactDigest) {
          return yield* failure("StaleDependency");
        }

        const basis = yield* readBasis(transaction, command.scope.bookId);

        if (basis.digest !== impact.replacement.basisDigest) {
          return yield* failure("StaleDependency");
        }

        const evidence = yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          command.input.reviewEvidenceId,
        );

        const sha256 = evidence[0]?.sha256;

        if (sha256 === undefined) return yield* failure("MissingEvidence");

        if (
          (yield* VatDb.readAmendmentPair(
            transaction,
            command.scope.bookId,
            command.input.originalDraftId,
            command.input.replacementDraftId,
          )).length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }

        const ordinal = (yield* VatDb.readNextAmendmentOrdinal(
          transaction,
          command.scope.bookId,
        ))[0]?.ordinal;

        if (ordinal === undefined || ordinal > amendmentInventoryBound) {
          return yield* unsupported();
        }

        const amendmentBody = yield* digestBody({
          id: newId("vatamendment"),
          scope: command.scope,
          input: command.input,
          impact,
          reviewEvidenceSha256: sha256,
          recordedAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "review_vat_amendment",
            actorId: principal.actorId,
          },
          state: "reviewed_internal_amendment",
          filingReady: false,
          externalState: "not_submitted",
        });

        const amendment = yield* decode(AmendmentSchema, amendmentBody);
        yield* VatDb.insertAmendment(transaction, {
          bookId: command.scope.bookId,
          id: amendment.id,
          ordinal,
          originalDraftId: command.input.originalDraftId,
          replacementDraftId: command.input.replacementDraftId,
          reviewEvidenceId: command.input.reviewEvidenceId,
          body: amendmentBody,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "review_vat_amendment",
          principal.actorId,
          amendment,
        );

        return amendment;
      }),
    "update",
  );
});

export const getAmendment = Effect.fn("vat.getAmendment")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireFactAccess(transaction, []);
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* VatDb.readAmendment(transaction, command.scope.bookId, command.id))[0];

      if (row === undefined) return yield* failure("NotFound");

      const original = (yield* VatDrafts.readDraft(
        transaction,
        command.scope.bookId,
        row.originalDraftId,
      ))[0];

      const replacement = (yield* VatDrafts.readDraft(
        transaction,
        command.scope.bookId,
        row.replacementDraftId,
      ))[0];

      if (original === undefined || replacement === undefined) return yield* failure("NotFound");
      const amendment = yield* decode(AmendmentSchema, row.body);
      const originalDraft = yield* decode(DraftSchema, original.body);
      const replacementDraft = yield* decode(DraftSchema, replacement.body);
      const basis = yield* readBasis(transaction, command.scope.bookId);

      return yield* decode(AmendmentViewSchema, {
        amendment,
        originalDraft,
        replacementDraft,
        replacementBasisCurrent: basis.digest === replacementDraft.basis.digest,
      });
    }),
  );
});

export const listAmendments = Effect.fn("vat.listAmendments")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireFactAccess(transaction, []);
      yield* Db.lockBookForShare(transaction, command.scope);
      const count = yield* VatDb.countAmendments(transaction, command.scope.bookId);

      if ((count[0]?.amendments ?? 0) > amendmentInventoryBound) return yield* unsupported();
      const rows = yield* VatDb.listAmendmentItems(transaction, command.scope.bookId);

      return yield* decode(AmendmentListSchema, {
        items: rows.map((row) => row.item),
      });
    }),
  );
});

export const recordFact = Effect.fn("vat.recordFact")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: FactInput },
) {
  return yield* withVatBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "record_vat_fact",
          principal.actorId,
          payload,
          FactSchema,
        );

        if (request.previous) return request.previous;
        yield* requireFactAccess(transaction, [
          "vat_fact_components",
          "vat_fact_revisions",
          "command_receipts",
        ]);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        yield* exactKeys(payload, factInputKeys);
        yield* requireDescribedFactFields(payload);
        yield* requireTaxLineSelection(command.input);

        const evidenceRefs = yield* readFactEvidenceRefs(
          transaction,
          command.scope.bookId,
          command.input,
        );

        yield* requireVoucherLink(transaction, command.scope.bookId, command.input);
        yield* requireUnownedPurchaseComponents(transaction, command.scope.bookId, command.input);

        const expense = yield* readExpenseLinkState(
          transaction,
          command.scope.bookId,
          payload,
          command.input,
        );

        const component = yield* openComponent(transaction, command.scope.bookId, command.input);

        if (component.opened) {
          yield* VatDb.insertFactComponent(transaction, {
            bookId: command.scope.bookId,
            id: component.factId,
            sourceKey: command.input.sourceKey,
            recordClass: command.input.recordClass,
          });
        }

        const revisionId = newId("vatfactrev");

        const body = yield* digestBody(
          yield* toJsonObject({
            id: revisionId,
            factId: component.factId,
            revision: component.revision,
            previousDigest: component.previousDigest,
            scope: command.scope,
            input: payload,
            evidenceRefs,
            expenseSourceDigest: expense?.sourceDigest ?? null,
            expenseReviewDigest: expense?.reviewDigest ?? null,
            recordedAt: yield* isoNow(transaction),
            receipt: {
              key: command.idempotencyKey,
              operation: "record_vat_fact",
              actorId: principal.actorId,
            },
          }),
        );

        yield* VatDb.insertFactRevision(transaction, {
          bookId: command.scope.bookId,
          factId: component.factId,
          revision: component.revision,
          id: revisionId,
          evidenceId: command.input.evidenceId,
          reviewEvidenceId: command.input.reviewEvidenceId,
          voucherId: command.input.voucherId,
          body,
        });
        const result = yield* decode(FactSchema, body);
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "record_vat_fact",
          principal.actorId,
          result,
        );

        return result;
      }),
    "update",
  );
});

export const returnBasis = Effect.fn("vat.returnBasis")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireFactAccess(transaction, []);
      yield* Db.lockBookForShare(transaction, command.scope);

      return yield* readBasis(transaction, command.scope.bookId);
    }),
  );
});

export const getFact = Effect.fn("vat.getFact")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireFactAccess(transaction, []);
      yield* Db.lockBookForShare(transaction, command.scope);
      const revisions = yield* VatDb.readFactHistory(transaction, command.scope.bookId, command.id);

      if (revisions.length === 0) return yield* failure("NotFound");

      const history = yield* Effect.forEach(revisions, (revision) =>
        decode(FactSchema, revision.body),
      );

      const current = history.at(-1);

      if (current === undefined) return yield* failure("NotFound");

      const withdrawn = (yield* VatDb.readFactWithdrawal(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0]?.body;

      const withdrawal =
        withdrawn === undefined || withdrawn === null
          ? null
          : yield* decode(WithdrawalSchema, withdrawn);

      const body = yield* toJsonObject({
        current,
        history,
        withdrawal,
        lineage: yield* readLineage(transaction, command.scope.bookId, command.id),
      });

      const size = (yield* VatDb.readCanonicalSize(transaction, body))[0]?.bytes;

      if (size === undefined) return yield* failure("InternalError");

      if (size > lineageByteBound) return yield* unsupported();

      return yield* decode(FactViewSchema, body);
    }),
  );
});

export const getDraft = Effect.fn("vat.getDraft")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireFactAccess(transaction, []);
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* VatDrafts.readDraft(transaction, command.scope.bookId, command.id))[0];

      if (!row) return yield* failure("NotFound");
      const draft = yield* decode(DraftSchema, row.body);
      const basis = yield* readBasis(transaction, command.scope.bookId);

      return yield* decode(DraftViewSchema, {
        draft,
        basisCurrent: draft.basis.digest === basis.digest,
      });
    }),
  );
});

export const listDrafts = Effect.fn("vat.listDrafts")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      const grants = yield* VatDb.readDraftGrants(transaction);

      if (grants.some((row) => !row.allowed)) return yield* unsupported();
      const counts = yield* VatDb.countDrafts(transaction, command.scope.bookId);

      if ((counts[0]?.drafts ?? 0) > draftInventoryBound) return yield* unsupported();
      const rows = yield* VatDb.listDraftItems(transaction, command.scope.bookId);

      return yield* decode(DraftListSchema, { items: rows.map((row) => row.item) });
    }),
  );
});

export type {
  ReclassificationApprovalInput,
  ReclassificationExecutionInput,
  ReclassificationInput,
};
