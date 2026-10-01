import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cash from "@open-erp/domain/cash-method";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/commerce/cash-payments";
import * as YearEndDb from "../../db/commerce/cash-year-end";
import { readAccounts } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import {
  digest,
  sealActionInTransaction,
  newId,
  approveChangeInTransaction,
  executeChangeInTransaction,
} from "../posting";
import { recordCashMethodFactInTransaction } from "../vat/cash-method-facts";
import {
  readCashInvoiceBasisInTransaction,
  resolveCashInvoiceProfileInTransaction,
  requireCashAccounts,
} from "./cash-invoices";
import { decode, type Scope, type Principal, type JsonObject } from "./support";
import { liveInvoice } from "./register";

type Selection = typeof CashMethod.CashAllocationSelection.Type;

type PaymentLine = Selection["invoices"][number]["lines"][number];

type Leg = { readonly invoiceId: string; readonly ordinal: number; readonly amountMinor: string };

export const readCashCoverageInTransaction = Effect.fn("commerce.cashPayment.readCoverage")(
  function* (tx: Transaction, scope: Scope, invoiceId: string) {
    const basis = yield* readCashInvoiceBasisInTransaction(tx, scope, invoiceId);
    const rows = yield* Db.readCoverage(tx, scope.bookId, invoiceId);
    const lines = [];

    for (const original of basis.lines) {
      const retained = rows.find((row) => row.sourceLineId === original.sourceLineId);

      const lineId =
        retained?.id ??
        `cashline_${(yield* digest({ invoiceId, sourceLineId: original.sourceLineId })).slice(7)}`;

      const line = yield* decode(
        Cash.CashMethodLine,
        retained?.body ?? {
          sourceLineId: original.sourceLineId,
          netMinor: original.netMinor,
          taxMinor: original.taxMinor,
          originalDeductibleMinor: original.deductibleMinor,
          releasedDeductibleMinor: "0",
          paidGrossMinor: "0",
          recognizedGrossMinor: "0",
          creditedGrossMinor: "0",
          recognizedVersion: "0",
          componentPolicy: basis.componentPolicy,
          rounding: basis.rounding,
        },
      );

      if (
        line.netMinor !== original.netMinor ||
        line.taxMinor !== original.taxMinor ||
        line.originalDeductibleMinor !== original.deductibleMinor
      )
        return yield* failure("StaleDependency");
      lines.push({ lineId, line });
    }

    if (rows.length > basis.lines.length) return yield* failure("UnsupportedProfile");

    return { basis, lines };
  },
);

export const readFinalCashSourceInTransaction = Effect.fn("commerce.cashPayment.readFinalSource")(
  function* (tx: Transaction, scope: Scope, voucherId: string, lineId: string) {
    const rows = yield* Db.readFinalCashSource(tx, scope.bookId, voucherId, lineId);

    if (rows.length !== 1 || !rows[0]) return yield* failure("UnsupportedProfile");

    return yield* decode(CashMethod.CashPaymentSource, rows[0].body);
  },
);

