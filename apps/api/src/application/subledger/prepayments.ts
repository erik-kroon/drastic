import * as Accounting from "@open-erp/contracts/accounting";
import * as Prep from "@open-erp/contracts/prepayments";
import {
  compileAccrual,
  compilePrepayment,
  resolveAccrualWithInvoice,
  type PrepaymentFailure,
  type PrepaymentFailureCode,
} from "@open-erp/domain/prepayments";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { admitAccountRole } from "../resource-admission";
import { failure } from "../failures";
import { newId, prepareJournalInTransaction, replay, saveCommand } from "../posting";
import * as Db from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import * as PrepDb from "../../db/subledger/prepayments";
import { digestValue, readBook, requireScheduleAccess, withSubledgerBook } from "./schedules";

// The prepared journal takes a key of its own. Both writes are in one
// transaction, so they must not collide on the command receipt's primary key,
// and deriving it from the command key plus the operation keeps a repeated
// command recovering both.
function journalKey(actorId: string, commandKey: string, operation: string) {
  return digestValue({ actor: actorId, key: commandKey, operation }).pipe(
    Effect.map((digest) => `sl_${digest.slice(8)}`),
  );
}

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const refusalFailure = {
  InvalidServicePeriod: "InvalidJournal",
  NonPositiveAmount: "InvalidJournal",
  AllocationMismatch: "InvalidJournal",
  IncompleteCoverage: "ApprovalRequired",
  DuplicateResolution: "IdempotencyConflict",
  // A consumed coverage below what was already recognized cannot be reconciled
  // by a difference, so it is a review question rather than a computed answer.
  EstimateBelowRecognized: "ApprovalRequired",
  // A journal that does not foot is never posted; the leaf refuses first.
  UnbalancedJournal: "InvalidJournal",
  UnsupportedPolicy: "UnsupportedProfile",
} satisfies Record<PrepaymentFailureCode, typeof Accounting.FailureCode.Type>;

// The schedule access gate plus the three tables this owner adds. A role that
// cannot reach them refuses here rather than on the first write.
function requirePrepaymentAccess(transaction: Transaction, write: boolean) {
  return Effect.gen(function* () {
    yield* requireScheduleAccess(transaction, write);
    const rows = yield* PrepDb.readPrepaymentAccess(transaction);

    if (rows.length !== PrepDb.prepaymentTables.length) {
      return yield* failure("UnsupportedProfile");
    }

    if (rows.some((row) => !row.canSelect || (write && !row.canInsert))) {
      return yield* failure("UnsupportedProfile");
    }
  });
}

function refuse(outcome: PrepaymentFailure) {
  return failure(refusalFailure[outcome.code], outcome.message);
}

function checked<A>(value: Result.Result<A, PrepaymentFailure>) {
  return Effect.gen(function* () {
    if (Result.isFailure(value)) return yield* refuse(value.failure);

    return value.success;
  });
}

