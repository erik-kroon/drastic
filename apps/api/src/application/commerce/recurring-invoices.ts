import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import * as Recurrence from "@open-erp/domain/recurrence";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { digest } from "../json";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";
import { createInvoiceDraftInTransaction } from "./invoice-lifecycle";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import * as RecurrenceDb from "../../db/commerce/recurring-invoices";
import {
  commandReceipt,
  decode,
  exactKeys,
  objectField,
  requireInsertAccess,
  requireTableAccess,
  textField,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./support";
import type { Transaction } from "../../db/transaction";

type Agreement = typeof Recurring.RecurringAgreement.Type;

type AgreementRow = {
  readonly agreement: Agreement;
  readonly digest: string;
};

const AgreementSchema = Recurring.RecurringAgreement;

const TemplateSchema = Recurring.RecurringTemplateRevision;

const EventSchema = Recurring.RecurringAgreementEvent;

const OccurrenceSchema = Recurring.RecurringOccurrence;

const AgreementViewSchema = Recurring.RecurringAgreementView;

const PlanSchema = Recurring.RecurringCyclePlan;

const OccurrenceListSchema = Recurring.RecurringOccurrenceList;

const OccurrenceViewSchema = Recurring.RecurringOccurrenceView;

const DraftContentSchema = Drafts.DraftContent;

const proposeFields = ["customerId", "reason", "schedule", "title"] as const;

const templateFields = [
  "chargeComponentKeys",
  "effectiveFromCycle",
  "expectedAgreementDigest",
  "expectedAgreementRevision",
  "reason",
  "template",
] as const;

const eventFields = [
  "effectiveCycle",
  "expectedAgreementDigest",
  "expectedAgreementRevision",
  "kind",
  "reason",
] as const;

const materializeFields = ["cycleOrdinal", "reason"] as const;

const maximumEvents = 200;

const pageBound = 200;

// The occurrence's identity is the agreement and cycle ordinal. The invoice
// draft key is derived from that pair alone, so amending a template can never
// mint a second draft for a cycle that is already issued.
function occurrenceDraftKey(agreementId: string, cycleOrdinal: string) {
  return `recurring-${cycleOrdinal}-${agreementId}`.slice(0, 128);
}

function requireRecurrenceAccess(transaction: Transaction, write: boolean) {
  return requireTableAccess(transaction, RecurrenceDb.recurringAgreementTables, false).pipe(
    Effect.flatMap(() =>
      write
        ? requireInsertAccess(transaction, RecurrenceDb.recurringAgreementWriteTables)
        : Effect.void,
    ),
  );
}

// A pure cycle refusal becomes the designed UnsupportedProfile refusal of this
// book profile rather than a posted error, so no partial write is left behind.
function refuseCycle(_result: Recurrence.Checked<unknown>) {
  return unsupported();
}

function scheduleOf(schedule: typeof Recurring.RecurringScheduleInput.Type) {
  return {
    anchorLocalDate: schedule.anchorLocalDate,
    timeZone: schedule.timeZone,
    cadence: schedule.cadence,
    firstCycleOrdinal: schedule.firstCycleOrdinal,
  };
}

function readAgreementRow(transaction: Transaction, bookId: string, agreementId: string) {
  return Effect.gen(function* () {
    const row = (yield* RecurrenceDb.readAgreement(transaction, bookId, agreementId))[0];

    if (!row) return yield* failure("NotFound");

    const digestValue = textField(row.body, "digest");

    if (digestValue === undefined) return yield* failure("InternalError");

    return {
      agreement: yield* decode(AgreementSchema, row.body),
      digest: digestValue,
    } satisfies AgreementRow;
  });
}

function boundariesOf(rows: ReadonlyArray<RecurrenceDb.RevisionBoundaryRow>) {
  return rows.map((row) => ({
    revision: row.revision,
    effectiveFromCycle: row.effectiveFromCycle,
  }));
}

type AgreementEventKind = "pause" | "resume" | "end";

function eventKind(kind: string): AgreementEventKind | null {
  return kind === "pause" || kind === "resume" || kind === "end" ? kind : null;
}

function eventsOf(rows: ReadonlyArray<RecurrenceDb.EventRow>) {
  return rows.flatMap((row) => {
    const kind = eventKind(row.kind);

    return kind === null ? [] : [{ kind, effectiveCycle: row.effectiveCycle }];
  });
}

function coverageOf(rows: ReadonlyArray<RecurrenceDb.CoverageRow>) {
  return rows.map((row) => ({
    cycleOrdinal: row.cycleOrdinal,
    serviceInterval: { serviceStartsOn: row.serviceStartsOn, serviceEndsOn: row.serviceEndsOn },
  }));
}

function readCyclePlan(
  transaction: Transaction,
  bookId: string,
  agreement: Agreement,
  throughOrdinal: string,
) {
  return Effect.gen(function* () {
    const revisions = yield* RecurrenceDb.readTemplateRevisions(transaction, bookId, agreement.id);
    const events = yield* RecurrenceDb.readEvents(transaction, bookId, agreement.id);
    const billed = yield* RecurrenceDb.readBilledCoverage(transaction, bookId, agreement.id);

    const materialised =
      (yield* RecurrenceDb.readMaterialisedThrough(transaction, bookId, agreement.id))[0]
        ?.cycleOrdinal ?? "-1";

    const plan = Recurrence.planDueCycles({
      schedule: scheduleOf(agreement.schedule),
      events: eventsOf(events),
      revisions: boundariesOf(revisions),
      billedCoverage: coverageOf(billed),
      throughOrdinal,
      materialisedThroughOrdinal: materialised === "-1" ? null : materialised,
    });

    if (Result.isFailure(plan)) return yield* refuseCycle(plan);

    return { plan: plan.success, billed, revisions, events };
  });
}

export const proposeRecurringAgreement = Effect.fn("commerce.recurring.proposeAgreement")(
  function* (
    token: string,
    command: {
      scope: Scope;
      idempotencyKey: string;
      input: typeof Recurring.ProposeRecurringAgreement.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (transaction, principal) {
        const operation = "propose_recurring_agreement";

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          yield* toJsonObject(command.input),
          AgreementSchema,
        );

        if (request.previous) return request.previous;
        yield* requireRecurrenceAccess(transaction, true);
        yield* exactKeys(yield* toJsonObject(command.input), proposeFields);

        const input = yield* decode(Recurring.ProposeRecurringAgreement, command.input);

        const firstCycle = Recurrence.cycleDate(
          scheduleOf(input.schedule),
          input.schedule.firstCycleOrdinal,
        );

        if (Result.isFailure(firstCycle)) return yield* refuseCycle(firstCycle);

        const counterparty = (yield* DraftDb.readCustomerCounterparty(
          transaction,
          command.scope.bookId,
          input.customerId,
        ))[0];

        if (!counterparty || (counterparty.role !== "customer" && counterparty.role !== "both")) {
          return yield* failure("InvalidJournal");
        }

        const id = newId("recurring_agreement");
        const createdAt = yield* isoNow(transaction);

        const withoutDigest: JsonObject = {
          id,
          scope: command.scope,
          revision: "1",
          customerId: input.customerId,
          title: input.title,
          schedule: yield* toJsonObject(input.schedule),
          reason: input.reason,
          createdAt,
          receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
        };

        const body = yield* toJsonObject(
          Object.assign({}, withoutDigest, { digest: yield* digest(withoutDigest) }),
        );

        const result = yield* decode(AgreementSchema, body);
        const agreementDigest = textField(body, "digest");

        if (agreementDigest === undefined) return yield* failure("InternalError");

        yield* RecurrenceDb.insertAgreement(transaction, {
          bookId: command.scope.bookId,
          id,
          customerId: input.customerId,
          body,
          digest: agreementDigest,
          createdAt,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          body,
        );

        return result;
      },
      "update",
    );
  },
);

export const proposeRecurringTemplateRevision = Effect.fn(
  "commerce.recurring.proposeTemplateRevision",
)(function* (
  token: string,
  command: {
    scope: Scope;
    agreementId: string;
    idempotencyKey: string;
    input: typeof Recurring.ProposeRecurringTemplateRevision.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const operation = "propose_recurring_template_revision";

      const replayInput = {
        agreementId: command.agreementId,
        input: command.input,
      } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        replayInput,
        TemplateSchema,
      );

      if (request.previous) return request.previous;
      yield* requireRecurrenceAccess(transaction, true);
      yield* exactKeys(yield* toJsonObject(command.input), templateFields);

      const input = yield* decode(Recurring.ProposeRecurringTemplateRevision, command.input);

      const current = yield* readAgreementRow(
        transaction,
        command.scope.bookId,
        command.agreementId,
      );

      if (
        input.expectedAgreementRevision !== current.agreement.revision ||
        input.expectedAgreementDigest !== current.digest
      ) {
        return yield* failure("StaleDependency");
      }

      const components = Recurrence.assertUniqueChargeComponents(input.chargeComponentKeys);

      if (Result.isFailure(components)) return yield* refuseCycle(components);

      // An amendment names the first affected cycle, and that cycle must still be
      // unissued. A boundary at or behind the last materialised cycle would
      // re-identify a cycle that already owns an occurrence, which is exactly
      // what occurrence identity exists to prevent. The materialised boundary is
      // the agreement's billing boundary: past it, a correction is a draft
      // revision and a new human review, not a new template.
      const materialised = (yield* RecurrenceDb.readMaterialisedThrough(
        transaction,
        command.scope.bookId,
        command.agreementId,
      ))[0]?.cycleOrdinal;

      if (materialised !== undefined && BigInt(input.effectiveFromCycle) <= BigInt(materialised)) {
        return yield* failure("StaleDependency");
      }

      const existing = yield* RecurrenceDb.readTemplateRevisions(
        transaction,
        command.scope.bookId,
        command.agreementId,
      );

      if (
        existing.some((row) => BigInt(row.effectiveFromCycle) === BigInt(input.effectiveFromCycle))
      ) {
        return yield* failure("StaleDependency");
      }

      const book = (yield* DraftDb.readBookCurrency(transaction, command.scope.bookId))[0];

      if (!book) return yield* failure("Forbidden");

      if (
        input.template.currency !== book.currency ||
        input.template.currencyScale !== book.currencyScale
      ) {
        return yield* failure("InvalidJournal");
      }

      const counted = (yield* RecurrenceDb.readRevisionNumber(
        transaction,
        command.scope.bookId,
        command.agreementId,
      ))[0];

      if (counted === undefined) return yield* failure("InternalError");

      const revision = (BigInt(counted.revision) + 1n).toString();
      const id = newId("recurring_template");
      const createdAt = yield* isoNow(transaction);

      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        agreementId: command.agreementId,
        agreementDigest: current.digest,
        revision,
        effectiveFromCycle: input.effectiveFromCycle,
        chargeComponentKeys: input.chargeComponentKeys,
        template: yield* toJsonObject(input.template),
        reason: input.reason,
        createdAt,
        receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
      };

      const body = yield* toJsonObject(
        Object.assign({}, withoutDigest, { digest: yield* digest(withoutDigest) }),
      );

      const result = yield* decode(TemplateSchema, body);
      const templateDigest = textField(body, "digest");

      if (templateDigest === undefined) return yield* failure("InternalError");

      yield* RecurrenceDb.insertTemplateRevision(transaction, {
        bookId: command.scope.bookId,
        id,
        agreementId: command.agreementId,
        revision,
        effectiveFromCycle: input.effectiveFromCycle,
        body,
        digest: templateDigest,
        createdAt,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        body,
      );

      return result;
    },
    "update",
  );
});

