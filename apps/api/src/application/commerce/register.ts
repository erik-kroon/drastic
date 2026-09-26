import { readSealedDraft } from "../../db/posting-admission";
import { admitAccountRole, admitLineOwner } from "../resource-admission";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Register from "@open-erp/contracts/sales-register";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { readInstant } from "../../db/commerce/access";
import * as AllocationDb from "../../db/commerce/allocations";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import * as InvoiceDb from "../../db/commerce/invoices";
import { lockBookForUpdate, readAccounts } from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { newId, replay, saveCommand } from "../posting";
import {
  commandReceipt,
  decode,
  exactKeys,
  isJsonArray,
  isJsonObject,
  readEvidenceReference,
  requireInsertAccess,
  requireTableAccess,
  requireText,
  toJsonObject,
  withBook,
  type JsonObject,
  type Scope,
  type Principal,
} from "./support";

const CounterpartySchema = Commerce.CounterpartyRevision;

const CreateCounterpartySchema = Commerce.CreateCounterparty;

const ReviseCounterpartySchema = Commerce.ReviseCounterparty;

const CounterpartyPageSchema = Commerce.CounterpartyPage;

const SupplierDuplicatesSchema = Commerce.SupplierInvoiceDuplicates;

const InvoiceSchema = Commerce.Invoice;

const CreateInvoiceSchema = Commerce.CreateInvoice;

const ReviseInvoiceSchema = Commerce.ReviseInvoice;

const InvoicePageSchema = Commerce.InvoicePage;

const InvoiceHistorySchema = Commerce.InvoiceHistory;

const InvoicePaymentsSchema = Commerce.InvoicePayments;

const PaymentCapacitySchema = Commerce.PaymentCapacity;

const SalesPageSchema = Register.SalesPage;

const createCounterpartyFields = [
  "displayName",
  "evidenceId",
  "externalKey",
  "kind",
  "reason",
  "role",
] as const;

const reviseCounterpartyFields = [
  "displayName",
  "evidenceId",
  "expectedRevision",
  "reason",
] as const;

const createInvoiceFields = [
  "amountMinor",
  "controlAccountId",
  "counterpartyId",
  "counterpartyRevision",
  "currency",
  "description",
  "direction",
  "documentNumber",
  "dueOn",
  "evidenceId",
  "issuedOn",
  "kind",
  "recognitionLineId",
  "recognitionVoucherId",
] as const;

const reviseInvoiceFields = [
  "description",
  "dueOn",
  "evidenceId",
  "expectedRevision",
  "reason",
] as const;

const standingDraftBlockers = new Set([
  "issuance_not_implemented",
  "legal_identity_not_verified",
  "tax_profile_not_activated",
]);

const invoiceDirections = new Set(["customer", "supplier"]);

const salesRegisterTables = [
  ...new Set([
    ...DraftDb.invoiceRegisterTables,
    "invoice_drafts",
    "invoice_draft_revisions",
    "invoice_issues",
  ]),
];

const paymentPageSize = 25;

const registerPageSize = 50;

const pageLimit = 51;

const revisionPattern = /^[1-9][0-9]{0,17}$/u;

const pagePattern = /^[1-9][0-9]{0,5}$/u;

const syntheticProfile = "synthetic-core-v1";

const nativeAuthority = "native";

const counterpartyKind = "synthetic_counterparty_v1";

const invoiceKind = "synthetic_invoice_v1";

function retainedNow(transaction: Transaction) {
  return readInstant(transaction).pipe(
    Effect.flatMap((rows) => {
      const instant = rows[0]?.instant;

      return instant === undefined ? failure("InternalError") : Effect.succeed(instant);
    }),
  );
}

function requireNativeWriter(book: DraftDb.BookProfileRow) {
  if (book.authority !== nativeAuthority) return failure("Forbidden");

  if (book.profile !== syntheticProfile) return failure("UnsupportedProfile");

  return Effect.void;
}

function exactMinor(value: string) {
  const match = /^(0|[1-9][0-9]*)(?:\.(0+))?$/u.exec(value);
  const whole = match?.[1];

  return whole === undefined ? null : BigInt(whole);
}

function requirePage(value: string | undefined) {
  const candidate = value ?? "1";

  return pagePattern.test(candidate)
    ? Effect.succeed(Number(candidate))
    : failure("InvalidJournal");
}

function retainedReference(reference: { readonly evidenceId: string; readonly sha256: string }) {
  return { evidenceId: reference.evidenceId, sha256: reference.sha256 } satisfies JsonObject;
}

