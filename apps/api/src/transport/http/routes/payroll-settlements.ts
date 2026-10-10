import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PayrollSettlementOperations } from "../../../application/operations/payroll-settlements";
import { operationHandlers } from "../operation-handlers";

export const PayrollSettlementHandlers = HttpApiBuilder.group(
  Api,
  "payrollSettlement",
  (handlers) => handlers.handleAll(operationHandlers(PayrollSettlementOperations)),
);
