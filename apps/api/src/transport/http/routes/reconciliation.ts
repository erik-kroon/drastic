import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as Workspace from "@open-erp/contracts/bank-workspace";
import { query, scopeParameter } from "../../../db/query";

export const ReconciliationHandlers = HttpApiBuilder.group(Api, "reconciliation", (handlers) =>
  handlers
    .handle("bankWorkspace", ({ params, query: input }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "bankWorkspace",
          [token, scopeParameter(params), JSON.stringify(input)],
          Workspace.BankWorkspace,
        ),
      ),
    )
    .handle("importBankStatement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_import_statement.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankStatement", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_get_statement.execute(token, { scope: params, statementId: params.id }),
      ),
    )
    .handle("matchBankObservation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_match_observation.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reconcileBank", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_reconcile.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankReconciliation", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_get_reconciliation.execute(token, {
          scope: params,
          reconciliationId: params.id,
        }),
      ),
    ),
);
