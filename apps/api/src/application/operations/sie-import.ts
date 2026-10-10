import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Sie from "../sie/import";

import { defineHttpOperation } from "../capabilities/http-operation";

export const SieImportOperations = {
  reclaimSieSourceRun: defineHttpOperation(
    Api.groups.sieImport.endpoints.reclaimSieSourceRun,
    (token, { params, headers, payload }) =>
      Sie.reclaimSourceRun(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        action: payload.action,
      }),
  ),
  advanceSieSourceRun: defineHttpOperation(
    Api.groups.sieImport.endpoints.advanceSieSourceRun,
    (token, { params, headers, payload }) =>
      Sie.advanceSourceRun(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        input: payload,
      }),
  ),
  getSieSourceRun: defineHttpOperation(
    Api.groups.sieImport.endpoints.getSieSourceRun,
    (token, { params }) => Sie.getSourceRun(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  startSieSourceRun: defineHttpOperation(
    Api.groups.sieImport.endpoints.startSieSourceRun,
    (token, { params, headers, payload }) =>
      Sie.startSourceRun(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        digest: payload.digest,
      }),
  ),
  getSieSourcePlan: defineHttpOperation(
    Api.groups.sieImport.endpoints.getSieSourcePlan,
    (token, { params }) =>
      Sie.getSourcePlan(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  sealSieSourcePlan: defineHttpOperation(
    Api.groups.sieImport.endpoints.sealSieSourcePlan,
    (token, { params, headers, payload }) =>
      Sie.sealSourcePlan(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        input: payload,
      }),
  ),
  getSieSource: defineHttpOperation(
    Api.groups.sieImport.endpoints.getSieSource,
    (token, { params }) => Sie.getSource(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  captureSieSource: defineHttpOperation(
    Api.groups.sieImport.endpoints.captureSieSource,
    (token, { params, headers, payload }) =>
      Sie.captureSource(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        input: { encoding: payload.encoding, profile: payload.profile ?? "sie4_source_v1" },
      }),
  ),
  listSieSourcePreviews: defineHttpOperation(
    Api.groups.sieImport.endpoints.listSieSourcePreviews,
    (token, { params }) =>
      Sie.listSourcePreviews(token, { scope: scopeFromPath(params), id: params.id }),
  ),
};
