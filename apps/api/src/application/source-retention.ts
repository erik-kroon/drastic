import * as Intake from "@open-erp/contracts/source-intake";
import { Buffer } from "node:buffer";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  objectStore,
  readRetainedObject,
  RetainedObject,
  sourceDigest,
} from "../adapters/storage/retained-objects";
import { failure } from "./failures";
import { digest, isoNow, newId, replay, saveCommand } from "./posting";
import { lockBookForShare, lockBookForUpdate } from "../db/posting";
import * as Retention from "../db/source-retention";
import type { Transaction } from "../db/transaction";
import {
  decode,
  exactKeys,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./commerce/support";

type Filters = typeof Intake.ArchiveFilters.Type;

type OccurrenceKey = {
  readonly sourceSystem: string;
  readonly sourceAccountId: string;
  readonly occurrenceKey: string;
  readonly sourceRevision: string;
};

const OccurrenceSchema = Intake.SourceOccurrence;

const AdmissionSchema = Intake.SourceAdmission;

const ArchiveSchema = Intake.ArchiveSearch;

const ExportSchema = Intake.ArchiveExport;

const SourceStorage = Schema.Struct({
  ...Intake.SourceOccurrenceView.fields,
  contentBase64: Schema.NullOr(Schema.String),
  object: Schema.NullOr(RetainedObject),
});

const SourceUpload = Schema.Struct({
  ...RetainedObject.fields,
  completed: Schema.optional(OccurrenceSchema),
});

const archiveFilterKeys = [
  "cursor",
  "sourceSystem",
  "filename",
  "retainedFrom",
  "retainedTo",
] as const;

const uploadMetadataKeys = [
  "sourceSystem",
  "sourceAccountId",
  "occurrenceKey",
  "sourceRevision",
  "filename",
  "sha256",
  "byteLength",
  "mediaType",
] as const;

const inlineBytesBound = 65536;

const archivePageSize = 10;

function requireRetentionAccess(transaction: Transaction, write: boolean) {
  return Retention.readRetentionAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = Retention.retentionTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);

        const inserts = [
          "intake_occurrences",
          "intake_contents",
          "source_uploads",
          "command_receipts",
        ];

        return (
          access === undefined ||
          !access.canSelect ||
          (write && inserts.includes(name) && !access.canInsert)
        );
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function textField(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function numberField(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "number" ? found : null;
}

function objectKeyFor(bookId: string, sha256: string) {
  return `v1/${bookId}/${sha256.slice(7)}`;
}

export function encodeSource(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function requireMatchingOccurrence(
  row: Retention.OccurrenceKeyRow,
  sha256: string,
  filename: string,
  mediaType: string,
) {
  return row.sha256 === sha256 &&
    textField(row.body, "filename") === filename &&
    textField(row.body, "mediaType") === mediaType
    ? Effect.void
    : failure("IdempotencyConflict");
}

function occurrenceReceipt(
  key: OccurrenceKey,
  filename: string,
  mediaType: string,
  sha256: string,
  byteLength: number,
) {
  return {
    sourceSystem: key.sourceSystem,
    sourceAccountId: key.sourceAccountId,
    occurrenceKey: key.occurrenceKey,
    sourceRevision: key.sourceRevision,
    filename,
    mediaType,
    sha256,
    byteLength,
  } satisfies JsonObject;
}

export const retainSource = Effect.fn("Source.retain")(function* (
  token: string,
  command: typeof Intake.SourceIntakeCapabilities.source_retain.input.Type,
) {
  const bytes = yield* Effect.try({
    try: () => Buffer.from(command.input.contentBase64, "base64"),
    catch: () => failure("InvalidJournal"),
  });

  if (
    bytes.length < 1 ||
    bytes.length > Intake.maxSourceBytes ||
    encodeSource(bytes) !== command.input.contentBase64
  ) {
    return yield* failure("InvalidJournal");
  }

  const mediaType = command.input.mediaType ?? "text/csv";
  const key: OccurrenceKey = command.input;

  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      yield* requireRetentionAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);

      if (mediaType === "text/csv" && bytes.length <= inlineBytesBound) {
        return yield* retainInline(transaction, command, principal.actorId, key, mediaType, bytes);
      }

      return yield* retainExternal(transaction, command, principal.actorId, key, mediaType, bytes);
    },
    "update",
  );
});

