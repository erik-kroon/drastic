import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { SiePartitionsOperations } from "../../../application/operations/sie-partitions";
import { operationHandlers } from "../operation-handlers";

export const SiePartitionsHandlers = HttpApiBuilder.group(Api, "siePartitions", (handlers) =>
  handlers.handleAll(operationHandlers(SiePartitionsOperations)),
);
