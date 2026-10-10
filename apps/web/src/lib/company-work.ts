import { useQueries, useQuery } from "@tanstack/react-query";
import * as Sales from "@open-erp/contracts/sales-register";
import { useBookWorkspace, workspacePath } from "./book-context";
import { readAccounting } from "./accounting-api";
import { bankWorkspaceOptions } from "./bank-workspace";
import { attentionQueryOptions } from "./attention";
import { useBusinessDate } from "./use-business-date";
import { checkScope, commercePath, commerceKey } from "@/components/commerce/shared";

/** Home combines the existing domain reads; each total retains its own coverage. */
export function useCompanyWork() {
  const { book, setup, locale } = useBookWorkspace();
  const today = useBusinessDate();

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

  const bank = useQuery(bankWorkspaceOptions(book, bankQuery));

  const singleBankAccounts = bank.isSuccess
    ? bank.data.accounts.filter((account) => account.unmatchedCount === 1)
    : [];

  const bankEvents = useQueries({
    queries: singleBankAccounts.map((account) => {
      const query = new URLSearchParams(bankQuery);
      query.set("accountId", account.id);

      return bankWorkspaceOptions(book, query);
    }),
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
    bankEvents: singleBankAccounts.flatMap((account, index) => {
      const query = bankEvents[index];

      return query ? [{ accountId: account.id, query }] : [];
    }),
    sales,
    journals,
    expenses,
    drafts,
  };
}

export type CompanyWork = ReturnType<typeof useCompanyWork>;
