import { defaultStringifySearch } from "@tanstack/react-router";
import { queryOptions } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/workspace";
import { bookKey, bookPath, readAccounting } from "./accounting-api";
import { reviewPath, workspacePath } from "./book-context";
import { workReturnHref, type WorkReturn } from "./work-return";
import type { Locale } from "@/paraglide/runtime";

// Only the fields the attention read filters on. The carried selection is part
// of where this page is, not a filter on the list it shows.
export function attentionServerSearch(filters: WorkReturn) {
  return {
    period: filters.period,
    status: filters.status,
    sort: filters.sort,
    q: filters.q,
    kind: filters.kind,
    after: filters.after,
  };
}

export function attentionQueryOptions(book: typeof Accounting.Book.Type, filters: WorkReturn) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(attentionServerSearch(filters)))
    if (value !== undefined && value !== "") search.set(key, value);

  return queryOptions({
    queryKey: [...bookKey(book), "attention", search.toString()],
    queryFn: async ({ signal }) => {
      const page = await readAccounting(
        `${bookPath(book)}/attention?${search}`,
        Workspace.AttentionPage,
        { signal },
      );

      if (page.scope.entityId !== book.entityId || page.scope.bookId !== book.id)
        throw new Error("Work scope mismatch");

      return page;
    },
    retry: false,
  });
}

export function attentionPath(
  book: typeof Accounting.Book.Type,
  item: typeof Workspace.AttentionItem.Type,
  work: WorkReturn,
) {
  if (item.supplierReview)
    return `${workReturnHref(`${workspacePath(book)}/purchases`, "supplier-drafts", work)}&record=${encodeURIComponent(item.supplierReview.draftId)}&review=${encodeURIComponent(item.supplierReview.reviewId)}`;

  if (item.kind === "recurring" && item.recurringAgreementId)
    return `${workReturnHref(`${workspacePath(book)}/sales`, "recurring", work)}&record=${encodeURIComponent(item.recurringAgreementId)}&job=${encodeURIComponent(item.id)}`;

  if (item.kind === "journal")
    return `${reviewPath(book, item.id, item.revision)}${defaultStringifySearch(work)}`;

  if (item.kind === "document" || item.kind === "supplier") {
    const selection = item.kind === "document" ? "occurrence" : "record";

    return `${workReturnHref(`${workspacePath(book)}/purchases`, "supplier-drafts", work)}&${selection}=${encodeURIComponent(item.id)}`;
  }

  const base = `${workspacePath(book)}/${item.kind === "invoice" ? "sales" : "purchases"}`;
  const area = workReturnHref(base, item.kind === "invoice" ? "drafts" : "expenses", work);

  return `${area}&record=${encodeURIComponent(item.id)}`;
}

// The work filters a reviewer chose survive the round trip through a record.
// Preserve the cursor as well as filters, including across reloads.
export function attentionWork(filters: WorkReturn): WorkReturn {
  return {
    period: filters.period,
    status: filters.status,
    sort: filters.sort,
    q: filters.q,
    kind: filters.kind,
    manifest: filters.manifest,
    after: filters.after,
  };
}

export function attentionCopy(locale: Locale) {
  return locale === "sv" ? swedish : english;
}

const english = {
  all: "All work",
  journal: "Bookkeeping",
  invoice: "Invoices",
  expense: "Expenses",
  document: "Incoming documents",
  supplier: "Supplier drafts",
  recurring: "Recurring drafts",
  recurring_draft_failed: "Review recurring draft failure",
  document_review: "Review original",
  document_reading_failed: "Review original after reading failed",
  document_reviewed: "Document review complete",
  supplier_draft: "Review supplier draft",
  supplier_review_prepared: "Acceptance review prepared",
  supplier_accepted: "Supplier invoice registered",
  type: "Type",
  journal_review: "Review proposal",
  journal_posted: "Posted",
  invoice_draft: "Continue draft",
  invoice_issued: "Issued internally",
  expense_review: "Review tax treatment",
  expense_reviewed: "Tax review saved",
  coverage:
    "Journal proposals, customer and supplier drafts, incoming documents, expense reviews and failed recurring drafts. Undated documents remain visible when filtering by period. Other period checks are available in Year-end.",
  emptyPage: "No work on this page",
  emptyPageDetail: "The list may have changed. Return to the first page of this view.",
  empty: "Nothing in this view",
  emptyDetail: "Try another filter, or prepare your next invoice or expense.",
  open: "Open work",
  openCount: "Open",
  completedCount: "Completed",
  splitScope: "in this filter, all statuses",
  showing: "Showing",
  of: "of",
  total: "Results",
  updated: "Updated",
  action: "Next step",
  title: "Description",
  amount: "Amount",
  first: "First page",
  next: "Next page",
  refresh: "Refresh",
};

const swedish: typeof english = {
  all: "Allt arbete",
  journal: "Bokföring",
  invoice: "Fakturor",
  expense: "Utgifter",
  document: "Inkomna underlag",
  supplier: "Leverantörsutkast",
  recurring: "Återkommande utkast",
  recurring_draft_failed: "Granska fel i återkommande utkast",
  document_review: "Granska original",
  document_reading_failed: "Granska original efter misslyckad läsning",
  document_reviewed: "Underlag granskat",
  supplier_draft: "Granska leverantörsutkast",
  supplier_review_prepared: "Bokföringsgranskning förberedd",
  supplier_accepted: "Leverantörsfaktura registrerad",
  type: "Typ",
  journal_review: "Granska förslag",
  journal_posted: "Bokfört",
  invoice_draft: "Fortsätt utkast",
  invoice_issued: "Utfärdad internt",
  expense_review: "Granska moms",
  expense_reviewed: "Momsgranskning sparad",
  coverage:
    "Bokföringsförslag, kund- och leverantörsutkast, inkomna underlag, utgiftsgranskningar och misslyckade återkommande utkast. Odaterade underlag visas även vid periodfilter. Övriga periodkontroller finns under Årsavslut.",
  emptyPage: "Inget arbete på den här sidan",
  emptyPageDetail: "Listan kan ha ändrats. Gå tillbaka till första sidan i den här vyn.",
  empty: "Inget i den här vyn",
  emptyDetail: "Prova ett annat filter, eller förbered nästa faktura eller utgift.",
  open: "Att göra",
  openCount: "Öppna",
  completedCount: "Avslutade",
  splitScope: "i det här filtret, alla statusar",
  showing: "Visar",
  of: "av",
  total: "Träffar",
  updated: "Uppdaterat",
  action: "Nästa steg",
  title: "Beskrivning",
  amount: "Belopp",
  first: "Första sidan",
  next: "Nästa sida",
  refresh: "Uppdatera",
};