function toJsonObject<A>(value: A) {
  return Schema.encodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function isCalendarDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function receipt(key: string, operation: string, actorId: string) {
  return { key, operation, actorId } satisfies JsonObject;
}

function readSchedule(transaction: Transaction, bookId: string, id: string) {
  return transaction.execute<{ readonly id: string; readonly sourceKey: string }>(
    sql`
      select s.id, s.source_key as "sourceKey"
      from openerp.subledger_schedules s
      where s.book_id = ${bookId} and s.id = ${id}
    `,
    "objects",
  );
}

export const linkExpenseCostBasis = Effect.fn("subledger.prepayments.linkCostBasis")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Prep.LinkExpenseCostBasis },
) {
  return yield* withSubledgerBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "link_expense_cost_basis",
          principal.actorId,
          yield* toJsonObject(command.input),
          Prep.PrepaymentPlanView,
        );

        if (request.previous) return request.previous;
        yield* requirePrepaymentAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        yield* readBook(transaction, command.scope);

        const input = command.input;

        const schedule = (yield* readSchedule(
          transaction,
          command.scope.bookId,
          input.scheduleId,
        ))[0];

        // A deferral must attach to a schedule that exists. Deferring a figure
        // nothing schedules would create capacity with no occurrence behind it.
        if (!schedule) return yield* failure("NotFound");

        if (
          (yield* PrepDb.readCostBasisBySchedule(
            transaction,
            command.scope.bookId,
            input.scheduleId,
          )).length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }

        const evidence = (yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          input.serviceEvidenceId,
        ))[0];

        // Reviewed service evidence is required. A tax invoice proves the
        // invoice, not that the service spans the asserted window.
        if (!evidence) return yield* failure("MissingEvidence");

        const accounts = yield* Db.readAccounts(transaction, command.scope.bookId, [
          input.prepaidAccountId,
          input.expenseAccountId,
        ]);

        if (accounts.length !== 2 || accounts.some((account) => !account.active)) {
          return yield* failure("InvalidJournal");
        }

        if (
          !isCalendarDate(input.reviewedCutoffOn) ||
          input.serviceEndsOnExclusive <= input.serviceStartsOn ||
          BigInt(input.costMinor) <= 0n
        ) {
          return yield* failure("InvalidJournal");
        }

        // The exact split over the reviewed service coverage. Nothing is
        // prorated from the invoice total and no tax is included.
        const plan = yield* checked(
          compilePrepayment({
            costMinor: input.costMinor,
            serviceStartOn: input.serviceStartsOn,
            serviceEndOnExclusive: input.serviceEndsOnExclusive,
            cutoffOn: input.reviewedCutoffOn,
            policy: input.policy,
            residual: input.residual,
            contractualWeights: input.contractualWeights,
            periods: input.periods,
            prepaidAccountId: input.prepaidAccountId,
            expenseAccountId: input.expenseAccountId,
          }),
        );

        // The shares sum to the cost exactly, so the recognized and future
        // parts are the same cost seen from two sides.
        const shares = plan.installments.reduce((sum, entry) => sum + BigInt(entry.shareMinor), 0n);

        if (shares !== BigInt(input.costMinor)) return yield* failure("InternalError");

        yield* admitAccountRole(
          transaction,
          command.scope.bookId,
          input.prepaidAccountId,
          "subledger",
        );
        const basisId = newId("costbasis");

        yield* PrepDb.insertCostBasis(transaction, {
          bookId: command.scope.bookId,
          id: basisId,
          purchaseRecognitionId: input.purchaseRecognitionId,
          scheduleId: input.scheduleId,
          costMinor: input.costMinor,
          currency: input.currency,
          serviceStartsOn: input.serviceStartsOn,
          serviceEndsOnExclusive: input.serviceEndsOnExclusive,
          serviceEvidenceId: input.serviceEvidenceId,
          reviewedCutoffOn: input.reviewedCutoffOn,
        });

        const body = yield* decode(
          Prep.PrepaymentPlanView,
          yield* toJsonObject({
            basisId,
            purchaseRecognitionId: input.purchaseRecognitionId,
            scheduleId: input.scheduleId,
            costMinor: input.costMinor,
            recognizedNowMinor: plan.recognizedNowMinor,
            futureMinor: plan.futureMinor,
            installments: plan.installments,
            taxTreatment: "no_tax_fact_defers_expense_timing_only",
            receipt: receipt(command.idempotencyKey, "link_expense_cost_basis", principal.actorId),
          } satisfies JsonObject),
        );

        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "link_expense_cost_basis",
          principal.actorId,
          yield* toJsonObject(body),
        );

        return body;
      }),
    "update",
  );
});

