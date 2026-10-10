import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { CatalogOperations } from "../../../application/operations/catalog";
import { operationHandlers } from "../operation-handlers";

export const CatalogHandlers = HttpApiBuilder.group(Api, "catalog", (handlers) =>
  handlers.handleAll(operationHandlers(CatalogOperations)),
);
