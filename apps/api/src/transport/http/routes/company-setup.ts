import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CompanySetupOperations } from "../../../application/operations/company-setup";
import { operationHandlers } from "../operation-handlers";

export const CompanySetupHandlers = HttpApiBuilder.group(Api, "companySetup", (handlers) =>
  handlers.handleAll(operationHandlers(CompanySetupOperations)),
);
