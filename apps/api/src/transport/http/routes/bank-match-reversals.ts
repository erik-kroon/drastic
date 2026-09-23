import { Api } from "@open-erp/contracts/api";
import * as Reversal from "@open-erp/contracts/bank-match-reversals";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const BankMatchReversalHandlers = HttpApiBuilder.group(Api, "bankMatchReversals", (handlers) =>
  handlers
    .handle("prepareBankMatchReversal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_prepare_match_reversal.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankMatchReversal", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_get_match_reversal.execute(token, { scope: params, planId: params.id }),
      ),
    )
    .handle("listBankMatchReversals", ({ params, query: page }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_list_match_reversals.execute(token, { scope: params, ...page }),
      ),
    )
    .handle("approveBankMatchReversal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveBankMatchReversal",
          [token, scopeParameter(params), headers["idempotency-key"], params.id, JSON.stringify(payload)],
          Reversal.BankMatchReversalApproval,
        ),
      ),
    )
    .handle("revokeBankMatchReversalApproval", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "revokeBankMatchReversalApproval",
          [token, scopeParameter(params), headers["idempotency-key"], params.id, JSON.stringify(payload)],
          Reversal.BankMatchReversalRevocation,
        ),
      ),
    )
    .handle("executeBankMatchReversal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.bank_execute_match_reversal.execute(token, {
          scope: params,
          planId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
