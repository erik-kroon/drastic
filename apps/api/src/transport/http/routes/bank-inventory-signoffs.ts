import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  getBankInventorySignoff,
  listBankInventorySignoffs,
  prepareBankInventorySignoff,
  signBankInventory,
} from "../../../application/banking/inventory-signoffs";

export const BankInventorySignoffHandlers = HttpApiBuilder.group(
  Api,
  "bankInventorySignoffs",
  (handlers) =>
    handlers
      .handle("prepareBankInventorySignoff", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          prepareBankInventorySignoff(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("signBankInventory", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          signBankInventory(token, {
            scope: scopeFromPath(params),
            planId: params.id,
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getBankInventorySignoff", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          getBankInventorySignoff(token, { scope: scopeFromPath(params), planId: params.id }),
        ),
      )
      .handle("listBankInventorySignoffs", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          listBankInventorySignoffs(token, { scope: scopeFromPath(params) }),
        ),
      ),
);
