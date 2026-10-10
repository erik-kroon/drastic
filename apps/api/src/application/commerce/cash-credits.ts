import { runBookCommand } from "../book-commands";
import * as Accounting from "@open-erp/contracts/accounting";
import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Cash from "@open-erp/domain/cash-method";
import { cumulativeRelease } from "@open-erp/domain/purchasing";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/commerce/cash-credits";
import * as CoverageDb from "../../db/commerce/cash-payments";
import * as YearDb from "../../db/commerce/cash-year-end";
import * as Ledger from "../../db/posting";
import * as PostingAdmissionDb from "../../db/posting-admission";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { newId } from "../identifiers";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import {
  sealActionInTransaction,
  approveChangeInTransaction,
  executeChangeInTransaction,
} from "../posting";
import { recordCashCreditFactInTransaction } from "../vat/cash-method-facts";
import { readCashCoverageInTransaction } from "./cash-payments";
import { resolveCashInvoiceProfileInTransaction, requireCashAccounts } from "./cash-invoices";
import { liveInvoice } from "./register";
import { approvalExpiry } from "./approval";
import { readCashCreditSource } from "./cash-credit-source";
import {
  decode,
  toJsonObject,
  commandReceipt,
  withBook,
  type Scope,
  type Principal,
} from "./support";

type Input = typeof CashMethod.PrepareCashCredit.Type;

type Plan = typeof CashMethod.CashCreditPlan.Type;

type CreditLine = typeof CashMethod.CashCreditLine.Type;

type Basis = typeof CashMethod.CashInvoiceBasis.Type;

type SourceComponents = {
  grossMinor: string;
  netMinor: string;
  taxMinor: string;
  deductibleMinor: string;
};

const requireSuffixComponents = Effect.fn("cashCredit.requireSuffixComponents")(function* (
  before: Cash.CashMethodLine,
  source: SourceComponents,
) {
  const gross = BigInt(before.netMinor) + BigInt(before.taxMinor);
  const effectiveBefore = gross - BigInt(before.creditedGrossMinor);
  const effectiveAfter = effectiveBefore - BigInt(source.grossMinor);

  const taxBefore = cumulativeRelease(
    BigInt(before.taxMinor),
    gross,
    0n,
    effectiveBefore,
    before.rounding,
  );

  const taxAfter = cumulativeRelease(
    BigInt(before.taxMinor),
    gross,
    0n,
    effectiveAfter,
    before.rounding,
  );

  if (Result.isFailure(taxBefore) || Result.isFailure(taxAfter))
    return yield* failure("UnsupportedProfile");

  const deductibleBefore = cumulativeRelease(
    BigInt(before.originalDeductibleMinor),
    BigInt(before.taxMinor),
    0n,
    taxBefore.success,
    before.rounding,
  );

  const deductibleAfter = cumulativeRelease(
    BigInt(before.originalDeductibleMinor),
    BigInt(before.taxMinor),
    0n,
    taxAfter.success,
    before.rounding,
  );

  if (Result.isFailure(deductibleBefore) || Result.isFailure(deductibleAfter))
    return yield* failure("UnsupportedProfile");

  const tax = taxBefore.success - taxAfter.success;

  if (
    tax !== BigInt(source.taxMinor) ||
    BigInt(source.grossMinor) - tax !== BigInt(source.netMinor) ||
    deductibleBefore.success - deductibleAfter.success !== BigInt(source.deductibleMinor)
  )
    return yield* failure("UnsupportedProfile");
});

