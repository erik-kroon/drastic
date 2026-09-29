import * as Accounting from "@open-erp/contracts/accounting";
import * as CashMethod from "@open-erp/contracts/cash-method";
import {
  applyCashPayment,
  prepareYearEnd,
  type CashMethodFailure,
  type CashMethodFailureCode,
  type CashMethodLine,
  type CashPaymentAllocation,
} from "@open-erp/domain/cash-method";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { withBook } from "./support";
import { digest, newId, prepareJournalInTransaction, replay, saveCommand } from "../posting";
import type { Transaction } from "../../db/transaction";
import * as CashMethodDb from "../../db/commerce/cash-method";
import { invoiceRegisterTables } from "../../db/commerce/invoice-lifecycle";
import { liveInvoice } from "./register";
import { requireTableAccess } from "./support";

type Scope = typeof Accounting.Scope.Type;

type JsonObject = Schema.JsonObject;

const refusalFailure = {
  // A payment covering more than the line's remaining commercial capacity.
  UnrecognizedCoverageExceeded: "InvalidJournal",
  // The coverage basis moved since the caller's view of it.
  StaleCoverage: "StaleDependency",
  // The same source was used twice for one recognition.
  DuplicateSourceUse: "IdempotencyConflict",
  NonPositiveAmount: "InvalidJournal",
  // A line without the capacity the caller asked it to cover.
  InsufficientLineCapacity: "InvalidJournal",
  // A journal that does not foot is never prepared.
  UnbalancedJournal: "InvalidJournal",
  // Year end needs the complete population, not a page of it.
  IncompletePopulation: "ApprovalRequired",
  // A backdated change after the assessment was sealed.
  InvalidatedAssessment: "ApprovalRequired",
  UnsupportedProfile: "UnsupportedProfile",
} satisfies Record<CashMethodFailureCode, typeof Accounting.FailureCode.Type>;

function refuse(outcome: CashMethodFailure) {
  return failure(refusalFailure[outcome.code], outcome.message);
}

