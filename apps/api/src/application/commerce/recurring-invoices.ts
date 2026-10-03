import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import * as Recurrence from "@open-erp/domain/recurrence";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { digest } from "../json";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";
import { calculateCommercialContent } from "./draft-calculation";
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
  type Principal,
} from "./support";
import type { Transaction } from "../../db/transaction";

type Agreement = typeof Recurring.RecurringAgreement.Type;

type AgreementRow = {
  readonly agreement: Agreement;
  readonly digest: string;
};

const AgreementSchema = Recurring.RecurringAgreement;

const ScheduleRevisionSchema = Recurring.RecurringScheduleRevision;

const TemplateSchema = Recurring.RecurringTemplateRevision;

const EventSchema = Recurring.RecurringAgreementEvent;

const OccurrenceSchema = Recurring.RecurringOccurrence;

const AgreementViewSchema = Recurring.RecurringAgreementView;

const PlanSchema = Recurring.RecurringCyclePlan;

const OccurrenceListSchema = Recurring.RecurringOccurrenceList;

const OccurrenceViewSchema = Recurring.RecurringOccurrenceView;

const DraftContentSchema = Drafts.DraftContent;

const proposeFields = ["customerId", "reason", "schedule", "title"] as const;

const scheduleFields = [
  "effectiveFromCycle",
  "expectedAgreementDigest",
  "expectedAgreementRevision",
  "reason",
  "schedule",
] as const;

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

const frozenCycleBound = 240;

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

// A stored schedule is re-validated rather than trusted. A row this owner wrote
// and a later edit cannot make unreadable is an internal inconsistency, not a
// reason to fall back to a default cadence.
function scheduleBoundariesOf(rows: ReadonlyArray<RecurrenceDb.ScheduleBoundaryRow>) {
  return Effect.forEach(rows, (row) =>
    decode(Recurrence.RecurrenceSchedule, objectField(row.body, "schedule")).pipe(
      Effect.map((schedule) => ({
        revision: row.revision,
        effectiveFromCycle: row.effectiveFromCycle,
        schedule,
      })),
    ),
  );
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

    const schedules = yield* scheduleBoundariesOf(
      yield* RecurrenceDb.readScheduleRevisions(transaction, bookId, agreement.id),
    );

    const materialised =
      (yield* RecurrenceDb.readMaterialisedThrough(transaction, bookId, agreement.id))[0]
        ?.cycleOrdinal ?? "-1";

    const plan = Recurrence.planDueCycles({
      schedules,
      events: eventsOf(events),
      revisions: boundariesOf(revisions),
      billedCoverage: coverageOf(billed),
      throughOrdinal,
      materialisedThroughOrdinal: materialised === "-1" ? null : materialised,
    });

    if (Result.isFailure(plan)) return yield* refuseCycle(plan);

    return { plan: plan.success, billed, revisions, events, schedules };
  });
}

function initialScheduleOrigin(agreement: Agreement) {
  return toJsonObject({
    kind: "retained_agreement",
    sourceCreatedAt: agreement.createdAt,
    sourceReceipt: agreement.receipt,
  });
}