function evidenceMatches(
  reference: JsonObject,
  evidence: { readonly evidenceId: string; readonly sha256: string },
) {
  return (
    isJsonArray(reference) &&
    reference.some(
      (entry) =>
        isJsonObject(entry) &&
        entry.evidenceId === evidence.evidenceId &&
        entry.sha256 === evidence.sha256,
    )
  );
}

export function liveInvoice(transaction: Transaction, bookId: string, invoiceId: string) {
  return Effect.gen(function* () {
    const live = (yield* InvoiceDb.readLiveInvoice(transaction, bookId, invoiceId))[0];

    if (!live) return yield* failure("NotFound");

    return yield* decode(InvoiceSchema, live.body);
  });
}

function counterpartyRecord(
  scope: Scope,
  id: string,
  revision: string,
  externalKey: string,
  role: string,
  displayName: string,
  evidenceId: string,
  evidence: { readonly evidenceId: string; readonly sha256: string },
  reason: string,
  createdAt: string,
  receipt: JsonObject,
): JsonObject {
  return {
    kind: counterpartyKind,
    externalKey,
    role,
    displayName,
    evidenceId,
    reason,
    id,
    scope,
    revision,
    evidence: retainedReference(evidence),
    legalIdentityVerified: false,
    createdAt,
    receipt,
  };
}

export const createCounterparty = Effect.fn("commerce.counterparties.create")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Commerce.CreateCounterparty.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "commerce_create_counterparty",
        principal.actorId,
        command.input,
        CounterpartySchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DraftDb.counterpartyTables, false);
      yield* requireInsertAccess(transaction, [
        "commerce_counterparties",
        "commerce_counterparty_revisions",
      ]);
      const books = yield* DraftDb.readBookProfile(transaction, command.scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");
      yield* requireNativeWriter(book);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), createCounterpartyFields);
      const input = yield* decode(CreateCounterpartySchema, command.input);
      yield* requireText(input.externalKey, 200);
      yield* requireText(input.displayName, 200);
      yield* requireText(input.reason, 2000);

      const evidence = yield* readEvidenceReference(
        transaction,
        command.scope.bookId,
        input.evidenceId,
      );

      const existing = yield* DraftDb.readCounterpartyByExternalKey(
        transaction,
        command.scope.bookId,
        input.externalKey,
      );

      if (existing[0]?.present === true) return yield* failure("IdempotencyConflict");
      const id = newId("counterparty");

      const body = counterpartyRecord(
        command.scope,
        id,
        "1",
        input.externalKey,
        input.role,
        input.displayName,
        input.evidenceId,
        evidence,
        input.reason,
        yield* retainedNow(transaction),
        commandReceipt(command.idempotencyKey, "commerce_create_counterparty", principal.actorId),
      );

      const result = yield* decode(CounterpartySchema, body);
      yield* DraftDb.insertCounterparty(transaction, {
        bookId: command.scope.bookId,
        id,
        externalKey: input.externalKey,
        role: input.role,
      });
      yield* DraftDb.insertCounterpartyRevision(transaction, {
        bookId: command.scope.bookId,
        counterpartyId: id,
        revision: "1",
        evidenceId: input.evidenceId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "commerce_create_counterparty",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const reviseCounterparty = Effect.fn("commerce.counterparties.revise")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Commerce.ReviseCounterparty.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "commerce_revise_counterparty",
        principal.actorId,
        replayInput,
        CounterpartySchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DraftDb.counterpartyTables, false);
      yield* requireInsertAccess(transaction, [
        "commerce_counterparties",
        "commerce_counterparty_revisions",
      ]);
      const books = yield* DraftDb.readBookProfile(transaction, command.scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");
      yield* requireNativeWriter(book);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), reviseCounterpartyFields);
      const input = yield* decode(ReviseCounterpartySchema, command.input);
      yield* requireText(input.displayName, 200);
      yield* requireText(input.reason, 2000);

      const heads = yield* DraftDb.readCounterpartyHeadForUpdate(
        transaction,
        command.scope.bookId,
        command.id,
      );

      const head = heads[0];

      if (!head) return yield* failure("NotFound");

      if (input.expectedRevision !== head.currentRevision) return yield* failure("StaleDependency");

      const evidence = yield* readEvidenceReference(
        transaction,
        command.scope.bookId,
        input.evidenceId,
      );

      const revision = (BigInt(head.currentRevision) + 1n).toString();

      const body = counterpartyRecord(
        command.scope,
        command.id,
        revision,
        head.externalKey,
        head.role,
        input.displayName,
        input.evidenceId,
        evidence,
        input.reason,
        yield* retainedNow(transaction),
        commandReceipt(command.idempotencyKey, "commerce_revise_counterparty", principal.actorId),
      );

      const result = yield* decode(CounterpartySchema, body);
      yield* DraftDb.insertCounterpartyRevision(transaction, {
        bookId: command.scope.bookId,
        counterpartyId: command.id,
        revision,
        evidenceId: input.evidenceId,
        body,
      });
      yield* DraftDb.advanceCounterpartyRevision(transaction, command.scope.bookId, command.id);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "commerce_revise_counterparty",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getCounterparty = Effect.fn("commerce.counterparties.get")(function* (
  token: string,
  input: { scope: Scope; id: string; revision?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.counterpartyTables, false);

    if (input.revision !== undefined && !revisionPattern.test(input.revision)) {
      return yield* failure("InvalidJournal");
    }

    const heads = yield* DraftDb.readCounterpartyHead(transaction, input.scope.bookId, input.id);
    const head = heads[0];

    if (!head) return yield* failure("NotFound");

    const body =
      input.revision === undefined
        ? head.revision
        : (yield* DraftDb.readCounterpartyRevision(
            transaction,
            input.scope.bookId,
            input.id,
            input.revision,
          ))[0]?.body;

    if (body === undefined) return yield* failure("NotFound");

    return yield* decode(CounterpartySchema, body);
  });
});

