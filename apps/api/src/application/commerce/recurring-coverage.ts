import * as Recurring from "@open-erp/contracts/recurring-invoices";
import * as Recurrence from "@open-erp/domain/recurrence";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { digest } from "../json";
import { failure } from "../failures";
import { newId } from "../posting";
import * as RecurrenceDb from "../../db/commerce/recurring-invoices";
import {
  decode,
  commandReceipt,
  requireInsertAccess,
  requireTableAccess,
  textField,
  toJsonObject,
  type JsonObject,
  type Scope,
} from "./support";
import { readInstant } from "../../db/commerce/access";
import type { Transaction } from "../../db/transaction";

type DraftSnapshot = {
  readonly id: string;
  readonly occurrence?: Recurring.OccurrenceReference;
};

type IssuedOccurrence = {
  readonly id: string;
  readonly agreementId: string;
  readonly cycleOrdinal: string;
  readonly serviceStartsOn: string;
  readonly serviceEndsOn: string;
  readonly draftId: string;
  readonly body: JsonObject;
};

type IssuedInvoice = {
  readonly id: string;
  readonly registerInvoiceId: string;
  readonly documentNumber: string;
  readonly postingReceiptId: string;
};

function retainedNow(transaction: Transaction) {
  return readInstant(transaction).pipe(
    Effect.flatMap((rows) => {
      const instant = rows[0]?.instant;

      return instant === undefined ? failure("InternalError") : Effect.succeed(instant);
    }),
  );
}

type LifecycleEvent = {
  readonly kind: "pause" | "resume" | "end";
  readonly effectiveCycle: string;
};

function lifecycleOf(
  rows: ReadonlyArray<{ readonly kind: string; readonly effectiveCycle: string }>,
) {
  return rows.flatMap((row): ReadonlyArray<LifecycleEvent> => {
    if (row.kind !== "pause" && row.kind !== "resume" && row.kind !== "end") return [];

    return [{ kind: row.kind, effectiveCycle: row.effectiveCycle }];
  });
}

// Issue admission for one recurring occurrence. The occurrence owner is the
// authority for both the cycle and its billing coverage; the invoice issue
// owners ask it rather than re-deriving either. A pause or an end that wins
// before issue admission blocks the invoice. A pause recorded after a committed
// issue cannot undo the invoice, because the coverage row already exists and the
// invoice is already in the register.
export function occurrenceAtIssueAdmission(
  transaction: Transaction,
  scope: Scope,
  draftSnapshot: DraftSnapshot,
) {
  return Effect.gen(function* () {
    const reference = draftSnapshot.occurrence;

    if (reference === undefined) return yield* Effect.succeed(null);

    yield* requireTableAccess(transaction, RecurrenceDb.occurrenceIssueTables, false);
    yield* requireInsertAccess(transaction, ["recurring_invoice_occurrence_issues"]);

    const occurrence = (yield* RecurrenceDb.readOccurrenceByDraft(
      transaction,
      scope.bookId,
      draftSnapshot.id,
    ))[0];

    if (!occurrence) return yield* failure("StaleDependency");

    if (
      occurrence.agreementId !== reference.agreementId ||
      occurrence.cycleOrdinal !== reference.cycleOrdinal
    ) {
      return yield* failure("StaleDependency");
    }

    const consumed = (yield* RecurrenceDb.readOccurrenceIssue(
      transaction,
      scope.bookId,
      occurrence.agreementId,
      occurrence.cycleOrdinal,
    ))[0];

    if (consumed) return yield* failure("AlreadyPosted");

    const lifecycle = lifecycleOf(
      yield* RecurrenceDb.readAgreementLifecycle(transaction, scope.bookId, occurrence.agreementId),
    );

    const disposition = Recurrence.eventDisposition(lifecycle, occurrence.cycleOrdinal);

    if (Result.isFailure(disposition)) return yield* unsupportedCycle(disposition);

    const retained = yield* decode(Recurring.RecurringOccurrence, occurrence.body);

    if (retained.catchUpWitness !== undefined) {
      const witness = retained.catchUpWitness;

      const events = yield* RecurrenceDb.readEvents(
        transaction,
        scope.bookId,
        occurrence.agreementId,
      );

      const agreementRow = (yield* RecurrenceDb.readAgreement(
        transaction,
        scope.bookId,
        occurrence.agreementId,
      ))[0];

      if (agreementRow === undefined) return yield* failure("StaleDependency");
      const agreement = yield* decode(Recurring.RecurringAgreement, agreementRow.body);

      const schedules = yield* RecurrenceDb.readScheduleRevisions(
        transaction,
        scope.bookId,
        occurrence.agreementId,
      );

      const templates = yield* RecurrenceDb.readTemplateRevisions(
        transaction,
        scope.bookId,
        occurrence.agreementId,
      );

      const configurationDigest = yield* digest(
        yield* toJsonObject({
          schedules: schedules.map((row) => row.body),
          templates: templates.map((row) => row.body),
        }),
      );

      const eventDigest = yield* digest(
        yield* toJsonObject({ events: events.map((row) => row.body) }),
      );

      if (
        witness.agreementRevision !== agreement.revision ||
        witness.agreementDigest !== agreement.digest ||
        witness.eventOrdinal !== (events.at(-1)?.ordinal ?? 0) ||
        witness.eventDigest !== eventDigest ||
        witness.configurationDigest !== configurationDigest ||
        events.some((event) => event.kind === "end") ||
        (disposition.success === "paused" && events.at(-1)?.kind !== "resume")
      )
        return yield* failure("StaleDependency");
    } else if (disposition.success !== "due") return yield* failure("StaleDependency");

    return yield* Effect.succeed(occurrence satisfies IssuedOccurrence);
  });
}

