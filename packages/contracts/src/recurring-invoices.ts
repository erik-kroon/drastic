import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  AgreementEventKind,
  CycleOrdinal,
  CyclePlan,
  RecurrenceCadence,
  ServiceInterval,
  TimeZone,
} from "@open-erp/domain/recurrence";
import * as Accounting from "./accounting";
import * as Commerce from "./commerce";
import * as Drafts from "./invoice-drafts";
import { accountingErrors } from "./accounting-errors";

export {
  AgreementEventKind,
  AgreementEventBoundary,
  BilledCoverage,
  CadenceKind,
  CycleIdentity,
  CycleOrdinal,
  CyclePlan,
  MonthAnchorPolicy,
  RecurrenceCadence,
  RecurrenceFailure,
  RecurrenceFailureCode,
  RecurrenceSchedule,
  ServiceInterval,
  SkippedCycleReason,
  TimeZone,
} from "@open-erp/domain/recurrence";

// A recurring occurrence is identified by its agreement and cycle ordinal alone.
// The selected template revision travels with the occurrence as the frozen fact
// it was drafted from and is deliberately absent from this identity, so amending
// a template cannot re-identify an already issued cycle.
export const OccurrenceReference = Schema.Struct({
  agreementId: Accounting.Identifier,
  cycleOrdinal: CycleOrdinal,
});

export type OccurrenceReference = typeof OccurrenceReference.Type;

const ChargeComponentKey = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{2,63}$/),
  Schema.isMaxLength(64),
);

const Title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const PaymentTerms = Schema.String.check(Schema.isMaxLength(1000));

const DayOffset = Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]{0,4})$/));

// The reviewed cadence of an agreement. `timeZone` names the reviewed local
// calendar the cycle dates are expressed in; this owner never derives a due
// instant from it.
export const RecurringScheduleInput = Schema.Struct({
  anchorLocalDate: Accounting.AccountingDate,
  timeZone: TimeZone,
  cadence: RecurrenceCadence,
  firstCycleOrdinal: CycleOrdinal,
});

export type RecurringScheduleInput = typeof RecurringScheduleInput.Type;

export const ProposeRecurringAgreement = Schema.Struct({
  customerId: Accounting.Identifier,
  title: Title,
  schedule: RecurringScheduleInput,
  reason: Accounting.Description,
});

export type ProposeRecurringAgreement = typeof ProposeRecurringAgreement.Type;

export const RecurringAgreement = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  revision: Commerce.Version,
  customerId: Accounting.Identifier,
  title: Title,
  schedule: RecurringScheduleInput,
  reason: Accounting.Description,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export type RecurringAgreement = typeof RecurringAgreement.Type;

// A template revision is a reviewed customer-invoice draft body plus the first
// cycle it governs. It carries no tax rate: every amount, tax description and
// tax evidence reference is a reviewed input of the author.
// A reviewed day offset from the cycle date. Whole local calendar days only. An
// absent offset leaves the draft's issue date unresolved, which the invoice draft
// owner reports as a blocker rather than this owner guessing a term.
export const RecurringDateOffsets = Schema.Struct({
  issueDays: DayOffset,
  supplyDays: DayOffset,
  dueDays: DayOffset,
});

export const RecurringTemplateInput = Schema.Struct({
  title: Title,
  counterpartyId: Accounting.Identifier,
  seller: Drafts.DraftIdentity,
  customer: Drafts.DraftIdentity,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  currencyScale: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  paymentTerms: Schema.NullOr(PaymentTerms),
  dateOffsets: Schema.NullOr(RecurringDateOffsets),
  sourceTotalMinor: Schema.NullOr(Accounting.MinorUnits),
  lines: Schema.Array(Drafts.DraftLine).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});

export type RecurringTemplateInput = typeof RecurringTemplateInput.Type;

export const ProposeRecurringTemplateRevision = Schema.Struct({
  expectedAgreementRevision: Commerce.Version,
  expectedAgreementDigest: Accounting.Digest,
  effectiveFromCycle: CycleOrdinal,
  chargeComponentKeys: Schema.Array(ChargeComponentKey).check(Schema.isMaxLength(50)),
  template: RecurringTemplateInput,
  reason: Accounting.Description,
});

export type ProposeRecurringTemplateRevision = typeof ProposeRecurringTemplateRevision.Type;

export const RecurringTemplateRevision = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  agreementId: Accounting.Identifier,
  agreementDigest: Accounting.Digest,
  revision: Commerce.Version,
  effectiveFromCycle: CycleOrdinal,
  chargeComponentKeys: Schema.Array(ChargeComponentKey),
  template: RecurringTemplateInput,
  reason: Accounting.Description,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export type RecurringTemplateRevision = typeof RecurringTemplateRevision.Type;

