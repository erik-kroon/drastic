import { runBookCommandWithReceipt } from "../book-commands";
import * as Contracts from "@open-erp/contracts/peppol-exchange";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/commerce/peppol-exchange";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { sourceDigest } from "../../adapters/storage/retained-objects";
import { decode, requireTableAccess, toJsonObject, withBook, type Scope } from "./support";
import { digest } from "../json";
import { isoNow, replay } from "../command-receipts";
import { newId } from "../identifiers";
import { failure } from "../failures";
import { renderPeppol, readPeppolDocument } from "./peppol-document";
import { accessPoint, capturePeppol, currentBinding } from "./peppol-context";
import { authorize } from "../authority";

type Command<A> = { readonly scope: Scope; readonly idempotencyKey: string; readonly input: A };

type Basis = Effect.Success<ReturnType<typeof capturePeppol>>;

const reviewTables = [...Db.tables, "peppol_review_returns"];

function validateCandidate(rendered: typeof Contracts.ValidationRequest.Type) {
  return Effect.gen(function* () {
    const result = yield* Effect.result(
      Effect.gen(function* () {
        const provider = yield* accessPoint();

        const report = yield* Effect.tryPromise({
          try: () => provider.validate(rendered),
          catch: () => failure("Unavailable"),
        });

        return yield* decode(Contracts.ValidationReport, yield* toJsonObject(report));
      }),
    );

    return Result.isSuccess(result)
      ? result.success
      : {
          outcome: "ValidationUnavailable",
          diagnostics: [
            {
              code: "validator_unavailable",
              text: "The configured validator could not provide a verifiable report.",
            },
          ],
        };
  });
}

function classifyValidation(
  report: typeof Contracts.ValidationReport.Type,
  xmlSha256: string,
  expected: typeof Contracts.ExpectedSemantic.Type,
) {
  return Effect.gen(function* () {
    if (report.outcome === "ValidationUnavailable") return "validation_unavailable" as const;

    if (report.outcome !== "passed") return "validation_failed" as const;

    if (
      report.xmlSha256 !== xmlSha256 ||
      report.releaseSha256 !== Contracts.releaseSha256 ||
      report.networkResolution !== "disabled" ||
      report.networkAccessPointQualification !== "not-established" ||
      (yield* digest(report.semantic ?? null)) !== (yield* digest(expected))
    )
      return "validation_integrity" as const;

    return null;
  });
}

function retainArtifact(
  tx: Transaction,
  scope: Scope,
  basis: Basis,
  input: typeof Contracts.Prepare.Type,
  rendered: { readonly xml: string; readonly expected: typeof Contracts.ExpectedSemantic.Type },
  validation: typeof Contracts.ValidationReport.Type,
  candidate: string,
  hash: string,
  actor: string,
  at: string,
) {
  return Effect.gen(function* () {
    const id = `peppol_artifact_${candidate.slice(0, 40)}`;
    const prior = (yield* Db.readArtifact(tx, scope.bookId, id))[0];

    if (prior) return yield* decode(Contracts.Artifact, prior.body);

    const body = {
      id,
      scope,
      input,
      documentDigest: basis.document.digest,
      sender: basis.sender,
      recipient: basis.recipient,
      ...rendered,
      rendererVersion: "ubl21-se-domestic-25-v2" as const,
      xmlSha256: hash,
      validation,
      createdBy: actor,
      createdAt: at,
    };

    const artifact = yield* decode(Contracts.Artifact, { ...body, digest: yield* digest(body) });
    yield* Db.insertArtifact(tx, scope.bookId, {
      id,
      kind: input.document.kind,
      sourceId: input.document.id,
      senderId: basis.sender.id,
      recipientId: basis.recipient.id,
      xmlSha256: hash,
      body: yield* toJsonObject(artifact),
    });

    return artifact;
  });
}