export const recordAccruedCost = Effect.fn("subledger.prepayments.recordAccrual")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Prep.RecordAccruedCost },
) {
  return yield* withSubledgerBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "record_accrued_cost",
          principal.actorId,
          yield* toJsonObject(command.input),
          Prep.AccruedCostView,
        );

        if (request.previous) return request.previous;
        yield* requirePrepaymentAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        yield* readBook(transaction, command.scope);

        const input = command.input;

        const evidence = (yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          input.evidenceId,
        ))[0];

        // An estimate with no evidence of the service is not an accrual.
        if (!evidence) return yield* failure("MissingEvidence");

        if (
          (yield* PrepDb.readAccrualByService(
            transaction,
            command.scope.bookId,
            input.serviceIdentity,
          )).length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }

        const accounts = yield* Db.readAccounts(transaction, command.scope.bookId, [
          input.expenseAccountId,
          input.accruedLiabilityAccountId,
        ]);

        if (accounts.length !== 2 || accounts.some((account) => !account.active)) {
          return yield* failure("InvalidJournal");
        }

        // The exact two-line accrual, compiled by the leaf. No deductible VAT
        // fact is created: qualified tax evidence does not exist here.
        const accrual = yield* checked(
          compileAccrual({
            expectedCostMinor: input.expectedCostMinor,
            evidenceId: input.evidenceId,
            expenseAccountId: input.expenseAccountId,
            accruedLiabilityAccountId: input.accruedLiabilityAccountId,
          }),
        );

        const plan = yield* prepareJournalInTransaction(transaction, principal, {
          scope: command.scope,
          idempotencyKey: yield* journalKey(
            principal.actorId,
            command.idempotencyKey,
            "record_accrued_cost",
          ),
          input: {
            kind: "manual_journal",
            evidenceId: input.evidenceId,
            eventKey: `accrual-${input.serviceIdentity}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
            accountingPeriodId: `period_${input.postingDate.slice(0, 4)}`,
            postingDate: input.postingDate,
            series: input.series,
            description: `Accrued service cost ${input.serviceIdentity}`,
            rationale: `Reviewed expected cost for a service already received`,
            taxAssessment: "not_applicable",
            lines: accrual.journal.map((line) => ({
              accountId: line.accountId,
              debitMinor: line.debitMinor,
              creditMinor: line.creditMinor,
              description: line.description,
            })),
          },
        });

        const accrualId = newId("accrual");

        yield* PrepDb.insertAccrual(transaction, {
          bookId: command.scope.bookId,
          id: accrualId,
          serviceIdentity: input.serviceIdentity,
          expenseAccountId: input.expenseAccountId,
          liabilityAccountId: input.accruedLiabilityAccountId,
          currency: input.currency,
          originalMinor: accrual.expectedMinor,
          evidenceId: input.evidenceId,
          reviewedOn: input.reviewedOn,
          changeSetId: plan.id,
        });

        const body = yield* decode(
          Prep.AccruedCostView,
          yield* toJsonObject({
            accrualId,
            serviceIdentity: input.serviceIdentity,
            originalMinor: accrual.expectedMinor,
            resolvedMinor: "0",
            remainingMinor: accrual.expectedMinor,
            expenseAccountId: input.expenseAccountId,
            liabilityAccountId: input.accruedLiabilityAccountId,
            currency: input.currency,
            resolutions: [],
            receipt: receipt(command.idempotencyKey, "record_accrued_cost", principal.actorId),
          } satisfies JsonObject),
        );

        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "record_accrued_cost",
          principal.actorId,
          yield* toJsonObject(body),
        );

        return body;
      }),
    "update",
  );
});

export const resolveAccruedCost = Effect.fn("subledger.prepayments.resolveAccrual")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Prep.ResolveAccruedCost },
) {
  return yield* withSubledgerBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "resolve_accrued_cost",
          principal.actorId,
          yield* toJsonObject(command.input),
          Prep.AccrualResolutionView,
        );

        if (request.previous) return request.previous;
        yield* requirePrepaymentAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        yield* readBook(transaction, command.scope);

        const input = command.input;

        const accrual = (yield* PrepDb.readAccrual(
          transaction,
          command.scope.bookId,
          input.accrualId,
        ))[0];

        if (!accrual) return yield* failure("NotFound");

        // An invoice that describes a different service cannot resolve this
        // accrual. Silently combining two services' costs is the failure this
        // refuses.
        if (accrual.serviceIdentity !== input.serviceIdentity) {
          return yield* failure("StaleDependency");
        }

        // One invoice resolves an accrual once, bound to the invoice's own
        // identity rather than to a command key, so re-presenting it under a
        // new key still collides.
        if (
          (yield* PrepDb.readResolutionByInvoice(
            transaction,
            command.scope.bookId,
            input.accrualId,
            input.invoiceIdentity,
          )).length > 0
        ) {
          return yield* failure("IdempotencyConflict");
        }

        const evidence = (yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          input.invoiceEvidenceId,
        ))[0];

        if (!evidence) return yield* failure("MissingEvidence");

        const resolved = (yield* PrepDb.readResolvedTotal(
          transaction,
          command.scope.bookId,
          input.accrualId,
        ))[0];

        const remaining = BigInt(accrual.originalMinor) - BigInt(resolved?.resolved ?? "0");

        if (remaining < 0n) return yield* failure("InternalError");

        const resolution = yield* checked(
          resolveAccrualWithInvoice({
            accrualId: input.accrualId,
            accrualRemainingMinor: remaining.toString(),
            consumedAccrualMinor: input.consumedMinor,
            actualNetMinor: input.actualNetMinor,
            deductibleTaxMinor: input.deductibleTaxMinor,
            resolutionId: input.invoiceIdentity,
            knownResolutionIds: (yield* PrepDb.readResolutions(
              transaction,
              command.scope.bookId,
              input.accrualId,
            )).map((row) => row.invoiceIdentity),
            expenseAccountId: input.expenseAccountId,
            taxAccountId: input.taxAccountId,
            payableAccountId: input.payableAccountId,
            accruedLiabilityAccountId: input.accruedLiabilityAccountId,
          }),
        );

        const payable = (
          BigInt(input.actualNetMinor) + BigInt(input.deductibleTaxMinor)
        ).toString();

        const resolutionId = newId("accrualresolution");

        const plan = yield* prepareJournalInTransaction(transaction, principal, {
          scope: command.scope,
          idempotencyKey: yield* journalKey(
            principal.actorId,
            command.idempotencyKey,
            "resolve_accrued_cost",
          ),
          input: {
            kind: "manual_journal",
            evidenceId: input.invoiceEvidenceId,
            eventKey: `accrual-resolution-${input.invoiceIdentity}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
            accountingPeriodId: `period_${input.postingDate.slice(0, 4)}`,
            postingDate: input.postingDate,
            series: input.series,
            description: `Accrued cost true-up ${input.invoiceIdentity}`,
            rationale: input.rationale,
            taxAssessment: "not_applicable",
            lines: resolution.journal.map((line) => ({
              accountId: line.accountId,
              debitMinor: line.debitMinor,
              creditMinor: line.creditMinor,
              description: line.description,
            })),
          },
        });

        yield* PrepDb.insertResolution(transaction, {
          bookId: command.scope.bookId,
          id: resolutionId,
          accrualId: input.accrualId,
          trueUpMinor: resolution.trueUpMinor,
          consumedMinor: input.consumedMinor,
          actualNetMinor: input.actualNetMinor,
          deductibleTaxMinor: input.deductibleTaxMinor,
          invoiceIdentity: input.invoiceIdentity,
          payableMinor: payable,
          changeSetId: plan.id,
          receiptId: command.idempotencyKey,
        });

        const after = (yield* PrepDb.readResolvedTotal(
          transaction,
          command.scope.bookId,
          input.accrualId,
        ))[0];

        const body = yield* decode(
          Prep.AccrualResolutionView,
          yield* toJsonObject({
            resolutionId,
            accrualId: input.accrualId,
            invoiceIdentity: input.invoiceIdentity,
            consumedMinor: input.consumedMinor,
            actualNetMinor: input.actualNetMinor,
            deductibleTaxMinor: input.deductibleTaxMinor,
            trueUpMinor: resolution.trueUpMinor,
            payableMinor: payable,
            remainingMinor: (
              BigInt(accrual.originalMinor) - BigInt(after?.resolved ?? "0")
            ).toString(),
            changeSetId: plan.id,
            journalIds: [],
            receipt: receipt(command.idempotencyKey, "resolve_accrued_cost", principal.actorId),
          } satisfies JsonObject),
        );

        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "resolve_accrued_cost",
          principal.actorId,
          yield* toJsonObject(body),
        );

        return body;
      }),
    "update",
  );
});

