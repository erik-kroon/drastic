import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Payroll from "../payroll-foundation";

import { defineHttpOperation } from "../capabilities/http-operation";

export const PayrollFoundationOperations = {
  listPayrollRevisions: defineHttpOperation(
    Api.groups.payrollFoundation.endpoints.listPayrollRevisions,
    (token, { params }) =>
      Payroll.listRevisions(token, {
        scope: { entityId: params.entityId, bookId: params.bookId },
        employeeId: params.id,
      }),
  ),
  capturePayrollRevision: defineHttpOperation(
    Api.groups.payrollFoundation.endpoints.capturePayrollRevision,
    (token, { params, headers, payload }) =>
      Payroll.captureRevision(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  setPayrollAccess: defineHttpOperation(
    Api.groups.payrollFoundation.endpoints.setPayrollAccess,
    (token, { params, payload }) =>
      Payroll.setAccess(token, { scope: scopeFromPath(params), input: payload }),
  ),
  listPayrollEmployees: defineHttpOperation(
    Api.groups.payrollFoundation.endpoints.listPayrollEmployees,
    (token, { params, query: filters }) =>
      Payroll.listEmployees(token, { scope: scopeFromPath(params), after: filters.after }),
  ),
};