function unsupportedCycle(result: Recurrence.Checked<unknown>) {
  return Result.isFailure(result) ? failure("UnsupportedProfile") : failure("InternalError");
}

// The coverage consumption is written in the same financial transaction that
// issues the invoice, one row per charge component, so the two commit together
// or neither does.
export function consumeOccurrenceCoverage(
  transaction: Transaction,
  scope: Scope,
  occurrence: IssuedOccurrence,
  invoice: IssuedInvoice,
  idempotencyKey: string,
  actorId: string,
  operation: string,
) {
  return Effect.gen(function* () {
    const occurrenceDigest = textField(occurrence.body, "digest");

    const components = yield* RecurrenceDb.readOccurrenceComponents(
      transaction,
      scope.bookId,
      occurrence.agreementId,
      occurrence.cycleOrdinal,
    );

    if (occurrenceDigest === undefined || components.length === 0) {
      return yield* failure("InternalError");
    }

    const createdAt = yield* retainedNow(transaction);

    for (const component of components) {
      const withoutDigest: JsonObject = {
        id: newId("recurring_coverage"),
        scope,
        occurrenceId: occurrence.id,
        occurrenceDigest,
        agreementId: occurrence.agreementId,
        cycleOrdinal: occurrence.cycleOrdinal,
        chargeComponentKey: component.chargeComponentKey,
        serviceInterval: {
          serviceStartsOn: occurrence.serviceStartsOn,
          serviceEndsOn: occurrence.serviceEndsOn,
        },
        draftId: occurrence.draftId,
        invoiceIssueId: invoice.id,
        registerInvoiceId: invoice.registerInvoiceId,
        documentNumber: invoice.documentNumber,
        postingReceiptId: invoice.postingReceiptId,
        createdAt,
        receipt: commandReceipt(idempotencyKey, operation, actorId),
      };

      const body = yield* toJsonObject(
        Object.assign({}, withoutDigest, { digest: yield* digest(withoutDigest) }),
      );

      const digestValue = textField(body, "digest");
      const coverageId = textField(body, "id");

      if (digestValue === undefined || coverageId === undefined) {
        return yield* failure("InternalError");
      }

      yield* RecurrenceDb.insertOccurrenceIssue(transaction, {
        bookId: scope.bookId,
        id: coverageId,
        occurrenceId: occurrence.id,
        agreementId: occurrence.agreementId,
        cycleOrdinal: occurrence.cycleOrdinal,
        chargeComponentKey: component.chargeComponentKey,
        draftId: occurrence.draftId,
        invoiceIssueId: invoice.id,
        registerInvoiceId: invoice.registerInvoiceId,
        documentNumber: invoice.documentNumber,
        postingReceiptId: invoice.postingReceiptId,
        body,
        digest: digestValue,
        createdAt,
      });
    }
  });
}
