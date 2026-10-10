import { runBookCommandWithReceipt } from "../book-commands";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Documents from "@open-erp/contracts/document-signatures";
import * as Report from "@open-erp/contracts/annual-report";
import * as Ledger from "../../db/posting";
import * as Annual from "../../db/reports/annual-report";
import * as Db from "../../db/documents/records";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { sha256Hex } from "../hashing";
import {
  commandReceipt,
  decode,
  readEvidenceReference,
  requireInsertAccess,
  toJsonObject,
  withBook,
  type Principal,
  type Scope,
} from "../commerce/support";
import type { Transaction } from "../../db/transaction";
import { authorize, authorizePresent } from "../authority";

export type Command<I> = {
  readonly scope: Scope;
  readonly idempotencyKey: string;
  readonly input: I;
  readonly id?: string;
};

export function synthetic(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const book = (yield* Ledger.readBook(transaction, scope))[0];

    if (book?.profile !== "synthetic-core-v1" || book.authority !== "native")
      return yield* failure("UnsupportedProfile");
  });
}

export function read<A>(
  transaction: Transaction,
  scope: Scope,
  table: Db.Table,
  id: string,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const row = (yield* Db.readRecord(transaction, scope.bookId, table, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(schema, row.body);
  });
}

export function list<A>(
  transaction: Transaction,
  scope: Scope,
  table: Db.Table,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const values: A[] = [];

    for (const row of yield* Db.listRecords(transaction, scope.bookId, table))
      values.push(yield* decode(schema, row.body));

    return values;
  });
}

export function seal<A>(
  transaction: Transaction,
  scope: Scope,
  schema: Schema.Decoder<A>,
  operation: string,
  actorId: string,
  key: string,
  fields: Schema.JsonObject,
) {
  return Effect.gen(function* () {
    const body = {
      ...Object.fromEntries(Object.entries(fields)),
      scope,
      createdAt: yield* isoNow(transaction),
      receipt: commandReceipt(key, operation, actorId),
    };

    return yield* decode(schema, { ...body, digest: yield* digest(body) });
  });
}

export function insert(
  transaction: Transaction,
  table: Db.Table,
  value: { readonly id: string; readonly scope: Scope; readonly digest: string },
) {
  return Effect.flatMap(toJsonObject(value), (body) =>
    Db.insertRecord(transaction, table, value, body),
  );
}

type DocumentGesture =
  | "review_filing_adoption"
  | "review_document_governance"
  | "prepare_document_signature"
  | "authorize_filing";

export function recordCommand<
  I,
  E,
  A extends { readonly id: string; readonly scope: Scope; readonly digest: string },
>(
  token: string,
  command: Command<I>,
  table: Db.Table,
  schema: Schema.Decoder<A>,
  operation: string,
  gesture: DocumentGesture | null,
  build: (transaction: Transaction, principal: Principal) => Effect.Effect<Schema.JsonObject, E>,
) {
  return withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      if (gesture === "prepare_document_signature" || gesture === "authorize_filing") {
        yield* authorizePresent(transaction, principal, command.scope, gesture, {
          idempotencyKey: command.idempotencyKey,
          id: command.id ?? null,
          input: yield* toJsonObject(command.input),
        });
      } else if (gesture !== null) yield* authorize(principal, gesture);
      yield* synthetic(transaction, command.scope);
      yield* requireInsertAccess(transaction, [table, "command_receipts"]);

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { id: command.id ?? null, input: yield* toJsonObject(command.input) },
        },
        schema,
        Effect.gen(function* () {
          const value = yield* seal(
            transaction,
            command.scope,
            schema,
            operation,
            principal.actorId,
            command.idempotencyKey,
            yield* build(transaction, principal),
          );

          yield* insert(transaction, table, value);

          return { receipt: yield* toJsonObject(value), result: value };
        }),
      );
    },
    "update",
  );
}

export function currentGovernance(transaction: Transaction, scope: Scope, governanceId: string) {
  return Effect.gen(function* () {
    const governance = yield* read(
      transaction,
      scope,
      "document_governance",
      governanceId,
      Documents.GovernanceRevision,
    );

    const revisions = yield* list(
      transaction,
      scope,
      "document_governance",
      Documents.GovernanceRevision,
    );

    const reviews = yield* list(
      transaction,
      scope,
      "document_governance_reviews",
      Documents.GovernanceReview,
    );

    const superseded = revisions.some(
      (revision) =>
        revision.input.supersedesId === governance.id &&
        reviews.some(
          (review) => review.governanceId === revision.id && review.result === "confirmed",
        ),
    );

    const last = reviews.filter((review) => review.governanceId === governance.id).at(-1);

    return {
      governance,
      current:
        !superseded && last?.result === "confirmed" && last.governanceDigest === governance.digest,
    };
  });
}