export const listCounterparties = Effect.fn("commerce.counterparties.list")(function* (
  token: string,
  input: { scope: Scope; after: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.counterpartyTables, false);

    if (input.after !== "" && !/^[a-z][a-z0-9_-]{2,127}$/u.test(input.after)) {
      return yield* failure("InvalidJournal");
    }

    const rows = yield* DraftDb.readCounterpartyPage(
      transaction,
      input.scope.bookId,
      input.after,
      pageLimit,
    );

    const page = rows.slice(0, registerPageSize);

    return yield* decode(CounterpartyPageSchema, {
      items: page.map((row) => row.body),
      next: rows.length > registerPageSize ? (page[page.length - 1]?.id ?? null) : null,
    });
  });
});

export const supplierInvoiceDuplicates = Effect.fn("commerce.invoices.duplicates")(function* (
  token: string,
  input: {
    scope: Scope;
    counterpartyId: string;
    documentNumber: string;
    evidenceId: string;
    after?: string;
  },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceRegisterTables, false);
    yield* requireText(input.documentNumber, 200);

    const suppliers = yield* DraftDb.readSupplierCounterparty(
      transaction,
      input.scope.bookId,
      input.counterpartyId,
    );

    if (suppliers[0]?.present !== true) return yield* failure("NotFound");

    const evidence = yield* readEvidenceReference(
      transaction,
      input.scope.bookId,
      input.evidenceId,
    );

    const after = input.after ?? "";

    if (after !== "" && !/^[a-z][a-z0-9_-]{2,127}$/u.test(after)) {
      return yield* failure("InvalidJournal");
    }

    const rows = yield* DraftDb.readSupplierDuplicatePage(
      transaction,
      input.scope.bookId,
      input.counterpartyId,
      input.documentNumber,
      evidence.sha256,
      after,
      pageLimit,
    );

    const page = rows.slice(0, registerPageSize);

    const items = yield* Effect.forEach(page, (row) =>
      Effect.gen(function* () {
        const reasons: Array<string> = [];

        if (row.sameNumber) reasons.push("same_document_number");

        if (row.sameContent) reasons.push("same_original_evidence_content");

        return { invoice: yield* liveInvoice(transaction, input.scope.bookId, row.id), reasons };
      }),
    );

    return yield* decode(SupplierDuplicatesSchema, {
      scope: input.scope,
      counterpartyId: input.counterpartyId,
      documentNumber: input.documentNumber,
      evidence: retainedReference(evidence),
      coverage: "registered_supplier_invoices_only",
      items,
      next: rows.length > registerPageSize ? (page[page.length - 1]?.id ?? null) : null,
    });
  });
});

function requireRecognition(
  transaction: Transaction,
  bookId: string,
  voucherId: string,
  lineId: string,
) {
  return Effect.gen(function* () {
    const lines = yield* DraftDb.readRecognitionLine(transaction, bookId, voucherId, lineId);
    const line = lines[0];

    if (!line) return yield* failure("NotFound");

    return line;
  });
}