export const preparePeppolReview = Effect.fn("peppol.prepareReview")(function* (
  token: string,
  command: Command<typeof Contracts.Prepare.Type>,
) {
  const initial = yield* withBook(token, command.scope, false, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_prepare_review",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Review,
    );

    if (request.previous) return { kind: "replayed" as const, review: request.previous };
    yield* requireTableAccess(tx, reviewTables, false);

    return {
      kind: "captured" as const,
      basis: yield* capturePeppol(tx, command.scope, command.input),
    };
  });

  if (initial.kind === "replayed") return initial.review;

  const rendered = yield* renderPeppol(
    initial.basis.document,
    initial.basis.sender,
    initial.basis.recipient,
  );

  const hash = (yield* sourceDigest(new TextEncoder().encode(rendered.xml))).slice(7);

  const candidate = (yield* digest({
    input: command.input,
    sourceDigest: initial.basis.document.digest,
    sender: initial.basis.sender.digest,
    recipient: initial.basis.recipient.digest,
    release: Contracts.releaseSha256,
    xmlSha256: hash,
  })).slice(7);

  const validation = yield* validateCandidate({
    ...rendered,
    releaseSha256: Contracts.releaseSha256,
  });

  const invalid = yield* classifyValidation(validation, hash, rendered.expected);

  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    return yield* runBookCommandWithReceipt(
      tx,
      {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        operation: "peppol_prepare_review",
        actorId: principal.actorId,
        input: yield* toJsonObject(command),
      },
      Contracts.Review,
      Effect.gen(function* () {
        yield* PostingDb.lockBookForUpdate(tx, command.scope);
        yield* requireTableAccess(tx, reviewTables, true);
        const current = yield* Effect.result(capturePeppol(tx, command.scope, command.input));

        if (
          Result.isFailure(current) &&
          (!("code" in current.failure) ||
            !["StaleDependency", "InvalidJournal", "MissingEvidence", "NotFound"].includes(
              current.failure.code,
            ))
        )
          return yield* current.failure;

        const changed =
          Result.isFailure(current) ||
          (yield* digest(current.success)) !== (yield* digest(initial.basis));

        const blockers = [
          ...(invalid ? [invalid] : []),
          ...(changed ? ["dependencies_changed" as const] : []),
        ];

        const at = yield* isoNow(tx);

        const preparer = (yield* Db.readReviewPreparer(
          tx,
          command.scope.bookId,
          principal.actorId,
        ))[0];

        if (!preparer) return yield* failure("MissingEvidence");

        const body = {
          createdByName: preparer.name,
          id: newId("peppol_review"),
          scope: command.scope,
          input: command.input,
          source: yield* decode(
            Contracts.ReviewSource,
            yield* toJsonObject(initial.basis.document),
          ),
          sender: initial.basis.sender,
          recipient: initial.basis.recipient,
          rendererVersion: "ubl21-se-domestic-25-v2" as const,
          ...rendered,
          xmlSha256: hash,
          validation,
          createdBy: principal.actorId,
          createdAt: at,
        };

        const artifact =
          blockers.length === 0
            ? yield* retainArtifact(
                tx,
                command.scope,
                initial.basis,
                command.input,
                rendered,
                validation,
                candidate,
                hash,
                principal.actorId,
                at,
              )
            : null;

        const result = artifact
          ? {
              ...body,
              outcome: "ready" as const,
              artifact: { id: artifact.id, digest: artifact.digest },
            }
          : { ...body, outcome: "blocked" as const, blockers };

        const review = yield* decode(Contracts.Review, {
          ...result,
          digest: yield* digest(result),
        });

        yield* Db.insertReview(tx, command.scope.bookId, {
          id: review.id,
          candidate,
          kind: command.input.document.kind,
          sourceId: command.input.document.id,
          senderId: review.sender.id,
          recipientId: review.recipient.id,
          actorId: principal.actorId,
          createdAt: at,
          body: yield* toJsonObject(review),
        });

        return { receipt: yield* toJsonObject(review), result: review };
      }),
    );
  });
});

function readReview(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readReview(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");
    const review = yield* decode(Contracts.Review, row.body);
    const body = { ...(yield* toJsonObject(review)) };
    delete body.digest;

    if (
      review.scope.entityId !== scope.entityId ||
      review.scope.bookId !== scope.bookId ||
      review.id !== id ||
      (yield* digest(body)) !== review.digest
    )
      return yield* failure("StaleDependency");

    return review;
  });
}

function presentDependencies(tx: Transaction, scope: Scope, review: typeof Contracts.Review.Type) {
  return Effect.gen(function* () {
    const source = yield* Effect.result(readPeppolDocument(tx, scope, review.input.document));

    if (
      Result.isFailure(source) &&
      (!("code" in source.failure) ||
        !["NotFound", "MissingEvidence", "StaleDependency"].includes(source.failure.code))
    )
      return yield* source.failure;

    const bindings = yield* Effect.result(
      Effect.gen(function* () {
        yield* currentBinding(tx, scope, review.sender);
        yield* currentBinding(tx, scope, review.recipient);
      }),
    );

    if (
      Result.isFailure(bindings) &&
      (!("code" in bindings.failure) || bindings.failure.code !== "StaleDependency")
    )
      return yield* bindings.failure;

    return {
      sourceCurrent: Result.isSuccess(source) && source.success.digest === review.source.digest,
      partiesCurrent: Result.isSuccess(bindings),
    };
  });
}

