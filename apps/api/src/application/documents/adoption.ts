import * as Filing from "@open-erp/contracts/filing-lifecycle";
import * as Documents from "@open-erp/contracts/document-signatures";
import * as Effect from "effect/Effect";
import { newId } from "../identifiers";
import { failure } from "../failures";
import { readEvidenceReference, type Scope } from "../commerce/support";
import { read, list, recordCommand, type Command } from "./support";
import type { Transaction } from "../../db/transaction";

export const captureFilingAdoption = (
  token: string,
  command: Command<typeof Filing.CaptureAdoption.Type>,
) =>
  recordCommand(
    token,
    command,
    "filing_adoptions",
    Filing.AdoptionRecord,
    "capture_filing_adoption",
    null,
    (transaction, principal) =>
      Effect.gen(function* () {
        const manifest = yield* read(
          transaction,
          command.scope,
          "document_manifests",
          command.input.manifestId,
          Documents.DocumentManifest,
        );

        const evidence = yield* readEvidenceReference(
          transaction,
          command.scope.bookId,
          command.input.evidenceId,
        );

        return {
          id: newId("filing_adoption"),
          manifestId: manifest.id,
          manifestDigest: manifest.digest,
          fiscalYearId: manifest.fiscalYearId,
          evidenceId: evidence.evidenceId,
          evidenceHash: `sha256:${evidence.sha256}`,
          adoptedOn: command.input.adoptedOn,
          creatorId: principal.actorId,
        };
      }),
  );

export const reviewFilingAdoption = (
  token: string,
  command: Command<typeof Filing.ReviewAdoption.Type> & { readonly id: string },
) =>
  recordCommand(
    token,
    command,
    "filing_adoption_reviews",
    Filing.AdoptionReview,
    "review_filing_adoption",
    "review_filing_adoption",
    (transaction, principal) =>
      Effect.gen(function* () {
        const adoption = yield* read(
          transaction,
          command.scope,
          "filing_adoptions",
          command.id,
          Filing.AdoptionRecord,
        );

        if (adoption.creatorId === principal.actorId) return yield* failure("Forbidden");

        if (adoption.digest !== command.input.digest) return yield* failure("StaleDependency");

        return {
          id: newId("adoption_review"),
          adoptionId: adoption.id,
          adoptionDigest: adoption.digest,
          reviewerId: principal.actorId,
          reason: command.input.reason,
        };
      }),
  );

export function reviewedAdoption(transaction: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const adoption = yield* read(transaction, scope, "filing_adoptions", id, Filing.AdoptionRecord);

    const review = (yield* list(
      transaction,
      scope,
      "filing_adoption_reviews",
      Filing.AdoptionReview,
    ))
      .filter((item) => item.adoptionId === id)
      .at(-1);

    if (!review || review.adoptionDigest !== adoption.digest)
      return yield* failure("StaleDependency");

    return adoption;
  });
}