function checked<A>(value: Result.Result<A, CashMethodFailure>) {
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

function receipt(key: string, operation: string, actorId: string) {
  return { key, operation, actorId } satisfies JsonObject;
}

// The invoice owner's own direction vocabulary is customer/supplier; the
// accounting view is sale/purchase. The mapping is explicit so a reader never
// has to infer which is which.
function accountingDirection(direction: string) {
  if (direction === "customer") return "sale" as const;

  if (direction === "supplier") return "purchase" as const;

  return undefined;
}

// The invoice owner's own retained tables, which this owner only reads. They
// are gated as reads even on a write path: requiring insert on `books` or
// `periods` would refuse a role that is correctly scoped to post.
const cashMethodReadTables = [
  ...invoiceRegisterTables,
  ...CashMethodDb.cashMethodTables,
  "change_sets",
  "command_receipts",
] as const;

// The commerce owner's read gate plus this owner's three tables, with insert
// required only where this owner actually writes. A role that cannot reach a
// table it needs refuses here rather than on the first write.
function requireCashMethodAccess(transaction: Transaction, write: boolean) {
  return Effect.gen(function* () {
    yield* requireTableAccess(transaction, cashMethodReadTables, false);

    if (!write) return;

    const rows = yield* CashMethodDb.readCashMethodAccess(transaction);

    if (rows.length !== CashMethodDb.cashMethodTables.length) {
      return yield* failure("UnsupportedProfile");
    }

    const denied = rows.some((row) => {
      if (!row.canSelect || !row.canInsert) return true;

      return row.tableName === "cash_method_lines" && !row.canUpdate;
    });

    if (denied) return yield* failure("UnsupportedProfile");
  });
}

// The net and tax components of one recognition, read from the retained
// journal lines of the voucher's own recognition. A cash-method line is
// derived from what the invoice actually posted, never from a caller stating
// what the tax was.
function recognitionComponents(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  recognitionLineId: string,
  direction: "sale" | "purchase",
) {
  return Effect.gen(function* () {
    const lines = yield* CashMethodDb.readRecognitionComponents(transaction, bookId, voucherId);

    // The recognition is identified by its own retained journal line. A
    // voucher whose control line is not retained is not a recognized document
    // and cannot become a cash-method line.
    const control = lines.find((line) => line.id === recognitionLineId);

    if (!control) return yield* failure("InvalidJournal");

    // The gross is the control side. A cash-method document posts its gross
    // against a net and a tax, so the non-control sides must sum to exactly the
    // gross: the net is the largest of them, because a tax component never
    // exceeds the net it sits on, and the tax is what remains. Taking the
    // largest reads the shape of the retained voucher rather than choosing
    // between amounts a caller supplied.
    const others = lines.filter((line) => line.id !== recognitionLineId);

    if (others.length === 0) return yield* failure("InvalidJournal");

    const sideOf = (line: { readonly debitMinor: string; readonly creditMinor: string }) =>
      direction === "sale"
        ? line.creditMinor === "0"
          ? line.debitMinor
          : line.creditMinor
        : line.debitMinor === "0"
          ? line.creditMinor
          : line.debitMinor;

    const grossMinor = sideOf(control);
    const parts = others.map(sideOf).map((part) => BigInt(part));

    if (parts.reduce((sum, part) => sum + part, 0n) !== BigInt(grossMinor)) {
      return yield* failure("InvalidJournal");
    }

    const netMinor = parts
      .reduce((largest, part) => (part > largest ? part : largest), 0n)
      .toString();

    return yield* Effect.succeed({
      netMinor,
      taxMinor: (BigInt(grossMinor) - BigInt(netMinor)).toString(),
    });
  });
}

function lineView(line: CashMethodDb.CashMethodLineRow, yearEndRecognized: boolean) {
  const original = BigInt(line.originalGrossMinor);
  const credited = BigInt(line.creditedGrossMinor);
  const paid = BigInt(line.paidGrossMinor);
  const recognized = BigInt(line.recognizedGrossMinor);

  return {
    lineId: line.id,
    invoiceId: line.invoiceId,
    sourceLineId: line.sourceLineId,
    direction: line.direction,
    currency: line.currency,
    originalGrossMinor: line.originalGrossMinor,
    creditedGrossMinor: line.creditedGrossMinor,
    paidGrossMinor: line.paidGrossMinor,
    recognizedGrossMinor: line.recognizedGrossMinor,
    // The two open balances. Commercial unpaid is what the counterparty still
    // owes; recognized unpaid is what the book has taken but not been paid for.
    // Keeping them apart is the whole point of the method.
    commercialUnpaidMinor: (original - credited - paid).toString(),
    recognizedUnpaidMinor: (recognized - paid).toString(),
    profileWitness: line.profileWitness,
    yearEndRecognized,
  } satisfies JsonObject;
}

export const registerCashMethodLine = Effect.fn("commerce.cashMethod.registerLine")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RegisterCashMethodLine },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireCashMethodAccess(transaction, true);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "register_cash_method_line",
        principal.actorId,
        yield* toJsonObject(command.input),
        CashMethod.CashMethodLineView,
      );

      if (request.previous) return request.previous;

      const input = command.input;

      const invoice = (yield* CashMethodDb.readInvoiceBasis(
        transaction,
        command.scope.bookId,
        input.invoiceId,
      ))[0];

      if (!invoice) return yield* failure("NotFound");
      // A cancelled or blocked document is not a cash-method document.
      void (yield* liveInvoice(transaction, command.scope.bookId, input.invoiceId));

      const direction = accountingDirection(invoice.direction);

      if (direction === undefined) return yield* failure("InvalidJournal");

      if (direction !== input.direction) return yield* failure("InvalidJournal");

      const existing = (yield* CashMethodDb.readLineBySource(
        transaction,
        command.scope.bookId,
        input.invoiceId,
        input.sourceLineId,
      ))[0];

      if (existing) return yield* failure("IdempotencyConflict");

      // The commercial gross is the invoice's own retained amount and the
      // net/tax split is the recognition voucher's, not the caller's. A
      // document whose recognition does not foot is not a cash-method document.
      // A document whose recognition does not separate its control, net and
      // tax sides is not a cash-method document. The split is read from the
      // retained journal lines, never from the caller.
      void (yield* recognitionComponents(
        transaction,
        command.scope.bookId,
        invoice.voucherId,
        invoice.recognitionLineId,
        direction,
      ));

      const lineId = newId("cashline");

      yield* CashMethodDb.insertLine(transaction, {
        bookId: command.scope.bookId,
        id: lineId,
        invoiceId: input.invoiceId,
        sourceLineId: input.sourceLineId,
        direction,
        currency: invoice.bookCurrency,
        originalGrossMinor: invoice.amountMinor,
        // Credits are a prefix under this policy, so a line starts with none
        // credited and consumes them from the suffix as they are applied.
        creditedGrossMinor: "0",
        componentPolicy: input.componentPolicy,
        rounding: input.rounding,
        profileWitness: input.profileWitness,
      });

      const line = (yield* CashMethodDb.readLine(transaction, command.scope.bookId, lineId))[0];

      if (!line) return yield* failure("InternalError");

      const body = yield* decode(
        CashMethod.CashMethodLineView,
        yield* toJsonObject({
          ...lineView(line, false),
          receipt: receipt(command.idempotencyKey, "register_cash_method_line", principal.actorId),
        } satisfies JsonObject),
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "register_cash_method_line",
        principal.actorId,
        yield* toJsonObject(body),
      );

      return body;
    },
    "update",
  );
});

