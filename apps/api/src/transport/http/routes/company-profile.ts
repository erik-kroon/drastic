import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CompanyProfileOperations } from "../../../application/operations/company-profile";
import { operationHandlers } from "../operation-handlers";

export const CompanyProfileHandlers = HttpApiBuilder.group(Api, "companyProfile", (handlers) =>
  handlers.handleAll(operationHandlers(CompanyProfileOperations)),
);
