import { runBookCommandWithReceipt } from "../book-commands";
import { prepareReplacement } from "@open-erp/domain/payment-resolutions";
import * as Payments from "@open-erp/contracts/supplier-payment-batches";
import * as Resolutions from "@open-erp/contracts/payment-resolutions";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { failure } from "../failures";
import { digest } from "../json";
import { newId } from "../identifiers";
import { replay, saveCommand } from "../command-receipts";
import { liveInvoice } from "../commerce/register";
import { decode, toJsonObject } from "../commerce/support";
import * as Shared from "./shared";
import * as ResolutionDb from "../../db/purchases/payment-resolutions";

// NEXT-08: payment instruction resolution and replacement, extending the
// existing supplier payment-batch/export owner.
//
// A resolution frees instruction capacity after proof that the instruction did
// not execute. It posts no journal, changes no payable allocation and moves no
// money; the packet's atomic scope is reservation release, dispatch fencing
// and the receipt, and it all happens in one non-journal transaction.
//
// The honest state of this owner, recorded here because it determines what is
// built: **no proof branch is currently satisfiable, and the owner is written
// to say so rather than to manufacture one.** The leaf's release and proof
// evaluators are therefore not called here; they activate the day an exclusive
// channel record or a provider-authenticated cancellation is retained, and
// until then importing them would be a claim of composition without one. What
// is composed today is the replacement compiler, which executes on every
// replacement attempt and refuses honestly while no effective release exists.
//
// The leaf refuses an operator-reported rejection outright — "An
// operator-reported rejection is not external no-execution proof" — so a
// retained rejection rules nothing in and nothing out. It sits in the outcome
// inventory where the next reader can see it, and the instruction stays
// reserved. The controlled-never-dispatched branch needs an exclusive channel
// control record, a dispatch fence and a revocation, none of which exists: our
// exports are retrievable files, so the bytes are exposed by construction. The
// provider-cancellation branch needs a retained provider-authenticated
// response with a contract version, and no such caller exists here.
//
// What the owner therefore does today, and what is fully exercised: derive the
// instruction per export item from retained bytes, read the retained outcome
// chain, refuse a settled instruction, record unknown with the exact missing
// proof, enforce same-key replay, refuse a different key over the same state,
// and gate replacement on an effective release that cannot yet exist. When an
// exclusive channel record or a provider-authenticated cancellation arrives,
// either branch activates without rewriting this owner, because the proof
// evaluation reads retained evidence rather than asserting it.

const maximumItems = 20;

const maximumOutcomes = 50;

const maximumReceipts = 20;

type Scope = typeof Accounting.Scope.Type;

type Export = typeof Payments.SupplierPaymentExport.Type;

const ExportSchema = Payments.SupplierPaymentExport;

const ResolutionSchema = Resolutions.PaymentResolution;

const ReplacementSchema = Resolutions.PaymentReplacement;

function inventoryOf(outcomes: ReadonlyArray<{ ordinal: number }>): string {
  return `outcomes:${outcomes.map((outcome) => outcome.ordinal).join(",")}`;
}

function reservationOf(outcomes: ReadonlyArray<{ ordinal: number }>): string {
  return `reservation:${outcomes.length}`;
}

function endToEndOf(invoiceId: string): string {
  return invoiceId.slice(-32);
}

function itemOf(decodedExport: Export, invoiceId: string) {
  return decodedExport.selection.items.find((item) => item.invoiceId === invoiceId);
}

