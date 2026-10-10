import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BankSourceRevisionsOperations } from "../../../application/operations/bank-source-revisions";
import { operationHandlers } from "../operation-handlers";

export const BankSourceRevisionsHandlers = HttpApiBuilder.group(
  Api,
  "bankSourceRevisions",
  (handlers) => handlers.handleAll(operationHandlers(BankSourceRevisionsOperations)),
);
