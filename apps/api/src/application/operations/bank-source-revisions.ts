import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { admitProviderObservation, applyProviderRevision } from "../banking/source-revisions";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const BankSourceRevisionsOperations = {
  readProviderObservation: bindHttpOperation(
    Api.groups.bankSourceRevisions.endpoints.readProviderObservation,
    capabilities.banking_read_provider_observation,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  admitProviderObservation: defineHttpOperation(
    Api.groups.bankSourceRevisions.endpoints.admitProviderObservation,
    (token, { params, headers, payload }) =>
      admitProviderObservation(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  applyProviderRevision: defineHttpOperation(
    Api.groups.bankSourceRevisions.endpoints.applyProviderRevision,
    (token, { params, headers, payload }) =>
      applyProviderRevision(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