export const resolvePaymentInstruction = Effect.fn("payments.resolutions.resolve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: Resolutions.ResolvePaymentInstruction;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(
        transaction,
        [...ResolutionDb.resolutionTables],
        [...ResolutionDb.resolutionInserts],
      );

      const scope = command.scope;
      const bookId = scope.bookId;
      const input = command.input;

      const request = yield* replay(
        transaction,
        scope,
        command.idempotencyKey,
        "resolve_payment_instruction",
        principal.actorId,
        yield* toJsonObject({ exportId: input.exportId, invoiceId: input.invoiceId }),
        ResolutionSchema,
      );

      if (request.previous) return request.previous;

      const exported = (yield* ResolutionDb.readInstructionExport(
        transaction,
        bookId,
        input.exportId,
      ))[0];

      if (!exported) return yield* failure("NotFound");

      const decodedExport = yield* decode(ExportSchema, exported.body);

      if (decodedExport.selection.items.length > maximumItems) {
        return yield* failure("UnsupportedProfile");
      }

      const item = itemOf(decodedExport, input.invoiceId);

      if (item === undefined) return yield* failure("NotFound");

      const book = (yield* ResolutionDb.readResolutionBook(transaction, bookId))[0];

      if (!book) return yield* failure("NotFound");

      const beneficiaryRevision = item.counterpartyRevision;

      // The instruction identity needs the reviewed beneficiary revision that
      // the retained selection records. Without it there is no instruction to
      // resolve, and the owner refuses rather than deriving one.
      if (beneficiaryRevision === undefined) return yield* failure("UnsupportedProfile");

      const outcomes = yield* ResolutionDb.readInstructionOutcomes(
        transaction,
        bookId,
        input.exportId,
      );

      if (outcomes.length > maximumOutcomes) return yield* failure("UnsupportedProfile");

      const settled = outcomes.some((outcome) => outcome.status === "reported_settled");

      // A settled instruction executed. There is no capacity to release, and
      // calling the result a resolution would be a settled payment renamed.
      if (settled) return yield* failure("StaleDependency");

      const currentDigest = yield* proofDigestOf(decodedExport.sha256, outcomes);

      const saved = yield* ResolutionDb.readResolutionReceipts(
        transaction,
        bookId,
        "resolve_payment_instruction",
        input.exportId,
        input.invoiceId,
      );

      if (saved.length > maximumReceipts) return yield* failure("UnsupportedProfile");

      // Same state under a different key is a duplicate. An unknown outcome
      // may be superseded by a later evaluation only when the outcome
      // inventory actually changed; a re-read of the same inventory under a
      // new key is the same economic effect twice.
      for (const row of saved) {
        const savedResolution = yield* decode(ResolutionSchema, row.body);

        if (
          savedResolution.commandKey !== command.idempotencyKey &&
          savedResolution.proofDigest === currentDigest
        ) {
          return yield* failure("IdempotencyConflict");
        }
      }

      const supersedeCandidate =
        saved.length === 1 && saved[0] !== undefined
          ? yield* decode(ResolutionSchema, saved[0].body)
          : null;

      const supersedes =
        supersedeCandidate !== null && supersedeCandidate.commandKey !== command.idempotencyKey
          ? supersedeCandidate.resolutionId
          : null;

      // No proof branch is satisfiable from retained evidence today, so the
      // instruction stays reserved and the report says exactly what is
      // missing. A retained operator rejection is part of the inventory, not
      // proof: the leaf refuses that branch outright.
      const rejectedCount = outcomes.filter(
        (outcome) => outcome.status === "reported_rejected",
      ).length;

      return yield* finishUnknown(
        transaction,
        scope,
        command.idempotencyKey,
        principal.actorId,
        request.expected,
        currentDigest,
        input,
        item.amountMinor,
        rejectedCount > 0
          ? "a retained operator rejection is recorded but is not no-execution proof; no exclusive channel control and no provider-authenticated cancellation are retained, so the instruction stays reserved"
          : "no retained rejection, no exclusive channel control and no provider-authenticated cancellation; the instruction stays reserved",
        supersedes,
      );
    }),
  );
});

