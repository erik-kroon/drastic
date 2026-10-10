import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";

import { bindHttpOperation } from "../capabilities/http-operation";

export const PayrollCalculationOperations = {
  listPayrollCalculations: bindHttpOperation(
    Api.groups.payrollCalculation.endpoints.listPayrollCalculations,
    capabilities.payroll_list_calculations,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      employeeId: params.employeeId,
      after: query.after,
    }),
  ),
  getPayrollCalculation: bindHttpOperation(
    Api.groups.payrollCalculation.endpoints.getPayrollCalculation,
    capabilities.payroll_get_calculation,
    ({ params }) => ({
      scope: scopeFromPath(params),
      calculationId: params.calculationId,
    }),
  ),
  preparePayrollCalculation: bindHttpOperation(
    Api.groups.payrollCalculation.endpoints.preparePayrollCalculation,
    capabilities.payroll_prepare_calculation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
