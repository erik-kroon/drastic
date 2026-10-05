import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Corrections from "@open-erp/contracts/corrections";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/commerce/recognition-replacements";
import * as Invoices from "../../db/commerce/invoices";
import * as PostingDb from "../../db/posting";
import * as AdmissionDb from "../../db/posting-admission";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { digest } from "../posting";
import { decode, type Scope } from "./support";

type Contribution = typeof Corrections.InvoiceRecognitionContribution.Type;

type Voucher = typeof Accounting.Voucher.Type;

function assignable(line: (typeof Accounting.VoucherPostingAction.Type.lines)[number]) {
  const value: typeof Accounting.AssignableLine.Type = {
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.description,
  };

  if (line.originalDimensions)
    Object.assign(value, { originalDimensions: line.originalDimensions });

  return value;
}

function supportedInvoice(invoice: typeof Commerce.Invoice.Type, voucherId: string) {
  return (
    invoice.kind === "synthetic_invoice_v1" &&
    invoice.direction === "supplier" &&
    invoice.status !== "blocked" &&
    !invoice.cancellation &&
    invoice.recognition !== null &&
    invoice.outstandingMinor !== null &&
    (invoice.effectiveRecognition ?? invoice.recognition).voucherId === voucherId
  );
}

export function invoiceRecognitionContribution(
  tx: Transaction,
  scope: Scope,
  original: Voucher,
  replacement: typeof Corrections.CorrectionIntent.Type.replacement,
) {
  return Effect.gen(function* () {
    const candidates = yield* Db.readInvoiceForVoucher(tx, scope.bookId, original.id);

    if (candidates.length === 0) return undefined;

    const candidate = candidates[0];

    if (!candidate || candidates.length !== 1) return yield* failure("UnsupportedProfile");

    const row = (yield* Invoices.readLiveInvoicePage(tx, scope.bookId, [candidate.invoiceId]))[0];

    if (!row) return yield* failure("StaleDependency");

    const invoice = yield* decode(Commerce.Invoice, row.body);

    const book = (yield* PostingDb.readBook(tx, scope))[0];

    if (!book || book.profile !== "synthetic-core-v1" || !supportedInvoice(invoice, original.id))
      return yield* failure("UnsupportedProfile");

    if (invoice.recognition === null || invoice.outstandingMinor === null)
      return yield* failure("UnsupportedProfile");

    const accounts = yield* PostingDb.readAllAccounts(tx, scope.bookId);

    const expenseIds = new Set(
      accounts
        .filter((account) => /^[4-7][0-9]{3}$/.test(account.code))
        .map((account) => account.id),
    );

    const beforeExpense = original.action.lines
      .filter((line) => expenseIds.has(line.accountId))
      .map(assignable);

    const afterExpense = replacement.lines.filter((line) => expenseIds.has(line.accountId));

    const unaffectedOriginal = original.action.lines
      .filter((line) => !expenseIds.has(line.accountId))
      .map(assignable);

    const unaffectedReplacement = replacement.lines.filter(
      (line) => !expenseIds.has(line.accountId),
    );

    const sum = (lines: ReadonlyArray<typeof Accounting.AssignableLine.Type>) =>
      lines.reduce((total, line) => total + BigInt(line.debitMinor), 0n);

    if (
      beforeExpense.length === 0 ||
      afterExpense.length === 0 ||
      [...beforeExpense, ...afterExpense].some(
        (line) => line.creditMinor !== "0" || BigInt(line.debitMinor) <= 0n,
      ) ||
      sum(beforeExpense) !== sum(afterExpense) ||
      !equalJson(
        unaffectedOriginal.map((line) => ({
          ...line,
          originalDimensions: line.originalDimensions ?? [],
        })),
        unaffectedReplacement.map((line) => ({
          ...line,
          originalDimensions: line.originalDimensions ?? [],
        })),
      )
    )
      return yield* failure("UnsupportedProfile");

    const control = unaffectedOriginal.filter(
      (line) => line.accountId === invoice.controlAccountId,
    );

    if (
      control.length !== 1 ||
      control[0]?.creditMinor !== invoice.amountMinor ||
      control[0]?.debitMinor !== "0"
    )
      return yield* failure("UnsupportedProfile");

    const voucherRow = (yield* PostingDb.readVoucher(tx, scope.bookId, original.id))[0];

    if (!voucherRow) return yield* failure("StaleDependency");

    const ownership = yield* AdmissionDb.readOwnedSources(
      tx,
      scope.bookId,
      voucherRow.changeSetId,
      original.action.eventId,
      original.action.evidenceRefs.map((reference) => reference.evidenceId),
    );

    if (ownership.length > 1000) return yield* failure("UnsupportedProfile");

    for (const source of ownership) {
      if (
        source.kind !== "supplier_acceptance" ||
        !(yield* Db.readAcceptedSource(tx, scope.bookId, invoice.id, source.id))[0]?.present
      )
        return yield* failure("UnsupportedProfile");
    }

    const basisDigest = yield* digest({ invoice, original, sourceOwners: ownership });

    return {
      kind: "invoice_recognition_replacement_v1",
      invoiceId: invoice.id,
      documentNumber: invoice.documentNumber,
      counterpartyName: invoice.counterpartyName,
      originalRecognitionVoucherId: invoice.recognition.voucherId,
      predecessorVoucherId: original.id,
      controlAccountId: invoice.controlAccountId,
      amountMinor: invoice.amountMinor,
      allocatedMinor: invoice.recordedAllocatedMinor,
      outstandingMinor: invoice.outstandingMinor,
      invoiceRevision: invoice.currentRevision.revision,
      allocationVersion: invoice.allocationVersion,
      beforeExpense,
      afterExpense,
      sourceOwners: ownership.map(({ kind, id }) => ({ kind, id })),
      basisDigest,
    } satisfies Contribution;
  });
}

