import { useQuery } from "@tanstack/react-query";
import * as Bank from "@open-erp/contracts/bank-workspace";
import * as Sales from "@open-erp/contracts/sales-register";
import { useBookWorkspace, workspacePath } from "./book-context";
import { bookKey, bookPath, readAccounting } from "./accounting-api";
import { attentionQueryOptions } from "./attention";
import { checkScope, commercePath, commerceKey } from "@/components/commerce/shared";

/** Home combines the existing domain reads; each total retains its own coverage. */
export function useCompanyWork() {
  const { book, setup, locale } = useBookWorkspace();
  const today = new Date().toISOString().slice(0, 10);
  const period =
    setup.periods.find((item) => item.startsOn <= today && item.endsOn >= today) ??
    setup.periods.at(-1);
  const from = period?.startsOn ?? today;
  const to = period && period.endsOn < today ? period.endsOn : today;
  const bankQuery = new URLSearchParams({
    startsOn: from,
    endsOn: to,
    view: "unmatched",
    page: "1",
    q: "",
  });
  const bank = useQuery({
    queryKey: [...bookKey(book), "bank-workspace", bankQuery.toString()],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        `${bookPath(book)}/bank-workspace?${bankQuery}`,
        Bank.BankWorkspace,
        { signal },
      );
      checkScope(book, value.scope);
      return value;
    },
    retry: false,
  });
  const salesQuery = new URLSearchParams({ status: "open", sort: "due", page: "1", q: "" });
  const sales = useQuery({
    queryKey: [...commerceKey(book), "sales-register", salesQuery.toString()],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        `${commercePath(book)}/sales-register?${salesQuery}`,
        Sales.SalesPage,
        { signal },
      );
      checkScope(book, value.scope);
      return value;
    },
    retry: false,
  });
  const journals = useQuery(
    attentionQueryOptions(book, { status: "open", kind: "journal", sort: "oldest" }),
  );
  const expenses = useQuery(
    attentionQueryOptions(book, { status: "open", kind: "expense", sort: "oldest" }),
  );
  const drafts = useQuery(
    attentionQueryOptions(book, { status: "open", kind: "invoice", sort: "newest" }),
  );
  return {
    book,
    locale,
    base: workspacePath(book),
    from,
    to,
    bank,
    sales,
    journals,
    expenses,
    drafts,
  };
}
export type CompanyWork = ReturnType<typeof useCompanyWork>;