function requireRecognitionAgreement(
  transaction: Transaction,
  scope: Scope,
  input: typeof Commerce.CreateInvoice.Type,
  line: DraftDb.RegisterLineRow,
  evidence: { readonly evidenceId: string; readonly sha256: string },
) {
  return Effect.gen(function* () {
    if (line.periodLocked) return yield* failure("PeriodLocked");
    const accounts = yield* readAccounts(transaction, scope.bookId, [input.controlAccountId]);

    if (accounts[0]?.active !== true) return yield* failure("InvalidJournal");

    const current = yield* DraftDb.readVoucherCurrent(
      transaction,
      scope.bookId,
      input.recognitionVoucherId,
    );

    const debit = exactMinor(line.debitMinor);
    const credit = exactMinor(line.creditMinor);
    const amount = exactMinor(input.amountMinor);

    if (debit === null || credit === null || amount === null) {
      return yield* failure("InternalError");
    }

    const oppositeSide =
      input.direction === "customer"
        ? debit === amount && credit === 0n
        : credit === amount && debit === 0n;

    if (
      line.accountId !== input.controlAccountId ||
      !oppositeSide ||
      current[0]?.current !== true ||
      line.postingDate < input.issuedOn
    ) {
      return yield* failure("InvalidJournal");
    }

    if (!evidenceMatches(line.evidenceRefs, evidence)) return yield* failure("MissingEvidence");

    const bankSource = yield* DraftDb.readBankSourceAccount(
      transaction,
      scope.bookId,
      line.accountId,
    );

    if (bankSource[0]?.present === true) return yield* failure("InvalidJournal");
  });
}

type CreateInvoiceCommand = {
  scope: Scope;
  idempotencyKey: string;
  input: typeof Commerce.CreateInvoice.Type;
};

export const createInvoiceInTransaction = Effect.fn("commerce.invoices.createInTransaction")(
  function* (transaction: Transaction, principal: Principal, command: CreateInvoiceCommand) {
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "commerce_create_invoice",
      principal.actorId,
      command.input,
      InvoiceSchema,
    );

    if (request.previous) return request.previous;
    yield* requireTableAccess(transaction, DraftDb.invoiceRegisterTables, false);
    yield* requireInsertAccess(transaction, [
      "commerce_invoices",
      "commerce_invoice_revisions",
      "commerce_control_accounts",
    ]);
    const books = yield* DraftDb.readBookProfile(transaction, command.scope.bookId);
    const book = books[0];

    if (!book) return yield* failure("Forbidden");
    yield* requireNativeWriter(book);
    yield* lockBookForUpdate(transaction, command.scope);
    yield* exactKeys(yield* toJsonObject(command.input), createInvoiceFields);
    const input = yield* decode(CreateInvoiceSchema, command.input);

    if (
      input.currency !== book.currency ||
      !invoiceDirections.has(input.direction) ||
      input.dueOn < input.issuedOn
    ) {
      return yield* failure("InvalidJournal");
    }

    yield* requireText(input.documentNumber, 200);
    yield* requireText(input.description, 2000);

    const evidence = yield* readEvidenceReference(
      transaction,
      command.scope.bookId,
      input.evidenceId,
    );

    const parties = yield* DraftDb.readCounterpartyHead(
      transaction,
      command.scope.bookId,
      input.counterpartyId,
    );

    const party = parties[0];

    if (!party) return yield* failure("NotFound");

    if (input.counterpartyRevision !== party.currentRevision)
      return yield* failure("StaleDependency");

    if (party.role !== input.direction && party.role !== "both") {
      return yield* failure("InvalidJournal");
    }

    const line = yield* requireRecognition(
      transaction,
      command.scope.bookId,
      input.recognitionVoucherId,
      input.recognitionLineId,
    );

    yield* requireRecognitionAgreement(transaction, command.scope, input, line, evidence);

    const duplicate = yield* DraftDb.readRegisterIdentity(
      transaction,
      command.scope.bookId,
      input.counterpartyId,
      input.documentNumber,
      input.recognitionVoucherId,
      input.recognitionLineId,
    );

    if (duplicate[0]?.present === true) return yield* failure("IdempotencyConflict");
    yield* admitAccountRole(transaction, command.scope.bookId, input.controlAccountId, "commerce");
    yield* admitLineOwner(
      transaction,
      command.scope.bookId,
      input.recognitionVoucherId,
      input.recognitionLineId,
      "commerce",
    );
    yield* DraftDb.claimControlAccount(
      transaction,
      command.scope.bookId,
      line.accountId,
      input.direction,
    );

    const classified = yield* DraftDb.readControlAccount(
      transaction,
      command.scope.bookId,
      line.accountId,
      input.direction,
    );

    if (classified[0]?.present !== true) return yield* failure("InvalidJournal");
    const id = newId("invoice");
    const counterpartyName = party.revision.displayName;

    if (typeof counterpartyName !== "string") return yield* failure("InternalError");
    const evidenceReference = retainedReference(evidence);

    const receipt = commandReceipt(
      command.idempotencyKey,
      "commerce_create_invoice",
      principal.actorId,
    );

    const createdAt = yield* retainedNow(transaction);

    const body: JsonObject = {
      id,
      scope: command.scope,
      kind: invoiceKind,
      direction: input.direction,
      counterpartyId: party.id,
      counterpartyRevision: party.currentRevision,
      counterpartyName,
      documentNumber: input.documentNumber,
      issuedOn: input.issuedOn,
      currency: book.currency,
      currencyScale: book.currencyScale,
      amountMinor: input.amountMinor,
      controlAccountId: line.accountId,
      evidence: evidenceReference,
      recognition: {
        voucherId: line.voucherId,
        lineId: line.id,
        eventId: line.eventId,
        postingDate: line.postingDate,
      } satisfies JsonObject,
    };

    yield* DraftDb.insertRegisteredInvoice(transaction, {
      bookId: command.scope.bookId,
      id,
      direction: input.direction,
      counterpartyId: party.id,
      counterpartyRevision: party.currentRevision,
      documentNumber: input.documentNumber,
      issuedOn: input.issuedOn,
      amountMinor: input.amountMinor,
      controlAccountId: line.accountId,
      recognitionVoucherId: line.voucherId,
      recognitionLineId: line.id,
      evidenceId: input.evidenceId,
      body,
    });
    yield* DraftDb.insertInvoiceRevision(transaction, {
      bookId: command.scope.bookId,
      invoiceId: id,
      revision: "1",
      evidenceId: input.evidenceId,
      body: {
        id,
        scope: command.scope,
        revision: "1",
        dueOn: input.dueOn,
        description: input.description,
        evidence: evidenceReference,
        reason: "Initial evidence-backed registration",
        createdAt,
        receipt,
      } satisfies JsonObject,
    });
    const result = yield* liveInvoice(transaction, command.scope.bookId, id);
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "commerce_create_invoice",
      principal.actorId,
      result,
    );

    return result;
  },
);

