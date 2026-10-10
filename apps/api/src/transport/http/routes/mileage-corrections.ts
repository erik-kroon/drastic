import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { MileageCorrectionOperations } from "../../../application/operations/mileage-corrections";
import { operationHandlers } from "../operation-handlers";

export const MileageCorrectionHandlers = HttpApiBuilder.group(
  Api,
  "mileageCorrections",
  (handlers) => handlers.handleAll(operationHandlers(MileageCorrectionOperations)),
);
