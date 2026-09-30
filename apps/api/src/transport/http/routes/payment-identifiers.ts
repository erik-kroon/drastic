import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Api } from "@open-erp/contracts/api";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";
import {
  inspectPaymentIdentifier,
  inspectBankAccountHint,
} from "../../../application/purchases/payment-identifiers";

export const PaymentIdentifierHandlers = HttpApiBuilder.group(
  Api,
  "paymentIdentifiers",
  (handlers) =>
    handlers
      .handle("checkPaymentIdentifier", ({ params, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          inspectPaymentIdentifier(token, { scope: scopeFromPath(params), input: payload }),
        ),
      )
      .handle("checkBankAccountHint", ({ params, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          inspectBankAccountHint(token, { scope: scopeFromPath(params), input: payload }),
        ),
      ),
);