export const createInvoice = Effect.fn("commerce.invoices.create")(function* (
  token: string,
  command: CreateInvoiceCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      return yield* createInvoiceInTransaction(tx, principal, command);
    },
    "update",
  );
});

export const reviseInvoice = Effect.fn("commerce.invoices.revise")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Commerce.ReviseInvoice.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const replayInput = { id: command.id, input: command.input } satisfies JsonObject;

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "commerce_revise_invoice",
        principal.actorId,
        replayInput,
        InvoiceSchema,
      );

      if (request.previous) return request.previous;
      yield* requireTableAccess(transaction, DraftDb.invoiceRegisterTables, false);
      yield* requireInsertAccess(transaction, ["commerce_invoice_revisions"]);
      const books = yield* DraftDb.readBookProfile(transaction, command.scope.bookId);
      const book = books[0];

      if (!book) return yield* failure("Forbidden");
      yield* requireNativeWriter(book);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), reviseInvoiceFields);
      const input = yield* decode(ReviseInvoiceSchema, command.input);
      yield* requireText(input.description, 2000);
      yield* requireText(input.reason, 2000);

      if (
        (yield* readSealedDraft(transaction, command.scope.bookId, command.id, "register")).length
      )
        return yield* failure("Forbidden");

      const heads = yield* DraftDb.readInvoiceHeadForUpdate(
        transaction,
        command.scope.bookId,
        command.id,
      );

      const head = heads[0];

      if (!head) return yield* failure("NotFound");

      if (input.expectedRevision !== head.currentRevision) return yield* failure("StaleDependency");

      if (input.dueOn < head.issuedOn) return yield* failure("InvalidJournal");

      const evidence = yield* readEvidenceReference(
        transaction,
        command.scope.bookId,
        input.evidenceId,
      );

      yield* DraftDb.insertInvoiceRevision(transaction, {
        bookId: command.scope.bookId,
        invoiceId: command.id,
        revision: (BigInt(head.currentRevision) + 1n).toString(),
        evidenceId: input.evidenceId,
        body: {
          id: command.id,
          scope: command.scope,
          revision: (BigInt(head.currentRevision) + 1n).toString(),
          dueOn: input.dueOn,
          description: input.description,
          evidence: retainedReference(evidence),
          reason: input.reason,
          createdAt: yield* retainedNow(transaction),
          receipt: commandReceipt(
            command.idempotencyKey,
            "commerce_revise_invoice",
            principal.actorId,
          ),
        } satisfies JsonObject,
      });
      yield* DraftDb.advanceInvoiceRevision(transaction, command.scope.bookId, command.id);
      const result = yield* liveInvoice(transaction, command.scope.bookId, command.id);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "commerce_revise_invoice",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getInvoice = Effect.fn("commerce.invoices.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceRegisterTables, false);

    return yield* liveInvoice(transaction, input.scope.bookId, input.id);
  });
});