export function admitInvoiceRecognitionChild(
  tx: Transaction,
  scope: Scope,
  bundleId: string,
  changeId: string,
  action: Schema.JsonObject,
) {
  return Effect.gen(function* () {
    const row = (yield* Db.readOwner(tx, scope.bookId, bundleId))[0];

    if (!row) return yield* failure("ApprovalRequired");

    const contribution = yield* decode(Corrections.InvoiceRecognitionContribution, row.body);

    const reversal = yield* decode(Accounting.ChangeSet, row.reversalPlan);

    const replacement = yield* decode(Accounting.ChangeSet, row.replacementPlan);

    const child = [reversal, replacement].find((plan) => plan.id === changeId);

    if (!child || !equalJson(child.groups[0]?.actions[0], action))
      return yield* failure("StaleDependency");

    return contribution;
  });
}

export function retainInvoiceRecognitionReplacement(
  tx: Transaction,
  scope: Scope,
  bundle: typeof Corrections.CorrectionBundle.Type,
  receipt: typeof Corrections.CorrectionBundleReceipt.Type,
) {
  return Effect.gen(function* () {
    const contribution = bundle.registerContribution;

    if (contribution?.kind !== "invoice_recognition_replacement_v1") return;

    const reversalLine = bundle.reversal.groups[0]?.actions[0]?.lines.find(
      (line) => line.accountId === contribution.controlAccountId,
    );

    const replacementLine = bundle.replacement.groups[0]?.actions[0]?.lines.find(
      (line) => line.accountId === contribution.controlAccountId,
    );

    if (!reversalLine || !replacementLine) return yield* failure("StaleDependency");

    yield* Db.insertTransition(tx, {
      bookId: scope.bookId,
      bundleId: bundle.id,
      invoiceId: contribution.invoiceId,
      predecessor: contribution.predecessorVoucherId,
      reversal: receipt.reversal.voucherId,
      replacement: receipt.replacement.voucherId,
      reversalLine: reversalLine.lineId,
      replacementLine: replacementLine.lineId,
    });
  });
}