const compileCreditLine = Effect.fn("cashCredit.compileLinkedLine")(function* (
  tx: Transaction,
  scope: Scope,
  current: { lineId: string; line: Cash.CashMethodLine },
  original: Basis["lines"][number],
  source: SourceComponents,
) {
  const before = current.line;

  yield* requireSuffixComponents(before, source);

  const creditGrossMinor = source.grossMinor;

  const effectiveAfter =
    BigInt(original.grossMinor) - BigInt(before.creditedGrossMinor) - BigInt(creditGrossMinor);

  const recognizedBefore = BigInt(before.recognizedGrossMinor);

  const recognizedAfter = recognizedBefore < effectiveAfter ? recognizedBefore : effectiveAfter;

  const result = Cash.applyCashCredit({
    direction: "purchase",
    line: before,
    creditGrossMinor,
    recognizedPortionMinor: (recognizedBefore - recognizedAfter).toString(),
    paidPrincipal: effectiveAfter < BigInt(before.paidGrossMinor),
  });

  if (Result.isFailure(result)) return yield* failure("UnsupportedProfile");

  const correction = result.success;

  const origins =
    BigInt(correction.recognizedCorrectionMinor) > 0n
      ? yield* Db.readRecognizedOrigin(tx, scope.bookId, current.lineId)
      : [];

  const origin = origins[0];

  if (
    BigInt(correction.recognizedCorrectionMinor) > 0n &&
    (!origin ||
      origins.length !== 1 ||
      BigInt(correction.recognizedCorrectionMinor) > BigInt(origin.initialGrossMinor))
  )
    return yield* failure("UnsupportedProfile");

  if (BigInt(correction.correctionTaxMinor) > 0n && !origin?.vatFactId)
    return yield* failure("StaleDependency");

  return {
    lineId: current.lineId,
    before,
    after: {
      ...correction.lineAfter,
      recognizedVersion: (BigInt(before.recognizedVersion) + 1n).toString(),
    },
    creditGrossMinor,
    recognizedCorrectionMinor: correction.recognizedCorrectionMinor,
    correctionNetMinor: correction.correctionNetMinor,
    correctionTaxMinor: correction.correctionTaxMinor,
    correctionDeductibleMinor: correction.correctionDeductibleMinor,
    originalRecognitionId: origin?.id ?? null,
    originalVatFactId: origin?.vatFactId ?? null,
    originalVoucherId: origin?.voucherId ?? null,
    taxJournalIndex: null,
  } satisfies CreditLine;
});

function appendCreditJournal(
  journal: Cash.CashJournalLine[],
  basis: Basis,
  original: Basis["lines"][number],
  line: CreditLine,
) {
  if (BigInt(line.recognizedCorrectionMinor) === 0n) return null;

  journal.push({
    sourceLineId: original.sourceLineId,
    accountId: basis.controlAccountId,
    debitMinor: line.recognizedCorrectionMinor,
    creditMinor: "0",
    description: "Reduce recognized unpaid supplier debt",
  });

  const cost =
    BigInt(line.correctionNetMinor) +
    BigInt(line.correctionTaxMinor) -
    BigInt(line.correctionDeductibleMinor);

  if (cost > 0n)
    journal.push({
      sourceLineId: original.sourceLineId,
      accountId: original.expenseAccountId,
      debitMinor: "0",
      creditMinor: cost.toString(),
      description: "Correct recognized original purchase cost",
    });

  if (BigInt(line.correctionDeductibleMinor) === 0n) return null;

  const taxJournalIndex = journal.length;

  journal.push({
    sourceLineId: original.sourceLineId,
    accountId: basis.inputVatAccountId,
    debitMinor: "0",
    creditMinor: line.correctionDeductibleMinor,
    description: "Correct recognized original input VAT",
  });

  return taxJournalIndex;
}

