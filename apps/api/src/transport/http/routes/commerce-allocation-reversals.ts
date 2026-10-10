import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CommerceAllocationReversalOperations } from "../../../application/operations/commerce-allocation-reversals";
import { operationHandlers } from "../operation-handlers";

export const CommerceAllocationReversalHandlers = HttpApiBuilder.group(
  Api,
  "commerceAllocationReversals",
  (handlers) => handlers.handleAll(operationHandlers(CommerceAllocationReversalOperations)),
);