export const readAccruedCost = Effect.fn("subledger.prepayments.readAccrual")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Prep.ReadAccruedCost },
) {
  return yield* withSubledgerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        yield* requirePrepaymentAccess(transaction, false);
        yield* Db.lockBookForShare(transaction, command.scope);
        yield* readBook(transaction, command.scope);

        const accrual = (yield* PrepDb.readAccrual(
          transaction,
          command.scope.bookId,
          command.input.accrualId,
        ))[0];

        if (!accrual) return yield* failure("NotFound");

        const resolutions = yield* PrepDb.readResolutions(
          transaction,
          command.scope.bookId,
          accrual.id,
        );

        const resolved = (yield* PrepDb.readResolvedTotal(
          transaction,
          command.scope.bookId,
          accrual.id,
        ))[0];

        return yield* decode(
          Prep.AccruedCostView,
          yield* toJsonObject({
            accrualId: accrual.id,
            serviceIdentity: accrual.serviceIdentity,
            originalMinor: accrual.originalMinor,
            resolvedMinor: resolved?.resolved ?? "0",
            // Always original less resolved. It is never carried as a stated
            // figure that could drift from the resolutions behind it.
            remainingMinor: (
              BigInt(accrual.originalMinor) - BigInt(resolved?.resolved ?? "0")
            ).toString(),
            expenseAccountId: accrual.expenseAccountId,
            liabilityAccountId: accrual.liabilityAccountId,
            currency: accrual.currency,
            resolutions: resolutions.map((row) => ({
              resolutionId: row.id,
              invoiceIdentity: row.invoiceIdentity,
              consumedMinor: row.consumedMinor,
              actualNetMinor: row.actualNetMinor,
              deductibleTaxMinor: row.deductibleTaxMinor,
              trueUpMinor: row.trueUpMinor,
              changeSetId: row.changeSetId,
            })),
            // A read records no command: there is no mutation to recover.
            receipt: receipt(command.idempotencyKey, "read_accrued_cost", principal.actorId),
          } satisfies JsonObject),
        );
      }),
    "share",
  );
});
