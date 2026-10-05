import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/commerce/peppol-exchange";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const PeppolExchangeHandlers = HttpApiBuilder.group(Api, "peppolExchange", (handlers) =>
  handlers
    .handle("registerPeppolBinding", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.registerPeppolBinding(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPeppolBinding", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getPeppolBinding(token, scopeFromPath(params), params.id),
      ),
    )
    .handle("preparePeppolArtifact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.preparePeppolArtifact(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPeppolArtifact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getPeppolArtifact(token, scopeFromPath(params), params.id),
      ),
    )
    .handle("approvePeppolExchange", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.approvePeppolExchange(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          artifactId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("dispatchPeppolExchange", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.dispatchPeppolExchange(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          artifactId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("getPeppolAttempt", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getPeppolAttempt(token, scopeFromPath(params), params.id),
      ),
    )
    .handle("collectPeppolOutcome", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.collectPeppolOutcome(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          attemptId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("receivePeppolEnvelope", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.receivePeppolEnvelope(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPeppolInbound", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getPeppolInbound(token, scopeFromPath(params), params.id),
      ),
    ),
);