const compileInvoicePayment = Effect.fn("commerce.cashPayment.compileInvoice")(function* (
  tx: Transaction,
  scope: Scope,
  source: typeof CashMethod.CashPaymentSource.Type,
  leg: Leg,
  journalStart: number,
) {
  const { basis, lines: coverage } = yield* readCashCoverageInTransaction(tx, scope, leg.invoiceId);
  const invoice = yield* liveInvoice(tx, scope.bookId, leg.invoiceId);
  const qualified = yield* resolveCashInvoiceProfileInTransaction(tx, scope, source.postingDate);

  if (
    qualified.methodFactRevisionId !== basis.methodFactRevisionId ||
    source.controlAccountId !== basis.controlAccountId
  )
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
      reason: "Retained source treatment for final cash allocation",
      acknowledgeSyntheticOnly: true,
    },
    source.postingDate,
    qualified,
  );
  let remaining = BigInt(leg.amountMinor);
  const journal: Array<typeof Cash.CashJournalLine.Type> = [];
  const lines: Array<PaymentLine> = [];

  for (const original of basis.lines) {
    const current = coverage.find((line) => line.line.sourceLineId === original.sourceLineId);

    if (!current) return yield* failure("InternalError");
    const before = current.line;

    const capacity =
      BigInt(original.grossMinor) -
      BigInt(before.creditedGrossMinor) -
      BigInt(before.paidGrossMinor);

    const paid = remaining < capacity ? remaining : capacity;

    if (paid <= 0n) continue;

    // The allocation owner fences each retained clearing-capacity interval.
    // Evidence may contain several real payments; it is not their economic key.
    const result = Cash.applyCashPayment({
      direction: "purchase",
      lines: [before],
      allocations: [{ sourceLineId: original.sourceLineId, paidGrossMinor: paid.toString() }],
      settlementControlAccountId: basis.controlAccountId,
      expenseOrRevenueAccountId: original.expenseAccountId,
      taxAccountId: basis.inputVatAccountId,
      bankAccountId: source.bankAccountId,
      cashEvidenceId: source.evidenceId,
      knownCashEvidenceIds: [],
    });

    if (Result.isFailure(result)) return yield* failure("StaleDependency");
    const slice = result.success.slices[0];

    if (!slice) return yield* failure("InternalError");
    const newGross = BigInt(slice.newNetMinor) + BigInt(slice.newTaxMinor);
    let taxJournalIndex: number | null = null;

    // Cash/AP is already posted by the source voucher. Adopt its clearing
    // side: recognize only the new part; an already-recognized part needs no
    // second bank or AP settlement journal.
    for (const line of result.success.journal) {
      if (line.accountId === source.bankAccountId || line.accountId === basis.controlAccountId)
        continue;

      if (line.accountId === basis.inputVatAccountId)
        taxJournalIndex = journalStart + journal.length;
      journal.push(line);
    }

    if (newGross > 0n)
      journal.push({
        sourceLineId: original.sourceLineId,
        accountId: basis.controlAccountId,
        debitMinor: "0",
        creditMinor: newGross.toString(),
        description: `Adopt cash clearing ${leg.invoiceId} ${original.sourceLineId}`,
      });
    lines.push({
      lineId: current.lineId,
      before,
      after: {
        ...slice.lineAfter,
        recognizedVersion: (BigInt(before.recognizedVersion) + 1n).toString(),
      },
      paidGrossMinor: paid.toString(),
      newGrossMinor: newGross.toString(),
      netMinor: slice.newNetMinor,
      taxMinor: slice.newTaxMinor,
      deductibleMinor: slice.newDeductibleMinor,
      taxJournalIndex,
    });
    remaining -= paid;
  }

  if (remaining !== 0n) return yield* failure("StaleDependency");

  return {
    invoice: {
      invoiceId: leg.invoiceId,
      invoiceEvidence: invoice.evidence,
      ordinal: leg.ordinal,
      paidGrossMinor: leg.amountMinor,
      basis,
      ...qualified,
      lines,
    },
    journal,
  };
});

export const captureCashAllocationInTransaction = Effect.fn(
  "commerce.cashPayment.captureAllocation",
)(function* (
  tx: Transaction,
  scope: Scope,
  payment: { readonly voucherId: string; readonly lineId: string },
  legs: ReadonlyArray<Leg>,
) {
  const source = yield* readFinalCashSourceInTransaction(
    tx,
    scope,
    payment.voucherId,
    payment.lineId,
  );

  if ((yield* YearEndDb.readBlockingRun(tx, scope.bookId, source.postingDate))[0])
    return yield* failure("StaleDependency");

  if (new Set(legs.map((leg) => leg.invoiceId)).size !== legs.length)
    return yield* failure("InvalidJournal");
  const invoices: Array<Selection["invoices"][number]> = [];
  const journal: Array<typeof Cash.CashJournalLine.Type> = [];

  for (const leg of legs) {
    const compiled = yield* compileInvoicePayment(tx, scope, source, leg, journal.length);
    invoices.push(compiled.invoice);
    journal.push(...compiled.journal);
  }

  const ids = [
    ...new Set([
      source.bankAccountId,
      source.controlAccountId,
      ...invoices.flatMap((invoice) => [
        invoice.basis.inputVatAccountId,
        ...invoice.basis.lines.map((line) => line.expenseAccountId),
      ]),
    ]),
  ].sort();

  const accounts = yield* readAccounts(tx, scope.bookId, ids);

  if (accounts.length !== ids.length || accounts.some((account) => !account.active))
    return yield* failure("StaleDependency");

  return yield* decode(CashMethod.CashAllocationSelection, {
    source,
    accounts: accounts.map((account) => ({ id: account.id, version: account.version.toString() })),
    invoices,
    journal,
  });
});

