import * as Accounting from "@open-erp/contracts/accounting";
import * as Connector from "@open-erp/contracts/bank-connector";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import * as ConnectorDb from "../../db/banking/connector";
import * as BankDb from "../../db/banking/shared";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type Transaction = import("../../db/transaction").Transaction;

type JsonObject = Schema.JsonObject;

const ConsentSchema = Connector.ConnectorConsent;

const ConsentStateSchema = Connector.ConnectorConsentState;

const BatchSchema = Connector.ConnectorBatch;

const RevocationSchema = Connector.ConnectorRevocation;

const ConsentInventorySchema = Connector.ConnectorInventory;

const BatchInventorySchema = Connector.ConnectorBatchInventory;

const FeedInventorySchema = Connector.ConnectorFeedInventory;

const connectorTables = [
  "books",
  "accounts",
  "bank_sources",
  "bank_connector_consents",
  "bank_connector_batches",
  "bank_connector_records",
  "intake_contents",
  "intake_occurrences",
  "command_receipts",
];

const connectorInserts = [
  "bank_connector_consents",
  "bank_connector_batches",
  "bank_connector_records",
  "intake_contents",
  "intake_occurrences",
  "command_receipts",
];

const providerIdPattern = /^[a-z][a-z0-9_-]{1,63}$/;

const recoveryKeyPattern = /^[a-zA-Z0-9_-]{8,128}$/;

const maximumRawBytes = 65536;

const maximumPageRecords = 20;

const maximumInputBytes = 262144;

function consentState(consent: ConnectorDb.ConsentRow) {
  return Object.assign({}, consent.body, {
    cursor: consent.cursor ?? "",
    revoked: consent.revokedAt !== null,
  }) satisfies JsonObject;
}

function readConsent(
  transaction: import("../../db/transaction").Transaction,
  bookId: string,
  consentId: string,
) {
  return ConnectorDb.readConsent(transaction, bookId, consentId).pipe(
    Effect.flatMap((rows) => {
      const consent = rows[0];

      return consent ? Effect.succeed(consent) : failure("NotFound");
    }),
  );
}

function lockBook(transaction: import("../../db/transaction").Transaction, bookId: string) {
  return BankDb.lockBook(transaction, bookId, "update").pipe(
    Effect.flatMap((rows) => {
      const book = rows[0];

      return book ? Effect.succeed(book) : failure("Forbidden");
    }),
  );
}

function mappingIsCurrent(
  transaction: import("../../db/transaction").Transaction,
  bookId: string,
  sourceAccountId: string,
  accountId: string,
) {
  return Effect.gen(function* () {
    const account = (yield* BankDb.readAccount(transaction, bookId, accountId))[0];

    if (!account?.active) return false;

    const conflicts = yield* ConnectorDb.readSourceMappingConflicts(
      transaction,
      bookId,
      sourceAccountId,
      accountId,
    );

    return conflicts[0]?.present !== true;
  });
}

export const saveConnectorConsent = Effect.fn("banking.connector.saveConsent")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Connector.SaveConnectorConsent.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, connectorTables, connectorInserts);
      const book = yield* lockBook(transaction, command.scope.bookId);

      if (!book) return yield* failure("Forbidden");

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "save_bank_connector_consent",
        principal.actorId,
        yield* Shared.toJsonObject(command.input),
        ConsentSchema,
      );

      if (request.previous) return request.previous;

      const { providerId, sourceAccountId, accountId, externalAccountId } = command.input;

      if (!providerIdPattern.test(providerId)) return yield* failure("InvalidJournal");

      if (
        !(yield* mappingIsCurrent(transaction, command.scope.bookId, sourceAccountId, accountId))
      ) {
        return yield* failure("StaleDependency");
      }

      const retained = yield* ConnectorDb.readConsentIdentities(transaction, command.scope.bookId);

      if (
        retained.some(
          (row) => row.sourceAccountId === sourceAccountId || row.accountId === accountId,
        )
      ) {
        return yield* failure("StaleDependency");
      }

      if (
        (yield* ConnectorDb.readProviderAccountDuplicate(
          transaction,
          command.scope.bookId,
          providerId,
          externalAccountId,
        ))[0]?.present === true
      ) {
        return yield* failure("IdempotencyConflict");
      }

      const body = yield* Shared.toJsonObject(
        Object.assign({}, command.input, {
          id: newId("connectorconsent"),
          scope: command.scope,
          consentAuthority: "operator_attested_not_provider_verified",
          providerConfigured: false,
          createdBy: principal.actorId,
          createdAt: yield* isoNow(transaction),
          receipt: Shared.receipt(
            command.idempotencyKey,
            "save_bank_connector_consent",
            principal.actorId,
          ),
        }),
      );

      const id = Shared.textField(body, "id");

      if (id === undefined) return yield* failure("InternalError");
      yield* ConnectorDb.insertConsent(transaction, {
        bookId: command.scope.bookId,
        id,
        providerId,
        externalAccountId,
        sourceAccountId,
        accountId,
        body,
      });
      const consent = yield* Shared.decode(ConsentSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "save_bank_connector_consent",
        principal.actorId,
        yield* Shared.toJsonObject(consent),
      );

      return consent;
    }),
  );
});

