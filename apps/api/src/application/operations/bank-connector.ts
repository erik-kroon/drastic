import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  getConnectorBatch,
  getConnectorConsent,
  ingestConnectorBatch,
  listConnectorBatches,
  listConnectorConsents,
  listConnectorFeeds,
  recoverConnectorBatch,
  revokeConnectorConsent,
  saveConnectorConsent,
} from "../banking/connector";

import { defineHttpOperation } from "../capabilities/http-operation";

export const BankConnectorOperations = {
  getConnectorBatch: defineHttpOperation(
    Api.groups.bankConnector.endpoints.getConnectorBatch,
    (token, { params }) =>
      getConnectorBatch(token, { scope: scopeFromPath(params), batchId: params.id }),
  ),
  ingestConnectorBatch: defineHttpOperation(
    Api.groups.bankConnector.endpoints.ingestConnectorBatch,
    (token, { params, headers, payload }) =>
      ingestConnectorBatch(token, {
        scope: scopeFromPath(params),
        consentId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  revokeConnectorConsent: defineHttpOperation(
    Api.groups.bankConnector.endpoints.revokeConnectorConsent,
    (token, { params, headers, payload }) =>
      revokeConnectorConsent(token, {
        scope: scopeFromPath(params),
        consentId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getConnectorConsent: defineHttpOperation(
    Api.groups.bankConnector.endpoints.getConnectorConsent,
    (token, { params }) =>
      getConnectorConsent(token, { scope: scopeFromPath(params), consentId: params.id }),
  ),
  saveConnectorConsent: defineHttpOperation(
    Api.groups.bankConnector.endpoints.saveConnectorConsent,
    (token, { params, headers, payload }) =>
      saveConnectorConsent(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  recoverConnectorBatch: defineHttpOperation(
    Api.groups.bankConnector.endpoints.recoverConnectorBatch,
    (token, { params }) =>
      recoverConnectorBatch(token, { scope: scopeFromPath(params), key: params.key }),
  ),
  listConnectorBatches: defineHttpOperation(
    Api.groups.bankConnector.endpoints.listConnectorBatches,
    (token, { params, query: search }) =>
      listConnectorBatches(token, {
        scope: scopeFromPath(params),
        consentId: params.id,
        cursor: search.cursor,
      }),
  ),
  listConnectorConsents: defineHttpOperation(
    Api.groups.bankConnector.endpoints.listConnectorConsents,
    (token, { params, query: search }) =>
      listConnectorConsents(token, { scope: scopeFromPath(params), cursor: search.cursor }),
  ),
  listConnectorFeeds: defineHttpOperation(
    Api.groups.bankConnector.endpoints.listConnectorFeeds,
    (token, { params, query: search }) =>
      listConnectorFeeds(token, {
        scope: scopeFromPath(params),
        cursor: search.cursor,
        consentId: search.consentId,
      }),
  ),
};