function retainInline(
  transaction: Transaction,
  command: typeof Intake.SourceIntakeCapabilities.source_retain.input.Type,
  actorId: string,
  key: OccurrenceKey,
  mediaType: string,
  bytes: Uint8Array,
) {
  return Effect.gen(function* () {
    const payload = yield* toJsonObject(command.input);

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "retain_source",
      actorId,
      payload,
      OccurrenceSchema,
    );

    if (request.previous) return request.previous;
    const sha256 = yield* sourceDigest(bytes);

    const content = (yield* Retention.readExternalContent(
      transaction,
      command.scope.bookId,
      sha256,
    ))[0];

    if (content?.objectKey !== null && content !== undefined) return yield* unsupported();
    const found = (yield* Retention.readOccurrenceByKey(transaction, command.scope.bookId, key))[0];

    const body =
      found === undefined
        ? yield* insertInlineOccurrence(
            transaction,
            command.scope,
            command.idempotencyKey,
            actorId,
            key,
            command.input.filename,
            mediaType,
            sha256,
            bytes,
          )
        : (yield* requireMatchingOccurrence(found, sha256, command.input.filename, mediaType),
          found.body);

    const occurrence = yield* decode(OccurrenceSchema, body);
    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "retain_source",
      actorId,
      occurrence,
    );

    return occurrence;
  });
}

function insertInlineOccurrence(
  transaction: Transaction,
  scope: Scope,
  idempotencyKey: string,
  actorId: string,
  key: OccurrenceKey,
  filename: string,
  mediaType: string,
  sha256: string,
  bytes: Uint8Array,
) {
  return Effect.gen(function* () {
    yield* Retention.insertInlineContent(transaction, scope.bookId, sha256, bytes);
    const id = newId("source");

    const body: JsonObject = Object.assign(
      occurrenceReceipt(key, filename, mediaType, sha256, bytes.length),
      {
        id,
        scope,
        retainedBy: actorId,
        retainedAt: yield* isoNow(transaction),
        receipt: { key: idempotencyKey, operation: "retain_source", actorId },
      },
    );

    yield* Retention.insertOccurrence(transaction, {
      bookId: scope.bookId,
      id,
      sha256,
      sourceSystem: key.sourceSystem,
      sourceAccountId: key.sourceAccountId,
      occurrenceKey: key.occurrenceKey,
      sourceRevision: key.sourceRevision,
      body,
    });

    return body;
  });
}

function retainExternal(
  transaction: Transaction,
  command: typeof Intake.SourceIntakeCapabilities.source_retain.input.Type,
  actorId: string,
  key: OccurrenceKey,
  mediaType: string,
  bytes: Uint8Array,
) {
  return Effect.gen(function* () {
    const sha256 = yield* sourceDigest(bytes);

    const metadata: JsonObject = occurrenceReceipt(
      key,
      command.input.filename,
      mediaType,
      sha256,
      bytes.length,
    );

    const reference = yield* beginUpload(
      transaction,
      command.scope,
      command.idempotencyKey,
      actorId,
      metadata,
    );

    if (reference.completed !== undefined) return reference.completed;
    const store = yield* objectStore;
    yield* Effect.tryPromise({
      try: () => store.put(reference.objectKey, bytes),
      catch: () => failure("Unavailable"),
    });
    yield* readRetainedObject(store, reference);

    return yield* completeUpload(
      transaction,
      command.scope,
      command.idempotencyKey,
      actorId,
      key,
      command.input.filename,
      mediaType,
      sha256,
      bytes.length,
      reference,
    );
  });
}

function beginUpload(
  transaction: Transaction,
  scope: Scope,
  idempotencyKey: string,
  actorId: string,
  metadata: JsonObject,
) {
  return Effect.gen(function* () {
    const sha256 = textField(metadata, "sha256") ?? "";
    const byteLength = numberField(metadata, "byteLength");

    if (byteLength === null) return yield* failure("InvalidJournal");

    const reference = {
      objectKey: objectKeyFor(scope.bookId, sha256),
      sha256,
      byteLength,
    } satisfies JsonObject;

    const request = yield* replay(
      transaction,
      scope,
      idempotencyKey,
      "retain_source_object",
      actorId,
      metadata,
      OccurrenceSchema,
    );

    if (request.previous) {
      return yield* decode(
        SourceUpload,
        Object.assign({}, reference, { completed: request.previous }),
      );
    }

    yield* exactKeys(metadata, uploadMetadataKeys);
    yield* Retention.insertSourceUpload(
      transaction,
      scope.bookId,
      idempotencyKey,
      metadata,
      actorId,
    );
    const saved = (yield* Retention.readSourceUpload(transaction, scope.bookId, idempotencyKey))[0];

    if (
      saved === undefined ||
      (yield* digest(saved.input)) !== (yield* digest(metadata)) ||
      saved.createdBy !== actorId
    ) {
      return yield* failure("IdempotencyConflict");
    }

    return yield* decode(SourceUpload, reference);
  });
}