export const listInvoices = Effect.fn("commerce.invoices.list")(function* (
  token: string,
  input: { scope: Scope; after: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceRegisterTables, false);

    if (input.after !== "" && !/^[a-z][a-z0-9_-]{2,127}$/u.test(input.after)) {
      return yield* failure("InvalidJournal");
    }

    const identities = yield* InvoiceDb.readInvoiceIdentityPage(
      transaction,
      input.scope.bookId,
      input.after,
      pageLimit,
    );

    const page = identities.slice(0, registerPageSize);

    const live = yield* InvoiceDb.readLiveInvoicePage(
      transaction,
      input.scope.bookId,
      page.map((row) => row.id),
    );

    const byId = new Map(live.map((row) => [row.id, row.body]));

    const items = yield* Effect.forEach(page, (row) => {
      const body = byId.get(row.id);

      return body === undefined ? failure("InternalError") : decode(InvoiceSchema, body);
    });

    return yield* decode(InvoicePageSchema, {
      items,
      next: identities.length > registerPageSize ? (page[page.length - 1]?.id ?? null) : null,
    });
  });
});

export const invoiceHistory = Effect.fn("commerce.invoices.history")(function* (
  token: string,
  input: { scope: Scope; id: string; after: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceRegisterTables, false);

    if (input.after !== "" && !revisionPattern.test(input.after)) {
      return yield* failure("InvalidJournal");
    }

    const heads = yield* DraftDb.readInvoiceHead(transaction, input.scope.bookId, input.id);

    if (!heads[0]) return yield* failure("NotFound");

    const rows = yield* DraftDb.readInvoiceRevisionPage(
      transaction,
      input.scope.bookId,
      input.id,
      input.after === "" ? 0 : Number(input.after),
      pageLimit,
    );

    const page = rows.slice(0, registerPageSize);

    return yield* decode(InvoiceHistorySchema, {
      items: page.map((row) => row.body),
      next: rows.length > registerPageSize ? (page[page.length - 1]?.revision ?? null) : null,
    });
  });
});

function paymentCapacity(
  book: DraftDb.BookProfileRow,
  scope: Scope,
  row: AllocationDb.PaymentCandidateRow,
) {
  return Effect.gen(function* () {
    const debit = exactMinor(row.debitMinor);
    const credit = exactMinor(row.creditMinor);
    const allocated = exactMinor(row.allocatedMinor);

    if (debit === null || credit === null || allocated === null) {
      return yield* failure("InternalError");
    }

    const amount = debit + credit;

    if (allocated > amount) return yield* failure("StaleDependency");
    const remaining = amount - allocated;

    return yield* decode(PaymentCapacitySchema, {
      voucherId: row.voucherId,
      lineId: row.lineId,
      scope,
      direction: row.direction,
      accountId: row.accountId,
      postingDate: row.postingDate,
      currency: book.currency,
      currencyScale: book.currencyScale,
      amountMinor: amount.toString(),
      allocatedMinor: row.allocatedMinor,
      remainingMinor: remaining.toString(),
      capacityVersion: row.capacityVersion,
    });
  });
}

