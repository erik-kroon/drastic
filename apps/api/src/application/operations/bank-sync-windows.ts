import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { appendSyncPage, claimSyncWindow, publishSyncGeneration } from "../banking/sync-windows";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const BankSyncWindowsOperations = {
  readSyncWindow: bindHttpOperation(
    Api.groups.bankSyncWindows.endpoints.readSyncWindow,
    capabilities.banking_read_sync_window,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  publishSyncGeneration: defineHttpOperation(
    Api.groups.bankSyncWindows.endpoints.publishSyncGeneration,
    (token, { params, headers, payload }) =>
      publishSyncGeneration(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  appendSyncPage: defineHttpOperation(
    Api.groups.bankSyncWindows.endpoints.appendSyncPage,
    (token, { params, headers, payload }) =>
      appendSyncPage(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  claimSyncWindow: defineHttpOperation(
    Api.groups.bankSyncWindows.endpoints.claimSyncWindow,
    (token, { params, headers, payload }) =>
      claimSyncWindow(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
