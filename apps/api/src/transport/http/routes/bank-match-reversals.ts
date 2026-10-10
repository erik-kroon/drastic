import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BankMatchReversalOperations } from "../../../application/operations/bank-match-reversals";
import { operationHandlers } from "../operation-handlers";

export const BankMatchReversalHandlers = HttpApiBuilder.group(
  Api,
  "bankMatchReversals",
  (handlers) => handlers.handleAll(operationHandlers(BankMatchReversalOperations)),
);