export const initializeRecurringScheduleInTransaction = Effect.fn(
  "commerce.recurring.initializeSchedule",
)(function* (
  transaction: Transaction,
  scope: Scope,
  agreementId: string,
  receipt: ReturnType<typeof commandReceipt>,
  reason: string,
  requiredCycle?: string,
) {
  const { agreement } = yield* readAgreementRow(transaction, scope.bookId, agreementId);

  const existing = yield* RecurrenceDb.readScheduleRevisions(
    transaction,
    scope.bookId,
    agreementId,
  );

  const boundary = requiredCycle ?? agreement.schedule.firstCycleOrdinal;

  if (existing.some((row) => BigInt(row.effectiveFromCycle) <= BigInt(boundary))) return;
  const firstBoundary = existing[0]?.effectiveFromCycle;

  if (
    firstBoundary !== undefined &&
    (yield* RecurrenceDb.readOccurrenceBeforeCycle(
      transaction,
      scope.bookId,
      agreementId,
      firstBoundary,
    )).length !== 0
  ) {
    return yield* failure("StaleDependency");
  }

  const counted = (yield* RecurrenceDb.readScheduleRevisionNumber(
    transaction,
    scope.bookId,
    agreementId,
  ))[0];

  if (counted === undefined) return yield* failure("InternalError");
  const revision = (BigInt(counted.revision) + 1n).toString();

  const cycle = Recurrence.cycleDate(
    scheduleOf(agreement.schedule),
    agreement.schedule.firstCycleOrdinal,
  );

  if (Result.isFailure(cycle)) return yield* refuseCycle(cycle);
  const createdAt = yield* isoNow(transaction);
  const id = newId("recurring_schedule");

  const withoutDigest: JsonObject = {
    id,
    scope,
    agreementId,
    agreementDigest: agreement.digest,
    revision,
    effectiveFromCycle: agreement.schedule.firstCycleOrdinal,
    schedule: yield* toJsonObject(agreement.schedule),
    reason,
    createdAt,
    receipt,
    origin: yield* initialScheduleOrigin(agreement),
  };

  const body = yield* toJsonObject(
    Object.assign({}, withoutDigest, { digest: yield* digest(withoutDigest) }),
  );

  const record = yield* decode(ScheduleRevisionSchema, body);

  yield* RecurrenceDb.insertScheduleRevision(transaction, {
    bookId: scope.bookId,
    id,
    agreementId,
    revision: record.revision,
    effectiveFromCycle: record.effectiveFromCycle,
    body,
    digest: record.digest,
    createdAt,
  });

  return record;
});

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
        yield* initializeRecurringScheduleInTransaction(
          transaction,
          command.scope,
          id,
          commandReceipt(command.idempotencyKey, operation, principal.actorId),
          input.reason,
        );
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

