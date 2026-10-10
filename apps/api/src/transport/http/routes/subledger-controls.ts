import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SubledgerControlsOperations } from "../../../application/operations/subledger-controls";
import { operationHandlers } from "../operation-handlers";

export const SubledgerControlsHandlers = HttpApiBuilder.group(
  Api,
  "subledgerControls",
  (handlers) => handlers.handleAll(operationHandlers(SubledgerControlsOperations)),
);
