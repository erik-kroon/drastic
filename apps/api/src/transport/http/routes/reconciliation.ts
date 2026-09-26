import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { bankWorkspace } from "../../../application/banking/workspace";
import {
  getBankStatement,
  importBankStatement,
} from "../../../application/banking/source-statement";
import { matchBankObservation } from "../../../application/banking/matches";
import { getBankReconciliation, reconcileBank } from "../../../application/banking/reconciliations";

export const ReconciliationHandlers = HttpApiBuilder.group(Api, "reconciliation", (handlers) =>
  handlers
    .handle("bankWorkspace", ({ params, query: input }) =>
      Effect.flatMap(authenticate, (token) =>
        bankWorkspace(token, { scope: scopeFromPath(params), input }),
      ),
    )
    .handle("importBankStatement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        importBankStatement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankStatement", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getBankStatement(token, { scope: scopeFromPath(params), statementId: params.id }),
      ),
    )
    .handle("matchBankObservation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        matchBankObservation(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reconcileBank", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        reconcileBank(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankReconciliation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getBankReconciliation(token, { scope: scopeFromPath(params), reconciliationId: params.id }),
      ),
    ),
);
