import * as Accounting from "@open-erp/contracts/accounting";
import { Job, JobStore } from "effect-mq";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { pendingPayslipRenders, renderPayslip } from "../application/payroll/payslips";
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
  readonly documentId: string;
  readonly outboxId: string;
  readonly documentDigest: string;
};

function payslipKey(payload: Payload) {
  return `${payload.scope.bookId}/${payload.outboxId}`;
}

export class PayslipQueue extends Job.make("payroll-payslip-render", {
  payload: {
    scope: Accounting.Scope,
    documentId: Accounting.Identifier,
    outboxId: Accounting.Identifier,
    documentDigest: Accounting.Digest,
  },
  success: Schema.String,
  error: Accounting.AccountingError,
  queue: "preparation",
  idempotencyKey: payslipKey,
  retryable: isTerminalDeliveryFailure,
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

function payslipRecordId(payload: Payload) {
  return `${PayslipQueue._tag}/${payslipKey(payload)}`;
}

export const dispatchPayslips = Effect.fn("payslip.dispatch")(function* () {
  const environment = yield* RequestEnvironment;
  const token = environment.bindings.OPENERP_PREPARATION_TOKEN;

  if (!token) return yield* failure("Unauthorized");

  const pending = yield* pendingPayslipRenders(token);

  if (pending.length === 0) return;

  const payloads = pending.map((row) => ({
    scope: { entityId: row.entityId, bookId: row.bookId },
    documentId: row.documentId,
    outboxId: row.outboxId,
    documentDigest: row.documentDigest,
  })) satisfies ReadonlyArray<Payload>;

  const snapshot = yield* readQueueSnapshot(
    payloads.map((payload) => JobStore.JobId(payslipRecordId(payload))),
  );

  yield* Effect.forEach(
    payloads,
    (payload) => {
      const id = JobStore.JobId(payslipRecordId(payload));

      return deliveryDispatch(
        id,
        snapshot,
        PayslipQueue.enqueue(payload),
        ignoreUnrearmable(PayslipQueue.retry(id)),
        Effect.void,
      ).pipe(
        Effect.catchDefect(() =>
          Effect.logWarning("Payslip enqueue failed; the intent stays undelivered."),
        ),
      );
    },
    { concurrency: 5, discard: true },
  );
});

export const handlePayslip = Effect.fn("payslip.handleJob")(function* (payload: Payload) {
  const environment = yield* RequestEnvironment;
  const token = environment.bindings.OPENERP_PREPARATION_TOKEN;

  if (!token) return yield* failure("Unauthorized");

  const artifact = yield* renderPayslip(token, {
    scope: payload.scope,
    documentId: payload.documentId,
    idempotencyKey: `payslip_render_${payload.outboxId}`,
    input: {
      documentDigest: payload.documentDigest,
    },
  });

  return artifact.id;
});
