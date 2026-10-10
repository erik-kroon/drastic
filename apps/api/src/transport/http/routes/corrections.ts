import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CorrectionOperations } from "../../../application/operations/corrections";
import { operationHandlers } from "../operation-handlers";

export const CorrectionHandlers = HttpApiBuilder.group(Api, "corrections", (handlers) =>
  handlers.handleAll(operationHandlers(CorrectionOperations)),
);