export function requireGovernance(transaction: Transaction, scope: Scope, governanceId: string) {
  return Effect.gen(function* () {
    const result = yield* currentGovernance(transaction, scope, governanceId);

    if (!result.current) return yield* failure("StaleDependency");

    return result.governance;
  });
}

export function artifactBasis(transaction: Transaction, scope: Scope, artifactId: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readArtifact(transaction, scope.bookId, artifactId))[0];

    if (!row) return yield* failure("NotFound");
    const artifact = yield* decode(Report.ReportArtifact, row.body);

    const presentationRow = (yield* Annual.readPresentation(
      transaction,
      scope.bookId,
      artifact.presentationId,
    ))[0];

    const finalRow = (yield* Annual.readFinal(transaction, scope.bookId, artifact.finalId))[0];

    if (!presentationRow || !finalRow) return yield* failure("StaleDependency");
    const presentation = yield* decode(Report.ReportPresentation, presentationRow.body);
    const final = yield* decode(Report.AnnualReportFinal, finalRow.body);
    const hash = `sha256:${yield* sha256Hex(artifact.xhtml)}`;
    const length = new TextEncoder().encode(artifact.xhtml).byteLength.toString();

    if (
      hash !== artifact.contentHash ||
      length !== artifact.sizeBytes.toString() ||
      presentation.finalId !== final.id ||
      presentation.revision.modelDigest !== final.summary.modelDigest
    )
      return yield* failure("StaleDependency");

    return { artifact, presentation, final, hash, length };
  });
}

export function validatedBasis(
  transaction: Transaction,
  scope: Scope,
  artifactId: string,
  validationId: string,
) {
  return Effect.gen(function* () {
    const basis = yield* artifactBasis(transaction, scope, artifactId);

    const validation = yield* read(
      transaction,
      scope,
      "document_validations",
      validationId,
      Documents.DocumentValidation,
    );

    if (
      validation.result !== "passed" ||
      validation.artifactId !== artifactId ||
      validation.artifactHash !== basis.hash ||
      validation.artifactLength !== basis.length ||
      validation.modelDigest !== basis.final.summary.modelDigest ||
      validation.presentationDigest !== basis.presentation.digest
    )
      return yield* failure("StaleDependency");

    return { ...basis, validation };
  });
}

export const captureDocumentGovernance = (
  token: string,
  command: Command<typeof Documents.CaptureGovernance.Type>,
) =>
  recordCommand(
    token,
    command,
    "document_governance",
    Documents.GovernanceRevision,
    "capture_document_governance",
    null,
    (transaction, principal) =>
      Effect.gen(function* () {
        const input = command.input;

        const evidence = yield* readEvidenceReference(
          transaction,
          command.scope.bookId,
          input.evidenceId,
        );

        const signerIds = input.requiredSigners.map((signer) => signer.signerId);

        if (
          new Set(signerIds).size !== signerIds.length ||
          new Set(input.certifierIds).size !== input.certifierIds.length
        )
          return yield* failure("InvalidJournal");

        if (
          !(yield* Ledger.readFiscalYear(transaction, command.scope.bookId, input.fiscalYearId))[0]
        )
          return yield* failure("NotFound");

        if (input.supersedesId !== null)
          yield* read(
            transaction,
            command.scope,
            "document_governance",
            input.supersedesId,
            Documents.GovernanceRevision,
          );

        return {
          id: newId("governance"),
          input: yield* toJsonObject(input),
          creatorId: principal.actorId,
          evidenceHash: `sha256:${evidence.sha256}`,
        };
      }),
  );

export const reviewDocumentGovernance = (
  token: string,
  command: Command<typeof Documents.ReviewGovernance.Type> & { readonly id: string },
) =>
  recordCommand(
    token,
    command,
    "document_governance_reviews",
    Documents.GovernanceReview,
    "review_document_governance",
    "review_document_governance",
    (transaction, principal) =>
      Effect.gen(function* () {
        const governance = yield* read(
          transaction,
          command.scope,
          "document_governance",
          command.id,
          Documents.GovernanceRevision,
        );

        if (governance.creatorId === principal.actorId) return yield* failure("Forbidden");

        if (governance.digest !== command.input.digest) return yield* failure("StaleDependency");

        return {
          id: newId("governance_review"),
          governanceId: governance.id,
          governanceDigest: governance.digest,
          reviewerId: principal.actorId,
          result: command.input.result,
          reason: command.input.reason,
        };
      }),
  );

export function participantCurrent(transaction: Transaction, scope: Scope, actorId: string) {
  return Db.readParticipant(transaction, scope.bookId, actorId).pipe(
    Effect.map((rows) => rows[0]?.enabled === true),
  );
}
