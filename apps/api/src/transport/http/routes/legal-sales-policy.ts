import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { LegalSalesPolicyOperations } from "../../../application/operations/legal-sales-policy";
import { operationHandlers } from "../operation-handlers";

export const LegalSalesPolicyHandlers = HttpApiBuilder.group(
  Api,
  "legalSalesPolicies",
  (handlers) => handlers.handleAll(operationHandlers(LegalSalesPolicyOperations)),
);
