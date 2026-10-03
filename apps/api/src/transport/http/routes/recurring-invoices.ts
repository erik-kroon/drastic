import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import * as Scheduling from "../../../application/commerce/recurring-draft-scheduling";
import * as Recurring from "../../../application/commerce/recurring-invoices";

export const RecurringInvoiceHandlers = HttpApiBuilder.group(Api, "recurringInvoices", (handlers) =>
  handlers
    .handle("listRecurringAgreements", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Scheduling.listRecurringAgreements(token, { scope: scopeFromPath(params), ...query }),
      ),
    )
    .handle("getRecurringDraftScheduling", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Scheduling.getRecurringDraftScheduling(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          ...query,
        }),
      ),
    )
    .handle("setRecurringDraftScheduling", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Scheduling.setRecurringDraftScheduling(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("catchUpRecurringDrafts", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Scheduling.catchUpRecurringDrafts(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("proposeRecurringAgreement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.proposeRecurringAgreement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("amendRecurringSchedule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.amendRecurringSchedule(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("proposeRecurringTemplateRevision", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.proposeRecurringTemplateRevision(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("recordRecurringAgreementEvent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.recordRecurringAgreementEvent(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("materializeRecurringOccurrence", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Recurring.materializeRecurringOccurrence(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("planRecurringOccurrences", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_plan_recurring_occurrences.execute(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          throughOrdinal: query.throughOrdinal,
        }),
      ),
    )
    .handle("getRecurringAgreement", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_recurring_agreement.execute(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
        }),
      ),
    )
    .handle("listRecurringOccurrences", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_list_recurring_occurrences.execute(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          ...query,
        }),
      ),
    )
    .handle("getRecurringOccurrence", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.commerce_get_recurring_occurrence.execute(token, {
          scope: scopeFromPath(params),
          agreementId: params.agreementId,
          cycleOrdinal: params.cycleOrdinal,
        }),
      ),
    ),
);
