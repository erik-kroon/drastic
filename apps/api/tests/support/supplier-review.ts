import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { evidence, fixture, key, post, type BookFixture } from "./fixtures";

export async function supplierFixture(extraAccounts: Parameters<typeof fixture>[0] = []) {
  const book = await fixture(extraAccounts);
  const source = await evidence(book);

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Architecture review supplier",
      evidenceId: source.id,
      reason: "Synthetic regression fixture",
    },
    Commerce.CounterpartyRevision,
  );

  const identity = {
    legalName: "Synthetic identity",
    registrationId: "5560000000",
    taxId: null,
    address: "Synthetic street 1",
    countryCode: "SE",
    evidenceId: source.id,
  };

  const content = {
    title: "Supplier review journey",
    counterpartyId: supplier.id,
    counterpartyRevision: supplier.revision,
    supplier: identity,
    buyer: identity,
    sourceEvidenceId: source.id,
    supplierDocumentNumber: "REVIEW-001",
    currency: "SEK",
    currencyScale: 2,
    documentDate: "2026-09-22",
    supplyDate: "2026-09-22",
    dueDate: "2026-10-22",
    paymentTerms: "30 days",
    sourceTotalMinor: "10000",
    lines: [
      {
        id: "line_purchase",
        description: "Synthetic service",
        quantity: "1",
        unitPriceMinor: "10000",
        baseMinor: "10000",
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "0",
        taxDescription: "Synthetic zero tax",
        taxEvidenceId: source.id,
        sourceGrossMinor: "10000",
      },
    ],
  } satisfies typeof Drafts.SupplierDraftContent.Type;

  return { book, source, supplier, content };
}

export function createDraft(book: BookFixture, content: typeof Drafts.SupplierDraftContent.Type) {
  return post(
    book,
    "/commerce/supplier-invoice-drafts",
    {
      draftKey: `review_${key()}`,
      content,
    },
    Drafts.SupplierInvoiceDraftRevision,
  );
}

export async function acceptDraft(
  book: BookFixture,
  draft: typeof Drafts.SupplierInvoiceDraftRevision.Type,
  debitAccountId = "account_bank",
) {
  const review = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "synthetic-manual-supplier-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_clearing",
      debitAccountId,
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic review regression",
      acknowledgeSyntheticOnly: true,
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const input = { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true };

  const approval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    input,
    Acceptance.SupplierAcceptanceApproval,
  );

  return post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    {
      ...input,
      approvalId: approval.id,
    },
    Acceptance.SupplierAcceptanceReceipt,
  );
}

export function purchaseEvidence(book: BookFixture, ordinal: number) {
  return post(
    book,
    "/evidence",
    {
      title: `Retained invoice ${ordinal}`,
      content: `Unique synthetic invoice ${ordinal}`,
      mediaType: "text/plain",
      origin: "Architecture review regression",
    },
    Accounting.Evidence,
  );
}
