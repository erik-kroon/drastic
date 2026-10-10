import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ReportOperations } from "../../../application/operations/reports";
import { operationHandlers } from "../operation-handlers";

export const ReportHandlers = HttpApiBuilder.group(Api, "reports", (handlers) =>
  handlers.handleAll(operationHandlers(ReportOperations)),
);
