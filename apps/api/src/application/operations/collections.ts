import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import * as Commerce from "../commerce/collections";
import * as Reminders from "../commerce/reminders";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const CollectionsOperations = {
  collectionHistoryPage: bindHttpOperation(
    Api.groups.collections.endpoints.collectionHistoryPage,
    capabilities.collections_history,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      customerId: params.id,
      after: search.after ?? "",
    }),
  ),
  collectionHistory: defineHttpOperation(
    Api.groups.collections.endpoints.collectionHistory,
    (token, { params }) =>
      Commerce.readHistory(token, { scope: scopeFromPath(params), id: params.id }),
  ),
  recordCollectionAction: defineHttpOperation(
    Api.groups.collections.endpoints.recordCollectionAction,
    (token, { params, headers, payload }) =>
      Commerce.recordAction(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  openCollectionDispute: defineHttpOperation(
    Api.groups.collections.endpoints.openCollectionDispute,
    (token, { params, headers, payload }) =>
      Commerce.openDispute(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  captureCollectionStatement: defineHttpOperation(
    Api.groups.collections.endpoints.captureCollectionStatement,
    (token, { params, headers, payload }) =>
      Commerce.captureStatement(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  collectionStatementExport: bindHttpOperation(
    Api.groups.collections.endpoints.collectionStatementExport,
    capabilities.collections_statement_export,
    ({ params }) => ({ scope: scopeFromPath(params), statementId: params.id }),
  ),
  collectionWorklist: bindHttpOperation(
    Api.groups.collections.endpoints.collectionWorklist,
    capabilities.collections_worklist,
    ({ params, query: search }) => ({ scope: scopeFromPath(params), page: search.page ?? "1" }),
  ),
  reconcileReminder: defineHttpOperation(
    Api.groups.collections.endpoints.reconcileReminder,
    (token, { params, payload }) =>
      Reminders.reconcileReminder(token, {
        scope: scopeFromPath(params),
        id: params.id,
        input: payload,
      }),
  ),
  cancelReminder: defineHttpOperation(
    Api.groups.collections.endpoints.cancelReminder,
    (token, { params, headers, payload }) =>
      Reminders.cancelReminder(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  requestReminderDispatch: defineHttpOperation(
    Api.groups.collections.endpoints.requestReminderDispatch,
    (token, { params, payload }) =>
      Reminders.requestReminderDispatch(token, {
        scope: scopeFromPath(params),
        id: params.id,
        input: payload,
      }),
  ),
  approveReminder: defineHttpOperation(
    Api.groups.collections.endpoints.approveReminder,
    (token, { params, payload }) =>
      Reminders.approveReminder(token, {
        scope: scopeFromPath(params),
        id: params.id,
        input: payload,
      }),
  ),
  readReminder: bindHttpOperation(
    Api.groups.collections.endpoints.readReminder,
    capabilities.collections_read_reminder,
    ({ params }) => ({ scope: scopeFromPath(params), reminderId: params.id }),
  ),
  prepareReminder: bindHttpOperation(
    Api.groups.collections.endpoints.prepareReminder,
    capabilities.collections_prepare_reminder,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      issueId: payload.issueId,
      recipient: payload.recipient,
    }),
  ),
  replaceReminder: defineHttpOperation(
    Api.groups.collections.endpoints.replaceReminder,
    (token, { params, headers, payload }) =>
      Reminders.replaceReminder(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  checkReminder: defineHttpOperation(
    Api.groups.collections.endpoints.checkReminder,
    (token, { params, headers, payload }) =>
      Reminders.checkReminder(token, {
        scope: scopeFromPath(params),
        id: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  reminderHistory: defineHttpOperation(
    Api.groups.collections.endpoints.reminderHistory,
    (token, { params, query }) =>
      Reminders.listReminders(token, {
        scope: scopeFromPath(params),
        invoiceId: query.invoiceId,
        after: query.after ?? "",
      }),
  ),
};
