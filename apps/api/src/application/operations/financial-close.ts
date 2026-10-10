import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { approveYearReopen, executeYearReopen } from "../closing/financial-reopen";
import {
  advanceYearClose,
  approveFinalProposal,
  executeFinalClose,
  prepareYearClose,
  prepareYearReopen,
} from "../closing/financial-close";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const FinancialCloseOperations = {
  financialCloseHistory: bindHttpOperation(
    Api.groups.financialClose.endpoints.financialCloseHistory,
    capabilities.closing_financial_close_history,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getFinancialOpeningSet: bindHttpOperation(
    Api.groups.financialClose.endpoints.getFinancialOpeningSet,
    capabilities.closing_get_financial_opening_set,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getFinancialCloseCertificate: bindHttpOperation(
    Api.groups.financialClose.endpoints.getFinancialCloseCertificate,
    capabilities.closing_get_financial_close_certificate,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  getFinancialYearStatus: bindHttpOperation(
    Api.groups.financialClose.endpoints.getFinancialYearStatus,
    capabilities.closing_get_financial_year_status,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  prepareYearReopen: defineHttpOperation(
    Api.groups.financialClose.endpoints.prepareYearReopen,
    (token, { params, headers, payload }) =>
      prepareYearReopen(token, {
        scope: scopeFromPath(params),
        fiscalYearId: params.fiscalYearId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeFinalClose: defineHttpOperation(
    Api.groups.financialClose.endpoints.executeFinalClose,
    (token, { params, headers, payload }) =>
      executeFinalClose(token, {
        scope: scopeFromPath(params),
        proposalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveFinalProposal: defineHttpOperation(
    Api.groups.financialClose.endpoints.approveFinalProposal,
    (token, { params, headers, payload }) =>
      approveFinalProposal(token, {
        scope: scopeFromPath(params),
        proposalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  advanceYearClose: defineHttpOperation(
    Api.groups.financialClose.endpoints.advanceYearClose,
    (token, { params, headers, payload }) =>
      advanceYearClose(token, {
        scope: scopeFromPath(params),
        preparationId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  prepareYearClose: defineHttpOperation(
    Api.groups.financialClose.endpoints.prepareYearClose,
    (token, { params, headers, payload }) =>
      prepareYearClose(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  executeYearReopen: defineHttpOperation(
    Api.groups.financialClose.endpoints.executeYearReopen,
    (token, { params, headers, payload }) =>
      executeYearReopen(token, {
        scope: scopeFromPath(params),
        proposalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  approveYearReopen: defineHttpOperation(
    Api.groups.financialClose.endpoints.approveYearReopen,
    (token, { params, headers, payload }) =>
      approveYearReopen(token, {
        scope: scopeFromPath(params),
        proposalId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