export const recordRecurringAgreementEvent = Effect.fn("commerce.recurring.recordEvent")(function* (
  token: string,
  command: {
    scope: Scope;
    agreementId: string;
    idempotencyKey: string;
    input: typeof Recurring.RecordRecurringAgreementEvent.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const operation = "record_recurring_agreement_event";

      const replayInput = {
        agreementId: command.agreementId,
        input: command.input,
      } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        replayInput,
        EventSchema,
      );

      if (request.previous) return request.previous;
      yield* requireRecurrenceAccess(transaction, true);
      yield* exactKeys(yield* toJsonObject(command.input), eventFields);

      const input = yield* decode(Recurring.RecordRecurringAgreementEvent, command.input);

      const current = yield* readAgreementRow(
        transaction,
        command.scope.bookId,
        command.agreementId,
      );

      if (
        input.expectedAgreementRevision !== current.agreement.revision ||
        input.expectedAgreementDigest !== current.digest
      ) {
        return yield* failure("StaleDependency");
      }

      const counted = (yield* RecurrenceDb.readEventCount(
        transaction,
        command.scope.bookId,
        command.agreementId,
      ))[0];

      if (counted === undefined) return yield* failure("InternalError");

      if (counted.count >= maximumEvents) return yield* failure("InvalidJournal");

      const ordinal = counted.count + 1;
      const id = newId("recurring_event");
      const createdAt = yield* isoNow(transaction);

      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        agreementId: command.agreementId,
        agreementDigest: current.digest,
        ordinal,
        kind: input.kind,
        effectiveCycle: input.effectiveCycle,
        reason: input.reason,
        createdAt,
        receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
      };

      const body = yield* toJsonObject(
        Object.assign({}, withoutDigest, { digest: yield* digest(withoutDigest) }),
      );

      const result = yield* decode(EventSchema, body);
      const eventDigest = textField(body, "digest");

      if (eventDigest === undefined) return yield* failure("InternalError");

      yield* RecurrenceDb.insertEvent(transaction, {
        bookId: command.scope.bookId,
        id,
        agreementId: command.agreementId,
        ordinal,
        kind: input.kind,
        effectiveCycle: input.effectiveCycle,
        body,
        digest: eventDigest,
        createdAt,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        body,
      );

      return result;
    },
    "update",
  );
});

