import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import {
  prepareFilingIntent,
  authorizeFiling,
  uploadFiling,
  certifyFiling,
  collectFiling,
  retainFilingObservation,
} from "../documents/filing";
import { captureFilingAdoption, reviewFilingAdoption } from "../documents/adoption";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const FilingLifecycleOperations = {
  filingHistory: bindHttpOperation(
    Api.groups.filingLifecycle.endpoints.filingHistory,
    capabilities.filings_submission_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getFiling: bindHttpOperation(
    Api.groups.filingLifecycle.endpoints.getFiling,
    capabilities.filings_get_submission,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  collectFiling: defineHttpOperation(
    Api.groups.filingLifecycle.endpoints.collectFiling,
    (token, { params, headers, payload }) =>
      collectFiling(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  certifyFiling: defineHttpOperation(
    Api.groups.filingLifecycle.endpoints.certifyFiling,
    (token, { params, headers, payload }) =>
      certifyFiling(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  uploadFiling: defineHttpOperation(
    Api.groups.filingLifecycle.endpoints.uploadFiling,
    (token, { params, headers, payload }) =>
      uploadFiling(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  authorizeFiling: defineHttpOperation(
    Api.groups.filingLifecycle.endpoints.authorizeFiling,
    (token, { params, headers, payload }) =>
      authorizeFiling(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareFilingIntent: defineHttpOperation(
    Api.groups.filingLifecycle.endpoints.prepareFilingIntent,
    (token, { params, headers, payload }) =>
      prepareFilingIntent(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  retainFilingObservation: defineHttpOperation(
    Api.groups.filingLifecycle.endpoints.retainFilingObservation,
    (token, { params, headers, payload }) =>
      retainFilingObservation(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  reviewFilingAdoption: defineHttpOperation(
    Api.groups.filingLifecycle.endpoints.reviewFilingAdoption,
    (token, { params, headers, payload }) =>
      reviewFilingAdoption(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  captureFilingAdoption: defineHttpOperation(
    Api.groups.filingLifecycle.endpoints.captureFilingAdoption,
    (token, { params, headers, payload }) =>
      captureFilingAdoption(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
