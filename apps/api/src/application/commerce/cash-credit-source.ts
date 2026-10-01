import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as DraftDb from "../../db/purchases/drafts";
import * as SourceDb from "../../db/commerce/cash-invoices";
import * as CreditDb from "../../db/commerce/cash-credits";
import * as Ledger from "../../db/posting";
import { readSealedDraft } from "../../db/posting-admission";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { compilePurchasePlan } from "../purchases/recognition";
import { evidenceHasPostedHistory } from "../purchases/shared";
import { decode, toJsonObject, readEvidenceReference, type Scope } from "./support";
import { liveInvoice } from "./register";

const creditAssignments = Effect.fn("cashCredit.assignRetainedLines")(function* (
  content: (typeof Drafts.SupplierInvoiceDraftRevision.Type)["content"],
  input: typeof CashMethod.PrepareCashCredit.Type,
  basis: typeof CashMethod.CashInvoiceBasis.Type,
) {
  const assignments = [];

  for (const line of content.lines) {
    const mapping = input.lineMappings.find((mapping) => mapping.creditLineId === line.id);

    const original = basis.lines.find(
      (original) => original.sourceLineId === mapping?.sourceLineId,
    );

    if (!mapping || !original || !equalJson(mapping.treatment, original.treatment))
      return yield* failure("UnsupportedProfile");

    assignments.push({
      lineId: line.id,
      expenseAccountId: original.expenseAccountId,
      treatment: mapping.treatment,
    });
  }

  return assignments;
});

export const readCashCreditSource = Effect.fn("cashCredit.readRetainedSource")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof CashMethod.PrepareCashCredit.Type,
  basis: typeof CashMethod.CashInvoiceBasis.Type,
) {
  const head = (yield* DraftDb.readDraft(tx, scope.bookId, input.draftId))[0];

  if (!head) return yield* failure("NotFound");

  if (head.currentRevision !== input.expectedRevision) return yield* failure("StaleDependency");

  const retained = (yield* DraftDb.readHeadRevision(
    tx,
    scope.bookId,
    head.id,
    head.currentRevision,
  ))[0];

  if (!retained) return yield* failure("NotFound");

  const draft = yield* decode(Drafts.SupplierInvoiceDraftRevision, retained.body);

  if (draft.digest !== input.expectedDigest) return yield* failure("StaleDependency");

  const invoice = yield* liveInvoice(tx, scope.bookId, input.invoiceId);
  const content = draft.content;

  if (
    !content.documentDate ||
    !content.supplierDocumentNumber ||
    content.currency !== "SEK" ||
    content.currencyScale !== 2 ||
    content.counterpartyId !== invoice.counterpartyId ||
    content.supplier.countryCode !== "SE" ||
    content.buyer.countryCode !== "SE" ||
    draft.totals.sourceTotalMatches !== true ||
    draft.totals.grossMinor === null ||
    BigInt(draft.totals.grossMinor) <= 0n
  )
    return yield* failure("UnsupportedProfile");

  if (
    (yield* readSealedDraft(tx, scope.bookId, input.draftId, "supplier")).length ||
    (yield* SourceDb.readSourceAdoption(tx, scope.bookId, content.sourceEvidenceId)).length ||
    (yield* CreditDb.readSourceAdoption(tx, scope.bookId, input.draftId, content.sourceEvidenceId))
      .length
  )
    return yield* failure("IdempotencyConflict");

  const creditEvidence = yield* readEvidenceReference(tx, scope.bookId, content.sourceEvidenceId);

  if (yield* evidenceHasPostedHistory(tx, scope.bookId, content.sourceEvidenceId))
    return yield* failure("AlreadyPosted");

  if (creditEvidence.sha256 !== draft.sourceEvidence.sha256)
    return yield* failure("MissingEvidence");

  const creditIds = new Set(input.lineMappings.map((mapping) => mapping.creditLineId));
  const originalIds = new Set(input.lineMappings.map((mapping) => mapping.sourceLineId));

  if (
    creditIds.size !== input.lineMappings.length ||
    originalIds.size !== input.lineMappings.length ||
    creditIds.size !== content.lines.length
  )
    return yield* failure("UnsupportedProfile");

  const assignments = yield* creditAssignments(content, input, basis);

  const book = (yield* Ledger.readBook(tx, scope))[0];

  if (!book) return yield* failure("NotFound");

  const compiled = yield* compilePurchasePlan(tx, scope, {
    recognitionId: draft.id,
    book,
    content: yield* toJsonObject(content),
    draftLines: content.lines,
    assignments,
    controlAccountId: basis.controlAccountId,
    inputVatAccountId: basis.inputVatAccountId,
    taxPoint: { taxPointOn: content.documentDate, basis: "document_date" },
    recognitionDate: content.documentDate,
  });

  if (compiled.plan.payableMinor !== draft.totals.grossMinor)
    return yield* failure("InvalidJournal");

  const amounts = new Map<
    string,
    { grossMinor: string; netMinor: string; taxMinor: string; deductibleMinor: string }
  >();

  for (const line of compiled.selections) {
    const mapping = input.lineMappings.find((mapping) => mapping.creditLineId === line.lineId);

    if (!mapping) return yield* failure("InternalError");

    const recognized = compiled.plan.lines.find(
      (candidate) => candidate.sourceLineId === line.lineId,
    );

    if (!recognized) return yield* failure("InternalError");

    amounts.set(mapping.sourceLineId, {
      grossMinor: line.sourceGrossMinor,
      netMinor: line.netMinor,
      taxMinor: line.sourceTaxMinor,
      deductibleMinor: recognized.deductibleTaxMinor,
    });
  }

  return {
    draft,
    creditDate: content.documentDate,
    supplierCreditNumber: content.supplierDocumentNumber,
    creditEvidence,
    amounts,
  };
});
