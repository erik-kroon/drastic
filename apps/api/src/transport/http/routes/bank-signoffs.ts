import { Api } from "@open-erp/contracts/api";
import * as Signoffs from "@open-erp/contracts/bank-signoffs";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const BankSignoffHandlers = HttpApiBuilder.group(Api, "bankSignoffs", (handlers) =>
  handlers
    .handle("prepareBankSignoff", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "prepareBankSignoff",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Signoffs.BankSignoffPlan,
        ),
      ),
    )
    .handle("signBankReconciliation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "signBankReconciliation",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Signoffs.BankReconciliationSignoff,
        ),
      ),
    )
    .handle("getBankSignoff", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getBankSignoff",
          [token, scopeParameter(params), params.id],
          Signoffs.BankSignoffView,
        ),
      ),
    )
    .handle("listBankSignoffs", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("listBankSignoffs", [token, scopeParameter(params)], Signoffs.BankSignoffList),
      ),
    ),
);