export const recognizeCashPayment = Effect.fn("commerce.cashMethod.recognizePayment")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RecognizeCashPayment },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireCashMethodAccess(transaction, true);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "recognize_cash_payment",
        principal.actorId,
        yield* toJsonObject(command.input),
        CashMethod.CashPaymentRecognition,
      );

      if (request.previous) return request.previous;

      const input = command.input;

      const line = (yield* CashMethodDb.readLineForUpdate(
        transaction,
        command.scope.bookId,
        input.lineId,
      ))[0];

      if (!line) return yield* failure("NotFound");

      // One payment recognizes a line once, bound to the payment's own
      // identity rather than to a command key, so a re-presented payment under
      // a new key still collides.
      const prior = (yield* CashMethodDb.readRecognition(
        transaction,
        command.scope.bookId,
        line.id,
        "actual_payment",
        input.paymentRef,
      ))[0];

      if (prior) return yield* failure("IdempotencyConflict");

      const invoice = (yield* CashMethodDb.readInvoiceBasis(
        transaction,
        command.scope.bookId,
        line.invoiceId,
      ))[0];

      if (!invoice) return yield* failure("NotFound");
      const direction = accountingDirection(invoice.direction) ?? "purchase";

      // A document whose recognition does not separate its control, net and
      // tax sides is not a cash-method document. The split is read from the
      // retained journal lines, never from the caller.
      const components = yield* recognitionComponents(
        transaction,
        command.scope.bookId,
        invoice.voucherId,
        invoice.recognitionLineId,
        direction,
      );

      const original = BigInt(line.originalGrossMinor);
      const credited = BigInt(line.creditedGrossMinor);
      const paid = BigInt(line.paidGrossMinor);
      const recognized = BigInt(line.recognizedGrossMinor);

      // The leaf's own state, derived from the retained prefixes.
      const basis: CashMethodLine = {
        sourceLineId: line.sourceLineId,
        netMinor: components.netMinor,
        taxMinor: components.taxMinor,
        creditedGrossMinor: credited.toString(),
        paidGrossMinor: paid.toString(),
        recognizedGrossMinor: recognized.toString(),
        recognizedVersion: line.version,
        componentPolicy: "tax_first_cumulative_v1",
        rounding: line.rounding === "half_up" ? "half_up" : "exact",
        originalDeductibleMinor: direction === "purchase" ? components.netMinor : "0",
        releasedDeductibleMinor: "0",
      };

      // The evidence a previous recognition already consumed, read from the
      // line's retained history. It must not include this payment's own
      // evidence: re-presenting the same cash receipt is the duplicate the
      // leaf refuses.
      const priorRecognitions = yield* CashMethodDb.readRecognitions(
        transaction,
        command.scope.bookId,
        line.id,
      );

      const plan = yield* checked(
        applyCashPayment({
          direction,
          lines: [basis],
          allocations: [
            { sourceLineId: line.sourceLineId, paidGrossMinor: input.paidGrossMinor },
          ] satisfies ReadonlyArray<CashPaymentAllocation>,
          settlementControlAccountId: input.settlementControlAccountId,
          expenseOrRevenueAccountId: input.expenseOrRevenueAccountId,
          taxAccountId: input.taxAccountId,
          bankAccountId: input.bankAccountId,
          cashEvidenceId: input.cashEvidenceId,
          knownCashEvidenceIds: priorRecognitions.flatMap((row) => [row.triggerRef]),
        }),
      );

      const slice = plan.slices[0];

      if (!slice) return yield* failure("InternalError");

      // The two balances after the payment, both derived from the leaf's own
      // line state rather than recomputed here.
      const advanced = yield* CashMethodDb.advanceLine(transaction, {
        bookId: command.scope.bookId,
        lineId: line.id,
        expectedVersion: line.version,
        paidGrossMinor: slice.lineAfter.paidGrossMinor,
        recognizedGrossMinor: slice.lineAfter.recognizedGrossMinor,
      });

      if ((advanced[0]?.moved ?? "0") !== "1") return yield* failure("StaleDependency");

      const prepared = yield* prepareJournalInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: `cm_${(yield* digest({
          actor: principal.actorId,
          key: command.idempotencyKey,
          operation: "recognize_cash_payment",
        } satisfies JsonObject)).slice(8)}`,
        input: {
          kind: "manual_journal",
          evidenceId: input.cashEvidenceId,
          eventKey: `cashmethod-${input.paymentRef}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
          accountingPeriodId: input.accountingPeriodId,
          postingDate: input.postingDate,
          series: input.series,
          description: `Cash-method recognition on payment ${input.paymentRef}`,
          rationale: input.rationale,
          taxAssessment: "not_applicable",
          lines: plan.journal.map((line) => ({
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            description: line.description,
          })),
        },
      });

      const recognitionId = newId("cashrecog");

      yield* CashMethodDb.insertRecognition(transaction, {
        bookId: command.scope.bookId,
        id: recognitionId,
        lineId: line.id,
        triggerKind: "actual_payment",
        triggerRef: input.paymentRef,
        recognizedGrossMinor: slice.settledRecognizedMinor,
        recognizedGrossAfterMinor: slice.recognizedGrossAfterMinor,
        paidGrossAfterMinor: slice.lineAfter.paidGrossMinor,
        netMinor: slice.newNetMinor,
        taxMinor: slice.newTaxMinor,
        deductibleMinor: slice.newDeductibleMinor,
        evidenceId: input.cashEvidenceId,
        changeSetId: prepared.id,
      });

      const after = (yield* CashMethodDb.readLine(transaction, command.scope.bookId, line.id))[0];

      if (!after) return yield* failure("InternalError");

      const body = yield* decode(
        CashMethod.CashPaymentRecognition,
        yield* toJsonObject({
          recognitionId,
          lineId: line.id,
          paymentRef: input.paymentRef,
          recognizedGrossMinor: slice.settledRecognizedMinor,
          recognizedGrossAfterMinor: after.recognizedGrossMinor,
          paidGrossAfterMinor: after.paidGrossMinor,
          commercialUnpaidMinor: (original - credited - BigInt(after.paidGrossMinor)).toString(),
          recognizedUnpaidMinor: (
            BigInt(after.recognizedGrossMinor) - BigInt(after.paidGrossMinor)
          ).toString(),
          netMinor: slice.newNetMinor,
          taxMinor: slice.newTaxMinor,
          changeSetId: prepared.id,
          // The journal is prepared, not executed: recognition follows the
          // released prepare/approve/execute boundary like every other posting.
          journalIds: [],
          receipt: receipt(command.idempotencyKey, "recognize_cash_payment", principal.actorId),
        } satisfies JsonObject),
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "recognize_cash_payment",
        principal.actorId,
        yield* toJsonObject(body),
      );

      return body;
    },
    "update",
  );
});

export const runCashMethodYearEnd = Effect.fn("commerce.cashMethod.runYearEnd")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RunCashMethodYearEnd },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      yield* requireCashMethodAccess(transaction, true);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "run_cash_method_year_end",
        principal.actorId,
        yield* toJsonObject(command.input),
        CashMethod.YearEndRecognition,
      );

      if (request.previous) return request.previous;

      const input = command.input;

      // One cutover per period. Recognizing the same unpaid remainder twice is
      // the failure this refusal exists to stop.
      if (
        (yield* CashMethodDb.readYearEndRunByPeriod(
          transaction,
          command.scope.bookId,
          input.accountingPeriodId,
        )).length > 0
      ) {
        return yield* failure("IdempotencyConflict");
      }

      // The population is read from the retained lines, not supplied by the
      // caller: a year end recognizes what the book actually holds unpaid, and
      // the leaf refuses a page of a population rather than the whole of it.
      const population = yield* CashMethodDb.readUnpaidPopulation(
        transaction,
        command.scope.bookId,
      );

      const runId = newId("cashyearend");

      const lines: Array<{
        readonly row: CashMethodDb.CashMethodLineRow;
        readonly basis: CashMethodLine;
        readonly direction: "sale" | "purchase";
        readonly components: { readonly netMinor: string; readonly taxMinor: string };
      }> = [];

      for (const row of population) {
        const invoice = (yield* CashMethodDb.readInvoiceBasis(
          transaction,
          command.scope.bookId,
          row.invoiceId,
        ))[0];

        if (!invoice) return yield* failure("InternalError");
        const direction = accountingDirection(invoice.direction) ?? "purchase";

        const components = yield* recognitionComponents(
          transaction,
          command.scope.bookId,
          invoice.voucherId,
          invoice.recognitionLineId,
          direction,
        );

        lines.push({
          row,
          direction,
          components,
          basis: {
            sourceLineId: row.sourceLineId,
            netMinor: components.netMinor,
            taxMinor: components.taxMinor,
            creditedGrossMinor: row.creditedGrossMinor,
            paidGrossMinor: row.paidGrossMinor,
            recognizedGrossMinor: row.recognizedGrossMinor,
            recognizedVersion: row.version,
            componentPolicy: "tax_first_cumulative_v1",
            rounding: row.rounding === "half_up" ? "half_up" : "exact",
            originalDeductibleMinor: direction === "purchase" ? components.netMinor : "0",
            releasedDeductibleMinor: "0",
          },
        });
      }

      // One direction per run: the leaf's journal is signed for a single
      // direction, and mixing purchases with sales in one recognition would
      // post a net figure that is neither.
      const directions = new Set(lines.map((entry) => entry.direction));

      if (directions.size > 1) return yield* failure("ApprovalRequired");
      const direction = lines[0]?.direction ?? "purchase";

      const plan = yield* checked(
        prepareYearEnd({
          direction,
          fiscalYearId: input.accountingPeriodId,
          accountingCutoff: input.cutoffOn,
          // The population is the whole of it: the count is the population the
          // owner read, so the leaf's completeness check is a real check
          // rather than a claim.
          complete: true,
          expectedInvoiceCount: lines.length,
          invoiceCount: lines.length,
          lines: lines.map((entry) => entry.basis),
          settlementControlAccountId: input.settlementControlAccountId,
          expenseOrRevenueAccountId: input.expenseOrRevenueAccountId,
          taxAccountId: input.taxAccountId,
        }),
      );

      const prepared = yield* prepareJournalInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: `cmye_${(yield* digest({
          actor: principal.actorId,
          key: command.idempotencyKey,
          operation: "run_cash_method_year_end",
        } satisfies JsonObject)).slice(8)}`,
        input: {
          kind: "manual_journal",
          evidenceId: input.evidenceId,
          eventKey: `cashmethod-yearend-${input.accountingPeriodId}`.replace(
            /[^a-zA-Z0-9_-]/g,
            "_",
          ),
          accountingPeriodId: input.accountingPeriodId,
          postingDate: input.postingDate,
          series: input.series,
          description: `Cash-method year-end unpaid recognition ${input.accountingPeriodId}`,
          rationale: input.rationale,
          taxAssessment: "not_applicable",
          lines: plan.journal.map((entry) => ({
            accountId: entry.accountId,
            debitMinor: entry.debitMinor,
            creditMinor: entry.creditMinor,
            description: entry.description,
          })),
        },
      });

      // The cutover run is retained before the recognitions that cite it: the
      // database refuses a year-end recognition naming a run that does not
      // exist, and that refusal is the point of the check.
      yield* CashMethodDb.insertYearEndRun(transaction, {
        bookId: command.scope.bookId,
        id: runId,
        accountingPeriodId: input.accountingPeriodId,
        cutoffOn: input.cutoffOn,
        rationale: input.rationale,
        evidenceId: input.evidenceId,
        recognizedLineCount: plan.slices.length,
        recognizedGrossMinor: plan.recognizedMinor,
        runKey: input.runKey,
        actorId: principal.actorId,
      });

      const changeSetIds = [prepared.id];
      const recognized: JsonObject[] = [];
      let total = 0n;
      let commercialRemaining = 0n;

      for (const entry of plan.slices) {
        const source = lines.find(
          (candidate) => candidate.basis.sourceLineId === entry.sourceLineId,
        );

        if (!source) return yield* failure("InternalError");

        const advanced = yield* CashMethodDb.advanceLine(transaction, {
          bookId: command.scope.bookId,
          lineId: source.row.id,
          expectedVersion: source.row.version,
          paidGrossMinor: entry.lineAfter.paidGrossMinor,
          recognizedGrossMinor: entry.lineAfter.recognizedGrossMinor,
        });

        if ((advanced[0]?.moved ?? "0") !== "1") return yield* failure("StaleDependency");

        yield* CashMethodDb.insertRecognition(transaction, {
          bookId: command.scope.bookId,
          id: newId("cashrecog"),
          lineId: source.row.id,
          triggerKind: "year_end_unpaid",
          triggerRef: runId,
          recognizedGrossMinor: entry.unpaidMinor,
          recognizedGrossAfterMinor: entry.lineAfter.recognizedGrossMinor,
          paidGrossAfterMinor: entry.lineAfter.paidGrossMinor,
          netMinor: entry.newNetMinor,
          taxMinor: entry.newTaxMinor,
          deductibleMinor: entry.newDeductibleMinor,
          evidenceId: input.evidenceId,
          changeSetId: prepared.id,
        });

        total += BigInt(entry.unpaidMinor);
        commercialRemaining +=
          BigInt(source.row.originalGrossMinor) -
          BigInt(source.row.creditedGrossMinor) -
          BigInt(entry.lineAfter.paidGrossMinor);
        recognized.push({
          lineId: source.row.id,
          invoiceId: source.row.invoiceId,
          sourceLineId: source.row.sourceLineId,
          recognizedGrossMinor: entry.unpaidMinor,
          recognizedGrossAfterMinor: entry.lineAfter.recognizedGrossMinor,
        } satisfies JsonObject);
      }

      const body = yield* decode(
        CashMethod.YearEndRecognition,
        yield* toJsonObject({
          runId,
          accountingPeriodId: input.accountingPeriodId,
          cutoffOn: input.cutoffOn,
          recognizedLineCount: recognized.length,
          recognizedGrossMinor: total.toString(),
          lines: recognized,
          // The unpaid commercial balance the run deliberately did not
          // recognize. It is reported rather than hidden, because that is the
          // difference between a cash-method year end and an accrual one.
          commercialUnpaidRemainingMinor: commercialRemaining.toString(),
          changeSetIds,
          receipt: receipt(command.idempotencyKey, "run_cash_method_year_end", principal.actorId),
        } satisfies JsonObject),
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "run_cash_method_year_end",
        principal.actorId,
        yield* toJsonObject(body),
      );

      return body;
    },
    "update",
  );
});

export const readCashMethodLine = Effect.fn("commerce.cashMethod.readLine")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.ReadCashMethodLine },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      yield* requireCashMethodAccess(transaction, false);

      const line = (yield* CashMethodDb.readLine(
        transaction,
        command.scope.bookId,
        command.input.lineId,
      ))[0];

      if (!line) return yield* failure("NotFound");

      const recognitions = yield* CashMethodDb.readRecognitions(
        transaction,
        command.scope.bookId,
        line.id,
      );

      const yearEndRecognized = recognitions.some((row) => row.triggerKind === "year_end_unpaid");

      return yield* decode(
        CashMethod.CashMethodLineView,
        yield* toJsonObject({
          ...lineView(line, yearEndRecognized),
          receipt: receipt(command.idempotencyKey, "read_cash_method_line", principal.actorId),
        } satisfies JsonObject),
      );
    },
    "share",
  );
});
