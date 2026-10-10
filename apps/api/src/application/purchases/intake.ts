import { createHash } from "node:crypto";
import * as Contracts from "@open-erp/contracts/supplier-inbox";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import * as Retention from "../../db/source-retention";
import * as IntakeDb from "../../db/purchases/intake";
import type { FixturePage } from "../../adapters/intake/local-fixture";
import { RequestEnvironment } from "../../runtime/environment";
import { failure } from "../failures";
import { retainSource } from "../source-retention";
import { registerSupplierInbox } from "./inbox";
import * as Shared from "../commerce/support";

type Scope = Shared.Scope;

type Item = typeof Contracts.IntakeItem.Type;

type PageItem = (typeof FixturePage.Type.items)[number];

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const destination = (scope: Scope) => `book-${scope.bookId}@intake.invalid`;

export const getIntakeDestination = Effect.fn("purchases.intake.destination")(function* (
  token: string,
  scope: Scope,
) {
  return yield* Shared.withBook(token, scope, true, function* (transaction) {
    yield* Retention.readRetentionAccess(transaction);

    return { address: destination(scope) };
  });
});

function processItem(
  token: string,
  scope: Scope,
  actorId: string,
  channel: "email" | "bulk" | "drive" | "dropbox",
  sourceAccountId: string,
  groupId: string | null,
  item: Item | PageItem,
) {
  return Effect.gen(function* () {
    const occurrenceKey = hash(JSON.stringify([channel, groupId, item.fileId]));

    const sourceSystem = Match.value(channel).pipe(
      Match.when("email", () => "inbound_email"),
      Match.when("bulk", () => "bulk_upload"),
      Match.orElse((name) => name),
    );

    const key = hash(
      JSON.stringify([
        scope.bookId,
        actorId,
        sourceSystem,
        sourceAccountId,
        occurrenceKey,
        item.revision,
      ]),
    ).slice(7);

    if ("state" in item && item.state !== "available")
      return {
        fileId: item.fileId,
        revision: item.revision,
        status: Match.value(item.state).pipe(
          Match.when("timeout", () => "unknown" as const),
          Match.when("expired", () => "expired" as const),
          Match.orElse(() => "refused" as const),
        ),
        occurrenceId: null,
        reason: item.state,
      };
    const bytes = item.contentBase64;

    if (bytes === null)
      return {
        fileId: item.fileId,
        revision: item.revision,
        status: "refused",
        occurrenceId: null,
        reason: "Missing content",
      };

    const existing = yield* Shared.withBook(token, scope, true, function* (transaction) {
      return (
        (yield* Retention.readOccurrenceByKey(transaction, scope.bookId, {
          sourceSystem,
          sourceAccountId,
          occurrenceKey,
          sourceRevision: item.revision,
        })).length > 0
      );
    });

    const retainedInput = {
      destination: channel === "email" ? undefined : ("supplier_inbox" as const),
      sourceSystem,
      sourceAccountId,
      occurrenceKey,
      sourceRevision: item.revision,
      filename: item.filename,
      mediaType: item.mediaType,
      contentBase64: bytes,
    };

    const retained = yield* Effect.result(
      retainSource(token, {
        scope,
        idempotencyKey: key,
        input: retainedInput,
      }),
    );

    if (Predicate.isTagged(retained, "Failure"))
      return {
        fileId: item.fileId,
        revision: item.revision,
        status:
          retained.failure.code === "Unavailable" || retained.failure.code === "InternalError"
            ? "unknown"
            : "refused",
        occurrenceId: null,
        reason: retained.failure.code,
      };

    const provenance = {
      channel,
      sourceAccountId,
      envelopeId: channel === "email" ? groupId : null,
      folderId: channel === "drive" || channel === "dropbox" ? groupId : null,
      fileId: item.fileId,
      revision: item.revision,
    };

    const binding = yield* Effect.result(
      Shared.withBook(
        token,
        scope,
        true,
        function* (transaction) {
          yield* IntakeDb.bindProvenance(
            transaction,
            scope.bookId,
            retained.success.id,
            provenance,
          );

          const stored = (yield* IntakeDb.readProvenance(
            transaction,
            scope.bookId,
            retained.success.id,
          ))[0];

          if (JSON.stringify(stored) !== JSON.stringify(provenance))
            return yield* failure("IdempotencyConflict");
        },
        "update",
      ),
    );

    if (Predicate.isTagged(binding, "Failure"))
      return {
        fileId: item.fileId,
        revision: item.revision,
        status: binding.failure.code === "IdempotencyConflict" ? "refused" : "unknown",
        occurrenceId: retained.success.id,
        reason: binding.failure.code,
      };

    if (channel === "email") {
      const registration = yield* Effect.result(
        registerSupplierInbox(token, {
          scope,
          idempotencyKey: hash(`register:${key}`).slice(7),
          input: {
            occurrenceId: retained.success.id,
            channel: "email",
            messageIdentity: hash(JSON.stringify([sourceAccountId, groupId, item.fileId])),
          },
        }),
      );

      if (Predicate.isTagged(registration, "Failure"))
        return {
          fileId: item.fileId,
          revision: item.revision,
          status: "unknown",
          occurrenceId: retained.success.id,
          reason: registration.failure.code,
        };
    }

    return {
      fileId: item.fileId,
      revision: item.revision,
      status: existing ? "duplicate" : "retained",
      occurrenceId: retained.success.id,
      reason: null,
    };
  });
}

