import { Api } from "@open-erp/contracts/api";
import * as Signoffs from "@open-erp/contracts/bank-inventory-signoffs";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const BankInventorySignoffHandlers = HttpApiBuilder.group(
  Api,
  "bankInventorySignoffs",
  (handlers) =>
    handlers
      .handle("prepareBankInventorySignoff", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "prepareBankInventorySignoff",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Signoffs.BankInventorySignoffPlan,
          ),
        ),
      )
      .handle("signBankInventory", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "signBankInventory",
            [
              token,
              scopeParameter(params),
              headers["idempotency-key"],
              params.id,
              JSON.stringify(payload),
            ],
            Signoffs.BankInventorySignoff,
          ),
        ),
      )
      .handle("getBankInventorySignoff", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getBankInventorySignoff",
            [token, scopeParameter(params), params.id],
            Signoffs.BankInventorySignoffView,
          ),
        ),
      )
      .handle("listBankInventorySignoffs", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "listBankInventorySignoffs",
            [token, scopeParameter(params)],
            Signoffs.BankInventorySignoffList,
          ),
        ),
      ),
);