export const invoicePayments = Effect.fn("commerce.invoices.payments")(function* (
  token: string,
  input: { scope: Scope; id: string; page?: string; historyPage?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, DraftDb.invoiceRegisterTables, false);
    const page = yield* requirePage(input.page);
    const historyPage = yield* requirePage(input.historyPage);
    const invoice = yield* liveInvoice(transaction, input.scope.bookId, input.id);
    const books = yield* DraftDb.readBookProfile(transaction, input.scope.bookId);
    const book = books[0];

    if (!book) return yield* failure("Forbidden");
    const eligible = invoice.status === "open" || invoice.status === "partially_allocated";

    const candidates = eligible
      ? yield* AllocationDb.readPaymentCandidatePage(
          transaction,
          input.scope.bookId,
          invoice.controlAccountId,
          invoice.direction,
          invoice.recognition.eventId,
          invoice.recognition.postingDate,
          (page - 1) * paymentPageSize,
          paymentPageSize,
        )
      : [];

    const total = eligible
      ? (candidates[0]?.total ??
        (yield* AllocationDb.countPaymentCandidates(
          transaction,
          input.scope.bookId,
          invoice.controlAccountId,
          invoice.direction,
          invoice.recognition.eventId,
          invoice.recognition.postingDate,
        ))[0]?.count ??
        0)
      : 0;

    const items = yield* Effect.forEach(candidates, (row) =>
      Effect.gen(function* () {
        const payment = yield* paymentCapacity(book, input.scope, row);

        const evidence = yield* readEvidenceReference(
          transaction,
          input.scope.bookId,
          row.evidenceId,
        );

        return {
          payment,
          voucherLabel: row.voucherLabel,
          description: row.description,
          evidence: retainedReference(evidence),
          sourceTitle: row.sourceTitle,
        };
      }),
    );

    const history = yield* AllocationDb.readInvoiceAllocationHistory(
      transaction,
      input.scope.bookId,
      input.id,
      (historyPage - 1) * paymentPageSize,
      paymentPageSize,
    );

    const historyTotal =
      history[0]?.total ??
      (yield* AllocationDb.countInvoiceAllocationHistory(
        transaction,
        input.scope.bookId,
        input.id,
      ))[0]?.count ??
      0;

    const retainedHistory = yield* Effect.forEach(history, (row) =>
      Effect.gen(function* () {
        const amountMinor = row.amountMinor;
        const postingDate = row.postingDate;
        const createdAt = row.createdAt;

        if (amountMinor === null || postingDate === null || createdAt === null) {
          return yield* failure("InternalError");
        }

        return {
          planId: row.planId,
          createdAt,
          postingDate,
          voucherLabel: row.voucherLabel,
          amountMinor,
          status: row.status,
          receiptId: row.receiptId,
        };
      }),
    );

    return yield* decode(
      InvoicePaymentsSchema,
      yield* toJsonObject({
        scope: input.scope,
        invoiceId: input.id,
        page,
        historyPage,
        pageSize: paymentPageSize,
        total,
        historyTotal,
        items,
        history: retainedHistory,
      }),
    );
  });
});

type RegisterRow = {
  readonly id: string;
  readonly kind: "draft" | "invoice";
  readonly title: string;
  readonly number: string | null;
  readonly customer: string;
  readonly date: string;
  readonly dueOn: string | null;
  readonly currency: string;
  readonly currencyScale: number;
  readonly amountMinor: string | null;
  readonly outstandingMinor: string | null;
  readonly status: string;
  readonly needsDetails: boolean;
  readonly overdue: boolean;
  readonly draftId: string | null;
  readonly issueReviewId: string | null;
};

function text(value: Schema.Json | undefined) {
  return typeof value === "string" ? value : null;
}

function minor(value: Schema.Json | undefined) {
  const candidate = text(value);

  return candidate === null || !/^(0|[1-9][0-9]*)$/u.test(candidate) ? null : candidate;
}

function scale(value: Schema.Json | undefined) {
  const candidate = text(value);

  if (candidate === null || !/^[0-9]+$/u.test(candidate)) return 0;

  return Number(candidate);
}

function draftRegisterRow(row: DraftDb.SalesDraftRow): RegisterRow | null {
  const body = row.body;
  const content = body.content;
  const customer = isJsonObject(content) ? content.customer : null;
  const totals = body.totals;
  const blockers = body.blockers;

  if (!isJsonObject(content) || !isJsonObject(customer) || !isJsonObject(totals)) return null;

  if (!isJsonArray(blockers)) return null;
  const title = text(content.title);
  const legalName = text(customer.legalName);
  const currency = text(content.currency);
  const createdAt = text(body.createdAt);

  if (title === null || legalName === null || currency === null || createdAt === null) return null;

  return {
    id: row.id,
    kind: "draft",
    title,
    number: null,
    customer: legalName,
    date: createdAt,
    dueOn: text(content.dueDate),
    currency,
    currencyScale: scale(content.currencyScale),
    amountMinor: minor(totals.grossMinor),
    outstandingMinor: null,
    status: "draft",
    needsDetails: blockers.some(
      (blocker) => !isJsonObject(blocker) || !standingDraftBlockers.has(text(blocker.code) ?? ""),
    ),
    overdue: false,
    draftId: row.id,
    issueReviewId: null,
  };
}

