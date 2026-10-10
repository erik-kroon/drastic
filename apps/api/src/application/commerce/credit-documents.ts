import * as Accounting from "@open-erp/contracts/accounting";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Db from "../../db/commerce/credit-documents";
import { withTransaction, databaseFailure, type Transaction } from "../../db/transaction";
import type { Database } from "../../db/connection";
import { base64, sha256HexOf } from "../bytes";
import { failure } from "../failures";
import { admitRunnerActor } from "../preparation-jobs";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { decode, requireTableAccess, toJsonObject, withBook, type Scope } from "./support";
import { renderCreditDocumentPdf } from "./credit-document-renderer";

const operation = "render_customer_credit_artifact";

const Intent = Schema.Struct({
  creditId: Accounting.Identifier,
  documentId: Accounting.Identifier,
  documentRevision: Schema.String,
  documentDigest: Accounting.Digest,
  requiredRendererVersion: Schema.String,
});

const readTables = [
  "customer_credit_documents",
  "customer_credit_artifacts",
  "customer_credit_render_failures",
  "outbox",
];

const checkedSource = Effect.fn("creditDocument.checkedSource")(function* (
  tx: Transaction,
  scope: Scope,
  creditId: string,
) {
  yield* requireTableAccess(tx, readTables, false);
  const sources = yield* Db.readSource(tx, scope.bookId, creditId);
  const source = sources[0];

  if (!source) return yield* failure("NotFound");

  if (sources.length !== 1) return yield* failure("StaleDependency");

  const document = yield* decode(Credits.CustomerCreditSemanticDocument, source.document);
  const intent = yield* decode(Intent, source.payload);
  const documentDigest = document.digest;
  const body = { ...(yield* toJsonObject(document)) };
  delete body.digest;

  if (
    document.creditId !== creditId ||
    intent.creditId !== creditId ||
    intent.documentId !== document.documentId ||
    intent.documentRevision !== document.revision ||
    intent.documentDigest !== documentDigest ||
    (yield* digest(body)) !== documentDigest
  ) {
    return yield* failure("StaleDependency");
  }

  if (intent.requiredRendererVersion !== Credits.customerCreditRendererVersion)
    return yield* failure("UnsupportedProfile");

  return { document, outboxId: source.outboxId };
});

const existingArtifact = Effect.fn("creditDocument.existingArtifact")(function* (
  tx: Transaction,
  scope: Scope,
  documentId: string,
) {
  const row = (yield* Db.readArtifactForDocument(tx, scope.bookId, documentId))[0];

  return row ? yield* decode(Credits.CustomerCreditArtifactDescriptor, row.descriptor) : null;
});

export const getCustomerCreditArtifactState = Effect.fn("creditDocument.state")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const source = yield* checkedSource(tx, command.scope, command.id);
    const artifact = yield* existingArtifact(tx, command.scope, source.document.documentId);

    const last = (yield* Db.readLastFailure(
      tx,
      command.scope.bookId,
      source.document.documentId,
    ))[0];

    return yield* decode(
      Credits.CustomerCreditArtifactView,
      yield* toJsonObject({
        scope: command.scope,
        creditId: command.id,
        document: source.document,
        state: artifact ? "available" : last ? "rendering_failed" : "pending",
        artifact,
        lastFailure: last ?? null,
      }),
    );
  });
});

export const getCustomerCreditArtifact = Effect.fn("creditDocument.artifact")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const row = (yield* Db.readArtifact(tx, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(
      Credits.CustomerCreditArtifact,
      Object.assign({}, row.descriptor, { contentBase64: row.contentBase64 }),
    );
  });
});

type RenderCommand = {
  scope: Scope;
  id: string;
  idempotencyKey: string;
  input: typeof Credits.RenderCustomerCreditArtifact.Type;
};

const recordFailure = Effect.fn("creditDocument.recordFailure")(function* (
  token: string,
  command: RenderCommand,
  code: (typeof Credits.CustomerCreditRenderFailure.Type)["code"],
) {
  yield* withBook(
    token,
    command.scope,
    false,
    function* (tx) {
      const source = yield* checkedSource(tx, command.scope, command.id);

      if (source.document.digest !== command.input.expectedDocumentDigest)
        return yield* failure("StaleDependency");

      if (yield* existingArtifact(tx, command.scope, source.document.documentId)) return;

      const last = (yield* Db.readLastFailure(
        tx,
        command.scope.bookId,
        source.document.documentId,
      ))[0];

      const ordinal = (last?.ordinal ?? 0) + 1;

      if (ordinal > 20) return;

      yield* Db.insertFailure(tx, {
        bookId: command.scope.bookId,
        documentId: source.document.documentId,
        documentRevision: BigInt(source.document.revision),
        documentDigest: source.document.digest,
        rendererVersion: command.input.rendererVersion,
        ordinal,
        code,
        failedAt: yield* isoNow(tx),
      });
      yield* Db.recordAttempt(tx, command.scope.bookId, source.outboxId);
    },
    "update",
  );
});