function readBatchResult(
  token: string,
  scope: Scope,
  idempotencyKey: string,
  operation: string,
  input: typeof Contracts.CloudIntake.Type,
) {
  return Shared.withBook(token, scope, true, function* (transaction, principal) {
    const stored = (yield* IntakeDb.readBatch(transaction, scope.bookId, idempotencyKey))[0];

    if (!stored) return null;

    if (
      stored.actorId !== principal.actorId ||
      stored.operation !== operation ||
      stored.digest !== hash(JSON.stringify(input))
    )
      return yield* failure("IdempotencyConflict");

    if (stored.body !== null)
      return yield* Schema.decodeUnknownEffect(Contracts.IntakeBatchResult)(stored.body).pipe(
        Effect.mapError(() => failure("InternalError")),
      );

    return {
      destination: destination(scope),
      state: "unknown" as const,
      items: [],
      nextCursor: null,
    };
  });
}

function reserveBatch(
  token: string,
  scope: Scope,
  idempotencyKey: string,
  operation: string,
  input: typeof Contracts.IntakeBatch.Type | typeof Contracts.CloudIntake.Type,
) {
  return Shared.withBook(
    token,
    scope,
    true,
    function* (transaction, principal) {
      const requestDigest = hash(JSON.stringify(input));
      const existing = (yield* IntakeDb.readBatch(transaction, scope.bookId, idempotencyKey))[0];

      if (
        existing &&
        (existing.actorId !== principal.actorId ||
          existing.operation !== operation ||
          existing.digest !== requestDigest)
      )
        return yield* failure("IdempotencyConflict");

      if (!existing) {
        if ("envelopeId" in input && input.channel === "email" && input.envelopeId !== null) {
          const manifest = hash(
            JSON.stringify([...input.items].sort((a, b) => a.fileId.localeCompare(b.fileId))),
          );

          yield* IntakeDb.bindEnvelope(
            transaction,
            scope.bookId,
            input.sourceAccountId,
            input.envelopeId,
            manifest,
          );

          const envelope = (yield* IntakeDb.readEnvelope(
            transaction,
            scope.bookId,
            input.sourceAccountId,
            input.envelopeId,
          ))[0];

          if (envelope?.manifest !== manifest) return yield* failure("IdempotencyConflict");
        }

        yield* IntakeDb.reserveBatch(
          transaction,
          scope.bookId,
          idempotencyKey,
          principal.actorId,
          operation,
          requestDigest,
        );
      }

      if (existing?.body !== null && existing?.body !== undefined)
        return yield* Schema.decodeUnknownEffect(Contracts.IntakeBatchResult)(existing.body).pipe(
          Effect.mapError(() => failure("InternalError")),
        );

      return existing
        ? {
            destination: destination(scope),
            state: "unknown" as const,
            items: [],
            nextCursor: null,
          }
        : null;
    },
    "update",
  );
}

