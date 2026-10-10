import { Api } from "@open-erp/contracts/api";

import * as Partitions from "../sie/partitions";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const SiePartitionsOperations = {
  getSiePartition: defineHttpOperation(
    Api.groups.siePartitions.endpoints.getSiePartition,
    (token, { params }) =>
      Partitions.getSiePartition(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  prepareSiePartition: defineHttpOperation(
    Api.groups.siePartitions.endpoints.prepareSiePartition,
    (token, { params, headers, payload }) =>
      Partitions.prepareSiePartition(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
