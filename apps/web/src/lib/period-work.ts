import { Api } from "@open-erp/contracts/api";
import type * as Effect from "effect/Effect";
import { bookScope, httpRequest, type AccountingClient } from "./contract-client";
import type { CommandKeys } from "@/lib/command-keys";
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
        (client) =>
          client.periodWork.getPeriodWorkProgress({ params: { ...bookScope(book), manifestId } }),
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

export type PeriodWorkCommand<A = typeof PeriodWork.PeriodWorkRunProgress.Type> = {
  readonly execute: (client: AccountingClient, options: RequestInit) => Effect.Effect<A, unknown>;
  readonly request: RequestInit;
};

// Advancing visits children through the owners that already hold each economic
// effect. It is a bounded pass, not a completion, and its own projection is what
// the caller reads back rather than a claim that the period is done.
export function advancePeriodWork(
  book: typeof Accounting.Book.Type,
  manifestId: string,
  boundedCount: number,
  keys: CommandKeys,
): PeriodWorkCommand {
  const path = `${periodWorkPath(book, manifestId)}/advance`;

  return {
    execute: (client, options) =>
      client.periodWork.advancePeriodWork(
        httpRequest(
          Api.groups.periodWork.endpoints.advancePeriodWork,
          { params: { ...bookScope(book), manifestId } },
          options,
        ),
      ),
    request: mutationOptions(path, JSON.stringify({ boundedCount }), keys),
  };
}

export function cancelPeriodWork(
  book: typeof Accounting.Book.Type,
  manifestId: string,
  expectedDigest: string,
  keys: CommandKeys,
): PeriodWorkCommand {
  const path = `${periodWorkPath(book, manifestId)}/cancel`;

  return {
    execute: (client, options) =>
      client.periodWork.cancelPeriodWork(
        httpRequest(
          Api.groups.periodWork.endpoints.cancelPeriodWork,
          { params: { ...bookScope(book), manifestId } },
          options,
        ),
      ),
    request: mutationOptions(path, JSON.stringify({ expectedDigest }), keys),
  };
}

export function periodWorkBatchPath(book: typeof Accounting.Book.Type, batchId: string) {
  return `${bookPath(book)}/period-work/batches/${encodeURIComponent(batchId)}`;
}

// A batch is a fixed manifest of already sealed member plans. The caller names
// the children; the owner, plan, plan digest and owning review are read from each
// child's own record, never from the caller's word, so naming a different set
// here cannot seal a different one.
export function preparePeriodWorkBatch(
  book: typeof Accounting.Book.Type,
  manifestId: string,
  workIdentities: ReadonlyArray<string>,
  keys: CommandKeys,
): PeriodWorkCommand<typeof PeriodWork.ApprovalBatch.Type> {
  const path = `${bookPath(book)}/period-work/batches`;

  return {
    execute: (client, options) =>
      client.periodWork.preparePeriodWorkBatch(
        httpRequest(
          Api.groups.periodWork.endpoints.preparePeriodWorkBatch,
          { params: bookScope(book) },
          options,
        ),
      ),
    request: mutationOptions(path, JSON.stringify({ manifestId, workIdentities }), keys),
  };
}

// The digest the operator was shown. A batch whose digest has moved is refused
// rather than approved on a different set than the one displayed.
export function approvePeriodWorkBatch(
  book: typeof Accounting.Book.Type,
  batchId: string,
  expectedDigest: string,
  keys: CommandKeys,
): PeriodWorkCommand<typeof PeriodWork.ApprovalBatch.Type> {
  const path = `${periodWorkBatchPath(book, batchId)}/approvals`;
  const body = JSON.stringify({ expectedDigest, acknowledgeSyntheticOnly: true });

  return {
    execute: (client, options) =>
      client.periodWork.approvePeriodWorkBatch(
        httpRequest(
          Api.groups.periodWork.endpoints.approvePeriodWorkBatch,
          { params: { ...bookScope(book), batchId } },
          options,
        ),
      ),
    request: mutationOptions(path, body, keys),
  };
}

// Execution is bounded and resumable: `afterOrdinal` continues from the cursor the
// previous pass reported, and the key binds the exact batch, digest and page, so
// a lost response recovers the same page rather than re-running it.
export function executePeriodWorkBatch(
  book: typeof Accounting.Book.Type,
  batchId: string,
  expectedDigest: string,
  boundedCount: number,
  afterOrdinal: number | undefined,
  keys: CommandKeys,
): PeriodWorkCommand<typeof PeriodWork.PeriodWorkExecutionResult.Type> {
  const path = `${periodWorkBatchPath(book, batchId)}/execute`;

  const payload = {
    expectedDigest,
    boundedCount,
    acknowledgeSyntheticOnly: true,
    // `undefined` is dropped by the serializer, so an absent cursor is absent from
    // the body and the identity key rather than sent as null.
    afterOrdinal,
  } satisfies typeof PeriodWork.ExecutePeriodWorkBatch.Type;

  return {
    execute: (client, options) =>
      client.periodWork.executePeriodWorkBatch(
        httpRequest(
          Api.groups.periodWork.endpoints.executePeriodWorkBatch,
          { params: { ...bookScope(book), batchId } },
          options,
        ),
      ),
    request: mutationOptions(path, JSON.stringify(payload), keys),
  };
}
