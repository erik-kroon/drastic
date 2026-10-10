import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { BureauObligationsOperations } from "../../../application/operations/bureau-obligations";
import { operationHandlers } from "../operation-handlers";

export const BureauObligationsHandlers = HttpApiBuilder.group(
  Api,
  "bureauObligations",
  (handlers) => handlers.handleAll(operationHandlers(BureauObligationsOperations)),
);
