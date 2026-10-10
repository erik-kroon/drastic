import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { ReportStatementOperations } from "../../../application/operations/report-statements";
import { operationHandlers } from "../operation-handlers";

export const ReportStatementHandlers = HttpApiBuilder.group(Api, "reportStatements", (handlers) =>
  handlers.handleAll(operationHandlers(ReportStatementOperations)),
);
