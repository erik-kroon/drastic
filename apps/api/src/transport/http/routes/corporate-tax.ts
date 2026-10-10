import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CorporateTaxOperations } from "../../../application/operations/corporate-tax";
import { operationHandlers } from "../operation-handlers";

export const CorporateTaxHandlers = HttpApiBuilder.group(Api, "corporateTax", (handlers) =>
  handlers.handleAll(operationHandlers(CorporateTaxOperations)),
);
