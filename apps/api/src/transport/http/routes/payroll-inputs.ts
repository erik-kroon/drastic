import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PayrollInputOperations } from "../../../application/operations/payroll-inputs";
import { operationHandlers } from "../operation-handlers";

export const PayrollInputHandlers = HttpApiBuilder.group(Api, "payrollInput", (handlers) =>
  handlers.handleAll(operationHandlers(PayrollInputOperations)),
);