export const getConnectorConsent = Effect.fn("banking.connector.getConsent")(function* (
  token: string,
  command: { readonly scope: Scope; readonly consentId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, connectorTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");
      const consent = yield* readConsent(transaction, command.scope.bookId, command.consentId);

      return yield* Shared.decode(ConsentStateSchema, consentState(consent));
    }),
  );
});

export const revokeConnectorConsent = Effect.fn("banking.connector.revokeConsent")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly consentId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Connector.RevokeConnectorConsent.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(
        transaction,
        connectorTables,
        ["command_receipts"],
        ["bank_connector_consents"],
      );
      const book = yield* lockBook(transaction, command.scope.bookId);

      if (!book) return yield* failure("Forbidden");

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "revoke_bank_connector_consent",
        principal.actorId,
        {
          consentId: command.consentId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        RevocationSchema,
      );

      if (request.previous) return request.previous;

      const consent = (yield* ConnectorDb.readConsentForUpdate(
        transaction,
        command.scope.bookId,
        command.consentId,
      ))[0];

      if (!consent) return yield* failure("NotFound");

      if (consent.revokedAt !== null) return yield* failure("IdempotencyConflict");

      const body = yield* Shared.toJsonObject(
        Object.assign(
          {},
          {
            consentId: command.consentId,
            revokedAt: yield* isoNow(transaction),
            revokedBy: principal.actorId,
            reason: command.input.reason,
            receipt: Shared.receipt(
              command.idempotencyKey,
              "revoke_bank_connector_consent",
              principal.actorId,
            ),
          },
        ),
      );

      yield* ConnectorDb.revokeConsent(transaction, command.scope.bookId, command.consentId);
      const revocation = yield* Shared.decode(RevocationSchema, body);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "revoke_bank_connector_consent",
        principal.actorId,
        yield* Shared.toJsonObject(revocation),
      );

      return revocation;
    }),
  );
});

export const getConnectorBatch = Effect.fn("banking.connector.getBatch")(function* (
  token: string,
  command: { readonly scope: Scope; readonly batchId: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, connectorTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");

      const batch = (yield* ConnectorDb.readBatch(
        transaction,
        command.scope.bookId,
        command.batchId,
      ))[0];

      if (!batch) return yield* failure("NotFound");

      return yield* Shared.decode(BatchSchema, batch.body);
    }),
  );
});

export const recoverConnectorBatch = Effect.fn("banking.connector.recoverBatch")(function* (
  token: string,
  command: { readonly scope: Scope; readonly key: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, connectorTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");

      if (!recoveryKeyPattern.test(command.key)) return yield* failure("InvalidJournal");

      const receipt = (yield* BankDb.readCommandReceipt(
        transaction,
        command.scope.bookId,
        command.key,
        "ingest_bank_connector_batch",
        principal.actorId,
      ))[0];

      if (!receipt) return yield* failure("NotFound");

      return yield* Shared.decode(BatchSchema, receipt.result);
    }),
  );
});