function offsetDate(date: string, offsets: JsonObject, key: string) {
  const days = textField(offsets, key);

  if (days === undefined) return Result.succeed(null);

  return Recurrence.shiftLocalDate(date, days);
}

// The template's reviewed draft body becomes explicit draft values. Only the
// counterparty revision is re-resolved, because the invoice draft owner refuses
// a draft pinned to a superseded customer head. Frozen service and price facts
// are carried across unchanged, and an absent day offset leaves the date
// unresolved rather than inventing a payment term.
function templateContent(
  template: JsonObject,
  cycleDateValue: string,
  counterpartyRevision: string,
): Recurrence.Checked<JsonObject> {
  const offsets = objectField(template, "dateOffsets");
  const plannedIssueDate = offsetDate(cycleDateValue, offsets, "issueDays");

  if (Result.isFailure(plannedIssueDate)) return Result.fail(plannedIssueDate.failure);

  const supplyDate = offsetDate(cycleDateValue, offsets, "supplyDays");

  if (Result.isFailure(supplyDate)) return Result.fail(supplyDate.failure);

  const dueDate = offsetDate(cycleDateValue, offsets, "dueDays");

  if (Result.isFailure(dueDate)) return Result.fail(dueDate.failure);

  const lines = template.lines;

  if (lines === undefined) {
    return Result.fail({
      code: "UnsupportedCadence",
      message: "The template revision carries no draft lines.",
    });
  }

  return Result.succeed({
    title: textField(template, "title") ?? "",
    counterpartyId: textField(template, "counterpartyId") ?? "",
    counterpartyRevision,
    seller: objectField(template, "seller"),
    customer: objectField(template, "customer"),
    currency: textField(template, "currency") ?? "",
    currencyScale: template.currencyScale ?? 0,
    plannedIssueDate: plannedIssueDate.success,
    supplyDate: supplyDate.success,
    dueDate: dueDate.success,
    paymentTerms: textField(template, "paymentTerms") ?? null,
    sourceTotalMinor: textField(template, "sourceTotalMinor") ?? null,
    lines,
  });
}

