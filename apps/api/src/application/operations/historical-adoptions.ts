import { Api } from "@open-erp/contracts/api";

import * as Adoptions from "../sie/adoptions";
import * as Settlements from "../commerce/historical-settlements";
import * as Obligations from "../commerce/historical-obligations";
import { scopeFromPath } from "../operation-scope";

import { defineHttpOperation } from "../capabilities/http-operation";

export const HistoricalAdoptionsOperations = {
  prepareHistoricalCredit: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.prepareHistoricalCredit,
    (token, { params, headers, payload }) =>
      Obligations.prepareHistoricalCredit(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeHistoricalSettlement: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.executeHistoricalSettlement,
    (token, { params, headers, payload }) =>
      Settlements.executeHistoricalSettlement(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveHistoricalSettlement: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.approveHistoricalSettlement,
    (token, { params, headers, payload }) =>
      Settlements.approveHistoricalSettlement(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getHistoricalSettlementPlan: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.getHistoricalSettlementPlan,
    (token, { params }) =>
      Settlements.getHistoricalSettlementPlan(token, {
        scope: scopeFromPath(params),
        id: params.id,
      }),
  ),
  prepareHistoricalSettlement: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.prepareHistoricalSettlement,
    (token, { params, headers, payload }) =>
      Settlements.prepareHistoricalSettlement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getHistoricalObligation: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.getHistoricalObligation,
    (token, { params }) =>
      Obligations.getHistoricalObligation(token, {
        scope: scopeFromPath(params),
        id: params.id,
      }),
  ),
  executeHistoricalAdoption: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.executeHistoricalAdoption,
    (token, { params, headers, payload }) =>
      Adoptions.executeHistoricalAdoption(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveHistoricalAdoption: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.approveHistoricalAdoption,
    (token, { params, headers, payload }) =>
      Adoptions.approveHistoricalAdoption(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getHistoricalAdoptionPlan: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.getHistoricalAdoptionPlan,
    (token, { params }) =>
      Adoptions.getHistoricalAdoptionPlan(token, {
        scope: scopeFromPath(params),
        id: params.id,
      }),
  ),
  prepareHistoricalAdoption: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.prepareHistoricalAdoption,
    (token, { params, headers, payload }) =>
      Adoptions.prepareHistoricalAdoption(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getHistoricalPool: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.getHistoricalPool,
    (token, { params }) =>
      Adoptions.getHistoricalPool(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  createHistoricalPool: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.createHistoricalPool,
    (token, { params, headers, payload }) =>
      Adoptions.createHistoricalPool(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listHistoricalAdoptionPlans: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.listHistoricalAdoptionPlans,
    (token, { params, query }) =>
      Adoptions.listHistoricalAdoptionPlans(token, {
        scope: scopeFromPath(params),
        query,
      }),
  ),
  getHistoricalAdoptionWorkspace: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.getHistoricalAdoptionWorkspace,
    (token, { params }) =>
      Adoptions.getHistoricalAdoptionWorkspace(token, {
        scope: scopeFromPath(params),
        id: params.id,
      }),
  ),
  rereviewHistoricalPool: defineHttpOperation(
    Api.groups.historicalAdoptions.endpoints.rereviewHistoricalPool,
    (token, { params, headers, payload }) =>
      Adoptions.rereviewHistoricalPool(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
