import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  readCashMethodLine,
  recognizeCashPayment,
  registerCashMethodLine,
  runCashMethodYearEnd,
} from "../../../application/commerce/cash-method";

// Cash-method recognition over the existing commerce invoice owner. Paying a
// document recognizes it without changing what is owed, and a year end
// recognizes the unpaid remainder once per period. Eligibility comes from a
// reviewed witness, never from an inference.
export const CashMethodHandlers = HttpApiBuilder.group(Api, "cashMethod", (handlers) =>
  handlers
    .handle("registerCashMethodLine", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        registerCashMethodLine(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("recognizeCashPayment", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        recognizeCashPayment(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("runCashMethodYearEnd", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        runCashMethodYearEnd(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("readCashMethodLine", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        readCashMethodLine(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
