import * as Accounting from "@open-erp/contracts/accounting";
import * as Runs from "@open-erp/contracts/payroll-runs";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/payroll/runs";
import { withTransaction, databaseFailure, type Transaction } from "../../db/transaction";
import { decode, toJsonObject, withBook, type Scope } from "../commerce/support";
import { base64, sha256HexOf } from "../bytes";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { admitRunnerActor } from "../preparation-jobs";
import { requirePayrollAccess } from "./run-basis";
import { renderPayslipPdf } from "./payslip-renderer";

const checkedDocument = Effect.fn("payroll.checkedPayslip")(function* (
  tx: Transaction,
  scope: Scope,
  documentId: string,
) {
  const rows = yield* Db.readDocument(tx, scope.bookId, documentId);
  const row = rows[0];

  if (!row) return yield* failure("NotFound");
  const document = yield* decode(Runs.PayrollPayslipDocument, row.body);
  const body = Object.fromEntries(Object.entries(row.body).filter(([field]) => field !== "digest"));

  if (
    rows.length !== 1 ||
    document.scope.entityId !== scope.entityId ||
    document.id !== documentId ||
    (yield* digest(body)) !== document.digest ||
    row.payload.documentDigest !== document.digest ||
    row.payload.requiredRendererVersion !== Runs.payslipRendererVersion
  )
    return yield* failure("StaleDependency");

  return { document, outboxId: row.outboxId, attempts: row.attempts };
});

const existingArtifact = Effect.fn("payroll.existingPayslip")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readArtifact(tx, scope.bookId, id))[0];

  return row ? yield* decode(Runs.PayrollPayslipArtifact, row.descriptor) : null;
});

export const getPayslip = Effect.fn("payroll.getPayslip")(function* (
  token: string,
  command: { scope: Scope; documentId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requirePayrollAccess(tx, command.scope, principal.actorId, false);
    const source = yield* checkedDocument(tx, command.scope, command.documentId);

    return {
      document: source.document,
      artifact: yield* existingArtifact(tx, command.scope, command.documentId),
      attempts: source.attempts,
    };
  });
});

export const getPayslipArtifact = Effect.fn("payroll.getPayslipArtifact")(function* (
  token: string,
  command: { scope: Scope; documentId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requirePayrollAccess(tx, command.scope, principal.actorId, false);
    const source = yield* checkedDocument(tx, command.scope, command.documentId);
    const row = (yield* Db.readArtifact(tx, command.scope.bookId, command.documentId))[0];

    if (!row) return yield* failure("NotFound");
    const artifact = yield* decode(Runs.PayrollPayslipArtifact, row.descriptor);
    const bytes = Uint8Array.from(atob(row.contentBase64), (character) => character.charCodeAt(0));

    if (
      artifact.documentDigest !== source.document.digest ||
      artifact.documentId !== command.documentId ||
      artifact.scope.entityId !== command.scope.entityId ||
      artifact.byteLength !== bytes.length ||
      (yield* sha256HexOf(bytes)) !== artifact.sha256
    )
      return yield* failure("StaleDependency");

    return { artifact, contentBase64: row.contentBase64 };
  });
});

type RenderCommand = {
  scope: Scope;
  documentId: string;
  idempotencyKey: string;
  input: typeof Runs.RenderPayrollPayslip.Type;
};

const recordRenderFailure = Effect.fn("payroll.recordRenderFailure")(function* (
  token: string,
  command: RenderCommand,
  code: string,
) {
  yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      yield* requirePayrollAccess(tx, command.scope, principal.actorId, true);
      const source = yield* checkedDocument(tx, command.scope, command.documentId);

      if (!(yield* existingArtifact(tx, command.scope, command.documentId)))
        yield* Db.recordFailure(
          tx,
          command.scope.bookId,
          command.documentId,
          source.outboxId,
          code,
        );
    },
    "update",
  );
});

export const renderPayslip = Effect.fn("payroll.renderPayslip")(function* (
  token: string,
  command: RenderCommand,
) {
  const operation = "render_payroll_payslip";
  const payload = { documentId: command.documentId, input: command.input };

  const captured = yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      yield* requirePayrollAccess(tx, command.scope, principal.actorId, true);

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        payload,
        Runs.PayrollPayslipArtifact,
      );

      if (request.previous) return { state: "available" as const, artifact: request.previous };
      const source = yield* checkedDocument(tx, command.scope, command.documentId);

      if (source.document.digest !== command.input.documentDigest)
        return yield* failure("StaleDependency");
      const artifact = yield* existingArtifact(tx, command.scope, command.documentId);

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

        return { state: "available" as const, artifact };
      }

      if (source.attempts >= 20) return yield* failure("UnsupportedProfile");

      return { state: "pending" as const, source };
    },
    "update",
  );

  if (captured.state === "available") return captured.artifact;
  const source = captured.source;

  const rendered = yield* Effect.result(
    Effect.tryPromise({
      try: () => renderPayslipPdf(source.document),
      catch: (cause) =>
        cause instanceof Accounting.AccountingError ? cause : failure("InternalError", cause),
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.catchTag("TimeoutError", () => failure("Unavailable")),
    ),
  );

  if (Result.isFailure(rendered)) {
    yield* recordRenderFailure(token, command, rendered.failure.code);

    return yield* rendered.failure;
  }

  const sha256 = yield* sha256HexOf(rendered.success);
  const contentBase64 = base64(rendered.success);

  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      yield* requirePayrollAccess(tx, command.scope, principal.actorId, true);

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { documentId: command.documentId, input: command.input },
        Runs.PayrollPayslipArtifact,
      );

      if (request.previous) return request.previous;
      const current = yield* checkedDocument(tx, command.scope, command.documentId);

      if (
        current.document.digest !== source.document.digest ||
        current.outboxId !== source.outboxId
      )
        return yield* failure("StaleDependency");
      const retained = yield* existingArtifact(tx, command.scope, command.documentId);

      const artifact =
        retained ??
        (yield* decode(Runs.PayrollPayslipArtifact, {
          id: newId("payslip_artifact"),
          scope: command.scope,
          documentId: command.documentId,
          documentDigest: source.document.digest,
          rendererVersion: Runs.payslipRendererVersion,
          mediaType: "application/pdf",
          sha256,
          byteLength: rendered.success.length,
          createdAt: yield* isoNow(tx),
        }));

      if (!retained) yield* Db.insertArtifact(tx, artifact, contentBase64);
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

      return artifact;
    },
    "update",
  );
});

export const pendingPayslipRenders = Effect.fn("payroll.pendingPayslips")(function* (
  token: string,
) {
  return yield* withTransaction((tx) =>
    Effect.gen(function* () {
      return yield* Db.readPending(tx, yield* admitRunnerActor(tx, token));
    }).pipe(Effect.mapError(databaseFailure)),
  );
});