export const prepareCashAllocationInTransaction = Effect.fn("commerce.cashPayment.prepareEffect")(
  function* (
    tx: Transaction,
    principal: Principal,
    scope: Scope,
    planId: string,
    selection: Selection,
  ) {
    if (selection.journal.length === 0)
      return yield* decode(CashMethod.CashAllocationPrepared, { selection, postingPlan: null });

    const evidenceRefs = [
      {
        evidenceId: selection.source.evidenceId,
        sha256: selection.source.sha256,
        locator: `bank_statement_${selection.source.statementId}_${selection.source.rowOrdinal}`,
      },
    ];

    for (const invoice of selection.invoices)
      evidenceRefs.push({ ...invoice.invoiceEvidence, locator: invoice.basis.draftId });

    const action = yield* decode(Accounting.VoucherPostingAction, {
      kind: "post_voucher",
      correctsVoucherId: null,
      eventId: selection.source.eventId,
      postingPurpose: "adjustment",
      occurrenceKey: `cash_allocation_${planId}`,
      fiscalYearId: selection.source.fiscalYearId,
      accountingPeriodId: selection.source.accountingPeriodId,
      postingDate: selection.source.postingDate,
      series: selection.source.series,
      currency: "SEK",
      description: "Owned cash-method allocation recognition",
      rationale: "Retained final bank cash; adopt clearing capacity without another bank posting",
      taxAssessment: "not_applicable",
      evidenceRefs,
      lines: selection.journal.map((line) => ({
        lineId: newId("line"),
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
      })),
    });

    const postingPlan = yield* sealActionInTransaction(tx, principal, scope, action);

    return yield* decode(CashMethod.CashAllocationPrepared, { selection, postingPlan });
  },
);

export const approveCashAllocationInTransaction = Effect.fn("commerce.cashPayment.approveEffect")(
  function* (
    tx: Transaction,
    principal: Principal,
    scope: Scope,
    plan: typeof Commerce.AllocationPlan.Type,
  ) {
    if (plan.cashEffect === undefined) return null;

    if (plan.receipt.actorId === principal.actorId) return yield* failure("ApprovalRequired");
    const prepared = yield* decode(CashMethod.CashAllocationPrepared, plan.cashEffect);

    if (prepared.postingPlan === null) return null;

    return yield* approveChangeInTransaction(tx, principal, {
      scope,
      changeSetId: prepared.postingPlan.id,
      idempotencyKey: `cash_approve_${plan.id}`,
      input: { version: 1, planDigest: prepared.postingPlan.planDigest },
    });
  },
);

export const cashAllocationReceiptSummary = Effect.fn("commerce.cashPayment.receiptSummary")(
  function* (effect: JsonObject, receiptId: string) {
    const prepared = yield* decode(CashMethod.CashAllocationPrepared, effect);
    const recognitionIds: Array<string> = [];
    const vatFactIds: Array<string> = [];

    for (const invoice of prepared.selection.invoices)
      for (const line of invoice.lines) {
        const suffix = (yield* digest({ receiptId, lineId: line.lineId })).slice(7);
        recognitionIds.push(`cashrec_${suffix}`);

        if (BigInt(line.taxMinor) > 0n) vatFactIds.push(`cashvat_${suffix}`);
      }

    return {
      recognitionIds,
      vatFactIds,
      changeSetId: prepared.postingPlan?.id ?? prepared.selection.source.changeSetId,
      sourceVoucherId: prepared.selection.source.voucherId,
    };
  },
);

