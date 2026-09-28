import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  preparePaymentReplacement,
  resolvePaymentInstruction,
} from "../../../application/purchases/payment-resolutions";

// The resolution and replacement surface over the existing supplier
// payment-batch/export owner. Neither operation posts, allocates or moves
// money: a resolution frees capacity against proof, and a replacement compiles
// a successor instruction bound to a new retained export. An XML file is not a
// paid invoice, and neither is its resolution.
export const PaymentResolutionHandlers = HttpApiBuilder.group(
  Api,
  "paymentResolutions",
  (handlers) =>
    handlers
      .handle("resolvePaymentInstruction", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          resolvePaymentInstruction(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("preparePaymentReplacement", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          preparePaymentReplacement(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      ),
);
