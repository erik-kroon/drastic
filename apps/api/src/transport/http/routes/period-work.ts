import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PeriodWorkOperations } from "../../../application/operations/period-work";
import { operationHandlers } from "../operation-handlers";

export const PeriodWorkHandlers = HttpApiBuilder.group(Api, "periodWork", (handlers) =>
  handlers.handleAll(operationHandlers(PeriodWorkOperations)),
);