const capture = Effect.fn("cashCredit.capture")(function* (
  tx: Transaction,
  scope: Scope,
  input: Input,
  eventId: string,
) {
  const invoice = yield* liveInvoice(tx, scope.bookId, input.invoiceId);

  if (invoice.kind !== "cash_method_supplier_invoice_v1" || invoice.status === "blocked")
    return yield* failure("UnsupportedProfile");

  const { basis, lines: coverage } = yield* readCashCoverageInTransaction(
    tx,
    scope,
    input.invoiceId,
  );

  const source = yield* readCashCreditSource(tx, scope, input, basis);
  const { creditDate, supplierCreditNumber, creditEvidence } = source;

  if (creditDate < invoice.issuedOn) return yield* failure("InvalidJournal");

  if ((yield* YearDb.readBlockingRun(tx, scope.bookId, creditDate))[0])
    return yield* failure("StaleDependency");

  if ((yield* PostingAdmissionDb.readActiveCloseCoveringDate(tx, scope.bookId, creditDate))[0])
    return yield* failure("StaleDependency");

  if (
    (yield* Db.readConflicts(tx, scope.bookId, {
      invoiceId: input.invoiceId,
      creditEvidenceId: creditEvidence.evidenceId,
      supplierCreditNumber,
    }))[0]?.present
  )
    return yield* failure("IdempotencyConflict");

  const period = (yield* Ledger.readPeriod(tx, scope.bookId, input.accountingPeriodId))[0];

  if (!period) return yield* failure("NotFound");

  if (period.locked) return yield* failure("PeriodLocked");

  if (creditDate < period.startsOn || creditDate > period.endsOn)
    return yield* failure("InvalidJournal");

  const qualified = yield* resolveCashInvoiceProfileInTransaction(tx, scope, creditDate);

  if (basis.methodFactRevisionId !== qualified.methodFactRevisionId)
    return yield* failure("StaleDependency");

  yield* requireCashAccounts(
    tx,
    scope,
    {
      profile: basis.profile,
      draftId: basis.draftId,
      expectedRevision: basis.draftRevision,
      expectedDigest: basis.draftDigest,
      controlAccountId: basis.controlAccountId,
      inputVatAccountId: basis.inputVatAccountId,
      lineAssignments: basis.lines.map((line) => ({
        lineId: line.sourceLineId,
        expenseAccountId: line.expenseAccountId,
        treatment: line.treatment,
      })),
      reason: input.rationale,
      acknowledgeSyntheticOnly: true,
    },
    creditDate,
    qualified,
  );

  if (creditEvidence.evidenceId === invoice.evidence.evidenceId)
    return yield* failure("UnsupportedProfile");

  const lines: CreditLine[] = [];
  const journal: Cash.CashJournalLine[] = [];

  for (const original of basis.lines) {
    const requested = source.amounts.get(original.sourceLineId);

    if (!requested) continue;

    const current = coverage.find((line) => line.line.sourceLineId === original.sourceLineId);

    if (!current) return yield* failure("InternalError");

    const line = yield* compileCreditLine(tx, scope, current, original, requested);

    lines.push({ ...line, taxJournalIndex: appendCreditJournal(journal, basis, original, line) });
  }

  const ids = [
    ...new Set([
      basis.controlAccountId,
      basis.inputVatAccountId,
      ...basis.lines.map((line) => line.expenseAccountId),
    ]),
  ].sort();

  const accounts = yield* Ledger.readAccounts(tx, scope.bookId, ids);

  const book = (yield* Ledger.readBook(tx, scope))[0];

  if (!book || book.profile !== "synthetic-core-v1" || book.authority !== "native")
    return yield* failure("UnsupportedProfile");

  return yield* decode(CashMethod.CashCreditSelection, {
    input,
    creditDraft: source.draft,
    creditDate,
    supplierCreditNumber,
    eventId,
    invoiceRevision: invoice.currentRevision.revision,
    allocationVersion: invoice.allocationVersion,
    basis: yield* toJsonObject(basis),
    invoiceEvidence: invoice.evidence,
    creditEvidence,
    ...qualified,
    periodVersion: period.version.toString(),
    profileVersion: book.profileVersion.toString(),
    writerEpoch: book.writerEpoch.toString(),
    accounts: accounts.map((account) => ({ id: account.id, version: account.version.toString() })),
    lines,
    journal,
  });
});

const readPlan = Effect.fn("cashCredit.readPlan")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readPlan(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  const plan = yield* decode(CashMethod.CashCreditPlan, row.body);
  const body = { ...(yield* toJsonObject(plan)) };
  delete body.digest;

  if ((yield* digest(body)) !== plan.digest) return yield* failure("StaleDependency");

  return plan;
});

const recheck = Effect.fn("cashCredit.recheck")(function* (
  tx: Transaction,
  scope: Scope,
  plan: Plan,
) {
  const current = yield* capture(tx, scope, plan.selection.input, plan.selection.eventId);

  if (!equalJson(current, plan.selection)) return yield* failure("StaleDependency");
});

