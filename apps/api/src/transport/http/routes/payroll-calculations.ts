import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Payroll from "../../../application/payroll/calculations";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const PayrollCalculationHandlers = HttpApiBuilder.group(
  Api,
  "payrollCalculation",
  (handlers) =>
    handlers
      .handle("preparePayrollCalculation", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Payroll.prepareCalculation(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getPayrollCalculation", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Payroll.getCalculation(token, {
            scope: scopeFromPath(params),
            calculationId: params.calculationId,
          }),
        ),
      )
      .handle("listPayrollCalculations", ({ params, query }) =>
        Effect.flatMap(authenticate, (token) =>
          Payroll.listCalculations(token, {
            scope: scopeFromPath(params),
            employeeId: params.employeeId,
            after: query.after,
          }),
        ),
      ),
);
