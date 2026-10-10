import * as Crm from "@open-erp/contracts/crm-master";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as CustomerDb from "../../db/commerce/customer-invoice-defaults";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import type { Transaction } from "../../db/transaction";
import { lockBookForUpdate } from "../../db/posting";
import { readInstant } from "../../db/commerce/access";
import { digest } from "../json";
import { replay, saveCommand } from "../command-receipts";
import { failure } from "../failures";
import {
  decode,
  requireRetainedEvidence,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "./support";

type Reference = typeof Crm.CustomerReference.Type;

type ReadInput = { scope: Scope; partyId: string; revision?: string };

const CustomerRecord = Schema.Union([Crm.CustomerInvoiceDefaults, Crm.ReviewedCustomerRecipient]);

export const readCustomerRecord = Effect.fn("commerce.crm.readCustomerRecord")(function* (
  transaction: Transaction,
  scope: Scope,
  partyId: string,
  stream: CustomerDb.CustomerStream,
  revision?: string,
) {
  const pointer = (yield* CustomerDb.readCustomerPointer(
    transaction,
    scope.bookId,
    partyId,
    stream,
  ))[0];

  const selected = revision ?? pointer?.currentRevision.toString();

  if (selected === undefined) return yield* failure("NotFound");

  const row = (yield* CustomerDb.readCustomerRevision(
    transaction,
    scope.bookId,
    partyId,
    selected,
    stream,
  ))[0];

  if (!row) return yield* failure("NotFound");

  return row.body;
});

export const getCustomerInvoiceDefaults = Effect.fn("commerce.crm.getCustomerInvoiceDefaults")(
  function* (token: string, input: ReadInput) {
    return yield* withBook(token, input.scope, false, function* (transaction) {
      yield* requireTableAccess(transaction, CustomerDb.customerDefaultsTables, false);

      return yield* decode(
        Crm.CustomerInvoiceDefaults,
        yield* readCustomerRecord(
          transaction,
          input.scope,
          input.partyId,
          "defaults",
          input.revision,
        ),
      );
    });
  },
);

export const getCustomerRecipient = Effect.fn("commerce.crm.getCustomerRecipient")(function* (
  token: string,
  input: ReadInput,
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, CustomerDb.customerDefaultsTables, false);

    return yield* decode(
      Crm.ReviewedCustomerRecipient,
      yield* readCustomerRecord(
        transaction,
        input.scope,
        input.partyId,
        "recipient",
        input.revision,
      ),
    );
  });
});

export const resolveReviewedRecipient = Effect.fn("commerce.crm.resolveReviewedRecipient")(
  function* (
    transaction: Transaction,
    scope: Scope,
    reference: Reference,
    purpose: typeof Crm.RecipientPurpose.Type,
    currentOnly = true,
  ) {
    const row = (yield* CustomerDb.readCustomerRevision(
      transaction,
      scope.bookId,
      reference.partyId,
      reference.revision,
      "recipient",
    ))[0];

    if (!row) return yield* failure("StaleDependency");
    const record = yield* decode(Crm.ReviewedCustomerRecipient, row.body);

    if (
      record.digest !== reference.digest ||
      record.scope.entityId !== scope.entityId ||
      record.scope.bookId !== scope.bookId ||
      record.status !== "reviewed" ||
      !record.purposes.includes(purpose)
    )
      return yield* failure("StaleDependency");

    if (currentOnly) {
      const pointer = (yield* CustomerDb.readCustomerPointer(
        transaction,
        scope.bookId,
        reference.partyId,
        "recipient",
      ))[0];

      if (pointer?.currentRevision.toString() !== reference.revision)
        return yield* failure("StaleDependency");
    }

    yield* requireRetainedEvidence(transaction, scope.bookId, record.reviewEvidence);

    return record;
  },
);

