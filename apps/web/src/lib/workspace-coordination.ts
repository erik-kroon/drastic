import { bookScope } from "@/lib/contract-client";
import { queryOptions } from "@tanstack/react-query";
import * as Workspace from "@open-erp/contracts/workspace";
import type * as Accounting from "@open-erp/contracts/accounting";
import { bookKey, readAccounting } from "./accounting-api";

export function coordinationOptions(book: typeof Accounting.Book.Type) {
  return queryOptions({
    queryKey: [...bookKey(book), "workspace-coordination"],
    queryFn: async ({ signal }) => {
      const data = await readAccounting(
        (client) => client.workspace.workspaceCoordination({ params: { ...bookScope(book) } }),
        Workspace.Coordination,
        {
          signal,
        },
      );

      if (data.scope.bookId !== book.id || data.scope.entityId !== book.entityId)
        throw new Error("Workspace scope mismatch");

      return data;
    },
    retry: false,
  });
}

export function savedFilters(filters: typeof Workspace.AttentionQuery.Type) {
  return {
    kind: filters.kind ?? "all",
    status: filters.status ?? "open",
    sort: filters.sort ?? "newest",
    q: filters.q?.trim() ?? "",
    period: filters.period,
  };
}
