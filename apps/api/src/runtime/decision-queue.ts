import * as A from "@open-erp/contracts/accounting";
import { Job, JobStore } from "effect-mq";
import * as Effect from "effect/Effect";
import {
  pendingDecisionRequests,
  processDecisionRequest,
  stopFailedDecisionRequest,
} from "../application/automation/decision-jobs";
import { RequestEnvironment } from "./environment";
import { failure } from "../application/failures";
import {
  deliveryDispatch,
  ignoreUnrearmable,
  isTerminalDeliveryFailure,
  readQueueSnapshot,
} from "./delivery-dispatch";

type Payload = { scope: typeof A.Scope.Type; id: string };

function decisionKey(payload: Payload) {
  return `${payload.scope.bookId}/${payload.id}`;
}

export class DecisionQueue extends Job.make("decision", {
  payload: { scope: A.Scope, id: A.Identifier },
  success: A.Identifier,
  error: A.AccountingError,
  queue: "preparation",
  idempotencyKey: decisionKey,
  retryable: (error) => !isTerminalDeliveryFailure(error),
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "1 second" } },
}) {}

const stop = Effect.fn("DecisionQueue.stop")(function* (payload: Payload) {
  const { bindings } = yield* RequestEnvironment;

  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");
  yield* stopFailedDecisionRequest(bindings.OPENERP_PREPARATION_TOKEN, payload);
});

export const dispatchPendingDecisions = Effect.fn("DecisionQueue.dispatch")(function* () {
  const { bindings } = yield* RequestEnvironment;

  if (!bindings.OPENERP_DECISION_RUNNER_CREDENTIAL_HASH || !bindings.OPENERP_PREPARATION_TOKEN)
    return;
  const pending = yield* pendingDecisionRequests(bindings.OPENERP_PREPARATION_TOKEN);

  const records = pending.map((row) => {
    const payload = { scope: { entityId: row.entityId, bookId: row.bookId }, id: row.id };

    return { payload, id: JobStore.JobId(`${DecisionQueue._tag}/${decisionKey(payload)}`) };
  });

  if (records.length === 0) return;
  const snapshot = yield* readQueueSnapshot(records.map((row) => row.id));
  yield* Effect.forEach(
    records,
    ({ payload, id }) =>
      deliveryDispatch(
        id,
        snapshot,
        DecisionQueue.enqueue(payload),
        ignoreUnrearmable(DecisionQueue.retry(id)),
        stop(payload),
      ).pipe(
        Effect.catchDefect(() =>
          Effect.logWarning("Decision enqueue failed; immutable request remains durable."),
        ),
      ),
    { concurrency: 1, discard: true },
  );
});

export const handleDecision = Effect.fn("DecisionQueue.handle")(function* (payload: Payload) {
  const { bindings } = yield* RequestEnvironment;

  if (!bindings.OPENERP_PREPARATION_TOKEN) return yield* failure("Unavailable");
  const result = yield* processDecisionRequest(bindings.OPENERP_PREPARATION_TOKEN, payload);

  if (result.status === "running") return yield* failure("Unavailable");

  return result.id;
});
