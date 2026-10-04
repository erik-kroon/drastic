import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/payroll/inputs";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const PayrollInputHandlers = HttpApiBuilder.group(Api, "payrollInput", (handlers) =>
  handlers
    .handle("submitPayrollInput", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.submitInput(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reviewPayrollInput", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.reviewInput(token, {
          scope: scopeFromPath(params),
          inputId: params.inputId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("preparePayrollInputPayment", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.prepareDirectPayment(token, {
          scope: scopeFromPath(params),
          inputId: params.inputId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approvePayrollInput", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.approveInput(token, {
          scope: scopeFromPath(params),
          reviewId: params.reviewId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executePayrollInput", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.executeInput(token, {
          scope: scopeFromPath(params),
          reviewId: params.reviewId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPayrollInput", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getInput(token, { scope: scopeFromPath(params), inputId: params.inputId }),
      ),
    ),
);