export const listConnectorConsents = Effect.fn("banking.connector.listConsents")(function* (
  token: string,
  command: { readonly scope: Scope; readonly cursor?: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, connectorTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");
      const after = command.cursor ?? "";

      if (after !== "" && !Shared.identifierPattern.test(after)) {
        return yield* failure("InvalidJournal");
      }

      const rows = yield* ConnectorDb.readConsentInventory(
        transaction,
        command.scope.bookId,
        after,
      );

      const visible = rows.slice(0, 50);

      return yield* Shared.decode(ConsentInventorySchema, {
        scope: command.scope,
        items: visible.map(consentState),
        nextCursor: rows.length > 50 ? (visible[49]?.id ?? null) : null,
      });
    }),
  );
});

export const listConnectorBatches = Effect.fn("banking.connector.listBatches")(function* (
  token: string,
  command: { readonly scope: Scope; readonly consentId: string; readonly cursor?: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, connectorTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");
      yield* readConsent(transaction, command.scope.bookId, command.consentId);
      const cursor = command.cursor ?? "";
      let cursorTime = "";

      if (cursor !== "") {
        if (!Shared.identifierPattern.test(cursor)) return yield* failure("InvalidJournal");

        const anchor = (yield* ConnectorDb.readBatchAnchor(
          transaction,
          command.scope.bookId,
          command.consentId,
          cursor,
        ))[0];

        if (!anchor) return yield* failure("NotFound");
        cursorTime = anchor.receivedAt;
      }

      const rows = yield* ConnectorDb.readBatchPage(
        transaction,
        command.scope.bookId,
        command.consentId,
        cursor,
        cursorTime,
      );

      const visible = rows.slice(0, 50);

      return yield* Shared.decode(BatchInventorySchema, {
        scope: command.scope,
        consentId: command.consentId,
        items: visible.map((row) => row.body),
        nextCursor: rows.length > 50 ? (visible[49]?.id ?? null) : null,
      });
    }),
  );
});

export const listConnectorFeeds = Effect.fn("banking.connector.listFeeds")(function* (
  token: string,
  command: { readonly scope: Scope; readonly cursor?: string; readonly consentId?: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, connectorTables);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");
      const cursor = command.cursor ?? "";
      const consentId = command.consentId ?? "";

      if (cursor !== "" && !Shared.identifierPattern.test(cursor)) {
        return yield* failure("InvalidJournal");
      }

      if (consentId !== "") {
        if (!Shared.identifierPattern.test(consentId)) return yield* failure("InvalidJournal");
        yield* readConsent(transaction, command.scope.bookId, consentId);
      }

      const readAt = (yield* ConnectorDb.readStatementTime(transaction))[0]?.now;

      if (readAt === undefined) return yield* failure("InternalError");

      const page = (yield* ConnectorDb.readFeedInventory(
        transaction,
        command.scope.bookId,
        consentId,
        cursor,
        readAt,
        JSON.stringify(command.scope),
      ))[0];

      return yield* Shared.decode(FeedInventorySchema, {
        scope: command.scope,
        items: page?.items ?? [],
        nextCursor: page?.nextCursor ?? null,
      });
    }),
  );
});

type IngestedRecords = {
  readonly recordCount: number;
  readonly overlapCount: number;
  readonly items: ReadonlyArray<JsonObject>;
};

