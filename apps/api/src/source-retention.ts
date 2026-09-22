import * as Effect from "effect/Effect";
import { Buffer } from "node:buffer";
import * as Schema from "effect/Schema";
import * as Intake from "@open-erp/contracts/source-intake";
import { objectStore, readRetainedObject, RetainedObject, sourceDigest } from "./retained-objects";
import { failure, query, scopeParameter } from "./database";

const SourceStorage = Schema.Struct({
  ...Intake.SourceOccurrenceView.fields,
  contentBase64: Schema.NullOr(Schema.String),
  object: Schema.NullOr(RetainedObject),
});

export const retainSource = Effect.fn("Source.retain")(function* (
  token: string,
  command: typeof Intake.SourceIntakeCapabilities.source_retain.input.Type,
) {
  const input = command.input;
  const bytes = yield* Effect.try({
    try: () => Buffer.from(input.contentBase64, "base64"),
    catch: () => failure("InvalidJournal"),
  });
  if (
    bytes.length < 1 ||
    bytes.length > Intake.maxSourceBytes ||
    encodeSource(bytes) !== input.contentBase64
  )
    return yield* failure("InvalidJournal");
  const scope = scopeParameter(command.scope);
  const mediaType = input.mediaType ?? "text/csv";
  if (mediaType === "text/csv" && bytes.length <= 65536) {
    const inline = {
      sourceSystem: input.sourceSystem,
      sourceAccountId: input.sourceAccountId,
      occurrenceKey: input.occurrenceKey,
      sourceRevision: input.sourceRevision,
      filename: input.filename,
      contentBase64: input.contentBase64,
    };
    return yield* query(
      "retainSource",
      [token, scope, command.idempotencyKey, JSON.stringify(inline)],
      Intake.SourceOccurrence,
    );
  }
  const store = yield* objectStore;
  const metadata = {
    sourceSystem: input.sourceSystem,
    sourceAccountId: input.sourceAccountId,
    occurrenceKey: input.occurrenceKey,
    sourceRevision: input.sourceRevision,
    filename: input.filename,
    mediaType,
    sha256: yield* sourceDigest(bytes),
    byteLength: bytes.length,
  };
  const reference = yield* query(
    "beginSourceUpload",
    [token, scope, command.idempotencyKey, JSON.stringify(metadata)],
    RetainedObject,
  );
  yield* Effect.tryPromise({
    try: () => store.put(reference.objectKey, bytes),
    catch: () => failure("Unavailable"),
  });
  yield* readRetainedObject(store, reference);
  return yield* query(
    "completeSourceUpload",
    [token, scope, command.idempotencyKey],
    Intake.SourceOccurrence,
  );
});

export function encodeSource(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

export const getSourceOccurrence = Effect.fn("Source.getOccurrence")(function* (
  token: string,
  command: typeof Intake.SourceIntakeCapabilities.source_get_occurrence.input.Type,
) {
  let source = yield* query(
    "getSourceStorage",
    [token, scopeParameter(command.scope), command.occurrenceId],
    SourceStorage,
  );
  let contentBase64 = source.contentBase64;
  if (source.object) {
    const store = yield* objectStore;
    contentBase64 = encodeSource(yield* readRetainedObject(store, source.object));
    // Recheck admission after the external read, including session/membership revocation.
    source = yield* query(
      "getSourceStorage",
      [token, scopeParameter(command.scope), command.occurrenceId],
      SourceStorage,
    );
  }
  if (contentBase64 === null) return yield* failure("MissingEvidence");
  return {
    occurrence: source.occurrence,
    latestPreviewId: source.latestPreviewId,
    admission: source.admission,
    previewIds: source.previewIds,
    contentBase64,
  };
});
