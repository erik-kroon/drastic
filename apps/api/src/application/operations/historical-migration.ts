import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Historical from "../sie/historical";

import { defineHttpOperation } from "../capabilities/http-operation";

export const HistoricalMigrationOperations = {
  reclaimSieFinancialRun: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.reclaimSieFinancialRun,
    (token, { params, headers, payload }) =>
      Historical.reclaimFinancialRun(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        action: payload.action,
      }),
  ),
  advanceSieFinancialRun: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.advanceSieFinancialRun,
    (token, { params, headers, payload }) =>
      Historical.advanceFinancialRun(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        input: payload,
      }),
  ),
  getSieFinancialRun: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.getSieFinancialRun,
    (token, { params }) =>
      Historical.getFinancialRun(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  startSieFinancialRun: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.startSieFinancialRun,
    (token, { params, headers, payload }) => {
      const command = {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        fiscalYearId: payload.fiscalYearId,
        planDigest: payload.planDigest,
      };

      if (payload.partitionId === undefined) return Historical.startFinancialRun(token, command);

      return Historical.startFinancialRun(token, {
        ...command,
        partitionId: payload.partitionId,
      });
    },
  ),
  postHistoricalOpening: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.postHistoricalOpening,
    (token, { params, headers, payload }) =>
      Historical.postOpening(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        planDigest: payload.planDigest,
        approvalId: payload.approvalId,
      }),
  ),
  getHistoricalBasis: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.getHistoricalBasis,
    (token, { params }) =>
      Historical.getBasis(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  selectHistoricalBasis: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.selectHistoricalBasis,
    (token, { params, headers, payload }) =>
      Historical.selectBasis(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listHistoricalBases: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.listHistoricalBases,
    (token, { params }) => Historical.listBases(token, { scope: scopeFromPath(params) }),
  ),
  getHistoricalItems: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.getHistoricalItems,
    (token, { params }) =>
      Historical.getItems(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  getPlanHistoricalItems: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.getPlanHistoricalItems,
    (token, { params }) =>
      Historical.getPlanItems(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  admitHistoricalItems: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.admitHistoricalItems,
    (token, { params, headers, payload }) =>
      Historical.admitItems(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        input: payload,
      }),
  ),
  prepareSieFinancialVoucher: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.prepareSieFinancialVoucher,
    (token, { params, headers, payload }) =>
      Historical.prepareFinancialVoucher(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        input: payload,
      }),
  ),
  getSieFinancialWorkspace: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.getSieFinancialWorkspace,
    (token, { params }) =>
      Historical.getFinancialWorkspace(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  prepareHistoricalOpening: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.prepareHistoricalOpening,
    (token, { params, headers, payload }) =>
      Historical.prepareOpening(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  compareSieClosing: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.compareSieClosing,
    (token, { params }) =>
      Historical.compareSieClosing(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  refreshHistoricalOpening: defineHttpOperation(
    Api.groups.historicalMigration.endpoints.refreshHistoricalOpening,
    (token, { params, headers, payload }) =>
      Historical.refreshOpening(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        input: payload,
      }),
  ),
};
