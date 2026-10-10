import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PayrollFoundationOperations } from "../../../application/operations/payroll-foundation";
import { operationHandlers } from "../operation-handlers";

export const PayrollFoundationHandlers = HttpApiBuilder.group(
  Api,
  "payrollFoundation",
  (handlers) => handlers.handleAll(operationHandlers(PayrollFoundationOperations)),
);
