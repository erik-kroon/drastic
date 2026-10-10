import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { EmployeeClaimOperations } from "../../../application/operations/employee-claims";
import { operationHandlers } from "../operation-handlers";

export const EmployeeClaimHandlers = HttpApiBuilder.group(Api, "employeeClaims", (handlers) =>
  handlers.handleAll(operationHandlers(EmployeeClaimOperations)),
);
