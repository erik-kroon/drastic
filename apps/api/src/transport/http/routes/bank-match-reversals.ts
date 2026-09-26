import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  approveBankMatchReversal,
  executeBankMatchReversal,
  getBankMatchReversal,
  listBankMatchReversals,
  prepareBankMatchReversal,
  revokeBankMatchReversalApproval,
} from "../../../application/banking/match-reversals";

export const BankMatchReversalHandlers = HttpApiBuilder.group(
  Api,
  "bankMatchReversals",
  (handlers) =>
    handlers
      .handle("prepareBankMatchReversal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareBankMatchReversal(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getBankMatchReversal", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getBankMatchReversal(token, { scope: scopeFromPath(params), planId: params.id }),
        ),
      )
      .handle("listBankMatchReversals", ({ params, query: page }) =>
        Effect.flatMap(authenticate, (token) =>
          listBankMatchReversals(token, { scope: scopeFromPath(params), after: page.after }),
        ),
      )
      .handle("approveBankMatchReversal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          approveBankMatchReversal(token, {
            scope: scopeFromPath(params),
            planId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("revokeBankMatchReversalApproval", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          revokeBankMatchReversalApproval(token, {
            scope: scopeFromPath(params),
            approvalId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("executeBankMatchReversal", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          executeBankMatchReversal(token, {
            scope: scopeFromPath(params),
            planId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      ),
);