export const RecordRecurringAgreementEvent = Schema.Struct({
  expectedAgreementRevision: Commerce.Version,
  expectedAgreementDigest: Accounting.Digest,
  kind: AgreementEventKind,
  effectiveCycle: CycleOrdinal,
  reason: Accounting.Description,
});

export type RecordRecurringAgreementEvent = typeof RecordRecurringAgreementEvent.Type;

export const RecurringAgreementEvent = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  agreementId: Accounting.Identifier,
  agreementDigest: Accounting.Digest,
  ordinal: Schema.Int,
  kind: AgreementEventKind,
  effectiveCycle: CycleOrdinal,
  reason: Accounting.Description,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export type RecurringAgreementEvent = typeof RecurringAgreementEvent.Type;

export const OccurrenceStatus = Schema.Literals(["drafted"]);

export type OccurrenceStatus = typeof OccurrenceStatus.Type;

export const RecurringOccurrence = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  agreementId: Accounting.Identifier,
  cycleOrdinal: CycleOrdinal,
  cycleDate: Accounting.AccountingDate,
  serviceInterval: ServiceInterval,
  chargeComponentKeys: Schema.Array(ChargeComponentKey),
  selectedTemplateRevision: Commerce.Version,
  selectedTemplateDigest: Accounting.Digest,
  status: OccurrenceStatus,
  draftId: Accounting.Identifier,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export type RecurringOccurrence = typeof RecurringOccurrence.Type;

// The append-only consumption of one occurrence's billing coverage. The invoice
// issue owner writes it in the same financial transaction that issues the
// invoice, so a second issue of the same occurrence cannot commit.
export const RecurringOccurrenceIssue = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  occurrenceId: Accounting.Identifier,
  occurrenceDigest: Accounting.Digest,
  agreementId: Accounting.Identifier,
  cycleOrdinal: CycleOrdinal,
  serviceInterval: ServiceInterval,
  draftId: Accounting.Identifier,
  invoiceIssueId: Accounting.Identifier,
  registerInvoiceId: Accounting.Identifier,
  documentNumber: Schema.String,
  createdAt: Schema.String,
  receipt: Commerce.CommandReceipt,
  digest: Accounting.Digest,
});

export type RecurringOccurrenceIssue = typeof RecurringOccurrenceIssue.Type;

export const MaterializeRecurringOccurrence = Schema.Struct({
  cycleOrdinal: CycleOrdinal,
  reason: Accounting.Description,
});

export type MaterializeRecurringOccurrence = typeof MaterializeRecurringOccurrence.Type;

export const RecurringCyclePlanQuery = Schema.Struct({ throughOrdinal: CycleOrdinal });

export const RecurringOccurrenceQuery = Schema.Struct({ after: Schema.optional(CycleOrdinal) });

export const RecurringCoverage = Schema.Struct({
  cycleOrdinal: CycleOrdinal,
  serviceInterval: ServiceInterval,
});

const occurrenceSummary = Schema.Struct({
  cycleOrdinal: CycleOrdinal,
  cycleDate: Accounting.AccountingDate,
  serviceInterval: ServiceInterval,
  selectedTemplateRevision: Commerce.Version,
  status: OccurrenceStatus,
  occurrenceId: Accounting.Identifier,
  draftId: Accounting.Identifier,
  issued: Schema.Boolean,
  documentNumber: Schema.NullOr(Schema.String),
});

export const RecurringOccurrenceList = Schema.Struct({
  scope: Accounting.Scope,
  agreementId: Accounting.Identifier,
  complete: Schema.Literal(true),
  count: Schema.Int,
  continuation: Schema.NullOr(CycleOrdinal),
  items: Schema.Array(occurrenceSummary).check(Schema.isMaxLength(200)),
});

export type RecurringOccurrenceList = typeof RecurringOccurrenceList.Type;