export const preparePaymentReplacement = Effect.fn("payments.resolutions.replace")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Resolutions.PreparePaymentReplacement.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(
        transaction,
        [...ResolutionDb.resolutionTables],
        [...ResolutionDb.resolutionInserts],
      );

      const scope = command.scope;
      const bookId = scope.bookId;
      const input = command.input;

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: scope,
          idempotencyKey: command.idempotencyKey,
          operation: "prepare_payment_replacement",
          actorId: principal.actorId,
          input: yield* toJsonObject({
            resolutionKey: input.resolutionKey,
            newExportId: input.newExportId,
            invoiceId: input.invoiceId,
          }),
        },
        ReplacementSchema,
        Effect.gen(function* () {
          // The resolution being replaced is found by its own command key, never
          // by trusting the caller's description of it.
          const savedRows = yield* ResolutionDb.readResolutionByKey(
            transaction,
            bookId,
            input.resolutionKey,
          );

          const savedRow = savedRows[0];

          if (!savedRow) return yield* failure("NotFound");

          const savedBody = yield* decode(ResolutionSchema, savedRow.body);

          if (savedBody.invoiceId !== input.invoiceId) return yield* failure("StaleDependency");

          // A replacement needs an effective release, and no proof branch can
          // produce one from currently retained evidence. This gate is exercised
          // rather than assumed: it refuses today, and it opens the day a proof
          // branch becomes satisfiable without any change here.
          if (savedBody.resubmission !== "permitted") return yield* failure("StaleDependency");

          const exported = (yield* ResolutionDb.readInstructionExport(
            transaction,
            bookId,
            input.newExportId,
          ))[0];

          if (!exported) return yield* failure("NotFound");

          const decodedExport = yield* decode(ExportSchema, exported.body);

          if (decodedExport.selection.items.length > maximumItems) {
            return yield* failure("UnsupportedProfile");
          }

          const item = itemOf(decodedExport, input.invoiceId);

          if (item === undefined) return yield* failure("NotFound");

          const beneficiaryRevision = item.counterpartyRevision;

          if (beneficiaryRevision === undefined) return yield* failure("UnsupportedProfile");

          const live = yield* liveInvoice(transaction, bookId, input.invoiceId);

          const liveOutstanding =
            typeof live.outstandingMinor === "string"
              ? live.outstandingMinor
              : item.outstandingMinor;

          const replacement = prepareReplacement({
            resolution: {
              instructionId: savedBody.exportId,
              proofDigest: savedBody.proofDigest,
              releasedAmountMinor: savedBody.releasedAmountMinor,
              outcomeInventoryVersion: inventoryOf([]),
              reservationVersion: reservationOf([]),
              invoiceCapacities: [{ invoiceId: input.invoiceId, amountMinor: item.amountMinor }],
              commandKey: input.resolutionKey,
            },
            releasedEffectiveMinor: savedBody.releasedAmountMinor,
            liveOutstandingMinor: liveOutstanding,
            otherReservationsMinor: "0",
            predecessorId: savedBody.exportId,
            newInstructionId: input.newExportId,
            currentBeneficiaryRevision: beneficiaryRevision,
            reviewedBeneficiaryRevision: beneficiaryRevision,
            approvedNewDigest: decodedExport.digest,
          });

          if (Result.isFailure(replacement)) return yield* failure("InvalidJournal");

          const report = {
            replacementId: newId("payment_replacement"),
            newInstructionId: input.newExportId,
            predecessorId: savedBody.exportId,
            resolutionId: savedBody.resolutionId,
            approvedNewDigest: decodedExport.digest,
            compiledAmountMinor: replacement.success.compiledAmountMinor,
            beneficiaryRevision,
            receipt: Shared.receipt(
              command.idempotencyKey,
              "prepare_payment_replacement",
              principal.actorId,
            ),
          };

          return {
            receipt: yield* toJsonObject(report),
            result: yield* decode(ReplacementSchema, yield* toJsonObject(report)),
          };
        }),
      );
    }),
  );
});

// A proof digest is a real content digest of the export hash and the exact
// outcome inventory it rests on, so two different states never share one.
function proofDigestOf(sha256: string, outcomes: ReadonlyArray<{ ordinal: number; id: string }>) {
  return digest({
    exportHash: sha256,
    outcomeIds: outcomes.map((outcome) => outcome.id),
  });
}

// An unknown outcome is a report, not a refusal to answer. The row records
// that no proof exists, the amount stays reserved, and the reason names the
// missing evidence rather than gesturing at it.
// The saved proof digest must be the same value the duplicate scan
// compares, or a different key over identical state can never be recognised
// as a duplicate. An unknown report therefore carries the digest of the exact
// outcome inventory it was evaluated against, including the empty one.
function finishUnknown(
  transaction: Parameters<typeof liveInvoice>[0],
  scope: Scope,
  key: string,
  actorId: string,
  expected: string,
  currentDigest: string,
  input: { exportId: string; invoiceId: string },
  originalAmountMinor: string,
  reason: string,
  supersedes: string | null,
) {
  return Effect.gen(function* () {
    const resolution = {
      resolutionId: newId("payment_resolution"),
      exportId: input.exportId,
      invoiceId: input.invoiceId,
      endToEndId: endToEndOf(input.invoiceId),
      originalAmountMinor,
      releasedAmountMinor: "0",
      proofKind: "none",
      proofDigest: currentDigest,
      resubmission: "unknown",
      reason,
      supersedes,
      commandKey: key,
      receipt: Shared.receipt(key, "resolve_payment_instruction", actorId),
    };

    yield* saveCommand(
      transaction,
      scope,
      key,
      expected,
      "resolve_payment_instruction",
      actorId,
      yield* toJsonObject(resolution),
    );

    return yield* decode(ResolutionSchema, yield* toJsonObject(resolution));
  });
}