export const materializeRecurringOccurrence = Effect.fn("commerce.recurring.materializeOccurrence")(
  function* (
    token: string,
    command: {
      scope: Scope;
      agreementId: string;
      idempotencyKey: string;
      input: typeof Recurring.MaterializeRecurringOccurrence.Type;
    },
  ) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (transaction, principal) {
        const operation = "materialize_recurring_occurrence";

        const replayInput = {
          agreementId: command.agreementId,
          input: command.input,
        } satisfies JsonObject;

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          replayInput,
          OccurrenceSchema,
        );

        if (request.previous) return request.previous;
        yield* requireRecurrenceAccess(transaction, true);
        yield* exactKeys(yield* toJsonObject(command.input), materializeFields);

        const input = yield* decode(Recurring.MaterializeRecurringOccurrence, command.input);

        const current = yield* readAgreementRow(
          transaction,
          command.scope.bookId,
          command.agreementId,
        );

        const agreement = current.agreement;

        // An occurrence that already exists is refused, never merged. A second
        // command for the same cycle is a duplicate request, not a second
        // billing and not a silent reuse of the first draft.
        const existing = (yield* RecurrenceDb.readOccurrence(
          transaction,
          command.scope.bookId,
          command.agreementId,
          input.cycleOrdinal,
        ))[0];

        if (existing) {
          const issued = (yield* RecurrenceDb.readOccurrenceIssue(
            transaction,
            command.scope.bookId,
            command.agreementId,
            input.cycleOrdinal,
          ))[0];

          return yield* failure(issued === undefined ? "IdempotencyConflict" : "AlreadyPosted");
        }

        const revisions = yield* RecurrenceDb.readTemplateRevisions(
          transaction,
          command.scope.bookId,
          command.agreementId,
        );

        const events = yield* RecurrenceDb.readEvents(
          transaction,
          command.scope.bookId,
          command.agreementId,
        );

        const billed = yield* RecurrenceDb.readBilledCoverage(
          transaction,
          command.scope.bookId,
          command.agreementId,
        );

        const resolved = Recurrence.resolveCycle({
          schedule: scheduleOf(agreement.schedule),
          events: eventsOf(events),
          revisions: boundariesOf(revisions),
          billedCoverage: coverageOf(billed),
          cycleOrdinal: input.cycleOrdinal,
        });

        if (Result.isFailure(resolved)) return yield* refuseCycle(resolved);

        if (resolved.success.disposition === "skipped" || resolved.success.planned === null) {
          return yield* failure("InvalidJournal");
        }

        const planned = resolved.success.planned;
        const selected = revisions.find((row) => row.revision === planned.selectedTemplateRevision);

        if (selected === undefined) return yield* failure("StaleDependency");

        const selectedDigest = textField(selected.body, "digest");

        if (selectedDigest === undefined) return yield* failure("InternalError");

        const counterparty = (yield* DraftDb.readCustomerCounterparty(
          transaction,
          command.scope.bookId,
          agreement.customerId,
        ))[0];

        if (!counterparty || (counterparty.role !== "customer" && counterparty.role !== "both")) {
          return yield* failure("InvalidJournal");
        }

        const content = templateContent(
          objectField(selected.body, "template"),
          planned.cycleDate,
          counterparty.currentRevision,
        );

        if (Result.isFailure(content)) return yield* refuseCycle(content);

        const draftContent = yield* decode(DraftContentSchema, content.success).pipe(
          Effect.mapError(() => failure("InvalidJournal")),
        );

        const draft = yield* createInvoiceDraftInTransaction(transaction, principal, {
          scope: command.scope,
          idempotencyKey: newId("recurring_occurrence"),
          input: {
            draftKey: occurrenceDraftKey(agreement.id, input.cycleOrdinal),
            content: draftContent,
            occurrence: { agreementId: agreement.id, cycleOrdinal: input.cycleOrdinal },
          },
        });

        const createdAt = yield* isoNow(transaction);
        const occurrenceId = newId("recurring_occurrence_record");

        const withoutDigest: JsonObject = {
          id: occurrenceId,
          scope: command.scope,
          agreementId: agreement.id,
          cycleOrdinal: input.cycleOrdinal,
          cycleDate: planned.cycleDate,
          serviceInterval: yield* toJsonObject(planned.serviceInterval),
          chargeComponentKeys: objectField(selected.body, "chargeComponentKeys"),
          selectedTemplateRevision: planned.selectedTemplateRevision,
          selectedTemplateDigest: selectedDigest,
          status: "drafted",
          draftId: draft.id,
          createdAt,
          receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
        };

        const body = yield* toJsonObject(
          Object.assign({}, withoutDigest, { digest: yield* digest(withoutDigest) }),
        );

        const result = yield* decode(OccurrenceSchema, body);
        const occurrenceDigest = textField(body, "digest");

        if (occurrenceDigest === undefined) return yield* failure("InternalError");

        yield* RecurrenceDb.insertOccurrence(transaction, {
          bookId: command.scope.bookId,
          id: occurrenceId,
          agreementId: agreement.id,
          cycleOrdinal: input.cycleOrdinal,
          cycleDate: planned.cycleDate,
          serviceStartsOn: planned.serviceInterval.serviceStartsOn,
          serviceEndsOn: planned.serviceInterval.serviceEndsOn,
          selectedTemplateRevision: planned.selectedTemplateRevision,
          selectedTemplateDigest: selectedDigest,
          draftId: draft.id,
          body,
          digest: occurrenceDigest,
          createdAt,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          body,
        );

        return result;
      },
      "update",
    );
  },
);

