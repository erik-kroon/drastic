import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { TaxAccountOperations } from "../../../application/operations/tax-account";
import { operationHandlers } from "../operation-handlers";

export const TaxAccountHandlers = HttpApiBuilder.group(Api, "taxAccount", (handlers) =>
  handlers.handleAll(operationHandlers(TaxAccountOperations)),
);
