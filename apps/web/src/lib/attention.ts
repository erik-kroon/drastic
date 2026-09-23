import { queryOptions } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/workspace";
import { bookKey, bookPath, readAccounting } from "./accounting-api";
import { reviewPath, workspacePath } from "./book-context";
import type { Locale } from "@/paraglide/runtime";

export function attentionQueryOptions(
  book: typeof Accounting.Book.Type,
  filters: typeof Workspace.AttentionQuery.Type,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
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
) {
  if (item.kind === "journal") return reviewPath(book, item.id, item.revision);
  return `${workspacePath(book)}/${item.kind === "invoice" ? "sales?view=drafts" : "purchases?view=expenses"}&record=${encodeURIComponent(item.id)}`;
}
export function attentionCopy(locale: Locale) {
  return locale === "sv" ? swedish : english;
}
const english = {
  all: "All work",
  journal: "Bookkeeping",
  invoice: "Invoices",
  expense: "Expenses",
  type: "Type",
  journal_review: "Review proposal",
  journal_posted: "Posted",
  invoice_draft: "Continue draft",
  invoice_issued: "Issued internally",
  expense_review: "Review tax treatment",
  expense_reviewed: "Tax review saved",
  coverage:
    "Journal proposals, invoice drafts and expense reviews. Other period checks are available in Year-end.",
  empty: "Nothing in this view",
  emptyDetail: "Try another filter, or prepare your next invoice or expense.",
  open: "Open work",
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
  type: "Typ",
  journal_review: "Granska förslag",
  journal_posted: "Bokfört",
  invoice_draft: "Fortsätt utkast",
  invoice_issued: "Utfärdad internt",
  expense_review: "Granska moms",
  expense_reviewed: "Momsgranskning sparad",
  coverage:
    "Bokföringsförslag, fakturautkast och utgiftsgranskningar. Övriga periodkontroller finns under Årsavslut.",
  empty: "Inget i den här vyn",
  emptyDetail: "Prova ett annat filter, eller förbered nästa faktura eller utgift.",
  open: "Att göra",
  total: "Träffar",
  updated: "Uppdaterat",
  action: "Nästa steg",
  title: "Beskrivning",
  amount: "Belopp",
  first: "Första sidan",
  next: "Nästa sida",
  refresh: "Uppdatera",
};