export const amendRecurringSchedule = Effect.fn("commerce.recurring.amendSchedule")(function* (
  token: string,
  command: {
    scope: Scope;
    agreementId: string;
    idempotencyKey: string;
    input: typeof Recurring.AmendRecurringSchedule.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const operation = "amend_recurring_schedule";

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
        ScheduleRevisionSchema,
      );

      if (request.previous) return request.previous;
      yield* requireRecurrenceAccess(transaction, true);
      yield* exactKeys(yield* toJsonObject(command.input), scheduleFields);

      const input = yield* decode(Recurring.AmendRecurringSchedule, command.input);

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

      const importsOriginal =
        input.effectiveFromCycle === current.agreement.schedule.firstCycleOrdinal &&
        (yield* digest(yield* toJsonObject(input.schedule))) ===
          (yield* digest(yield* toJsonObject(current.agreement.schedule)));

      if (importsOriginal) {
        const initialized = yield* initializeRecurringScheduleInTransaction(
          transaction,
          command.scope,
          command.agreementId,
          commandReceipt(command.idempotencyKey, operation, principal.actorId),
          input.reason,
        );

        if (initialized !== undefined) {
          yield* saveCommand(
            transaction,
            command.scope,
            command.idempotencyKey,
            request.expected,
            operation,
            principal.actorId,
            yield* toJsonObject(initialized),
          );

          return initialized;
        }
      }

      const probe = Recurrence.cycleDate(scheduleOf(input.schedule), input.effectiveFromCycle);

      if (Result.isFailure(probe)) return yield* refuseCycle(probe);

      // The boundary must be the first cycle the new schedule governs, which is
      // also the first cycle that is still unissued. A cadence change therefore
      // never reaches back over an occurrence that already exists.
      const materialised = (yield* RecurrenceDb.readMaterialisedThrough(
        transaction,
        command.scope.bookId,
        command.agreementId,
      ))[0]?.cycleOrdinal;

      if (materialised !== undefined && BigInt(input.effectiveFromCycle) <= BigInt(materialised)) {
        return yield* failure("StaleDependency");
      }

      const existing = yield* RecurrenceDb.readScheduleRevisions(
        transaction,
        command.scope.bookId,
        command.agreementId,
      );

      if (
        existing.some((row) => BigInt(row.effectiveFromCycle) === BigInt(input.effectiveFromCycle))
      ) {
        return yield* failure("StaleDependency");
      }

      // A frequency change re-maps every later cycle, so each already
      // materialised cycle is recomputed under the proposed schedule and must
      // land on the date and service start it was frozen with. This is what
      // refuses a monthly-to-quarterly change that would re-cover or silently
      // skip service an earlier cycle already billed.
      const frozen = yield* RecurrenceDb.readFrozenCycles(
        transaction,
        command.scope.bookId,
        command.agreementId,
        frozenCycleBound,
      );

      if (frozen.length > frozenCycleBound) {
        return yield* failure("UnsupportedProfile");
      }

      const unchanged = Recurrence.assertUnchangedMaterialisedCycles(
        scheduleOf(input.schedule),
        frozen.map((row) => ({
          cycleOrdinal: row.cycleOrdinal,
          cycleDate: row.cycleDate,
          serviceStartsOn: row.serviceStartsOn,
        })),
      );

      if (Result.isFailure(unchanged)) return yield* refuseCycle(unchanged);

      const counted = (yield* RecurrenceDb.readScheduleRevisionNumber(
        transaction,
        command.scope.bookId,
        command.agreementId,
      ))[0];

      if (counted === undefined) return yield* failure("InternalError");

      const revision = (BigInt(counted.revision) + 1n).toString();
      const id = newId("recurring_schedule");
      const createdAt = yield* isoNow(transaction);

      const withoutDigest: JsonObject = {
        id,
        scope: command.scope,
        agreementId: command.agreementId,
        agreementDigest: current.digest,
        revision,
        effectiveFromCycle: input.effectiveFromCycle,
        schedule: yield* toJsonObject(input.schedule),
        reason: input.reason,
        createdAt,
        receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
      };

      const body = yield* toJsonObject(
        Object.assign({}, withoutDigest, { digest: yield* digest(withoutDigest) }),
      );

      const result = yield* decode(ScheduleRevisionSchema, body);
      const scheduleDigest = textField(body, "digest");

      if (scheduleDigest === undefined) return yield* failure("InternalError");

      yield* RecurrenceDb.insertScheduleRevision(transaction, {
        bookId: command.scope.bookId,
        id,
        agreementId: command.agreementId,
        revision,
        effectiveFromCycle: input.effectiveFromCycle,
        body,
        digest: scheduleDigest,
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

function commercialTemplateContent(
  template: typeof Recurring.CommercialRecurringTemplateInput.Type,
  cycleDateValue: string,
  counterparty: DraftDb.CounterpartyRow,
) {
  return Effect.gen(function* () {
    const issue = Recurrence.shiftLocalDate(cycleDateValue, template.dateOffsets.issueDays);
    const supply = Recurrence.shiftLocalDate(cycleDateValue, template.dateOffsets.supplyDays);
    const due = Recurrence.shiftLocalDate(cycleDateValue, template.dateOffsets.dueDays);

    if (Result.isFailure(issue) || Result.isFailure(supply) || Result.isFailure(due)) {
      return yield* failure("UnsupportedProfile");
    }

    return yield* decode(Drafts.CommercialContent, {
      title: template.title,
      counterpartyId: template.counterpartyId,
      counterpartyRevision: counterparty.currentRevision,
      seller: yield* toJsonObject(template.seller),
      customer: {
        legalName: textField(counterparty.revision, "displayName") ?? "",
        registrationId: null,
        taxId: null,
        address: null,
        countryCode: null,
        evidenceId: textField(counterparty.revision, "evidenceId") ?? "",
      },
      plannedIssueDate: issue.success,
      supplyDate: supply.success,
      dueDate: due.success,
      paymentTerms: template.paymentTerms,
      lines: template.lines,
    });
  });
}

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

      yield* initializeRecurringScheduleInTransaction(
        transaction,
        command.scope,
        command.agreementId,
        commandReceipt(command.idempotencyKey, operation, principal.actorId),
        input.reason,
      );

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

      if ("kind" in input.template) {
        if (input.template.counterpartyId !== current.agreement.customerId)
          return yield* failure("InvalidJournal");

        const customer = (yield* DraftDb.readCustomerCounterparty(
          transaction,
          command.scope.bookId,
          current.agreement.customerId,
        ))[0];

        if (!customer) return yield* failure("StaleDependency");

        const schedules = yield* scheduleBoundariesOf(
          yield* RecurrenceDb.readScheduleRevisions(
            transaction,
            command.scope.bookId,
            command.agreementId,
          ),
        );

        const selected = Recurrence.selectScheduleRevision(schedules, input.effectiveFromCycle);

        if (Result.isFailure(selected)) return yield* refuseCycle(selected);
        const schedule = schedules.find((row) => row.revision === selected.success);

        if (!schedule) return yield* failure("StaleDependency");
        const date = Recurrence.cycleDate(schedule.schedule, input.effectiveFromCycle);

        if (Result.isFailure(date)) return yield* refuseCycle(date);
        const commercial = yield* commercialTemplateContent(input.template, date.success, customer);
        yield* calculateCommercialContent(transaction, command.scope, book, commercial);
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

export type RecurringAdmissionWitness = {
  readonly agreementRevision: string;
  readonly agreementDigest: string;
  readonly configurationDigest: string;
  readonly explicitCatchUp?: boolean;
  readonly templateDigest: string;
  readonly scheduleRevision: string;
  readonly eventDigest: string;
  readonly eventOrdinal: number;
};

type MaterializeCommand = {
  readonly scope: Scope;
  readonly agreementId: string;
  readonly idempotencyKey: string;
  readonly input: typeof Recurring.MaterializeRecurringOccurrence.Type;
};

export const materializeRecurringOccurrenceInTransaction = Effect.fn(
  "commerce.recurring.materializeInTransaction",
)(function* (
  transaction: Transaction,
  principal: Principal,
  command: MaterializeCommand,
  expected?: RecurringAdmissionWitness,
) {
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

  const current = yield* readAgreementRow(transaction, command.scope.bookId, command.agreementId);

  const agreement = current.agreement;

  yield* initializeRecurringScheduleInTransaction(
    transaction,
    command.scope,
    command.agreementId,
    commandReceipt(command.idempotencyKey, operation, principal.actorId),
    input.reason,
    input.cycleOrdinal,
  );

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

  const scheduleRows = yield* RecurrenceDb.readScheduleRevisions(
    transaction,
    command.scope.bookId,
    command.agreementId,
  );

  const schedules = yield* scheduleBoundariesOf(scheduleRows);

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

  if (
    expected !== undefined &&
    (expected.eventDigest !==
      (yield* digest(yield* toJsonObject({ events: events.map((row) => row.body) }))) ||
      expected.eventOrdinal !== (events.at(-1)?.ordinal ?? 0))
  )
    return yield* failure("StaleDependency");

  if (
    expected !== undefined &&
    (expected.agreementRevision !== agreement.revision ||
      expected.agreementDigest !== agreement.digest ||
      expected.configurationDigest !==
        (yield* recurringConfigurationDigest(
          transaction,
          command.scope.bookId,
          command.agreementId,
        )))
  )
    return yield* failure("StaleDependency");

  const resolved = resolveMaterializationCycle(
    {
      schedules,
      events: eventsOf(events),
      revisions: boundariesOf(revisions),
      billedCoverage: coverageOf(billed),
      cycleOrdinal: input.cycleOrdinal,
    },
    events,
    expected?.explicitCatchUp === true,
  );

  if (Result.isFailure(resolved)) return yield* refuseCycle(resolved);

  if (resolved.success.disposition === "skipped" || resolved.success.planned === null) {
    return yield* failure("InvalidJournal");
  }

  const planned = resolved.success.planned;
  const scheduleRevision = Recurrence.selectScheduleRevision(schedules, input.cycleOrdinal);

  if (Result.isFailure(scheduleRevision)) return yield* refuseCycle(scheduleRevision);

  const selected = revisions.find((row) => row.revision === planned.selectedTemplateRevision);

  if (selected === undefined) return yield* failure("StaleDependency");

  const selectedTemplate = yield* decode(TemplateSchema, selected.body);
  const selectedDigest = selectedTemplate.digest;

  if (
    expected !== undefined &&
    (expected.templateDigest !== selectedDigest ||
      expected.scheduleRevision !== scheduleRevision.success)
  )
    return yield* failure("StaleDependency");

  const counterparty = (yield* DraftDb.readCustomerCounterparty(
    transaction,
    command.scope.bookId,
    agreement.customerId,
  ))[0];

  if (!counterparty || (counterparty.role !== "customer" && counterparty.role !== "both")) {
    return yield* failure("InvalidJournal");
  }

  const occurrence = { agreementId: agreement.id, cycleOrdinal: input.cycleOrdinal };

  const draftInput =
    "kind" in selectedTemplate.template
      ? {
          draftKey: occurrenceDraftKey(agreement.id, input.cycleOrdinal),
          commercial: yield* commercialTemplateContent(
            selectedTemplate.template,
            planned.cycleDate,
            counterparty,
          ),
          occurrence,
        }
      : {
          draftKey: occurrenceDraftKey(agreement.id, input.cycleOrdinal),
          content: yield* Effect.gen(function* () {
            const content = templateContent(
              objectField(selected.body, "template"),
              planned.cycleDate,
              counterparty.currentRevision,
            );

            if (Result.isFailure(content)) return yield* refuseCycle(content);

            return yield* decode(DraftContentSchema, content.success);
          }),
          occurrence,
        };

  const draft = yield* createInvoiceDraftInTransaction(
    transaction,
    principal,
    {
      scope: command.scope,
      idempotencyKey: newId("recurring_occurrence"),
      input: draftInput,
    },
    undefined,
    "kind" in selectedTemplate.template
      ? {
          agreementId: agreement.id,
          revision: selectedTemplate.revision,
          digest: selectedTemplate.digest,
        }
      : undefined,
  );

  const createdAt = yield* isoNow(transaction);
  const occurrenceId = newId("recurring_occurrence_record");

  const withoutDigest: JsonObject = {
    id: occurrenceId,
    scope: command.scope,
    agreementId: agreement.id,
    cycleOrdinal: input.cycleOrdinal,
    cycleDate: planned.cycleDate,
    serviceInterval: yield* toJsonObject(planned.serviceInterval),
    chargeComponentKeys: selectedTemplate.chargeComponentKeys,
    selectedTemplateRevision: planned.selectedTemplateRevision,
    selectedTemplateDigest: selectedDigest,
    selectedScheduleRevision: scheduleRevision.success,
    status: "drafted",
    draftId: draft.id,
    createdAt,
    receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
  };

  const withCatchUp =
    expected?.explicitCatchUp === true
      ? Object.assign({}, withoutDigest, {
          catchUpWitness: {
            agreementRevision: expected.agreementRevision,
            agreementDigest: expected.agreementDigest,
            configurationDigest: expected.configurationDigest,
            eventDigest: expected.eventDigest,
            eventOrdinal: expected.eventOrdinal,
          },
        })
      : withoutDigest;

  const body = yield* toJsonObject(
    Object.assign({}, withCatchUp, { digest: yield* digest(withCatchUp) }),
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
    selectedScheduleRevision: scheduleRevision.success,
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
});

export const materializeRecurringOccurrence = Effect.fn("commerce.recurring.materializeOccurrence")(
  function* (token: string, command: MaterializeCommand) {
    return yield* withBook(
      token,
      command.scope,
      true,
      function* (transaction, principal) {
        return yield* materializeRecurringOccurrenceInTransaction(transaction, principal, command);
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

    const schedules = yield* RecurrenceDb.readScheduleRevisions(
      transaction,
      input.scope.bookId,
      input.agreementId,
    );

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

    const templates = yield* Effect.forEach(revisions, (row) => decode(TemplateSchema, row.body));

    return yield* decode(AgreementViewSchema, {
      agreement: yield* toJsonObject(current.agreement),
      schedules: schedules.flatMap((row) => {
        const digestValue = textField(row.body, "digest");
        const cadenceKind = objectField(objectField(row.body, "schedule"), "cadence").kind;

        if (digestValue === undefined) return [];

        if (cadenceKind !== "monthly" && cadenceKind !== "fixed_day_interval") return [];

        return [
          {
            revision: row.revision,
            effectiveFromCycle: row.effectiveFromCycle,
            cadenceKind,
            digest: digestValue,
            createdAt: textField(row.body, "createdAt") ?? "",
          },
        ];
      }),
      revisions: templates.map((template) => ({
        revision: template.revision,
        effectiveFromCycle: template.effectiveFromCycle,
        chargeComponentKeys: template.chargeComponentKeys,
        digest: template.digest,
        createdAt: template.createdAt,
      })),
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

export const inspectRecurringCycle = Effect.fn("commerce.recurring.inspectCycle")(function* (
  transaction: Transaction,
  scope: Scope,
  agreementId: string,
  cycleOrdinal: string,
  explicitCatchUp = false,
) {
  const { agreement } = yield* readAgreementRow(transaction, scope.bookId, agreementId);

  const schedules = yield* scheduleBoundariesOf(
    yield* RecurrenceDb.readScheduleRevisions(transaction, scope.bookId, agreementId),
  );

  const revisions = yield* RecurrenceDb.readTemplateRevisions(
    transaction,
    scope.bookId,
    agreementId,
  );

  const events = yield* RecurrenceDb.readEvents(transaction, scope.bookId, agreementId);

  const retainedOccurrence = (yield* RecurrenceDb.readOccurrence(
    transaction,
    scope.bookId,
    agreementId,
    cycleOrdinal,
  ))[0];

  const billed =
    retainedOccurrence === undefined
      ? yield* RecurrenceDb.readBilledCoverage(transaction, scope.bookId, agreementId)
      : [];

  const scheduleRevision = Recurrence.selectScheduleRevision(schedules, cycleOrdinal);

  if (Result.isFailure(scheduleRevision)) return yield* refuseCycle(scheduleRevision);
  const selectedSchedule = schedules.find((row) => row.revision === scheduleRevision.success);

  if (!selectedSchedule) return yield* failure("StaleDependency");
  const cycleDateValue = Recurrence.cycleDate(selectedSchedule.schedule, cycleOrdinal);

  if (Result.isFailure(cycleDateValue)) return yield* refuseCycle(cycleDateValue);

  const resolved = resolveMaterializationCycle(
    {
      schedules,
      events: eventsOf(events),
      revisions: boundariesOf(revisions),
      billedCoverage: coverageOf(billed),
      cycleOrdinal,
    },
    events,
    explicitCatchUp,
  );

  const templatePlan =
    Result.isSuccess(resolved) && resolved.success.planned === null
      ? Recurrence.resolveCycle({
          schedules,
          events: [],
          revisions: boundariesOf(revisions),
          billedCoverage: [],
          cycleOrdinal,
        })
      : resolved;

  const selectedRevision = Result.isSuccess(templatePlan)
    ? templatePlan.success.planned?.selectedTemplateRevision
    : undefined;

  const selected = revisions.find((row) => row.revision === selectedRevision);

  const template =
    selected === undefined ? undefined : yield* decode(TemplateSchema, selected.body);

  return {
    agreement,
    cycleDate: cycleDateValue.success,
    timeZone: selectedSchedule.schedule.timeZone,
    resolved,
    template,
    witness: {
      agreementRevision: agreement.revision,
      agreementDigest: agreement.digest,
      configurationDigest: yield* recurringConfigurationDigest(
        transaction,
        scope.bookId,
        agreementId,
      ),
      templateDigest: template?.digest ?? "",
      scheduleRevision: scheduleRevision.success,
      eventDigest: yield* digest(yield* toJsonObject({ events: events.map((row) => row.body) })),
      eventOrdinal: events.at(-1)?.ordinal ?? 0,
    } satisfies RecurringAdmissionWitness,
  };
});

function resolveMaterializationCycle(
  input: Recurrence.CycleResolutionInput,
  events: ReadonlyArray<RecurrenceDb.EventRow>,
  explicitCatchUp: boolean,
) {
  const resolved = Recurrence.resolveCycle(input);

  if (Result.isFailure(resolved)) return resolved;

  if (!explicitCatchUp || resolved.success.reason !== "paused") return resolved;

  if (events.at(-1)?.kind !== "resume" || events.some((event) => event.kind === "end"))
    return resolved;

  return Recurrence.resolveCycle({ ...input, events: [] });
}

export function recurringConfigurationDigest(
  transaction: Transaction,
  bookId: string,
  agreementId: string,
) {
  return Effect.gen(function* () {
    const schedules = yield* RecurrenceDb.readScheduleRevisions(transaction, bookId, agreementId);
    const templates = yield* RecurrenceDb.readTemplateRevisions(transaction, bookId, agreementId);

    return yield* digest(
      yield* toJsonObject({
        schedules: schedules.map((row) => row.body),
        templates: templates.map((row) => row.body),
      }),
    );
  });
}