export const applyCashAllocationInTransaction = Effect.fn("commerce.cashPayment.applyEffect")(
  function* (
    tx: Transaction,
    principal: Principal,
    scope: Scope,
    plan: typeof Commerce.AllocationPlan.Type,
    approval: typeof Commerce.AllocationApproval.Type,
    receiptId: string,
  ) {
    if (plan.cashEffect === undefined) return;
    const prepared = yield* decode(CashMethod.CashAllocationPrepared, plan.cashEffect);
    const retained = yield* Db.readEffectiveLegs(tx, scope.bookId, receiptId);

    const selected = retained.filter((leg) =>
      prepared.selection.invoices.some((invoice) => invoice.ordinal === leg.ordinal),
    );

    if (
      selected.length !== prepared.selection.invoices.length ||
      selected.some(
        (leg) =>
          leg.voucherId !== prepared.selection.source.voucherId ||
          leg.lineId !== prepared.selection.source.lineId,
      )
    )
      return yield* failure("StaleDependency");

    const current = yield* captureCashAllocationInTransaction(
      tx,
      scope,
      prepared.selection.source,
      selected,
    );

    if (!equalJson(current, prepared.selection)) return yield* failure("StaleDependency");

    const posting =
      prepared.postingPlan === null
        ? null
        : yield* executeChangeInTransaction(tx, principal, {
            scope,
            changeSetId: prepared.postingPlan.id,
            idempotencyKey: `cash_execute_${receiptId}`,
            input: {
              version: 1,
              planDigest: prepared.postingPlan.planDigest,
              approvalId: approval.cashPostingApprovalId ?? "approval_missing",
            },
            owner: { kind: "cash_allocation", id: plan.id },
          });

    for (const invoice of current.invoices)
      for (const line of invoice.lines) {
        yield* Db.insertCoverage(tx, scope.bookId, {
          id: line.lineId,
          invoiceId: invoice.invoiceId,
          witness: invoice.methodFactRevisionId,
          line: line.before,
        });
        const suffix = (yield* digest({ receiptId, lineId: line.lineId })).slice(7);
        const recognitionId = `cashrec_${suffix}`;
        const factId = BigInt(line.taxMinor) > 0n ? `cashvat_${suffix}` : null;
        yield* Db.insertRecognition(tx, scope.bookId, {
          id: recognitionId,
          lineId: line.lineId,
          receiptId,
          ordinal: invoice.ordinal,
          sourceVoucherId: current.source.voucherId,
          sourceLineId: current.source.lineId,
          newGrossMinor: line.newGrossMinor,
          after: line.after,
          netMinor: line.netMinor,
          taxMinor: line.taxMinor,
          deductibleMinor: line.deductibleMinor,
          evidenceId: current.source.evidenceId,
          changeSetId: posting?.changeSetId ?? current.source.changeSetId,
          voucherId: posting?.voucherId ?? current.source.voucherId,
          vatFactId: factId,
        });

        if (factId !== null) {
          const taxLine =
            line.taxJournalIndex === null
              ? undefined
              : prepared.postingPlan?.groups[0]?.actions[0]?.lines[line.taxJournalIndex];

          if (!posting || !taxLine) return yield* failure("InternalError");
          yield* recordCashMethodFactInTransaction(tx, principal, {
            scope,
            recognitionId,
            factId,
            invoiceId: invoice.invoiceId,
            source: current.source,
            line,
            voucherId: posting.voucherId,
            taxLineId: taxLine.lineId,
            witness: invoice.vatWitness,
            receiptId,
          });
        }

        if (!(yield* Db.advanceCoverage(tx, scope.bookId, line.lineId, line.before, line.after))[0])
          return yield* failure("StaleDependency");
      }

    yield* YearEndDb.bumpPopulation(tx, scope.bookId);
  },
);
