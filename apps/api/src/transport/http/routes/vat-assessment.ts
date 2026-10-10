import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { VatAssessmentOperations } from "../../../application/operations/vat-assessment";
import { operationHandlers } from "../operation-handlers";

export const VatAssessmentHandlers = HttpApiBuilder.group(Api, "vatAssessment", (handlers) =>
  handlers.handleAll(operationHandlers(VatAssessmentOperations)),
);