export const planRecurringOccurrences = Effect.fn("commerce.recurring.plan")(function* (
  token: string,
  input: { scope: Scope; agreementId: string; throughOrdinal: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireRecurrenceAccess(transaction, false);

    const current = yield* readAgreementRow(transaction, input.scope.bookId, input.agreementId);

    const planned = yield* readCyclePlan(
      transaction,
      input.scope.bookId,
      current.agreement,
      input.throughOrdinal,
    );

    return yield* decode(PlanSchema, {
      agreement: current.agreement,
      plan: yield* toJsonObject(planned.plan),
      billedCoverage: coverageOf(planned.billed),
    });
  });
});

export const getRecurringAgreement = Effect.fn("commerce.recurring.getAgreement")(function* (
  token: string,
  input: { scope: Scope; agreementId: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireRecurrenceAccess(transaction, false);

    const current = yield* readAgreementRow(transaction, input.scope.bookId, input.agreementId);

    const revisions = yield* RecurrenceDb.readTemplateRevisions(
      transaction,
      input.scope.bookId,
      input.agreementId,
    );

    const events = yield* RecurrenceDb.readEvents(
      transaction,
      input.scope.bookId,
      input.agreementId,
    );

    return yield* decode(AgreementViewSchema, {
      agreement: yield* toJsonObject(current.agreement),
      revisions: revisions.flatMap((row) => {
        const digestValue = textField(row.body, "digest");

        if (digestValue === undefined) return [];

        return [
          {
            revision: row.revision,
            effectiveFromCycle: row.effectiveFromCycle,
            chargeComponentKeys: objectField(row.body, "chargeComponentKeys"),
            digest: digestValue,
            createdAt: textField(row.body, "createdAt") ?? "",
          },
        ];
      }),
      events: events.flatMap((row) => {
        const digestValue = textField(row.body, "digest");

        if (digestValue === undefined) return [];

        return [
          {
            ordinal: row.ordinal,
            kind: eventKind(row.kind) ?? "end",
            effectiveCycle: row.effectiveCycle,
            digest: digestValue,
            createdAt: textField(row.body, "createdAt") ?? "",
          },
        ];
      }),
    });
  });
});

