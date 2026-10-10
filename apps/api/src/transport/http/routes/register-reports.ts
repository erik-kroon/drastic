import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { RegisterReportOperations } from "../../../application/operations/register-reports";
import { operationHandlers } from "../operation-handlers";

export const RegisterReportHandlers = HttpApiBuilder.group(Api, "registerReports", (handlers) =>
  handlers.handleAll(operationHandlers(RegisterReportOperations)),
);
