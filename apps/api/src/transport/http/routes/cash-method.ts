import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { admitCashMethodInvoice } from "../../../application/commerce/cash-invoices";
import {
  prepareCashCredit,
  approveCashCredit,
  executeCashCredit,
} from "../../../application/commerce/cash-credits";
import {
  prepareCashYearEnd,
  approveCashYearEnd,
  executeCashYearEnd,
} from "../../../application/commerce/cash-year-end";
import {
  readCashMethodLine,
  recognizeCashPayment,
  registerCashMethodLine,
} from "../../../application/commerce/cash-method";

// Payment settles commercial debt and recognizes only uncovered components.
// Year-end recognizes unpaid debt without settling it. Both use retained native
// invoice facts and current reviewed profiles.
export const CashMethodHandlers = HttpApiBuilder.group(Api, "cashMethod", (handlers) =>
  handlers
    .handle("admitCashMethodInvoice", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        admitCashMethodInvoice(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
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
        prepareCashYearEnd(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveCashYearEnd", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveCashYearEnd(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCashYearEnd", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeCashYearEnd(token, {
          scope: scopeFromPath(params),
          id: params.id,
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
    )
    .handle("prepareCashCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareCashCredit(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveCashCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveCashCredit(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCashCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeCashCredit(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