export const prepareCashCredit = Effect.fn("cashCredit.prepare")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Input },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "cash_credit_prepare";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: input,
        },
        CashMethod.CashCreditPlan,
        Effect.gen(function* () {
          const id = newId("cashcreditplan");
          const eventId = newId("event");
          const selection = yield* capture(tx, scope, input, eventId);
          yield* Ledger.insertEvent(
            tx,
            scope.bookId,
            eventId,
            selection.creditEvidence.evidenceId,
            `cash_credit_${id}`,
          );
          const period = (yield* Ledger.readPeriod(tx, scope.bookId, input.accountingPeriodId))[0];

          if (!period) return yield* failure("NotFound");

          const postingPlan =
            selection.journal.length === 0
              ? null
              : yield* sealActionInTransaction(
                  tx,
                  principal,
                  scope,
                  yield* decode(Accounting.VoucherPostingAction, {
                    kind: "post_voucher",
                    correctsVoucherId: null,
                    eventId,
                    postingPurpose: "adjustment",
                    occurrenceKey: `cash_credit_${id}`,
                    fiscalYearId: period.fiscalYearId,
                    accountingPeriodId: period.id,
                    postingDate: selection.creditDate,
                    series: input.series,
                    currency: "SEK",
                    description: "Owned unpaid cash-method supplier credit",
                    rationale: input.rationale,
                    taxAssessment: "not_applicable",
                    evidenceRefs: [
                      { ...selection.creditEvidence, locator: selection.input.draftId },
                      { ...selection.invoiceEvidence, locator: selection.input.invoiceId },
                    ],
                    lines: selection.journal.map((line) => ({
                      lineId: newId("line"),
                      accountId: line.accountId,
                      debitMinor: line.debitMinor,
                      creditMinor: line.creditMinor,
                      description: line.description,
                    })),
                  }),
                );

          const body = {
            id,
            scope,
            selection,
            postingPlan,
            createdBy: principal.actorId,
            createdAt: yield* isoNow(tx),
          };

          const plan = yield* decode(CashMethod.CashCreditPlan, {
            ...body,
            digest: yield* digest(body),
          });

          yield* Db.insertPlan(tx, scope.bookId, plan);

          return plan;
        }),
      );
    },
    "update",
  );
});

export const approveCashCredit = Effect.fn("cashCredit.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CashMethod.ApproveCashCredit.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "cash_credit_approve";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { id: command.id, input },
        },
        CashMethod.CashCreditApproval,
        Effect.gen(function* () {
          const plan = yield* readPlan(tx, scope, command.id);

          if (plan.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

          if (plan.digest !== input.planDigest) return yield* failure("StaleDependency");

          yield* recheck(tx, scope, plan);

          const kernel =
            plan.postingPlan === null
              ? null
              : yield* approveChangeInTransaction(tx, principal, {
                  scope,
                  changeSetId: plan.postingPlan.id,
                  idempotencyKey: `creditapprove_${newId("command")}`,
                  input: { version: 1, planDigest: plan.postingPlan.planDigest },
                  owner: { kind: "cash_credit", id: plan.id },
                });

          const approval = yield* decode(CashMethod.CashCreditApproval, {
            id: newId("cashcreditapproval"),
            planId: plan.id,
            planDigest: plan.digest,
            actorId: principal.actorId,
            expiresAt: yield* approvalExpiry(tx),
            cashPostingApprovalId: kernel?.id ?? null,
            receipt: commandReceipt(idempotencyKey, operation, principal.actorId),
          });

          yield* Db.insertApproval(tx, scope.bookId, approval);

          return approval;
        }),
      );
    },
    "update",
  );
});

const applyLines = Effect.fn("cashCredit.applyLines")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  plan: Plan,
  receipt: typeof CashMethod.CashCreditReceipt.Type,
) {
  for (const [index, line] of receipt.lines.entries()) {
    yield* CoverageDb.insertCoverage(tx, scope.bookId, {
      id: line.lineId,
      invoiceId: receipt.invoiceId,
      witness: plan.selection.methodFactRevisionId,
      line: line.before,
    });

    const suffix = (yield* digest({ creditId: receipt.id, lineId: line.lineId })).slice(7);
    const creditLineId = `cashcreditline_${suffix}`;

    const factId = BigInt(line.correctionTaxMinor) > 0n ? `cashcreditvat_${suffix}` : null;

    yield* Db.insertLine(tx, scope.bookId, receipt.id, creditLineId, line, factId);

    if (factId !== null) {
      const taxLine =
        line.taxJournalIndex === null
          ? undefined
          : plan.postingPlan?.groups[0]?.actions[0]?.lines[line.taxJournalIndex];

      if (
        !taxLine ||
        !receipt.postingReceipt ||
        !line.originalRecognitionId ||
        !line.originalVatFactId
      )
        return yield* failure("InternalError");

      yield* recordCashCreditFactInTransaction(tx, principal, {
        scope,
        creditLineId,
        factId,
        invoiceId: receipt.invoiceId,
        line,
        voucherId: receipt.postingReceipt.voucherId,
        taxLineId: taxLine.lineId,
        witness: plan.selection.vatWitness,
        receiptId: receipt.id,
        creditEvidence: plan.selection.creditEvidence,
        creditDate: plan.selection.creditDate,
      });

      if (receipt.vatFactIds[index] !== factId && !receipt.vatFactIds.includes(factId))
        return yield* failure("InternalError");
    }

    if (!(yield* Db.advanceCoverage(tx, scope.bookId, line))[0])
      return yield* failure("StaleDependency");
  }
});