function ingestRecords(
  transaction: import("../../db/transaction").Transaction,
  consent: ConnectorDb.ConsentRow,
  scope: Scope,
  input: typeof Connector.IngestConnectorBatch.Type,
  records: ReadonlyArray<typeof Connector.ConnectorRecordInput.Type>,
  batchId: string,
  batchReceipt: JsonObject,
  receivedAt: string,
  actorId: string,
) {
  return Effect.gen(function* () {
    const items: JsonObject[] = [];
    let recordCount = 0;
    let overlapCount = 0;

    for (const record of records) {
      const rawBytes = Shared.byteLength(record.raw);

      if (rawBytes < 1 || rawBytes > maximumRawBytes) return yield* failure("InvalidJournal");
      const revision = record.revision ?? input.sourceRevision;

      if (consent.providerId === "plaid" && record.revision !== undefined) {
        const digest = yield* sha256Hex(record.raw);

        if (!/^[a-f0-9]{64}$/.test(record.revision) || digest !== record.revision) {
          return yield* failure("InvalidJournal");
        }
      }

      const sha256 = `sha256:${yield* sha256Hex(record.raw)}`;

      const retained = (yield* ConnectorDb.readConnectorRecord(
        transaction,
        scope.bookId,
        consent.id,
        record.externalId,
        revision,
      ))[0];

      if (retained) {
        if (retained.sha256 !== sha256) return yield* failure("IdempotencyConflict");
        overlapCount += 1;
        items.push({
          externalId: record.externalId,
          revision,
          occurrenceId: retained.occurrenceId,
          status: "overlap",
        });
        continue;
      }

      const sourceSystem = `connector:${consent.providerId}`;

      if (
        (yield* ConnectorDb.readSourceIdentityConflict(
          transaction,
          scope.bookId,
          sourceSystem,
          consent.sourceAccountId,
          record.externalId,
          revision,
        ))[0]?.present === true
      ) {
        return yield* failure("IdempotencyConflict");
      }

      const occurrenceId = newId("source");
      yield* ConnectorDb.insertIntakeContent(transaction, {
        bookId: scope.bookId,
        sha256,
        bytes: record.raw,
      });
      yield* ConnectorDb.insertIntakeOccurrence(transaction, {
        bookId: scope.bookId,
        id: occurrenceId,
        sha256,
        sourceSystem,
        sourceAccountId: consent.sourceAccountId,
        occurrenceKey: record.externalId,
        sourceRevision: revision,
        body: Object.assign(
          {},
          {
            id: occurrenceId,
            scope,
            sourceSystem,
            sourceAccountId: consent.sourceAccountId,
            occurrenceKey: record.externalId,
            sourceRevision: revision,
            filename: "provider-record",
            sha256,
            byteLength: rawBytes,
            mediaType: "application/octet-stream",
            retainedBy: actorId,
            retainedAt: receivedAt,
            receipt: batchReceipt,
          },
        ) satisfies JsonObject,
      });
      yield* ConnectorDb.insertConnectorRecord(transaction, {
        bookId: scope.bookId,
        consentId: consent.id,
        externalId: record.externalId,
        revision,
        occurrenceId,
        batchId,
        sha256,
      });
      recordCount += 1;

      const superseded =
        (yield* ConnectorDb.readOtherRevisions(
          transaction,
          scope.bookId,
          consent.id,
          record.externalId,
          revision,
        ))[0]?.present === true;

      items.push({
        externalId: record.externalId,
        revision,
        occurrenceId,
        status: superseded ? "revision" : "new",
      });
    }

    return { recordCount, overlapCount, items } satisfies IngestedRecords;
  });
}

function pageIsAdmissible(
  consent: ConnectorDb.ConsentRow,
  input: typeof Connector.IngestConnectorBatch.Type,
  previousCursor: string,
  nextCursor: string,
) {
  return (
    previousCursor.length <= 256 &&
    nextCursor.length <= 256 &&
    previousCursor === (consent.cursor ?? "") &&
    input.records.length <= maximumPageRecords &&
    Shared.byteLength(JSON.stringify(input)) <= maximumInputBytes &&
    (input.providerOutcome === "delivered"
      ? nextCursor !== previousCursor
      : input.records.length === 0 && nextCursor === previousCursor)
  );
}

function retainedProviderPage(
  transaction: Transaction,
  consent: ConnectorDb.ConsentRow,
  bookId: string,
  occurrenceId: string,
  previousCursor: string,
  hasRevisions: boolean,
) {
  return Effect.gen(function* () {
    const page = (yield* ConnectorDb.readRetainedPage(transaction, bookId, occurrenceId))[0];

    if (!page) return false;

    const expectedOccurrenceKey = `plaidraw_${(yield* sha256Hex(
      `${bookId}:${consent.id}:${previousCursor}`,
    )).slice(0, 48)}`;

    return !(
      page.sourceSystem !== `connector-raw:${consent.providerId}` ||
      page.sourceAccountId !== consent.sourceAccountId ||
      Shared.textField(page.body, "mediaType") !== "application/json" ||
      (consent.providerId === "plaid" &&
        hasRevisions &&
        page.occurrenceKey !== expectedOccurrenceKey)
    );
  });
}

