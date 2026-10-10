import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as Commerce from "../commerce/legal";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const ArLegalIssueOperations = {
  arLegalIssueHistory: bindHttpOperation(
    Api.groups.arLegalIssue.endpoints.arLegalIssueHistory,
    capabilities.commerce_ar_legal_issue_history,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  getArLegalIssue: bindHttpOperation(
    Api.groups.arLegalIssue.endpoints.getArLegalIssue,
    capabilities.commerce_get_ar_legal_issue,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  getArLegalIssueReview: bindHttpOperation(
    Api.groups.arLegalIssue.endpoints.getArLegalIssueReview,
    capabilities.commerce_get_ar_legal_issue_review,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  executeArLegalIssue: defineHttpOperation(
    Api.groups.arLegalIssue.endpoints.executeArLegalIssue,
    (token, { params, headers, payload }) =>
      Commerce.executeArLegalIssue(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveArLegalIssue: defineHttpOperation(
    Api.groups.arLegalIssue.endpoints.approveArLegalIssue,
    (token, { params, headers, payload }) =>
      Commerce.approveArLegalIssue(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareArLegalIssue: defineHttpOperation(
    Api.groups.arLegalIssue.endpoints.prepareArLegalIssue,
    (token, { params, headers, payload }) =>
      Commerce.prepareArLegalIssue(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getArLegalAccountingProfile: bindHttpOperation(
    Api.groups.arLegalIssue.endpoints.getArLegalAccountingProfile,
    capabilities.commerce_get_ar_legal_accounting_profile,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  activateArLegalAccountingProfile: defineHttpOperation(
    Api.groups.arLegalIssue.endpoints.activateArLegalAccountingProfile,
    (token, { params, headers, payload }) =>
      Commerce.activateArLegalAccountingProfile(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
