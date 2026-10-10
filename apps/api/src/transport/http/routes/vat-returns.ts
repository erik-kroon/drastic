import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { VatReturnsOperations } from "../../../application/operations/vat-returns";
import { operationHandlers } from "../operation-handlers";

export const VatReturnsHandlers = HttpApiBuilder.group(Api, "vatReturns", (handlers) =>
  handlers.handleAll(operationHandlers(VatReturnsOperations)),
);
