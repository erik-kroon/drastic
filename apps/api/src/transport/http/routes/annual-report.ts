import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { AnnualReportOperations } from "../../../application/operations/annual-report";
import { operationHandlers } from "../operation-handlers";

export const AnnualReportHandlers = HttpApiBuilder.group(Api, "annualReport", (handlers) =>
  handlers.handleAll(operationHandlers(AnnualReportOperations)),
);