export const resolveCustomerDefaults = Effect.fn("commerce.crm.resolveCustomerDefaults")(function* (
  transaction: Transaction,
  scope: Scope,
  reference: Reference,
  currentOnly = true,
) {
  const row = (yield* CustomerDb.readCustomerRevision(
    transaction,
    scope.bookId,
    reference.partyId,
    reference.revision,
    "defaults",
  ))[0];

  if (!row) return yield* failure("StaleDependency");
  const record = yield* decode(Crm.CustomerInvoiceDefaults, row.body);

  if (
    record.digest !== reference.digest ||
    record.scope.entityId !== scope.entityId ||
    record.scope.bookId !== scope.bookId
  )
    return yield* failure("StaleDependency");

  if (currentOnly) {
    const pointer = (yield* CustomerDb.readCustomerPointer(
      transaction,
      scope.bookId,
      reference.partyId,
      "defaults",
    ))[0];

    if (pointer?.currentRevision.toString() !== reference.revision)
      return yield* failure("StaleDependency");

    if (record.recipient !== null)
      yield* resolveReviewedRecipient(transaction, scope, record.recipient, "invoice_delivery");
  }

  yield* requireRetainedEvidence(transaction, scope.bookId, record.reviewEvidence);

  return record;
});

export function copiedDefaults(
  record: typeof Crm.CustomerInvoiceDefaults.Type,
  invoiceDate: string,
) {
  if (!Accounting.isCalendarDate(invoiceDate)) return failure("InvalidJournal");
  const date = new Date(`${invoiceDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + record.terms.days);
  const dueDate = date.toISOString().slice(0, 10);

  if (!Accounting.isCalendarDate(dueDate)) return failure("InvalidJournal");

  return Effect.succeed({
    scope: record.scope,
    reference: { partyId: record.partyId, revision: record.revision, digest: record.digest },
    invoiceDate,
    dueDate,
    paymentTerms:
      record.language === "sv"
        ? `${record.terms.days} kalenderdagar`
        : `${record.terms.days} calendar days`,
    currency: record.currency,
    language: record.language,
    recipient: record.recipient,
  });
}

export const applyCustomerInvoiceDefaults = Effect.fn("commerce.crm.applyCustomerInvoiceDefaults")(
  function* (
    token: string,
    command: { scope: Scope; partyId: string; input: typeof Crm.ApplyCustomerInvoiceDefaults.Type },
  ) {
    return yield* withBook(token, command.scope, true, function* (transaction) {
      yield* requireTableAccess(transaction, CustomerDb.customerDefaultsTables, false);

      if (command.partyId !== command.input.reference.partyId)
        return yield* failure("StaleDependency");

      const record = yield* resolveCustomerDefaults(
        transaction,
        command.scope,
        command.input.reference,
      );

      return yield* decode(
        Crm.CopiedCustomerInvoiceDefaults,
        yield* toJsonObject(yield* copiedDefaults(record, command.input.invoiceDate)),
      );
    });
  },
);

type CustomerCommand = { scope: Scope; partyId: string; idempotencyKey: string } & (
  | { kind: "defaults"; input: typeof Crm.SaveCustomerInvoiceDefaults.Type }
  | { kind: "recipient"; input: typeof Crm.SaveCustomerRecipient.Type }
);

const saveCustomerRecord = Effect.fn("commerce.crm.saveCustomerRecord")(function* (
  token: string,
  command: CustomerCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const operation =
        command.kind === "defaults" ? "crm_save_invoice_defaults" : "crm_save_reviewed_recipient";

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { partyId: command.partyId, input: command.input },
        CustomerRecord,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, CustomerDb.customerDefaultsTables, true);
      yield* lockBookForUpdate(transaction, command.scope);

      const party = (yield* DraftDb.readCustomerCounterparty(
        transaction,
        command.scope.bookId,
        command.partyId,
      ))[0];

      if (!party || (party.role !== "customer" && party.role !== "both"))
        return yield* failure("InvalidJournal");
      yield* requireRetainedEvidence(
        transaction,
        command.scope.bookId,
        command.input.reviewEvidence,
      );

      const pointer = (yield* CustomerDb.readCustomerPointer(
        transaction,
        command.scope.bookId,
        command.partyId,
        command.kind,
      ))[0];

      const revision = pointer?.currentRevision.toString() ?? "0";

      if (revision !== command.input.expectedRevision || BigInt(revision) >= 1000n)
        return yield* failure("StaleDependency");

      if (revision === "0") {
        if (command.input.expectedDigest !== null) return yield* failure("StaleDependency");
      } else {
        const previous = yield* decode(
          CustomerRecord,
          yield* readCustomerRecord(
            transaction,
            command.scope,
            command.partyId,
            command.kind,
            revision,
          ),
        );

        if (previous.digest !== command.input.expectedDigest)
          return yield* failure("StaleDependency");
      }

      let details;

      if (command.kind === "defaults") {
        const input = command.input;
        const book = (yield* DraftDb.readBookCurrency(transaction, command.scope.bookId))[0];

        if (book?.currency !== input.currency) return yield* failure("UnsupportedProfile");

        if (input.recipient !== null) {
          if (input.recipient.partyId !== command.partyId) return yield* failure("StaleDependency");
          yield* resolveReviewedRecipient(
            transaction,
            command.scope,
            input.recipient,
            "invoice_delivery",
          );
        }

        details = {
          terms: input.terms,
          currency: input.currency,
          language: input.language,
          recipient: input.recipient,
          reviewEvidence: input.reviewEvidence,
          reason: input.reason,
        };
      } else {
        const input = command.input;

        if (new Set(input.purposes).size !== input.purposes.length)
          return yield* failure("InvalidJournal");
        details = {
          channel: input.channel,
          destination: input.destination,
          purposes: input.purposes,
          status: input.status,
          reviewEvidence: input.reviewEvidence,
          reason: input.reason,
        };
      }

      const next = (BigInt(revision) + 1n).toString();

      const body = yield* toJsonObject({
        ...details,
        scope: command.scope,
        partyId: command.partyId,
        revision: next,
        recordedBy: principal.actorId,
        recordedAt: (yield* readInstant(transaction))[0]?.instant,
      });

      const record = yield* decode(CustomerRecord, { ...body, digest: yield* digest(body) });

      if (revision === "0")
        yield* CustomerDb.insertCustomerPointer(
          transaction,
          command.scope.bookId,
          command.partyId,
          command.kind,
        );
      else
        yield* CustomerDb.advanceCustomerPointer(
          transaction,
          command.scope.bookId,
          command.partyId,
          next,
          command.kind,
        );
      yield* CustomerDb.insertCustomerRevision(
        transaction,
        {
          bookId: command.scope.bookId,
          partyId: command.partyId,
          revision: next,
          body: yield* toJsonObject(record),
          recordedBy: principal.actorId,
        },
        command.kind,
      );
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        record,
      );

      return record;
    },
    "update",
  );
});

export const saveCustomerInvoiceDefaults = Effect.fn("commerce.crm.saveCustomerInvoiceDefaults")(
  function* (
    token: string,
    command: {
      scope: Scope;
      partyId: string;
      idempotencyKey: string;
      input: typeof Crm.SaveCustomerInvoiceDefaults.Type;
    },
  ) {
    return yield* decode(
      Crm.CustomerInvoiceDefaults,
      yield* toJsonObject(yield* saveCustomerRecord(token, { ...command, kind: "defaults" })),
    );
  },
);

export const saveCustomerRecipient = Effect.fn("commerce.crm.saveCustomerRecipient")(function* (
  token: string,
  command: {
    scope: Scope;
    partyId: string;
    idempotencyKey: string;
    input: typeof Crm.SaveCustomerRecipient.Type;
  },
) {
  return yield* decode(
    Crm.ReviewedCustomerRecipient,
    yield* toJsonObject(yield* saveCustomerRecord(token, { ...command, kind: "recipient" })),
  );
});