function invoiceRegisterRow(row: InvoiceDb.SalesInvoiceRow): RegisterRow | null {
  const body = row.body;
  const revision = body.currentRevision;

  if (!isJsonObject(revision)) return null;
  const title = text(revision.description);
  const customer = text(body.counterpartyName);
  const currency = text(body.currency);
  const date = text(body.issuedOn);
  const amount = minor(body.amountMinor);
  const status = text(body.status);
  const outstanding = text(body.outstandingMinor);

  if (
    title === null ||
    customer === null ||
    currency === null ||
    date === null ||
    amount === null ||
    status === null
  ) {
    return null;
  }

  const dueOn = text(revision.dueOn);

  return {
    id: row.id,
    kind: "invoice",
    title,
    number: text(body.documentNumber),
    customer,
    date,
    dueOn,
    currency,
    currencyScale: scale(body.currencyScale),
    amountMinor: amount,
    outstandingMinor: outstanding,
    status,
    needsDetails: status === "blocked",
    overdue: false,
    draftId: row.draftId,
    issueReviewId: row.reviewId,
  };
}

function searchableText(row: RegisterRow) {
  return [row.title, row.number, row.customer]
    .filter((part): part is string => part !== null)
    .join(" ")
    .toLowerCase();
}

function matchesStatus(row: RegisterRow, status: string) {
  if (status === "all") return true;

  if (status === "draft") return row.kind === "draft";

  if (status === "open") {
    return (
      row.status === "open" || row.status === "partially_allocated" || row.status === "blocked"
    );
  }

  if (status === "overdue") return row.overdue;

  if (status === "settled") return row.status === "allocated";

  return row.status === "cancelled";
}

function compareText(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareDates(left: string | null, right: string | null) {
  if (left === null && right === null) return 0;

  if (left === null) return 1;

  if (right === null) return -1;

  return compareText(left, right);
}

function compareRegisterRows(left: RegisterRow, right: RegisterRow, sort: string) {
  if (sort === "customer") {
    const result = compareText(left.customer.toLowerCase(), right.customer.toLowerCase());

    if (result !== 0) return result;
  }

  if (sort === "due") {
    const result = compareDates(left.dueOn, right.dueOn);

    if (result !== 0) return result;
  }

  if (sort === "oldest") {
    const result = compareText(left.date, right.date);

    if (result !== 0) return result;
  }

  if (sort === "newest") {
    const result = compareText(left.date, right.date);

    if (result !== 0) return -result;
  }

  return compareText(left.id, right.id);
}

export const salesRegister = Effect.fn("commerce.register.sales")(function* (
  token: string,
  input: {
    scope: Scope;
    q?: string;
    status?: string;
    sort?: string;
    page?: string;
  },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, salesRegisterTables, false);
    const search = (input.q ?? "").trim().toLowerCase();

    if (search.length > 200) return yield* failure("InvalidJournal");
    const status = input.status ?? "all";
    const sort = input.sort ?? "newest";
    const page = yield* requirePage(input.page);
    const dates = yield* DraftDb.readUtcDate(transaction);
    const today = dates[0]?.today;

    if (today === undefined) return yield* failure("InternalError");
    const drafts = yield* DraftDb.readSalesDraftRows(transaction, input.scope.bookId);
    const registered = yield* InvoiceDb.readSalesInvoiceRows(transaction, input.scope.bookId);
    const rows: Array<RegisterRow> = [];

    for (const draft of drafts) {
      const row = draftRegisterRow(draft);

      if (row === null) return yield* failure("InternalError");
      rows.push(row);
    }

    for (const invoice of registered) {
      const row = invoiceRegisterRow(invoice);

      if (row === null) return yield* failure("InternalError");
      rows.push({
        ...row,
        overdue:
          (row.status === "open" || row.status === "partially_allocated") &&
          row.dueOn !== null &&
          row.dueOn < today,
      });
    }

    const searched = rows.filter((row) => search === "" || searchableText(row).includes(search));
    const filtered = searched.filter((row) => matchesStatus(row, status));
    const ordered = filtered.slice().sort((left, right) => compareRegisterRows(left, right, sort));
    const pageRows = ordered.slice((page - 1) * registerPageSize, page * registerPageSize);

    return yield* decode(SalesPageSchema, {
      scope: input.scope,
      checkedAt: yield* retainedNow(transaction),
      asOf: today,
      page,
      pageSize: registerPageSize,
      total: filtered.length,
      counts: {
        all: searched.length,
        draft: searched.filter((row) => row.kind === "draft").length,
        open: searched.filter(
          (row) =>
            row.status === "open" ||
            row.status === "partially_allocated" ||
            row.status === "blocked",
        ).length,
        overdue: searched.filter((row) => row.overdue).length,
        settled: searched.filter((row) => row.status === "allocated").length,
        cancelled: searched.filter((row) => row.status === "cancelled").length,
      },
      items: pageRows,
    });
  });
});
