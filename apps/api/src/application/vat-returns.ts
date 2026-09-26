import * as Vat from "@open-erp/contracts/vat-returns";
import { calculateVatDraft } from "@open-erp/jurisdiction-se/vat";
import * as Effect from "effect/Effect";
import { failure } from "./failures";
import { digestJson } from "../db/commerce/access";
import { lockBookForUpdate } from "../db/posting";
import * as VatDb from "../db/vat-return-drafts";
import type { Transaction } from "../db/transaction";
import { isoNow, newId, replay, saveCommand } from "./posting";
import {
  decode,
  exactKeys,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
} from "./commerce/support";

type PrepareVatCommand = typeof Vat.PrepareVatCommand.Type;

const DraftSchema = Vat.VatDraft;
const BasisSchema = Vat.VatBasis;
const CalculationSchema = Vat.VatCalculation;

const draftInputKeys = ["mode", "startsOn", "endsOn", "periodEvidenceId", "otherBoxes"] as const;
const calculationKeys = [
  "engine",
  "assessments",
  "includedCount",
  "excludedCount",
  "syntheticBoxes",
  "blockers",
  "coverageEstablished",
  "ledgerReconciled",
  "legalProfileActive",
  "filingReady",
] as const;
const maximumFacts = 200;
const maximumDrafts = 500;
const maximumIntervalDays = 365;

function requireDraftAccess(transaction: Transaction, write: boolean) {
  return VatDb.readDraftWriteAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = VatDb.draftTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);
        return (
          access === undefined ||
          !access.canSelect ||
          (write && ["vat_return_drafts", "command_receipts"].includes(name) && !access.canInsert)
        );
      });
      return denied ? unsupported() : Effect.void;
    }),
  );
}

function digestBody(transaction: Transaction, body: JsonObject) {
  return digestJson(transaction, body).pipe(
    Effect.flatMap((rows) => {
      const digest = rows[0]?.digest;
      return digest === undefined ? failure("InternalError") : Effect.succeed(digest);
    }),
    Effect.map((digest): JsonObject => Object.assign({}, body, { digest })),
  );
}

function readBasis(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const state = (yield* VatDb.readBookState(transaction, bookId))[0];
    if (!state) return yield* failure("Forbidden");
    const counted = yield* VatDb.countFactComponents(transaction, bookId);
    if ((counted[0]?.total ?? 0) > maximumFacts) return yield* unsupported();
    const facts = (yield* VatDb.readBasisFacts(transaction, bookId))[0]?.facts ?? [];
    return yield* decode(
      BasisSchema,
      yield* digestBody(transaction, {
        bookSequence: state.committedSequence,
        bookProfile: state.profile,
        bookProfileVersion: state.profileVersion,
        currency: state.currency,
        currencyScale: state.currencyScale,
        facts,
      }),
    );
  });
}

function requireOrderedInterval(input: typeof Vat.PrepareVatDraft.Type) {
  const starts = Date.parse(`${input.startsOn}T00:00:00.000Z`);
  const ends = Date.parse(`${input.endsOn}T00:00:00.000Z`);
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return failure("InvalidJournal");
  const days = (ends - starts) / 86400000;
  return starts <= ends && days <= maximumIntervalDays ? Effect.void : failure("InvalidJournal");
}

function requireSupportedMode(input: typeof Vat.PrepareVatDraft.Type) {
  if (input.mode === "actual_review" && input.otherBoxes !== "unknown") {
    return failure("InvalidJournal");
  }
  return Effect.void;
}

function requireCalculationLineage(
  basis: typeof BasisSchema.Type,
  calculation: typeof CalculationSchema.Type,
  input: typeof Vat.PrepareVatDraft.Type,
) {
  return Effect.gen(function* () {
    yield* exactKeys(yield* toJsonObject(calculation), calculationKeys);
    if (
      calculation.engine !== "vat-return-draft-v3" ||
      calculation.assessments.length !== basis.facts.length
    ) {
      return yield* failure("InvalidJournal");
    }
    if (
      calculation.coverageEstablished !== false ||
      calculation.ledgerReconciled !== false ||
      calculation.legalProfileActive !== false ||
      calculation.filingReady !== false
    ) {
      return yield* unsupported();
    }
    if (
      input.mode === "actual_review" &&
      (calculation.syntheticBoxes !== null || calculation.includedCount !== 0)
    ) {
      return yield* unsupported();
    }
    for (const [index, assessment] of calculation.assessments.entries()) {
      const fact = basis.facts[index];
      if (!fact) return yield* failure("InvalidJournal");
      if (assessment.factId !== fact.fact.factId || assessment.sourceDigest !== fact.fact.digest) {
        return yield* failure("InvalidJournal");
      }
      if (
        fact.withdrawal != null &&
        (assessment.state !== "excluded" ||
          assessment.contribution !== null ||
          !assessment.blockers.includes("withdrawn_fact"))
      ) {
        return yield* failure("InvalidJournal");
      }
      if (
        fact.expenseSourceWithdrawn === true &&
        (assessment.state !== "excluded" ||
          assessment.contribution !== null ||
          !assessment.blockers.includes("withdrawn_expense_source"))
      ) {
        return yield* failure("InvalidJournal");
      }
      if (
        assessment.state === "included_synthetic" &&
        (input.mode !== "synthetic_demonstration" ||
          basis.bookProfile !== "synthetic-core-v1" ||
          fact.fact.input.recordClass !== "synthetic")
      ) {
        return yield* failure("InvalidJournal");
      }
    }
  });
}

export const prepareVatDraft = Effect.fn("vat.prepareDraft")(function* (
  token: string,
  command: PrepareVatCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const payload = yield* toJsonObject(command.input);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_vat_return_draft",
        principal.actorId,
        payload,
        DraftSchema,
      );
      if (request.previous) return request.previous;
      yield* requireDraftAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(payload, draftInputKeys);
      yield* requireSupportedMode(command.input);
      yield* requireOrderedInterval(command.input);
      const periodEvidenceSha256 =
        command.input.periodEvidenceId === null
          ? null
          : ((yield* VatDb.readEvidenceDigest(
              transaction,
              command.scope.bookId,
              command.input.periodEvidenceId,
            ))[0]?.sha256 ?? null);
      if (command.input.periodEvidenceId !== null && periodEvidenceSha256 === null) {
        return yield* failure("MissingEvidence");
      }
      const basis = yield* readBasis(transaction, command.scope.bookId);
      const calculation = calculateVatDraft(basis, command.input);
      yield* decode(CalculationSchema, calculation);
      yield* requireCalculationLineage(basis, calculation, command.input);
      const ordinal = (yield* VatDb.readNextDraftOrdinal(transaction, command.scope.bookId))[0]
        ?.ordinal;
      if (ordinal === undefined || ordinal > maximumDrafts) return yield* unsupported();
      const body = yield* digestBody(transaction, {
        id: newId("vatdraft"),
        scope: command.scope,
        input: command.input,
        basis,
        calculation,
        periodEvidenceSha256,
        recordedAt: yield* isoNow(transaction),
        receipt: {
          key: command.idempotencyKey,
          operation: "prepare_vat_return_draft",
          actorId: principal.actorId,
        },
      });
      const draft = yield* decode(DraftSchema, body);
      yield* VatDb.insertDraft(transaction, {
        bookId: command.scope.bookId,
        id: draft.id,
        ordinal,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_vat_return_draft",
        principal.actorId,
        draft,
      );
      return draft;
    },
    "update",
  );
});