function saveBatchResult(
  token: string,
  scope: Scope,
  idempotencyKey: string,
  result: typeof Contracts.IntakeBatchResult.Type,
) {
  return Shared.withBook(
    token,
    scope,
    true,
    function* (transaction) {
      yield* IntakeDb.saveBatch(transaction, scope.bookId, idempotencyKey, result);
      const stored = (yield* IntakeDb.readBatch(transaction, scope.bookId, idempotencyKey))[0];

      return yield* Schema.decodeUnknownEffect(Contracts.IntakeBatchResult)(stored?.body).pipe(
        Effect.mapError(() => failure("InternalError")),
      );
    },
    "update",
  );
}

function runBatch(
  token: string,
  scope: Scope,
  idempotencyKey: string,
  input: typeof Contracts.IntakeBatch.Type | typeof Contracts.CloudIntake.Type,
  channel: "email" | "bulk" | "drive" | "dropbox",
  items: ReadonlyArray<Item | PageItem>,
  cursor: string | null,
) {
  return Effect.gen(function* () {
    const actorId = yield* Shared.withBook(token, scope, true, function* (transaction, principal) {
      yield* Retention.readRetentionAccess(transaction);

      return principal.actorId;
    });

    const outcomes = yield* Effect.forEach(
      items,
      (item) =>
        processItem(
          token,
          scope,
          actorId,
          channel,
          input.sourceAccountId,
          "envelopeId" in input ? input.envelopeId : input.folderId,
          item,
        ),
      { concurrency: 1 },
    );

    const result = yield* Schema.decodeUnknownEffect(Contracts.IntakeBatchResult)({
      destination: destination(scope),
      state: "completed",
      items: outcomes,
      nextCursor: outcomes.every(
        (item) => item.status === "retained" || item.status === "duplicate",
      )
        ? cursor
        : null,
    }).pipe(Effect.mapError(() => failure("InternalError")));

    return yield* saveBatchResult(token, scope, idempotencyKey, result);
  });
}

export const acquireIntakeBatch = Effect.fn("purchases.intake.batch")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Contracts.IntakeBatch.Type },
) {
  const { scope, input } = command;
  yield* getIntakeDestination(token, scope);

  if (
    input.channel === "email" &&
    (input.destination !== destination(scope) || input.envelopeId === null)
  )
    return yield* failure("Forbidden");

  if (input.channel === "bulk" && (input.destination !== null || input.envelopeId !== null))
    return yield* failure("InvalidJournal");

  const previous = yield* reserveBatch(
    token,
    scope,
    command.idempotencyKey,
    "acquire_intake_batch",
    input,
  );

  if (previous !== null) return previous;

  return yield* runBatch(
    token,
    scope,
    command.idempotencyKey,
    input,
    input.channel,
    input.items,
    null,
  );
});

export const acquireCloudIntake = Effect.fn("purchases.intake.cloud")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Contracts.CloudIntake.Type },
) {
  const { scope, input } = command;
  yield* getIntakeDestination(token, scope);

  const authorized = yield* Shared.withBook(token, scope, true, function* (transaction) {
    return (
      (yield* IntakeDb.readConnection(
        transaction,
        scope.bookId,
        input.provider,
        input.sourceAccountId,
        input.folderId,
      )).length > 0
    );
  });

  if (!authorized) return yield* failure("Forbidden");

  const previous = yield* readBatchResult(
    token,
    scope,
    command.idempotencyKey,
    "acquire_cloud_intake",
    input,
  );

  if (previous !== null) return previous;

  const { bindings } = yield* RequestEnvironment;

  const feed = bindings.INTAKE_FEED;

  if (!feed) return yield* failure("UnsupportedProfile");

  const reserved = yield* reserveBatch(
    token,
    scope,
    command.idempotencyKey,
    "acquire_cloud_intake",
    input,
  );

  if (reserved !== null) return reserved;

  const fetched = yield* Effect.result(
    Effect.tryPromise({
      try: () => feed(input.provider, input.sourceAccountId, input.folderId, input.cursor),
      catch: () => failure("Unavailable"),
    }),
  );

  if (Predicate.isTagged(fetched, "Failure")) {
    return yield* saveBatchResult(token, scope, command.idempotencyKey, {
      destination: destination(scope),
      state: "unknown",
      items: [],
      nextCursor: null,
    });
  }

  const page = fetched.success;

  return yield* runBatch(
    token,
    scope,
    command.idempotencyKey,
    input,
    input.provider,
    page.items,
    page.nextCursor,
  );
});