export const listRecurringOccurrences = Effect.fn("commerce.recurring.listOccurrences")(function* (
  token: string,
  input: { scope: Scope; agreementId: string; after?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireRecurrenceAccess(transaction, false);

    const current = yield* readAgreementRow(transaction, input.scope.bookId, input.agreementId);

    const counted = (yield* RecurrenceDb.readOccurrenceCount(
      transaction,
      input.scope.bookId,
      input.agreementId,
    ))[0];

    if (counted === undefined) return yield* failure("InternalError");

    const rows = yield* RecurrenceDb.readOccurrencePage(
      transaction,
      input.scope.bookId,
      input.agreementId,
      input.after ?? null,
    );

    const page = rows.slice(0, pageBound);

    const items = yield* Effect.forEach(page, (row) =>
      Effect.gen(function* () {
        const record = yield* decode(OccurrenceSchema, row.body);

        return {
          cycleOrdinal: record.cycleOrdinal,
          cycleDate: record.cycleDate,
          serviceInterval: record.serviceInterval,
          selectedTemplateRevision: record.selectedTemplateRevision,
          status: record.status,
          occurrenceId: record.id,
          draftId: record.draftId,
          issued: row.issued,
          prepared: row.prepared,
          approved: row.approved,
          documentNumber: row.documentNumber,
          postingReceiptId: row.postingReceiptId,
        };
      }),
    );

    return yield* decode(OccurrenceListSchema, {
      scope: input.scope,
      agreementId: current.agreement.id,
      complete: true,
      count: counted.count,
      continuation: rows.length > pageBound ? (page.at(-1)?.cycleOrdinal ?? null) : null,
      items,
    });
  });
});

export const getRecurringOccurrence = Effect.fn("commerce.recurring.getOccurrence")(function* (
  token: string,
  input: { scope: Scope; agreementId: string; cycleOrdinal: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireRecurrenceAccess(transaction, false);

    const row = (yield* RecurrenceDb.readOccurrence(
      transaction,
      input.scope.bookId,
      input.agreementId,
      input.cycleOrdinal,
    ))[0];

    if (!row) return yield* failure("NotFound");

    const coverage = yield* RecurrenceDb.readOccurrenceIssue(
      transaction,
      input.scope.bookId,
      input.agreementId,
      input.cycleOrdinal,
    );

    return yield* decode(OccurrenceViewSchema, {
      occurrence: row.body,
      coverage: coverage.map((entry) => entry.body),
    });
  });
});
