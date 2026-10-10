import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ArLegalIssueOperations } from "../../../application/operations/ar-legal-issue";
import { operationHandlers } from "../operation-handlers";

export const ArLegalIssueHandlers = HttpApiBuilder.group(Api, "arLegalIssue", (handlers) =>
  handlers.handleAll(operationHandlers(ArLegalIssueOperations)),
);
