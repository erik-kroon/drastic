import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BankSourceCoverageOperations } from "../../../application/operations/bank-source-coverage";
import { operationHandlers } from "../operation-handlers";

export const BankSourceCoverageHandlers = HttpApiBuilder.group(
  Api,
  "bankSourceCoverage",
  (handlers) => handlers.handleAll(operationHandlers(BankSourceCoverageOperations)),
);
