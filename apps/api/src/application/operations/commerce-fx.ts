import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as CommerceFx from "../commerce/fx";
import {
  approveFxChainRepair,
  executeFxChainRepair,
  getFxChainRepair,
  prepareFxChainRepair,
} from "../commerce/fx-chain-repair";
import {
  approveFxRemeasurement,
  executeFxRemeasurement,
  getFxRemeasurement,
  prepareFxRemeasurement,
} from "../commerce/fx-remeasurement";

import { defineHttpOperation } from "../capabilities/http-operation";

export const CommerceFxOperations = {
  recoverCommerceFxCommand: defineHttpOperation(
    Api.groups.commerceFx.endpoints.recoverCommerceFxCommand,
    (token, { params }) =>
      CommerceFx.recoverCommand(token, { scope: scopeFromPath(params), key: params.key }),
  ),
  getCommerceFxItem: defineHttpOperation(
    Api.groups.commerceFx.endpoints.getCommerceFxItem,
    (token, { params }) =>
      CommerceFx.getItem(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  getFxChainRepair: defineHttpOperation(
    Api.groups.commerceFx.endpoints.getFxChainRepair,
    (token, { params }) => getFxChainRepair(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  executeFxChainRepair: defineHttpOperation(
    Api.groups.commerceFx.endpoints.executeFxChainRepair,
    (token, { params, headers, payload }) =>
      executeFxChainRepair(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        reviewId: params.id,
        input: payload,
      }),
  ),
  approveFxChainRepair: defineHttpOperation(
    Api.groups.commerceFx.endpoints.approveFxChainRepair,
    (token, { params, headers, payload }) =>
      approveFxChainRepair(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        reviewId: params.id,
        input: payload,
      }),
  ),
  prepareFxChainRepair: defineHttpOperation(
    Api.groups.commerceFx.endpoints.prepareFxChainRepair,
    (token, { params, headers, payload }) =>
      prepareFxChainRepair(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getFxRemeasurement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.getFxRemeasurement,
    (token, { params }) =>
      getFxRemeasurement(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  executeFxRemeasurement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.executeFxRemeasurement,
    (token, { params, headers, payload }) =>
      executeFxRemeasurement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        reviewId: params.id,
        input: payload,
      }),
  ),
  approveFxRemeasurement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.approveFxRemeasurement,
    (token, { params, headers, payload }) =>
      approveFxRemeasurement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        reviewId: params.id,
        input: payload,
      }),
  ),
  prepareFxRemeasurement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.prepareFxRemeasurement,
    (token, { params, headers, payload }) =>
      prepareFxRemeasurement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeCommerceFxSettlementCorrection: defineHttpOperation(
    Api.groups.commerceFx.endpoints.executeCommerceFxSettlementCorrection,
    (token, { params, headers, payload }) =>
      CommerceFx.executeSettlementCorrection(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveCommerceFxSettlementCorrection: defineHttpOperation(
    Api.groups.commerceFx.endpoints.approveCommerceFxSettlementCorrection,
    (token, { params, headers, payload }) =>
      CommerceFx.approveSettlementCorrection(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareCommerceFxSettlementCorrection: defineHttpOperation(
    Api.groups.commerceFx.endpoints.prepareCommerceFxSettlementCorrection,
    (token, { params, headers, payload }) =>
      CommerceFx.prepareSettlementCorrection(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeCommerceFxFeeSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.executeCommerceFxFeeSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.executeFeeSettlement(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveCommerceFxFeeSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.approveCommerceFxFeeSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.approveFeeSettlement(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareCommerceFxFeeSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.prepareCommerceFxFeeSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.prepareFeeSettlement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeCommerceFxPartialSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.executeCommerceFxPartialSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.executePartialSettlement(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveCommerceFxPartialSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.approveCommerceFxPartialSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.approvePartialSettlement(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareCommerceFxPartialSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.prepareCommerceFxPartialSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.preparePartialSettlement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeCommerceFxSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.executeCommerceFxSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.executeSettlement(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveCommerceFxSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.approveCommerceFxSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.approveSettlement(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareCommerceFxSettlement: defineHttpOperation(
    Api.groups.commerceFx.endpoints.prepareCommerceFxSettlement,
    (token, { params, headers, payload }) =>
      CommerceFx.prepareSettlement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeCommerceFxRecognition: defineHttpOperation(
    Api.groups.commerceFx.endpoints.executeCommerceFxRecognition,
    (token, { params, headers, payload }) =>
      CommerceFx.executeRecognition(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveCommerceFxRecognition: defineHttpOperation(
    Api.groups.commerceFx.endpoints.approveCommerceFxRecognition,
    (token, { params, headers, payload }) =>
      CommerceFx.approveRecognition(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareCommerceFxRecognition: defineHttpOperation(
    Api.groups.commerceFx.endpoints.prepareCommerceFxRecognition,
    (token, { params, headers, payload }) =>
      CommerceFx.prepareRecognition(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