export const ingestConnectorBatch = Effect.fn("banking.connector.ingestBatch")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly consentId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Connector.IngestConnectorBatch.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, connectorTables, connectorInserts, [
        "bank_connector_consents",
      ]);
      const book = yield* lockBook(transaction, command.scope.bookId);

      if (!book) return yield* failure("Forbidden");

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "ingest_bank_connector_batch",
        principal.actorId,
        {
          consentId: command.consentId,
          input: yield* Shared.toJsonObject(command.input),
        } satisfies JsonObject,
        BatchSchema,
      );

      if (request.previous) return request.previous;

      const consent = (yield* ConnectorDb.readConsentForUpdate(
        transaction,
        command.scope.bookId,
        command.consentId,
      ))[0];

      if (!consent) return yield* failure("NotFound");

      if (consent.revokedAt !== null) return yield* failure("ApprovalRequired");

      if (
        !(yield* mappingIsCurrent(
          transaction,
          command.scope.bookId,
          consent.sourceAccountId,
          consent.accountId,
        ))
      ) {
        return yield* failure("StaleDependency");
      }

      const outcome = command.input.providerOutcome;
      const records = command.input.records;
      const previousCursor = command.input.previousCursor;
      const nextCursor = command.input.nextCursor;
      const hasRevisions = records.some((record) => record.revision !== undefined);

      if (!pageIsAdmissible(consent, command.input, previousCursor, nextCursor)) {
        return yield* failure("InvalidJournal");
      }

      if (consent.providerId === "plaid" && hasRevisions) {
        if (command.input.sourceOccurrenceId === undefined) {
          return yield* failure("MissingEvidence");
        }
      }

      if (command.input.sourceOccurrenceId !== undefined) {
        const retained = yield* retainedProviderPage(
          transaction,
          consent,
          command.scope.bookId,
          command.input.sourceOccurrenceId,
          previousCursor,
          hasRevisions,
        );

        if (!retained) return yield* failure("MissingEvidence");
      }

      const receivedAt = yield* isoNow(transaction);
      const batchId = newId("connectorbatch");

      const batchReceipt = Shared.receipt(
        command.idempotencyKey,
        "ingest_bank_connector_batch",
        principal.actorId,
      );

      const ingested = yield* ingestRecords(
        transaction,
        consent,
        command.scope,
        command.input,
        records,
        batchId,
        batchReceipt,
        receivedAt,
        principal.actorId,
      );

      const body: JsonObject = {
        id: batchId,
        scope: command.scope,
        consentId: command.consentId,
        providerOutcome: outcome,
        previousCursor,
        nextCursor,
        sourceRevision: command.input.sourceRevision,
        recordCount: ingested.recordCount,
        overlapCount: ingested.overlapCount,
        items: ingested.items,
        recognition: "not_admitted",
        providerVerification: "not_established",
        receivedAt,
        receivedBy: principal.actorId,
        receipt: batchReceipt,
      };

      const bodyWithSource: JsonObject =
        command.input.sourceOccurrenceId === undefined
          ? body
          : Object.assign({}, body, { sourceOccurrenceId: command.input.sourceOccurrenceId });

      yield* ConnectorDb.insertBatch(transaction, {
        bookId: command.scope.bookId,
        id: batchId,
        consentId: command.consentId,
        body: yield* Shared.toJsonObject(bodyWithSource),
      });

      if (outcome === "delivered") {
        yield* ConnectorDb.advanceConsentCursor(
          transaction,
          command.scope.bookId,
          command.consentId,
          nextCursor,
        );
      }

      const batch = yield* Shared.decode(BatchSchema, yield* Shared.toJsonObject(bodyWithSource));
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "ingest_bank_connector_batch",
        principal.actorId,
        yield* Shared.toJsonObject(batch),
      );

      return batch;
    }),
  );
});