const assertCreditResidual = Effect.fn("cashCredit.assertNativeResidual")(function* (
  tx: Transaction,
  scope: Scope,
  invoiceId: string,
) {
  const invoice = yield* liveInvoice(tx, scope.bookId, invoiceId);
  const coverage = yield* readCashCoverageInTransaction(tx, scope, invoiceId);

  const outstanding = coverage.lines
    .reduce(
      (sum, entry) =>
        sum +
        BigInt(entry.line.netMinor) +
        BigInt(entry.line.taxMinor) -
        BigInt(entry.line.creditedGrossMinor) -
        BigInt(entry.line.paidGrossMinor),
      0n,
    )
    .toString();

  if (invoice.outstandingMinor !== outstanding) return yield* failure("InvalidJournal");
});

export const executeCashCredit = Effect.fn("cashCredit.execute")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CashMethod.ExecuteCashCredit.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "cash_credit_execute";

      return yield* runBookCommand(
        tx,
        {
          scope: scope,
          idempotencyKey: idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { id: command.id, input },
        },
        CashMethod.CashCreditReceipt,
        Effect.gen(function* () {
          const plan = yield* readPlan(tx, scope, command.id);

          if (plan.digest !== input.planDigest) return yield* failure("StaleDependency");

          yield* recheck(tx, scope, plan);
          const row = (yield* Db.readApproval(tx, scope.bookId, input.approvalId))[0];

          if (!row || row.consumed) return yield* failure("ApprovalRequired");

          const approval = yield* decode(CashMethod.CashCreditApproval, row.body);

          if (
            approval.planId !== plan.id ||
            approval.planDigest !== plan.digest ||
            approval.actorId === plan.createdBy ||
            approval.expiresAt <= (yield* isoNow(tx))
          )
            return yield* failure("ApprovalRequired");

          if (
            !(yield* Ledger.readOperatorMembership(tx, scope.bookId, approval.actorId))[0] ||
            (yield* Ledger.readActorAdmission(tx, approval.actorId))[0]?.enabled === false
          )
            return yield* failure("ApprovalRequired");

          const postingReceipt =
            plan.postingPlan === null
              ? null
              : yield* executeChangeInTransaction(tx, principal, {
                  scope,
                  changeSetId: plan.postingPlan.id,
                  idempotencyKey: `creditexecute_${plan.id}`,
                  input: {
                    version: 1,
                    planDigest: plan.postingPlan.planDigest,
                    approvalId: approval.cashPostingApprovalId ?? "approval_missing",
                  },
                  owner: { kind: "cash_credit", id: plan.id },
                });

          const id = newId("cashcredit");
          const vatFactIds: string[] = [];

          for (const line of plan.selection.lines)
            if (BigInt(line.correctionTaxMinor) > 0n)
              vatFactIds.push(
                `cashcreditvat_${(yield* digest({ creditId: id, lineId: line.lineId })).slice(7)}`,
              );

          const total = (field: "creditGrossMinor" | "recognizedCorrectionMinor") =>
            plan.selection.lines.reduce((sum, line) => sum + BigInt(line[field]), 0n).toString();

          const receipt = yield* decode(CashMethod.CashCreditReceipt, {
            id,
            scope,
            invoiceId: plan.selection.input.invoiceId,
            planId: plan.id,
            approvalId: approval.id,
            creditGrossMinor: total("creditGrossMinor"),
            recognizedCorrectionMinor: total("recognizedCorrectionMinor"),
            lines: plan.selection.lines,
            postingReceipt,
            vatFactIds,
            committedAt: yield* isoNow(tx),
            receipt: commandReceipt(idempotencyKey, operation, principal.actorId),
          });

          yield* Db.insertCredit(tx, scope.bookId, plan, receipt);
          yield* applyLines(tx, principal, scope, plan, receipt);

          yield* assertCreditResidual(tx, scope, receipt.invoiceId);

          yield* Db.consumeApproval(tx, scope.bookId, approval.id);
          yield* YearDb.bumpPopulation(tx, scope.bookId);

          return receipt;
        }),
      );
    },
    "update",
  );
});
