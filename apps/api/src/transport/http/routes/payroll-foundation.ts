import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Payroll from "../../../application/payroll-foundation";

export const PayrollFoundationHandlers = HttpApiBuilder.group(
  Api,
  "payrollFoundation",
  (handlers) =>
    handlers
      .handle("listPayrollEmployees", ({ params, query: filters }) =>
        Effect.flatMap(authenticate, (token) =>
          Payroll.listEmployees(token, { scope: scopeFromPath(params), after: filters.after }),
        ),
      )
      .handle("setPayrollAccess", ({ params, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Payroll.setAccess(token, { scope: scopeFromPath(params), input: payload }),
        ),
      )
      .handle("capturePayrollRevision", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Payroll.captureRevision(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("listPayrollRevisions", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Payroll.listRevisions(token, {
            scope: { entityId: params.entityId, bookId: params.bookId },
            employeeId: params.id,
          }),
        ),
      ),
);
