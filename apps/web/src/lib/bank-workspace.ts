import { queryOptions } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/bank-workspace";
import { bookKey, bookPath, readAccounting } from "./accounting-api";
import { checkScope } from "@/components/commerce/shared";

export function bankWorkspaceOptions(book: typeof Accounting.Book.Type, query: URLSearchParams) {
  return queryOptions({
    queryKey: [...bookKey(book), "bank-workspace", query.toString()],
    queryFn: async ({ signal }) => {
      const data = await readAccounting(
        `${bookPath(book)}/bank-workspace?${query}`,
        Bank.BankWorkspace,
        { signal },
      );

      checkScope(book, data.scope);

      return data;
    },
    retry: false,
  });
}
