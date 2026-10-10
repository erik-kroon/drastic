import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CrmMasterOperations } from "../../../application/operations/crm-master";
import { operationHandlers } from "../operation-handlers";

export const CrmMasterHandlers = HttpApiBuilder.group(Api, "crmMaster", (handlers) =>
  handlers.handleAll(operationHandlers(CrmMasterOperations)),
);