export const getPeppolReview = Effect.fn("peppol.getReview")(function* (
  token: string,
  scope: Scope,
  id: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    yield* requireTableAccess(tx, reviewTables, false);
    const review = yield* readReview(tx, scope, id);
    const returned = (yield* Db.readReviewReturn(tx, scope.bookId, id))[0];
    const validation = review.validation;
    const semantics = validation.semantic;

    const totalsMatch =
      validation.xmlSha256 === review.xmlSha256 &&
      validation.releaseSha256 === Contracts.releaseSha256 &&
      validation.networkResolution === "disabled" &&
      semantics !== undefined &&
      semantics.exclusiveMinor === review.source.netMinor &&
      semantics.taxMinor === review.source.taxMinor &&
      semantics.payableMinor === review.source.grossMinor &&
      semantics.documentId === review.source.legalNumber &&
      semantics.currency === review.source.currency &&
      semantics.documentType === review.source.documentType;

    return yield* decode(Contracts.ReviewView, {
      review,
      returned: returned ? yield* decode(Contracts.ReviewReturn, returned.body) : null,
      preparerName: review.createdByName,
      totalsMatch,
      ...(yield* presentDependencies(tx, scope, review)),
    });
  });
});

export const listPeppolReviews = Effect.fn("peppol.listReviews")(function* (
  token: string,
  scope: Scope,
  query: typeof Contracts.ReviewQuery.Type,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    yield* requireTableAccess(tx, reviewTables, false);
    yield* readPeppolDocument(tx, scope, { kind: query.documentKind, id: query.documentId });

    if (query.after) {
      const anchor = yield* readReview(tx, scope, query.after);

      if (
        anchor.input.document.kind !== query.documentKind ||
        anchor.input.document.id !== query.documentId
      )
        return yield* failure("NotFound");
    }

    const rows = yield* Db.readReviewPage(
      tx,
      scope.bookId,
      query.documentKind,
      query.documentId,
      query.after ?? null,
    );

    const reviews = yield* Effect.forEach(rows.slice(0, 20), (row) =>
      decode(Contracts.Review, row.body),
    );

    return yield* decode(Contracts.ReviewPage, {
      items: reviews.map((review) => ({
        id: review.id,
        document: review.input.document,
        legalNumber: review.source.legalNumber,
        customerName: review.source.buyer.legalName,
        outcome: review.outcome,
        createdAt: review.createdAt,
      })),
      next: rows.length > 20 ? (reviews.at(-1)?.id ?? null) : null,
    });
  });
});

export const returnPeppolReview = Effect.fn("peppol.returnReview")(function* (
  token: string,
  command: Command<typeof Contracts.Approve.Type> & { readonly reviewId: string },
) {
  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    yield* authorize(principal, "return_peppol_review");
    yield* PostingDb.lockBookForUpdate(tx, command.scope);
    const review = yield* readReview(tx, command.scope, command.reviewId);

    if (review.digest !== command.input.digest) return yield* failure("StaleDependency");

    if (review.outcome !== "blocked") return yield* failure("UnsupportedProfile");

    if (review.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

    return yield* runBookCommandWithReceipt(
      tx,
      {
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        operation: "peppol_return_review",
        actorId: principal.actorId,
        input: yield* toJsonObject(command),
      },
      Contracts.ReviewReturn,
      Effect.gen(function* () {
        const prior = (yield* Db.readReviewReturn(tx, command.scope.bookId, review.id))[0];

        const body = {
          id: newId("peppol_review_return"),
          reviewId: review.id,
          reviewDigest: review.digest,
          actorId: principal.actorId,
          createdAt: yield* isoNow(tx),
        };

        const returned = prior
          ? yield* decode(Contracts.ReviewReturn, prior.body)
          : yield* decode(Contracts.ReviewReturn, { ...body, digest: yield* digest(body) });

        if (!prior)
          yield* Db.insertReviewReturn(tx, command.scope.bookId, {
            ...returned,
            body: yield* toJsonObject(returned),
          });

        return { receipt: yield* toJsonObject(returned), result: returned };
      }),
    );
  });
});
