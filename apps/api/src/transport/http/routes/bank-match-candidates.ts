import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BankMatchCandidateOperations } from "../../../application/operations/bank-match-candidates";
import { operationHandlers } from "../operation-handlers";

export const BankMatchCandidateHandlers = HttpApiBuilder.group(
  Api,
  "bankMatchCandidates",
  (handlers) => handlers.handleAll(operationHandlers(BankMatchCandidateOperations)),
);
