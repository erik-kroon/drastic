import { requireResolvedSupplierQuestions } from "../work-questions";
import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Effect from "effect/Effect";
import * as Db from "../../db/commerce/cash-invoices";
import * as YearEndDb from "../../db/commerce/cash-year-end";
import * as RegisterDb from "../../db/commerce/invoice-lifecycle";
import * as DraftDb from "../../db/purchases/drafts";
import * as ProfileDb from "../../db/company-profiles";
import { readSealedDraft, readAccountRoles } from "../../db/posting-admission";
import { readAccounts } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import { compilePurchasePlan } from "../purchases/recognition";
import { evidenceHasPostedHistory } from "../purchases/shared";
import { admitAccountRole } from "../resource-admission";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { liveInvoice } from "./register";
import {
  commandReceipt,
  decode,
  readEvidenceReference,
  requireInsertAccess,
  toJsonObject,
  withBook,
  type Scope,
  type Principal,
} from "./support";

export const readCashInvoiceBasisInTransaction = Effect.fn(
  "commerce.cashInvoice.readBasisInTransaction",
)(function* (transaction: Transaction, scope: Scope, invoiceId: string) {
  const row = (yield* Db.readCashInvoiceBasis(transaction, scope.bookId, invoiceId))[0];

  if (!row) return yield* failure("NotFound");

  return yield* decode(CashMethod.CashInvoiceBasis, row.body);
});

// Re-resolve this at future payment/year-end execution; a retained witness alone
// is not proof that the same method still applies to the trigger date.
export const resolveCashInvoiceProfileInTransaction = Effect.fn(
  "commerce.cashInvoice.resolveProfileInTransaction",
)(function* (transaction: Transaction, scope: Scope, date: string) {
  const resolved = yield* resolveCompanyProfileInTransaction(transaction, scope, "synthetic", {
    postingOn: date,
    taxPointOn: date,
    paymentOn: null,
    reportOn: null,
  });

  const postingWitness = resolved.families.find(
    (family) => family.family === "posting_eligibility",
  )?.witness;

  const vatWitness = resolved.families.find((family) => family.family === "vat")?.witness;

  if (!postingWitness || !vatWitness) return yield* failure("UnsupportedProfile");
  const facts = yield* ProfileDb.readFactRevisions(transaction, scope.entityId, date, date);

  const methods = facts.filter(
    (fact) =>
      fact.factKind === "accounting_method" &&
      postingWitness.factRevisionIds.includes(fact.id) &&
      vatWitness.factRevisionIds.includes(fact.id),
  );

  const method = methods[0];

  if (methods.length !== 1 || !method) return yield* failure("UnsupportedProfile");
  const fact = yield* decode(Profiles.FactRevision, method.body);

  if (
    fact.factKind !== "accounting_method" ||
    fact.value.state !== "known" ||
    fact.value.value !== "cash"
  )
    return yield* failure("UnsupportedProfile");

  for (const witness of [postingWitness, vatWitness]) {
    const row = (yield* ProfileDb.readRuleReleases(transaction, witness.family)).find(
      (row) => row.id === witness.ruleReleaseId,
    );

    if (!row) return yield* failure("UnsupportedProfile");
    const release = yield* decode(Profiles.RuleRelease, row.body);

    if (
      release.calculatorVersion !== "synthetic-cash-method-domestic-v1" ||
      release.applicability.accountingMethods.length !== 1 ||
      release.applicability.accountingMethods[0] !== "cash" ||
      release.applicability.vatRegistrations.length !== 1 ||
      release.applicability.vatRegistrations[0] !== "registered" ||
      !release.requiredFactKinds.includes("vat_registration") ||
      release.rounding.mode !== "half_up" ||
      release.rounding.scale !== 2 ||
      row.checksum !== witness.ruleReleaseChecksum
    )
      return yield* failure("UnsupportedProfile");
  }

  return { methodFactRevisionId: method.id, postingWitness, vatWitness };
});

