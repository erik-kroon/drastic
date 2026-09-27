import * as Accounting from "@open-erp/contracts/accounting";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import { Job } from "effect-mq";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  pendingCustomerCreditRenders,
  renderCustomerCreditArtifact,
} from "../application/commerce/credit-documents";
import { failure } from "../application/failures";
import { RequestEnvironment } from "./environment";

type Payload = {
  readonly scope: typeof Accounting.Scope.Type;
  readonly creditId: string;
  readonly outboxId: string;
  readonly documentDigest: string;
};

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
  idempotencyKey: (payload: Payload) => `${payload.scope.bookId}/${payload.outboxId}`,
  metadata: ({ scope }) => ({ bookId: scope.bookId }),
  defaults: { attempts: 5, backoff: { type: "exponential", delay: "10 seconds" } },
}) {}

export const dispatchCreditDocuments = Effect.fn("creditDocument.dispatch")(function* () {
  const environment = yield* RequestEnvironment;
  const token = environment.bindings.OPENERP_PREPARATION_TOKEN;

  if (!token) return yield* failure("Unauthorized");

  const pending = yield* pendingCustomerCreditRenders(token);

  for (const row of pending) {
    yield* CreditDocumentQueue.enqueue({
      scope: { entityId: row.entityId, bookId: row.bookId },
      creditId: row.creditId,
      outboxId: row.outboxId,
      documentDigest: row.documentDigest,
    });
  }
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
