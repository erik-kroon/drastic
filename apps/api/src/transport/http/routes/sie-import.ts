import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SieImportOperations } from "../../../application/operations/sie-import";
import { operationHandlers } from "../operation-handlers";

export const SieImportHandlers = HttpApiBuilder.group(Api, "sieImport", (handlers) =>
  handlers.handleAll(operationHandlers(SieImportOperations)),
);
