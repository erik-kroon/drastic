import * as Accounting from "@open-erp/contracts/accounting";
import { Job, JobStore } from "effect-mq";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  acknowledgeRecurringDraftDispatch,
  executeRecurringDraftJob,
  markRecurringDraftDeliveryFailure,
  pendingRecurringDraftJobs,
  scanDueRecurringDrafts,
} from "../application/commerce/recurring-draft-scheduling";
import type { ScanCursor } from "../db/commerce/recurring-draft-scheduling";
import { failure } from "../application/failures";
import {
  deliveryDispatch,
  ignoreUnrearmable,
  isTerminalDeliveryFailure,
  readQueueSnapshot,
} from "./delivery-dispatch";
import { RequestEnvironment } from "./environment";

type Payload = {
  readonly scope: typeof Accounting.Scope.Type;
  readonly jobId: string;
  readonly generation: string;
};

function recurringDraftKey(payload: Payload) {
  return `${payload.scope.bookId}/${payload.jobId}/${payload.generation}`;
}

export class RecurringDraftQueue extends Job.make("recurring-invoice-draft", {
  payload: { scope: Accounting.Scope, jobId: Accounting.Identifier, generation: Schema.String },
  success: Schema.String,
  error: Accounting.AccountingError,
  queue: "preparation",
  idempotencyKey: recurringDraftKey,
  retryable: (error) => !isTerminalDeliveryFailure(error),
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

export const dispatchRecurringDrafts = Effect.fn("recurringDraft.dispatch")(function* (
  cursor: ScanCursor | null,
) {
  const { bindings } = yield* RequestEnvironment;
  const token = bindings.OPENERP_PREPARATION_TOKEN;

  if (token === undefined) return yield* failure("Unavailable");
  const continuation = yield* scanDueRecurringDrafts(token, cursor);
  const pending = yield* pendingRecurringDraftJobs(token);

  const payloads = pending.map((row) => ({
    scope: { entityId: row.entityId, bookId: row.bookId },
    jobId: row.id,
    generation: row.generation,
  }));

  const snapshot = yield* readQueueSnapshot(
    payloads.map((payload) =>
      JobStore.JobId(`${RecurringDraftQueue._tag}/${recurringDraftKey(payload)}`),
    ),
  );

  yield* Effect.forEach(
    payloads,
    (payload) => {
      const id = JobStore.JobId(`${RecurringDraftQueue._tag}/${recurringDraftKey(payload)}`);

      return deliveryDispatch(
        id,
        snapshot,
        RecurringDraftQueue.enqueue(payload),
        ignoreUnrearmable(RecurringDraftQueue.retry(id)),
        markRecurringDraftDeliveryFailure(token, payload),
      ).pipe(
        Effect.andThen(acknowledgeRecurringDraftDispatch(token, payload)),
        Effect.catchDefect(() =>
          Effect.logWarning("Recurring draft enqueue failed; the retained intent is ready."),
        ),
      );
    },
    { concurrency: 2, discard: true },
  );

  return continuation;
});

export const handleRecurringDraft = Effect.fn("recurringDraft.handle")(function* (
  payload: Payload,
) {
  const { bindings } = yield* RequestEnvironment;
  const token = bindings.OPENERP_PREPARATION_TOKEN;

  if (token === undefined) return yield* failure("Unavailable");

  return yield* executeRecurringDraftJob(token, payload);
});

export const runRecurringDraftDispatch = Effect.fn("recurringDraft.runDispatch")(function* () {
  let cursor: ScanCursor | null = null;

  while (true) {
    cursor = yield* dispatchRecurringDrafts(cursor).pipe(
      Effect.catch(() =>
        Effect.logWarning(
          "Recurring draft dispatch failed; durable progress remains retained.",
        ).pipe(Effect.as(null)),
      ),
      Effect.catchDefect(() =>
        Effect.logWarning(
          "Recurring draft dispatch defect; durable progress remains retained.",
        ).pipe(Effect.as(null)),
      ),
    );

    if (cursor === null) yield* Effect.sleep("1 second");
  }
});
