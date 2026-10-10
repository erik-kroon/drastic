import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { FirmOperations } from "../../../application/operations/firms";
import { operationHandlers } from "../operation-handlers";

export const FirmHandlers = HttpApiBuilder.group(Api, "firms", (handlers) =>
  handlers.handleAll(operationHandlers(FirmOperations)),
);