function completeUpload(
  transaction: Transaction,
  scope: Scope,
  idempotencyKey: string,
  actorId: string,
  key: OccurrenceKey,
  filename: string,
  mediaType: string,
  sha256: string,
  byteLength: number,
  reference: typeof RetainedObject.Type,
) {
  return Effect.gen(function* () {
    const saved = (yield* Retention.readSourceUpload(transaction, scope.bookId, idempotencyKey))[0];

    if (saved === undefined || saved.createdBy !== actorId) return yield* failure("NotFound");

    const request = yield* replay(
      transaction,
      scope,
      idempotencyKey,
      "retain_source_object",
      actorId,
      saved.input,
      OccurrenceSchema,
    );

    if (request.previous) return request.previous;
    const found = (yield* Retention.readOccurrenceByKey(transaction, scope.bookId, key))[0];

    const body =
      found === undefined
        ? yield* insertExternalOccurrence(
            transaction,
            scope,
            idempotencyKey,
            actorId,
            key,
            filename,
            mediaType,
            sha256,
            byteLength,
            reference,
          )
        : (yield* requireMatchingOccurrence(found, sha256, filename, mediaType), found.body);

    const occurrence = yield* decode(OccurrenceSchema, body);
    yield* saveCommand(
      transaction,
      scope,
      idempotencyKey,
      request.expected,
      "retain_source_object",
      actorId,
      occurrence,
    );

    return occurrence;
  });
}

function insertExternalOccurrence(
  transaction: Transaction,
  scope: Scope,
  idempotencyKey: string,
  actorId: string,
  key: OccurrenceKey,
  filename: string,
  mediaType: string,
  sha256: string,
  byteLength: number,
  reference: typeof RetainedObject.Type,
) {
  return Effect.gen(function* () {
    yield* Retention.insertExternalContent(
      transaction,
      scope.bookId,
      sha256,
      reference.objectKey,
      byteLength,
    );
    const content = (yield* Retention.readExternalContent(transaction, scope.bookId, sha256))[0];

    if (content === undefined || content.byteLength !== byteLength) {
      return yield* failure("MissingEvidence");
    }

    const id = newId("source");

    const body: JsonObject = Object.assign(
      occurrenceReceipt(key, filename, mediaType, sha256, byteLength),
      {
        id,
        scope,
        retainedBy: actorId,
        retainedAt: yield* isoNow(transaction),
        receipt: { key: idempotencyKey, operation: "retain_source_object", actorId },
      },
    );

    yield* Retention.insertOccurrence(transaction, {
      bookId: scope.bookId,
      id,
      sha256,
      sourceSystem: key.sourceSystem,
      sourceAccountId: key.sourceAccountId,
      occurrenceKey: key.occurrenceKey,
      sourceRevision: key.sourceRevision,
      body,
    });

    return body;
  });
}

function readStorage(transaction: Transaction, scope: Scope, occurrenceId: string) {
  return Retention.readOccurrenceStorage(transaction, scope.bookId, occurrenceId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      if (!row) return failure("NotFound");

      return Effect.gen(function* () {
        const occurrence = yield* decode(OccurrenceSchema, row.body);

        const admission =
          row.admissionBody === null ? null : yield* decode(AdmissionSchema, row.admissionBody);

        const object =
          row.objectKey === null
            ? null
            : yield* decode(RetainedObject, {
                objectKey: row.objectKey,
                sha256: row.objectSha256,
                byteLength: row.objectByteLength,
              });

        return yield* decode(SourceStorage, {
          occurrence,
          latestPreviewId: row.latestPreviewId,
          admission,
          previewIds: row.previewIds,
          contentBase64: row.inlineContent === null ? null : encodeSource(row.inlineContent),
          object,
        });
      });
    }),
  );
}