export const renderCustomerCreditArtifact = Effect.fn("creditDocument.render")(function* (
  token: string,
  command: RenderCommand,
): Effect.fn.Return<
  typeof Credits.CustomerCreditArtifactDescriptor.Type,
  Accounting.AccountingError,
  Database
> {
  const payload = yield* toJsonObject({ id: command.id, input: command.input });

  const captured = yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        payload,
        Credits.CustomerCreditArtifactDescriptor,
      );

      if (request.previous) return { artifact: request.previous, source: null };

      const source = yield* checkedSource(tx, command.scope, command.id);

      if (
        source.document.digest !== command.input.expectedDocumentDigest ||
        command.input.rendererVersion !== Credits.customerCreditRendererVersion
      ) {
        return yield* failure("StaleDependency");
      }

      const artifact = yield* existingArtifact(tx, command.scope, source.document.documentId);

      if (artifact) {
        yield* Db.acknowledge(tx, command.scope.bookId, source.outboxId);
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          yield* toJsonObject(artifact),
        );

        return { artifact, source: null };
      }

      const last = (yield* Db.readLastFailure(
        tx,
        command.scope.bookId,
        source.document.documentId,
      ))[0];

      if (last && last.ordinal >= 20) return yield* failure("UnsupportedProfile");

      return { artifact: null, source };
    },
    "update",
  );

  if (captured.artifact) return captured.artifact;

  const source = captured.source;

  if (!source) return yield* failure("InternalError");

  // No database transaction is held while the renderer runs.
  const rendered = yield* Effect.result(
    Effect.tryPromise({
      try: () => renderCreditDocumentPdf(source.document),
      catch: (error) =>
        error instanceof Accounting.AccountingError ? error : failure("InternalError"),
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.catchTag("TimeoutError", () => failure("Unavailable")),
    ),
  );

  if (Result.isFailure(rendered)) {
    const code = rendered.failure.code;

    if (code === "UnsupportedProfile" || code === "Unavailable" || code === "InternalError") {
      yield* recordFailure(token, command, code);
    }

    return yield* rendered.failure;
  }

  const contentBase64 = base64(rendered.success);
  const sha256 = yield* sha256HexOf(rendered.success);

  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        payload,
        Credits.CustomerCreditArtifactDescriptor,
      );

      if (request.previous) return request.previous;

      const current = yield* checkedSource(tx, command.scope, command.id);

      if (
        current.document.digest !== source.document.digest ||
        current.outboxId !== source.outboxId
      )
        return yield* failure("StaleDependency");

      const retained = yield* existingArtifact(tx, command.scope, current.document.documentId);

      if (retained && retained.sha256 !== sha256) return yield* failure("StaleDependency");

      const descriptor =
        retained ??
        (yield* decode(Credits.CustomerCreditArtifactDescriptor, {
          id: newId("credit_artifact"),
          scope: command.scope,
          creditId: command.id,
          documentId: current.document.documentId,
          documentRevision: current.document.revision,
          documentDigest: current.document.digest,
          rendererVersion: command.input.rendererVersion,
          mediaType: "application/pdf",
          filename: `credit-${current.document.documentNumber}.pdf`,
          sha256,
          byteLength: rendered.success.length,
          createdAt: yield* isoNow(tx),
          createdBy: principal.actorId,
          delivered: false,
        }));

      if (!retained) {
        yield* Db.insertArtifact(tx, {
          bookId: command.scope.bookId,
          id: descriptor.id,
          documentId: descriptor.documentId,
          documentRevision: BigInt(descriptor.documentRevision),
          documentDigest: descriptor.documentDigest,
          rendererVersion: descriptor.rendererVersion,
          outboxId: current.outboxId,
          descriptor: yield* toJsonObject(descriptor),
          contentBase64,
        });
      }

      yield* Db.acknowledge(tx, command.scope.bookId, current.outboxId);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(descriptor),
      );

      return descriptor;
    },
    "update",
  ).pipe(
    Effect.tapError((error) => {
      const code = error.code;

      return code === "UnsupportedProfile" || code === "Unavailable" || code === "InternalError"
        ? recordFailure(token, command, code)
        : Effect.void;
    }),
  );
});

export const pendingCustomerCreditRenders = Effect.fn("creditDocument.pending")(function* (
  token: string,
) {
  return yield* withTransaction((tx) =>
    Effect.gen(function* () {
      const actorId = yield* admitRunnerActor(tx, token);

      return yield* Db.readPending(tx, actorId);
    }).pipe(Effect.mapError(databaseFailure)),
  );
});
