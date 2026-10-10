import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { OwnerRegisterOperations } from "../../../application/operations/owner-register";
import { operationHandlers } from "../operation-handlers";

export const OwnerRegisterHandlers = HttpApiBuilder.group(Api, "ownerRegister", (handlers) =>
  handlers.handleAll(operationHandlers(OwnerRegisterOperations)),
);
