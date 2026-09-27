import { queryOptions } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as PeriodWork from "@open-erp/contracts/period-work";
import { bookKey, bookPath, mutationOptions, readAccounting } from "./accounting-api";

export function periodWorkPath(book: typeof Accounting.Book.Type, manifestId: string) {
  return `${bookPath(book)}/period-work/manifests/${encodeURIComponent(manifestId)}`;
}

export function periodWorkQueryOptions(book: typeof Accounting.Book.Type, manifestId: string) {
  return queryOptions({
    queryKey: [...bookKey(book), "period-work", manifestId],
    queryFn: async ({ signal }) => {
      const progress = await readAccounting(
        `${periodWorkPath(book, manifestId)}/progress`,
        PeriodWork.PeriodWorkRunProgress,
        { signal },
      );

      if (progress.scope.entityId !== book.entityId || progress.scope.bookId !== book.id)
        throw new Error("Period work scope mismatch");

      return progress;
    },
    enabled: manifestId !== "",
    retry: false,
  });
}

// Advancing visits children through the owners that already hold each economic
// effect. It is a bounded pass, not a completion, and its own projection is what
// the caller reads back rather than a claim that the period is done.
export function advancePeriodWork(
  book: typeof Accounting.Book.Type,
  manifestId: string,
  boundedCount: number,
  keys: Map<string, string>,
) {
  const path = `${periodWorkPath(book, manifestId)}/advance`;

  return mutationOptions(path, JSON.stringify({ boundedCount }), keys);
}

export function cancelPeriodWork(
  book: typeof Accounting.Book.Type,
  manifestId: string,
  expectedDigest: string,
  keys: Map<string, string>,
) {
  const path = `${periodWorkPath(book, manifestId)}/cancel`;

  return mutationOptions(path, JSON.stringify({ expectedDigest }), keys);
}