function readOccurrenceView(token: string, scope: Scope, occurrenceId: string) {
  return withBook(token, scope, false, function* (transaction) {
    yield* requireRetentionAccess(transaction, false);
    yield* lockBookForShare(transaction, scope);

    return yield* readStorage(transaction, scope, occurrenceId);
  });
}

export const getSourceOccurrence = Effect.fn("Source.getOccurrence")(function* (
  token: string,
  command: typeof Intake.SourceIntakeCapabilities.source_get_occurrence.input.Type,
) {
  const storage = yield* readOccurrenceView(token, command.scope, command.occurrenceId);

  const contentBase64 =
    storage.object === null
      ? storage.contentBase64
      : encodeSource(yield* readRetainedObject(yield* objectStore, storage.object));

  const rechecked =
    storage.object === null
      ? storage
      : yield* readOccurrenceView(token, command.scope, command.occurrenceId);

  if (contentBase64 === null) return yield* failure("MissingEvidence");

  return {
    occurrence: rechecked.occurrence,
    latestPreviewId: rechecked.latestPreviewId,
    admission: rechecked.admission,
    previewIds: rechecked.previewIds,
    contentBase64,
  };
});

export const getSourceOccurrenceMetadata = Effect.fn("Source.getOccurrenceMetadata")(function* (
  token: string,
  command: typeof Intake.SourceIntakeCapabilities.source_get_occurrence_metadata.input.Type,
) {
  const storage = yield* readOccurrenceView(token, command.scope, command.occurrenceId);
  const admission = storage.admission;

  return {
    occurrence: storage.occurrence,
    latestPreviewId: storage.latestPreviewId,
    previewIds: storage.previewIds,
    admission:
      admission === null
        ? null
        : {
            previewId: admission.previewId,
            digest: admission.digest,
            admittedAt: admission.admittedAt,
            admittedBy: admission.receipt.actorId,
            statementId: admission.imported.statement.id,
            evidenceId: admission.imported.statement.evidenceId,
            checkpoint: admission.imported.checkpoint,
          },
    originalAvailability: "not_checked",
  } satisfies typeof Intake.SourceOccurrenceMetadata.Type;
});

export const searchSourceArchive = Effect.fn("Source.searchArchive")(function* (
  token: string,
  scope: typeof Intake.SourceIntakeCapabilities.source_search_archive.input.Type.scope,
  filters: Filters,
) {
  return yield* withBook(token, scope, false, function* (transaction) {
    yield* requireRetentionAccess(transaction, false);
    yield* lockBookForShare(transaction, scope);

    return yield* readArchive(transaction, scope, filters);
  });
});

function readArchive(transaction: Transaction, scope: Scope, filters: Filters) {
  return Effect.gen(function* () {
    yield* exactKeys(yield* toJsonObject(filters), archiveFilterKeys);

    const rows = yield* Retention.listArchive(transaction, scope.bookId, {
      cursor: filters.cursor ?? null,
      sourceSystem: filters.sourceSystem ?? null,
      filename: filters.filename ?? null,
      retainedFrom: filters.retainedFrom ?? null,
      retainedTo: filters.retainedTo ?? null,
    });

    const page = rows.slice(0, archivePageSize);
    const items = yield* Effect.forEach(page, (row) => decode(OccurrenceSchema, row.body));

    return yield* decode(ArchiveSchema, {
      items,
      nextCursor: rows.length > page.length ? (page.at(-1)?.id ?? null) : null,
    });
  });
}

export const exportSourceArchive = Effect.fn("Source.exportArchive")(function* (
  token: string,
  scope: typeof Intake.SourceIntakeCapabilities.source_export_archive.input.Type.scope,
  filters: Filters,
) {
  const page = yield* searchSourceArchive(token, scope, filters);
  const items = [];

  for (const occurrence of page.items) {
    const original = yield* getSourceOccurrence(token, { scope, occurrenceId: occurrence.id });
    items.push({ occurrence, contentBase64: original.contentBase64 });
  }

  yield* searchSourceArchive(token, scope, filters);

  return yield* decode(ExportSchema, { scope, items, nextCursor: page.nextCursor });
});