export const requireCashAccounts = Effect.fn("commerce.cashInvoice.requireAccounts")(function* (
  transaction: Transaction,
  scope: Scope,
  input: typeof CashMethod.AdmitCashInvoice.Type,
  date: string,
  qualified: {
    readonly postingWitness: typeof Profiles.ProfileWitness.Type;
    readonly vatWitness: typeof Profiles.ProfileWitness.Type;
  },
) {
  const bindings = yield* ProfileDb.readRoleBindings(transaction, scope.bookId, date, date);

  if (
    !bindings.some(
      (role) =>
        role.roleKind === "commerce" &&
        role.accountId === input.controlAccountId &&
        qualified.postingWitness.roleBindingIds.includes(role.id),
    ) ||
    !bindings.some(
      (role) =>
        role.roleKind === "vat" &&
        role.accountId === input.inputVatAccountId &&
        qualified.vatWitness.roleBindingIds.includes(role.id),
    )
  )
    return yield* failure("InvalidJournal");

  const accountIds = [
    ...new Set([
      input.controlAccountId,
      input.inputVatAccountId,
      ...input.lineAssignments.map((line) => line.expenseAccountId),
    ]),
  ].sort();

  const accounts = yield* readAccounts(transaction, scope.bookId, accountIds);

  if (
    accounts.length !== accountIds.length ||
    accounts.some((account) => !account.active) ||
    input.controlAccountId === input.inputVatAccountId
  )
    return yield* failure("InvalidJournal");

  yield* admitAccountRole(transaction, scope.bookId, input.controlAccountId, "commerce");
  yield* admitAccountRole(transaction, scope.bookId, input.inputVatAccountId, "vat");

  for (const assignment of input.lineAssignments) {
    if (
      assignment.expenseAccountId === input.controlAccountId ||
      assignment.expenseAccountId === input.inputVatAccountId ||
      (yield* readAccountRoles(transaction, scope.bookId, assignment.expenseAccountId)).length
    )
      return yield* failure("InvalidJournal");

    const treatment = assignment.treatment;

    if (
      treatment.basis !== "full_deduction" ||
      BigInt(treatment.rate.numerator) * 4n !== BigInt(treatment.rate.denominator) ||
      treatment.deduction.numerator !== treatment.deduction.denominator ||
      treatment.invoiceTaxRounding !== "half_up" ||
      treatment.deductionRounding !== "half_up" ||
      treatment.acceptancePolicy !== "exact_match" ||
      treatment.toleranceMinor !== "0"
    )
      return yield* failure("UnsupportedProfile");
  }
});

const readCashBook = Effect.fn("commerce.cashInvoice.readBook")(function* (
  transaction: Transaction,
  scope: Scope,
) {
  const book = (yield* RegisterDb.readBookProfile(transaction, scope.bookId))[0];

  if (
    !book ||
    book.authority !== "native" ||
    book.profile !== "synthetic-core-v1" ||
    book.currency !== "SEK" ||
    book.currencyScale !== 2
  )
    return yield* failure("UnsupportedProfile");

  return book;
});

