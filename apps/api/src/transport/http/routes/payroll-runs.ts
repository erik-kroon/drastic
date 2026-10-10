import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PayrollRunOperations } from "../../../application/operations/payroll-runs";
import { operationHandlers } from "../operation-handlers";

export const PayrollRunHandlers = HttpApiBuilder.group(Api, "payrollRun", (handlers) =>
  handlers.handleAll(operationHandlers(PayrollRunOperations)),
);
