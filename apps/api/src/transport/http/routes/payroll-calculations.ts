import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PayrollCalculationOperations } from "../../../application/operations/payroll-calculations";
import { operationHandlers } from "../operation-handlers";

export const PayrollCalculationHandlers = HttpApiBuilder.group(
  Api,
  "payrollCalculation",
  (handlers) => handlers.handleAll(operationHandlers(PayrollCalculationOperations)),
);