export const admitCashInvoiceInTransaction = Effect.fn("commerce.invoices.admitCashInTransaction")(
  function* (
    transaction: Transaction,
    principal: Principal,
    command: {
      readonly scope: Scope;
      readonly idempotencyKey: string;
      readonly input: typeof CashMethod.AdmitCashInvoice.Type;
    },
  ) {
    const operation = "commerce_admit_cash_invoice";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      command.input,
      Commerce.Invoice,
    );

    if (request.previous) return request.previous;
    const input = yield* decode(CashMethod.AdmitCashInvoice, command.input);
    const head = (yield* DraftDb.readDraft(transaction, command.scope.bookId, input.draftId))[0];

    if (!head) return yield* failure("NotFound");

    if (head.currentRevision !== input.expectedRevision) return yield* failure("StaleDependency");

    const retained = (yield* DraftDb.readHeadRevision(
      transaction,
      command.scope.bookId,
      head.id,
      head.currentRevision,
    ))[0];

    if (!retained) return yield* failure("NotFound");
    const draft = yield* decode(Drafts.SupplierInvoiceDraftRevision, retained.body);

    if (draft.digest !== input.expectedDigest) return yield* failure("StaleDependency");

    yield* requireResolvedSupplierQuestions(transaction, command.scope, input.draftId);

    if (
      (yield* Db.readDraftAdoption(transaction, command.scope.bookId, head.id)).length ||
      (yield* readSealedDraft(transaction, command.scope.bookId, head.id, "supplier")).length
    )
      return yield* failure("IdempotencyConflict");
    const content = draft.content;

    if (
      !content.documentDate ||
      !content.dueDate ||
      !content.supplierDocumentNumber ||
      content.dueDate < content.documentDate ||
      content.currency !== "SEK" ||
      content.currencyScale !== 2 ||
      content.supplier.countryCode !== "SE" ||
      content.buyer.countryCode !== "SE" ||
      draft.totals.sourceTotalMatches !== true ||
      draft.totals.grossMinor === null ||
      BigInt(draft.totals.grossMinor) <= 0n
    )
      return yield* failure("UnsupportedProfile");
    const book = yield* readCashBook(transaction, command.scope);

    const qualified = yield* resolveCashInvoiceProfileInTransaction(
      transaction,
      command.scope,
      content.documentDate,
    );

    if (
      (yield* YearEndDb.readBlockingRun(transaction, command.scope.bookId, content.documentDate))[0]
    )
      return yield* failure("StaleDependency");

    yield* requireCashAccounts(transaction, command.scope, input, content.documentDate, qualified);

    const party = (yield* RegisterDb.readCounterpartyHead(
      transaction,
      command.scope.bookId,
      content.counterpartyId,
    ))[0];

    if (!party) return yield* failure("NotFound");

    if (party.currentRevision !== content.counterpartyRevision)
      return yield* failure("StaleDependency");

    if (party.role !== "supplier" && party.role !== "both") return yield* failure("InvalidJournal");

    if (
      (yield* Db.readInvoiceIdentity(
        transaction,
        command.scope.bookId,
        party.id,
        content.supplierDocumentNumber,
      )).length
    )
      return yield* failure("IdempotencyConflict");

    const evidence = yield* readEvidenceReference(
      transaction,
      command.scope.bookId,
      content.sourceEvidenceId,
    );

    if (evidence.sha256 !== draft.sourceEvidence.sha256) return yield* failure("MissingEvidence");

    if (
      (yield* Db.readSourceAdoption(transaction, command.scope.bookId, content.sourceEvidenceId))
        .length
    )
      return yield* failure("IdempotencyConflict");

    if (
      yield* evidenceHasPostedHistory(transaction, command.scope.bookId, content.sourceEvidenceId)
    )
      return yield* failure("AlreadyPosted");
    const id = newId("invoice");

    // This existing pure source compiler validates retained original facts and
    // reviewed treatment. Its prospective journal/tax facts are NOT persisted.
    const compiled = yield* compilePurchasePlan(transaction, command.scope, {
      recognitionId: id,
      book,
      content: yield* toJsonObject(content),
      draftLines: content.lines,
      assignments: input.lineAssignments,
      controlAccountId: input.controlAccountId,
      inputVatAccountId: input.inputVatAccountId,
      taxPoint: { taxPointOn: content.documentDate, basis: "document_date" },
      recognitionDate: content.documentDate,
    });

    if (compiled.plan.payableMinor !== draft.totals.grossMinor)
      return yield* failure("InvalidJournal");

    const basis = yield* decode(CashMethod.CashInvoiceBasis, {
      profile: input.profile,
      direction: "purchase",
      draftId: draft.id,
      draftRevision: draft.revision,
      draftDigest: draft.digest,
      ...qualified,
      vatMethod: "cash",
      controlAccountId: input.controlAccountId,
      inputVatAccountId: input.inputVatAccountId,
      componentPolicy: "tax_first_cumulative_v1",
      rounding: "half_up",
      lines: compiled.selections.map((line) => ({
        sourceLineId: line.lineId,
        expenseAccountId: line.expenseAccountId,
        netMinor: line.netMinor,
        taxMinor: line.sourceTaxMinor,
        grossMinor: line.sourceGrossMinor,
        deductibleMinor: line.sourceTaxMinor,
        treatment: line.treatment,
      })),
    });

    yield* requireInsertAccess(transaction, [
      "commerce_invoices",
      "commerce_invoice_revisions",
      "commerce_control_accounts",
    ]);
    yield* RegisterDb.claimControlAccount(
      transaction,
      command.scope.bookId,
      input.controlAccountId,
      "supplier",
    );
    const counterpartyName = party.revision.displayName;

    if (typeof counterpartyName !== "string") return yield* failure("InternalError");

    const body = yield* toJsonObject({
      id,
      scope: command.scope,
      kind: "cash_method_supplier_invoice_v1",
      direction: "supplier",
      counterpartyId: party.id,
      counterpartyRevision: party.currentRevision,
      counterpartyName,
      documentNumber: content.supplierDocumentNumber,
      issuedOn: content.documentDate,
      currency: book.currency,
      currencyScale: book.currencyScale,
      amountMinor: compiled.plan.payableMinor,
      controlAccountId: input.controlAccountId,
      evidence,
      recognition: null,
      cashMethod: basis,
    });

    yield* Db.insertCashInvoice(transaction, {
      bookId: command.scope.bookId,
      id,
      draftId: draft.id,
      counterpartyId: party.id,
      counterpartyRevision: party.currentRevision,
      documentNumber: content.supplierDocumentNumber,
      issuedOn: content.documentDate,
      amountMinor: compiled.plan.payableMinor,
      controlAccountId: input.controlAccountId,
      evidenceId: content.sourceEvidenceId,
      body,
    });
    yield* RegisterDb.insertInvoiceRevision(transaction, {
      bookId: command.scope.bookId,
      invoiceId: id,
      revision: "1",
      evidenceId: content.sourceEvidenceId,
      body: yield* toJsonObject({
        id,
        scope: command.scope,
        revision: "1",
        dueOn: content.dueDate,
        description: content.title,
        evidence,
        reason: input.reason,
        createdAt: yield* isoNow(transaction),
        receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
      }),
    });
    const result = yield* liveInvoice(transaction, command.scope.bookId, id);
    yield* YearEndDb.bumpPopulation(transaction, command.scope.bookId);
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      result,
    );

    return result;
  },
);

export const admitCashMethodInvoice = Effect.fn("commerce.invoices.admitCash")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof CashMethod.AdmitCashInvoice.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      return yield* admitCashInvoiceInTransaction(transaction, principal, command);
    },
    "update",
  );
});
