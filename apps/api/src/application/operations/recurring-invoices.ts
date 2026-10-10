import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as Scheduling from "../commerce/recurring-draft-scheduling";
import * as Recurring from "../commerce/recurring-invoices";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const RecurringInvoiceOperations = {
  getRecurringOccurrence: bindHttpOperation(
    Api.groups.recurringInvoices.endpoints.getRecurringOccurrence,
    capabilities.commerce_get_recurring_occurrence,
    ({ params }) => ({
      scope: scopeFromPath(params),
      agreementId: params.agreementId,
      cycleOrdinal: params.cycleOrdinal,
    }),
  ),
  listRecurringOccurrences: bindHttpOperation(
    Api.groups.recurringInvoices.endpoints.listRecurringOccurrences,
    capabilities.commerce_list_recurring_occurrences,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      agreementId: params.agreementId,
      ...query,
    }),
  ),
  getRecurringAgreement: bindHttpOperation(
    Api.groups.recurringInvoices.endpoints.getRecurringAgreement,
    capabilities.commerce_get_recurring_agreement,
    ({ params }) => ({
      scope: scopeFromPath(params),
      agreementId: params.agreementId,
    }),
  ),
  planRecurringOccurrences: bindHttpOperation(
    Api.groups.recurringInvoices.endpoints.planRecurringOccurrences,
    capabilities.commerce_plan_recurring_occurrences,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      agreementId: params.agreementId,
      throughOrdinal: query.throughOrdinal,
    }),
  ),
  materializeRecurringOccurrence: defineHttpOperation(
    Api.groups.recurringInvoices.endpoints.materializeRecurringOccurrence,
    (token, { params, headers, payload }) =>
      Recurring.materializeRecurringOccurrence(token, {
        scope: scopeFromPath(params),
        agreementId: params.agreementId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  recordRecurringAgreementEvent: defineHttpOperation(
    Api.groups.recurringInvoices.endpoints.recordRecurringAgreementEvent,
    (token, { params, headers, payload }) =>
      Recurring.recordRecurringAgreementEvent(token, {
        scope: scopeFromPath(params),
        agreementId: params.agreementId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  proposeRecurringTemplateRevision: defineHttpOperation(
    Api.groups.recurringInvoices.endpoints.proposeRecurringTemplateRevision,
    (token, { params, headers, payload }) =>
      Recurring.proposeRecurringTemplateRevision(token, {
        scope: scopeFromPath(params),
        agreementId: params.agreementId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  amendRecurringSchedule: defineHttpOperation(
    Api.groups.recurringInvoices.endpoints.amendRecurringSchedule,
    (token, { params, headers, payload }) =>
      Recurring.amendRecurringSchedule(token, {
        scope: scopeFromPath(params),
        agreementId: params.agreementId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  proposeRecurringAgreement: defineHttpOperation(
    Api.groups.recurringInvoices.endpoints.proposeRecurringAgreement,
    (token, { params, headers, payload }) =>
      Recurring.proposeRecurringAgreement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  catchUpRecurringDrafts: defineHttpOperation(
    Api.groups.recurringInvoices.endpoints.catchUpRecurringDrafts,
    (token, { params, headers, payload }) =>
      Scheduling.catchUpRecurringDrafts(token, {
        scope: scopeFromPath(params),
        agreementId: params.agreementId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  setRecurringDraftScheduling: defineHttpOperation(
    Api.groups.recurringInvoices.endpoints.setRecurringDraftScheduling,
    (token, { params, headers, payload }) =>
      Scheduling.setRecurringDraftScheduling(token, {
        scope: scopeFromPath(params),
        agreementId: params.agreementId,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  getRecurringDraftScheduling: bindHttpOperation(
    Api.groups.recurringInvoices.endpoints.getRecurringDraftScheduling,
    capabilities.commerce_get_recurring_draft_scheduling,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      agreementId: params.agreementId,
      ...query,
    }),
  ),
  listRecurringAgreements: bindHttpOperation(
    Api.groups.recurringInvoices.endpoints.listRecurringAgreements,
    capabilities.commerce_list_recurring_agreements,
    ({ params, query }) => ({ scope: scopeFromPath(params), ...query }),
  ),
};
