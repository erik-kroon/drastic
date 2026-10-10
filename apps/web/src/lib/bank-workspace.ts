import { bookScope, httpQuery } from "@/lib/contract-client";
import { Api } from "@open-erp/contracts/api";
import { queryOptions } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/bank-workspace";
import { bookKey, readAccounting } from "./accounting-api";
import { checkScope } from "@/components/commerce/shared";

export function bankWorkspaceOptions(book: typeof Accounting.Book.Type, query: URLSearchParams) {
  return queryOptions({
    queryKey: [...bookKey(book), "bank-workspace", query.toString()],
    queryFn: async ({ signal }) => {
      const data = await readAccounting(
        (client) =>
          client.reconciliation.bankWorkspace({
            params: { ...bookScope(book) },
            query: httpQuery(Api.groups.reconciliation.endpoints.bankWorkspace, `${query}`),
          }),
        Bank.BankWorkspace,
        { signal },
      );

      checkScope(book, data.scope);

      return data;
    },
    retry: false,
  });
}