export const RecurringAgreementView = Schema.Struct({
  agreement: RecurringAgreement,
  revisions: Schema.Array(
    Schema.Struct({
      revision: Commerce.Version,
      effectiveFromCycle: CycleOrdinal,
      chargeComponentKeys: Schema.Array(ChargeComponentKey),
      digest: Accounting.Digest,
      createdAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(50)),
  events: Schema.Array(
    Schema.Struct({
      ordinal: Schema.Int,
      kind: AgreementEventKind,
      effectiveCycle: CycleOrdinal,
      digest: Accounting.Digest,
      createdAt: Schema.String,
    }),
  ).check(Schema.isMaxLength(200)),
});

export type RecurringAgreementView = typeof RecurringAgreementView.Type;

// The occurrence, its billing coverage consumption and nothing else. The draft
// itself stays with the invoice draft owner, which remains its single authority.
export const RecurringOccurrenceView = Schema.Struct({
  occurrence: RecurringOccurrence,
  issue: Schema.NullOr(RecurringOccurrenceIssue),
});

export type RecurringOccurrenceView = typeof RecurringOccurrenceView.Type;

export const RecurringCyclePlan = Schema.Struct({
  agreement: RecurringAgreement,
  plan: CyclePlan,
  billedCoverage: Schema.Array(RecurringCoverage).check(Schema.isMaxLength(2000)),
});

export type RecurringCyclePlan = typeof RecurringCyclePlan.Type;

const agreementPath = Schema.Struct({
  entityId: Accounting.Identifier,
  bookId: Accounting.Identifier,
  agreementId: Accounting.Identifier,
});

const agreementOccurrencePath = Schema.Struct({
  entityId: Accounting.Identifier,
  bookId: Accounting.Identifier,
  agreementId: Accounting.Identifier,
  cycleOrdinal: CycleOrdinal,
});

const path = "/v1/entities/:entityId/books/:bookId/commerce/recurring-invoices";

const write = {
  params: agreementPath,
  headers: Accounting.IdempotencyHeaders,
  error: accountingErrors,
};

const read = { params: agreementPath, error: accountingErrors };

export const RecurringInvoicesApi = HttpApiGroup.make("recurringInvoices").add(
  HttpApiEndpoint.post("proposeRecurringAgreement", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    error: accountingErrors,
    payload: ProposeRecurringAgreement.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RecurringAgreement,
  }),
  HttpApiEndpoint.post(
    "proposeRecurringTemplateRevision",
    `${path}/:agreementId/template-revisions`,
    {
      ...write,
      payload: ProposeRecurringTemplateRevision.annotate({
        parseOptions: { onExcessProperty: "error" },
      }),
      success: RecurringTemplateRevision,
    },
  ),
  HttpApiEndpoint.post("recordRecurringAgreementEvent", `${path}/:agreementId/events`, {
    ...write,
    payload: RecordRecurringAgreementEvent.annotate({
      parseOptions: { onExcessProperty: "error" },
    }),
    success: RecurringAgreementEvent,
  }),
  HttpApiEndpoint.post("materializeRecurringOccurrence", `${path}/:agreementId/occurrences`, {
    ...write,
    payload: MaterializeRecurringOccurrence.annotate({
      parseOptions: { onExcessProperty: "error" },
    }),
    success: RecurringOccurrence,
  }),
  HttpApiEndpoint.get("planRecurringOccurrences", `${path}/:agreementId/plan`, {
    params: agreementPath,
    query: RecurringCyclePlanQuery,
    error: accountingErrors,
    success: RecurringCyclePlan,
  }),
  HttpApiEndpoint.get("getRecurringAgreement", `${path}/:agreementId`, {
    ...read,
    success: RecurringAgreementView,
  }),
  HttpApiEndpoint.get("listRecurringOccurrences", `${path}/:agreementId/occurrences`, {
    ...read,
    query: RecurringOccurrenceQuery,
    success: RecurringOccurrenceList,
  }),
  HttpApiEndpoint.get("getRecurringOccurrence", `${path}/:agreementId/occurrences/:cycleOrdinal`, {
    params: agreementOccurrencePath,
    error: accountingErrors,
    success: RecurringOccurrenceView,
  }),
);

// Agreement events and template revisions change future billing, and a
// materialized occurrence is a commercial draft. Ordinary MCP exposes the reads
// only; the mutations stay behind operator HTTP authority.
export const RecurringInvoiceCapabilities = {
  commerce_get_recurring_agreement: {
    description:
      "Read one recurring invoice agreement with its immutable template revision boundaries and its pause, resume and end events. Cycle identity is the anchor and cycle ordinal, never a template revision.",
    input: Schema.Struct({ scope: Accounting.Scope, agreementId: Accounting.Identifier }),
    output: RecurringAgreementView,
    readOnly: true,
  },
  commerce_plan_recurring_occurrences: {
    description:
      "Compute the due, skipped and already materialised cycles of one recurring agreement up to an ordinal, with the service coverage already billed. Reads only; it creates no draft and issues nothing.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      agreementId: Accounting.Identifier,
      throughOrdinal: CycleOrdinal,
    }),
    output: RecurringCyclePlan,
    readOnly: true,
  },
  commerce_list_recurring_occurrences: {
    description:
      "Read the bounded materialised occurrence history of one recurring agreement with per-cycle issued status. Coverage, draft and document number are reported independently.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      agreementId: Accounting.Identifier,
      ...RecurringOccurrenceQuery.fields,
    }),
    output: RecurringOccurrenceList,
    readOnly: true,
  },
  commerce_get_recurring_occurrence: {
    description:
      "Read one materialised occurrence of a recurring agreement with its billing coverage consumption. Read the customer draft through the invoice draft owner; this is not legal issuance or delivery authority.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      agreementId: Accounting.Identifier,
      cycleOrdinal: CycleOrdinal,
    }),
    output: RecurringOccurrenceView,
    readOnly: true,
  },
};
