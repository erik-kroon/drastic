import * as Accounting from "@open-erp/contracts/accounting";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import { Job, JobStore } from "effect-mq";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  pendingCustomerCreditRenders,
  renderCustomerCreditArtifact,
} from "../application/commerce/credit-documents";
import { failure } from "../application/failures";
import { deliveryDispatch, ignoreUnrearmable, readQueueSnapshot } from "./delivery-dispatch";
import { RequestEnvironment } from "./environment";

type Payload = {
  readonly scope: typeof Accounting.Scope.Type;
  readonly creditId: string;
  readonly outboxId: string;
  readonly documentDigest: string;
};

function creditDocumentKey(payload: Payload) {
  return `${payload.scope.bookId}/${payload.outboxId}`;
}

export class CreditDocumentQueue extends Job.make("customer-credit-render", {
  payload: {
    scope: Accounting.Scope,
    creditId: Accounting.Identifier,
    outboxId: Accounting.Identifier,
    documentDigest: Accounting.Digest,
  },
  success: Schema.String,
  error: Accounting.AccountingError,
  queue: "preparation",
  idempotencyKey: creditDocumentKey,
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

// effect-mq prefixes the idempotency key with the job name.
function creditDocumentRecordId(payload: Payload) {
  return `${CreditDocumentQueue._tag}/${creditDocumentKey(payload)}`;
}

export const dispatchCreditDocuments = Effect.fn("creditDocument.dispatch")(function* () {
  const environment = yield* RequestEnvironment;
  const token = environment.bindings.OPENERP_PREPARATION_TOKEN;

  if (!token) return yield* failure("Unauthorized");

  const pending = yield* pendingCustomerCreditRenders(token);

  if (pending.length === 0) return;

  const payloads = pending.map((row) => ({
    scope: { entityId: row.entityId, bookId: row.bookId },
    creditId: row.creditId,
    outboxId: row.outboxId,
    documentDigest: row.documentDigest,
  })) satisfies ReadonlyArray<Payload>;

  const snapshot = yield* readQueueSnapshot(
    payloads.map((payload) => JobStore.JobId(creditDocumentRecordId(payload))),
  );

  yield* Effect.forEach(
    payloads,
    (payload) => {
      const id = JobStore.JobId(creditDocumentRecordId(payload));

      return deliveryDispatch(
        id,
        snapshot,
        CreditDocumentQueue.enqueue(payload),
        ignoreUnrearmable(CreditDocumentQueue.retry(id)),
        // A render intent is not settled here. It has no state to settle into
        // without a result, and acknowledging it would claim the artifact
        // exists. It is left pending, its recorded failure is what an operator
        // reads, and the app-level attempt ceiling is what stops selecting it.
        Effect.void,
      ).pipe(
        // The store is reached through the defect channel, so one unreachable
        // queue row must not abandon the remaining rows of this poll.
        Effect.catchDefect(() =>
          Effect.logWarning("Credit document enqueue failed; the intent stays undelivered."),
        ),
      );
    },
    { concurrency: 5, discard: true },
  );
});

export const handleCreditDocument = Effect.fn("creditDocument.handleJob")(function* (
  payload: Payload,
) {
  const environment = yield* RequestEnvironment;
  const token = environment.bindings.OPENERP_PREPARATION_TOKEN;

  if (!token) return yield* failure("Unauthorized");

  const artifact = yield* renderCustomerCreditArtifact(token, {
    scope: payload.scope,
    id: payload.creditId,
    idempotencyKey: `credit_render_${payload.outboxId}`,
    input: {
      expectedDocumentDigest: payload.documentDigest,
      rendererVersion: Credits.customerCreditRendererVersion,
    },
  });

  return artifact.id;
});
