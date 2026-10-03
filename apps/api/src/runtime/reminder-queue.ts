import * as Accounting from "@open-erp/contracts/accounting";
import { Job, JobStore } from "effect-mq";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  dispatchReminder,
  pendingReminders,
  stopReminderDelivery,
} from "../application/commerce/reminders";
import { RequestEnvironment } from "./environment";
import {
  deliveryDispatch,
  ignoreUnrearmable,
  isTerminalDeliveryFailure,
  readQueueSnapshot,
} from "./delivery-dispatch";

type Payload = {
  readonly scope: typeof Accounting.Scope.Type;
  readonly messageId: string;
  readonly checkpoint: number;
};

function reminderKey(payload: Payload) {
  return `${payload.scope.bookId}/${payload.messageId}/${payload.checkpoint}`;
}

export class ReminderQueue extends Job.make("payment-reminder", {
  payload: { scope: Accounting.Scope, messageId: Accounting.Identifier, checkpoint: Schema.Int },
  success: Schema.String,
  error: Accounting.AccountingError,
  queue: "preparation",
  idempotencyKey: reminderKey,
  retryable: (error) => !isTerminalDeliveryFailure(error),
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "1 second" } },
}) {}

export const dispatchPendingReminders = Effect.fn("reminder.dispatchPending")(function* () {
  const { bindings } = yield* RequestEnvironment;

  if (!bindings.REMINDER_DELIVERY || !bindings.OPENERP_PREPARATION_TOKEN) return;
  const pending = yield* pendingReminders(bindings.OPENERP_PREPARATION_TOKEN);

  const records = pending.map((row) => {
    const payload = {
      scope: { entityId: row.entityId, bookId: row.bookId },
      messageId: row.messageId,
      checkpoint: row.checkpoint,
    };

    return { payload, id: JobStore.JobId(`${ReminderQueue._tag}/${reminderKey(payload)}`) };
  });

  if (records.length === 0) return;
  const snapshot = yield* readQueueSnapshot(records.map((record) => record.id));
  yield* Effect.forEach(
    records,
    ({ payload, id }) => {
      const record = snapshot.records.get(id);

      if (
        record?.state === "completed" ||
        (record?.state === "failed" && record.attemptsMade < record.attemptsMax)
      )
        return stopReminderDelivery(payload);

      return deliveryDispatch(
        id,
        snapshot,
        ReminderQueue.enqueue(payload),
        ignoreUnrearmable(ReminderQueue.retry(id)),
        stopReminderDelivery(payload),
      ).pipe(
        Effect.catchDefect(() =>
          Effect.logWarning("Reminder enqueue failed; the admitted identity remains durable."),
        ),
      );
    },
    { concurrency: 2, discard: true },
  );
});

export const handleReminder = dispatchReminder;
