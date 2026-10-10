import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SourceIntakeOperations } from "../../../application/operations/source-intake";
import { operationHandlers } from "../operation-handlers";

export const SourceIntakeHandlers = HttpApiBuilder.group(Api, "sourceIntake", (handlers) =>
  handlers.handleAll(operationHandlers(SourceIntakeOperations)),
);
