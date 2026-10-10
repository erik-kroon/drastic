import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { Sie4EOperations } from "../../../application/operations/sie4e";
import { operationHandlers } from "../operation-handlers";

export const Sie4EHandlers = HttpApiBuilder.group(Api, "sieFullBook", (handlers) =>
  handlers.handleAll(operationHandlers(Sie4EOperations)),
);
