import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Tax from "../vat/tax-account";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const TaxAccountOperations = {
  listTaxAccountControls: bindHttpOperation(
    Api.groups.taxAccount.endpoints.listTaxAccountControls,
    capabilities.tax_account_list_controls,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getTaxAccountControl: bindHttpOperation(
    Api.groups.taxAccount.endpoints.getTaxAccountControl,
    capabilities.tax_account_get_control,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  createTaxAccountControl: bindHttpOperation(
    Api.groups.taxAccount.endpoints.createTaxAccountControl,
    capabilities.tax_account_create_control,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listTaxAccountStatements: bindHttpOperation(
    Api.groups.taxAccount.endpoints.listTaxAccountStatements,
    capabilities.tax_account_list_statements,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getTaxAccountStatement: bindHttpOperation(
    Api.groups.taxAccount.endpoints.getTaxAccountStatement,
    capabilities.tax_account_get_statement,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  recordTaxAccountStatement: defineHttpOperation(
    Api.groups.taxAccount.endpoints.recordTaxAccountStatement,
    (token, { params, headers, payload }) =>
      Tax.recordStatement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listTaxAccountMatches: bindHttpOperation(
    Api.groups.taxAccount.endpoints.listTaxAccountMatches,
    capabilities.tax_account_list_matches,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getTaxAccountMatch: bindHttpOperation(
    Api.groups.taxAccount.endpoints.getTaxAccountMatch,
    capabilities.tax_account_get_match,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
  unmatchTaxAccountEvent: defineHttpOperation(
    Api.groups.taxAccount.endpoints.unmatchTaxAccountEvent,
    (token, { params, headers, payload }) =>
      Tax.unmatchEvent(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        id: params.id,
        input: payload,
      }),
  ),
  matchTaxAccountEvent: defineHttpOperation(
    Api.groups.taxAccount.endpoints.matchTaxAccountEvent,
    (token, { params, headers, payload }) =>
      Tax.matchEvent(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  previewTaxAccountMatch: bindHttpOperation(
    Api.groups.taxAccount.endpoints.previewTaxAccountMatch,
    capabilities.tax_account_preview_match,
    ({ params, payload }) => ({ scope: scopeFromPath(params), input: payload }),
  ),
  getTaxAccountEventClassification: bindHttpOperation(
    Api.groups.taxAccount.endpoints.getTaxAccountEventClassification,
    capabilities.tax_account_get_event_classification,
    ({ params }) => ({ scope: scopeFromPath(params), eventId: params.id }),
  ),
  resolveTaxAccountEventClassification: defineHttpOperation(
    Api.groups.taxAccount.endpoints.resolveTaxAccountEventClassification,
    (token, { params, headers, payload }) =>
      Tax.resolveEventClassification(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  listUnclassifiedTaxAccountEvents: bindHttpOperation(
    Api.groups.taxAccount.endpoints.listUnclassifiedTaxAccountEvents,
    capabilities.tax_account_list_unclassified_events,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      accountId: search.accountId,
      after: search.after,
    }),
  ),
};
