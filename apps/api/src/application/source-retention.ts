import { runBookCommand } from "./book-commands";
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
import { digest } from "./json";
import { isoNow, replay } from "./command-receipts";
import { newId } from "./identifiers";
import { lockBookForShare, lockBookForUpdate } from "../db/posting";
import * as Retention from "../db/source-retention";
import * as SupplierInboxDb from "../db/purchases/inbox";
import { readBook } from "./posting-validation";
import * as Archive from "../db/source-archive";
import type { Transaction } from "../db/transaction";
import {
  decode,
  requireTableAccess,
  requireInsertAccess,
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
    command.input.destination === "supplier_inbox",
    function* (transaction, principal) {
      yield* requireRetentionAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const supplier = command.input.destination === "supplier_inbox";

      if (supplier) {
        const book = yield* readBook(transaction, command.scope);

        if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
          return yield* unsupported();
        yield* requireTableAccess(transaction, ["supplier_inbox"], false);
        yield* requireInsertAccess(transaction, ["supplier_inbox"]);
      }

      const source =
        mediaType === "text/csv" && bytes.length <= inlineBytesBound
          ? yield* retainInline(transaction, command, principal.actorId, key, mediaType, bytes)
          : yield* retainExternal(transaction, command, principal.actorId, key, mediaType, bytes);

      if (supplier) {
        yield* SupplierInboxDb.insertInbox(transaction, {
          bookId: command.scope.bookId,
          occurrenceId: source.id,
          channel: "upload",
          messageIdentity: null,
        });

        const registered = yield* SupplierInboxDb.readRegistration(
          transaction,
          command.scope.bookId,
          source.id,
          "upload",
          null,
        );

        if (registered[0]?.registered !== true) return yield* failure("IdempotencyConflict");
      }

      return source;
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

    return yield* runBookCommand(
      transaction,
      {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        operation: "retain_source",
        actorId: actorId,
        input: payload,
      },
      OccurrenceSchema,
      Effect.gen(function* () {
        const sha256 = yield* sourceDigest(bytes);

        const content = (yield* Retention.readExternalContent(
          transaction,
          command.scope.bookId,
          sha256,
        ))[0];

        if (content?.objectKey !== null && content !== undefined) return yield* unsupported();

        const found = (yield* Retention.readOccurrenceByKey(
          transaction,
          command.scope.bookId,
          key,
        ))[0];

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

        return occurrence;
      }),
    );
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

    const uploadMetadata =
      command.input.destination === undefined
        ? metadata
        : Object.assign({}, metadata, { destination: command.input.destination });

    const reference = yield* beginUpload(
      transaction,
      command.scope,
      command.idempotencyKey,
      actorId,
      uploadMetadata,
    );

    if (reference.completed !== undefined) return reference.completed;

    const store = yield* objectStore;

    const existing = yield* Effect.tryPromise({
      try: () => store.get(reference.objectKey),
      catch: () => failure("Unavailable"),
    });

    if (existing === null) {
      yield* Effect.tryPromise({
        try: () => store.put(reference.objectKey, bytes),
        catch: () => failure("Unavailable"),
      });
    }

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

    yield* exactKeys(
      metadata,
      metadata.destination === undefined
        ? uploadMetadataKeys
        : [...uploadMetadataKeys, "destination"],
    );
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

    return yield* runBookCommand(
      transaction,
      {
        scope: scope,
        idempotencyKey: idempotencyKey,
        operation: "retain_source_object",
        actorId: actorId,
        input: saved.input,
      },
      OccurrenceSchema,
      Effect.gen(function* () {
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

        return occurrence;
      }),
    );
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

export function readSourceOccurrenceInTransaction(
  transaction: Transaction,
  scope: Scope,
  occurrenceId: string,
) {
  return requireRetentionAccess(transaction, false).pipe(
    Effect.flatMap(() => readStorage(transaction, scope, occurrenceId)),
    Effect.map((storage) => storage.occurrence),
  );
}

export function readSourceBytesInTransaction(
  transaction: Transaction,
  scope: Scope,
  occurrenceId: string,
) {
  return Effect.gen(function* () {
    yield* requireRetentionAccess(transaction, false);
    const storage = yield* readStorage(transaction, scope, occurrenceId);

    const bytes =
      storage.object === null
        ? storage.contentBase64 === null
          ? null
          : Buffer.from(storage.contentBase64, "base64")
        : yield* readRetainedObject(yield* objectStore, storage.object);

    if (
      bytes === null ||
      bytes.byteLength !== storage.occurrence.byteLength ||
      (yield* sourceDigest(bytes)) !== storage.occurrence.sha256
    )
      return yield* failure("MissingEvidence");

    return { occurrence: storage.occurrence, bytes };
  });
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

const ArchiveTraversal = Schema.Struct({
  context: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  cutoff: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/)),
  after: Intake.SourceOccurrence.fields.id,
});

function normalizedArchiveFilters(filters: Filters) {
  return {
    occurrenceId: filters.occurrenceId ?? null,
    sourceSystem: filters.sourceSystem ?? null,
    filename: filters.filename ?? null,
    retainedFrom: filters.retainedFrom ?? null,
    retainedTo: filters.retainedTo ?? null,
    q: filters.q?.trim() || null,
    supplierId: filters.supplierId ?? null,
    documentFrom: filters.documentFrom ?? null,
    documentTo: filters.documentTo ?? null,
    currency: filters.currency ?? null,
    currencyScale: filters.currencyScale ?? null,
    amountMinor: filters.amountMinor ?? null,
    invoiceId: filters.invoiceId ?? null,
    voucherId: filters.voucherId ?? null,
  };
}

function readArchive(transaction: Transaction, scope: Scope, filters: Filters) {
  return Effect.gen(function* () {
    yield* Schema.decodeEffect(Intake.ArchiveFilters)(filters, {
      onExcessProperty: "error",
    }).pipe(Effect.mapError(() => failure("InvalidJournal")));

    if (
      (filters.amountMinor !== undefined &&
        (filters.currency === undefined || filters.currencyScale === undefined)) ||
      (filters.currencyScale !== undefined && filters.currency === undefined) ||
      (filters.documentFrom !== undefined &&
        filters.documentTo !== undefined &&
        filters.documentFrom > filters.documentTo) ||
      (filters.retainedFrom !== undefined &&
        filters.retainedTo !== undefined &&
        filters.retainedFrom > filters.retainedTo)
    ) {
      return yield* failure("InvalidJournal");
    }

    const access = yield* Archive.readArchiveAccess(transaction);

    if (
      Archive.archiveTables.some(
        (table) => !access.some((row) => row.tableName === table && row.canSelect),
      )
    ) {
      return yield* unsupported();
    }

    const normalized = normalizedArchiveFilters(filters);

    const now = yield* isoNow(transaction);

    let cutoff = now;

    let after: string | null = null;

    if (filters.cursor !== undefined) {
      const encoded = filters.cursor.slice(5);

      const content = Buffer.from(encoded, "base64url").toString("utf8");

      if (Buffer.from(content).toString("base64url") !== encoded)
        return yield* failure("InvalidJournal");

      const cursor = yield* Schema.decodeEffect(Schema.fromJsonString(ArchiveTraversal))(
        content,
      ).pipe(Effect.mapError(() => failure("InvalidJournal")));

      const expectedContext = (yield* digest({
        scope,
        filters: normalized,
        cutoff: cursor.cutoff,
      })).slice(7);

      if (
        cursor.context !== expectedContext ||
        !Number.isFinite(Date.parse(cursor.cutoff)) ||
        Date.parse(cursor.cutoff) > Date.parse(now)
      ) {
        return yield* failure("InvalidJournal");
      }

      cutoff = cursor.cutoff;
      after = cursor.after;

      const anchors = yield* Archive.readArchiveAnchor(transaction, scope.bookId, {
        filters,
        cutoff,
        after,
      });

      if (anchors.length !== 1) return yield* failure("InvalidJournal");
    }

    const selectionFilters = { ...filters, q: normalized.q ?? undefined };

    const rows = yield* Archive.listArchive(transaction, scope.bookId, {
      filters: selectionFilters,
      cutoff,
      after,
    });

    const page = rows.slice(0, archivePageSize);

    if (page.some((row) => Array.isArray(row.facts) && row.facts.length > 1000))
      return yield* unsupported();

    const items = yield* Effect.forEach(page, (row) =>
      decode(
        Intake.DocumentSearchRow,
        Object.assign({}, row.body, {
          facts: row.facts,
          suggestions: row.suggestions,
          originalAvailability: "not_checked",
        }),
      ),
    );

    const context = (yield* digest({ scope, filters: normalized, cutoff })).slice(7);

    const anchor = page.at(-1);

    const nextCursor =
      rows.length > page.length && anchor !== undefined
        ? `arc1:${Buffer.from(JSON.stringify({ context, cutoff, after: anchor.id })).toString("base64url")}`
        : null;

    return yield* decode(ArchiveSchema, {
      items,
      nextCursor,
      retainedCutoff: cutoff,
      metadataConsistency: "live_owner_revisions",
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
    items.push({ occurrence: original.occurrence, contentBase64: original.contentBase64 });
  }

  yield* searchSourceArchive(token, scope, filters);

  return yield* decode(ExportSchema, {
    scope,
    items,
    nextCursor: page.nextCursor,
    retainedCutoff: page.retainedCutoff,
    metadataConsistency: page.metadataConsistency,
  });
});
