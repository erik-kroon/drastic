import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/payroll/paid-recovery";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const PaidRecoveryHandlers = HttpApiBuilder.group(Api, "paidRecovery", (handlers) =>
  handlers
    .handle("listPaidRecoveryBasisSources", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.listPaidRecoveryBasisSources(token, { scope: scopeFromPath(params), ...query }),
      ),
    )
    .handle("preparePaidRecovery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.preparePaidRecovery(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("splitPaidRecovery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.splitPaidRecovery(token, {
          scope: scopeFromPath(params),
          recoveryId: params.recoveryId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("attachPaidRecovery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.attachPaidRecovery(token, {
          scope: scopeFromPath(params),
          recoveryId: params.recoveryId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("qualifyPaidRecovery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.qualifyPaidRecovery(token, {
          scope: scopeFromPath(params),
          recoveryId: params.recoveryId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("preparePaidRecoveryClaim", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.preparePaidRecoveryClaim(token, {
          scope: scopeFromPath(params),
          recoveryId: params.recoveryId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("cancelPaidRecovery", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.cancelPaidRecovery(token, {
          scope: scopeFromPath(params),
          recoveryId: params.recoveryId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPaidRecovery", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getPaidRecovery(token, {
          scope: scopeFromPath(params),
          recoveryId: params.recoveryId,
        }),
      ),
    )
    .handle("listPaidRecoveries", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.listPaidRecoveries(token, { scope: scopeFromPath(params), ...query }),
      ),
    ),
);
