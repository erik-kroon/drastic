import { runBookCommandWithReceipt } from "../book-commands";
import * as Mandates from "@open-erp/contracts/posting-mandates";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/posting-mandates";
import * as PostingDb from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { authorizePresent, readAuthorityPolicy } from "../authority";
import { failure } from "../failures";
import { digest } from "../json";
import { newId } from "../identifiers";

import { collectPostingActorBasis, collectPostingPrincipalBasis } from "../posting-authority";
import { executeAcceptanceInTransaction, readCurrentReview, recordApproval } from "./acceptance";
import * as Shared from "./shared";

type Scope = Shared.Scope;

type Command<I> = {
  readonly scope: Scope;
  readonly idempotencyKey: string;
  readonly input: I;
};

const sum = (values: ReadonlyArray<string>) =>
  values.reduce((total, value) => total + BigInt(value), 0n);

// Mandates are refused outright unless the operator console enabled them for the book.
function requireMandatesEnabled(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const policy = yield* readAuthorityPolicy(transaction, scope.bookId);

    if (!policy.postingMandatesEnabled) return yield* failure("Forbidden");
  });
}

function mandateView(scope: Scope, row: Db.MandateRow) {
  return Effect.gen(function* () {
    const body = yield* Shared.decode(MandateBody, row.body);

    return yield* Shared.decode(Mandates.PostingMandate, {
      id: row.id,
      scope,
      grantorId: row.grantorId,
      terms: body.terms,
      reason: body.reason,
      digest: row.digest,
      grantedAt: row.grantedAt,
      revocation: row.revocation,
      consumedEvents: row.consumedEvents,
      consumedGrossMinor: sum(row.consumedGross).toString(),
    });
  });
}

// The retained terms, reason and the grantor's approval basis at grant, including
// how the grantor authenticated for the grant gesture.
const MandateBody = Schema.Struct({
  terms: Mandates.MandateTerms,
  reason: Mandates.PostingMandate.fields.reason,
  grantBasis: Schema.JsonObject,
});

function lockedMandate(transaction: Transaction, scope: Scope, id: string) {
  return Db.lockMandate(transaction, scope.bookId, id).pipe(
    Effect.flatMap((rows) => (rows[0] ? Effect.succeed(rows[0]) : failure("NotFound"))),
  );
}

// Grant is a human gesture: an operator with an interactive session and, when the
// book requires it, a presence proof for this exact request. Terms name the
// current revision of each supplier; a later revision is outside the mandate.
export const grantPostingMandate = Effect.fn("mandates.grant")(function* (
  token: string,
  command: Command<typeof Mandates.GrantPostingMandate.Type>,
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const { scope, input } = command,
        operation = "grant_posting_mandate";

      yield* authorizePresent(transaction, principal, scope, "grant_posting_mandate", {
        idempotencyKey: command.idempotencyKey,
        id: null,
        input: yield* Shared.toJsonObject(input),
      });
      yield* Shared.requireTables(transaction, Db.mandateTables, Db.mandateTables);

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { input: yield* Shared.toJsonObject(input) },
        },
        Mandates.PostingMandate,
        Effect.gen(function* () {
          yield* requireMandatesEnabled(transaction, scope);

          // Decoding through the terms schema keeps exactly the terms, without the
          // reason or acknowledgement.
          const terms = yield* Shared.decode(
            Mandates.MandateTerms,
            yield* Shared.toJsonObject(input),
          );

          if (
            Date.parse(terms.validUntil) <= Date.parse(terms.validFrom) ||
            BigInt(terms.aggregateLimitMinor) < BigInt(terms.perEventLimitMinor) ||
            terms.granteeId === principal.actorId ||
            new Set(terms.profiles).size !== terms.profiles.length ||
            new Set(terms.counterparties.map((entry) => entry.counterpartyId)).size !==
              terms.counterparties.length
          )
            return yield* failure("InvalidJournal");

          if (
            (yield* PostingDb.readPostingMembership(transaction, scope.bookId, terms.granteeId))
              .length === 0
          )
            return yield* failure("InvalidJournal");

          for (const entry of terms.counterparties) {
            const current = (yield* Db.readCurrentCounterparty(
              transaction,
              scope.bookId,
              entry.counterpartyId,
            ))[0];

            if (
              current === undefined ||
              current.currentRevision !== entry.revision ||
              (current.role !== "supplier" && current.role !== "both")
            )
              return yield* failure("StaleDependency");
          }

          const id = newId("posting_mandate");

          const body = {
            terms: yield* Shared.toJsonObject(terms),
            reason: input.reason,
            grantBasis: yield* collectPostingPrincipalBasis(
              transaction,
              scope,
              principal,
              "approve_change",
            ),
          };

          const mandateDigest = yield* digest({
            version: 1,
            id,
            scope,
            grantorId: principal.actorId,
            ...body,
          });

          yield* Db.insertMandate(transaction, {
            bookId: scope.bookId,
            id,
            grantorId: principal.actorId,
            granteeId: terms.granteeId,
            validFrom: terms.validFrom,
            validUntil: terms.validUntil,
            body,
            digest: mandateDigest,
          });

          for (const entry of terms.counterparties) {
            yield* Db.insertMandateCounterparty(transaction, {
              bookId: scope.bookId,
              mandateId: id,
              counterpartyId: entry.counterpartyId,
              revision: entry.revision,
            });
          }

          const view = yield* mandateView(scope, yield* lockedMandate(transaction, scope, id));

          return { receipt: yield* Shared.toJsonObject(view), result: view };
        }),
      );
    }),
  );
});

// Any current operator may revoke, however they authenticated: removing authority
// must not be harder than using it. Revocation stops later consumption only.
export const revokePostingMandate = Effect.fn("mandates.revoke")(function* (
  token: string,
  command: Command<typeof Mandates.RevokePostingMandate.Type> & { readonly id: string },
) {
  return yield* Shared.withBook(token, command.scope, true, "update", (transaction, principal) =>
    Effect.gen(function* () {
      const { scope, input } = command,
        operation = "revoke_posting_mandate";

      yield* Shared.requireTables(transaction, Db.mandateTables, Db.mandateTables);

      return yield* runBookCommandWithReceipt(
        transaction,
        {
          scope: scope,
          idempotencyKey: command.idempotencyKey,
          operation: operation,
          actorId: principal.actorId,
          input: { id: command.id, input: yield* Shared.toJsonObject(input) },
        },
        Mandates.PostingMandate,
        Effect.gen(function* () {
          const mandate = yield* lockedMandate(transaction, scope, command.id);

          if (mandate.digest !== input.digest) return yield* failure("StaleDependency");

          if (mandate.revocation === null)
            yield* Db.insertRevocation(transaction, {
              bookId: scope.bookId,
              mandateId: command.id,
              actorId: principal.actorId,
              reason: input.reason,
            });

          const view = yield* mandateView(
            scope,
            yield* lockedMandate(transaction, scope, command.id),
          );

          return { receipt: yield* Shared.toJsonObject(view), result: view };
        }),
      );
    }),
  );
});

export const getPostingMandate = Effect.fn("mandates.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, Db.mandateTables);
      const row = (yield* Db.readMandate(transaction, command.scope.bookId, command.id))[0];

      if (row === undefined) return yield* failure("NotFound");

      return yield* mandateView(command.scope, row);
    }),
  );
});

export const listPostingMandates = Effect.fn("mandates.list")(function* (
  token: string,
  scope: Scope,
) {
  return yield* Shared.withBook(token, scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, Db.mandateTables);

      return yield* Effect.forEach(yield* Db.listMandates(transaction, scope.bookId), (row) =>
        mandateView(scope, row),
      );
    }),
  );
});

// The grantee executes one sealed supplier review under the mandate. Every term,
// the grantor's current authority and the remaining limits are checked under the
// mandate row lock; the approval, posting, acceptance and consumption commit
// together or not at all. A refusal leaves the review for exact human approval.
export const executeSupplierAcceptanceUnderMandate = Effect.fn("mandates.executeAcceptance")(
  function* (
    token: string,
    command: Command<typeof Mandates.ExecuteSupplierAcceptanceUnderMandate.Type> & {
      readonly reviewId: string;
    },
  ) {
    return yield* Shared.withBook(token, command.scope, false, "update", (transaction, principal) =>
      Effect.gen(function* () {
        const { scope, input } = command,
          operation = "execute_supplier_acceptance_under_mandate";

        yield* Shared.requireTables(transaction, Db.mandateTables, Db.mandateTables);

        return yield* runBookCommandWithReceipt(
          transaction,
          {
            scope: scope,
            idempotencyKey: command.idempotencyKey,
            operation: operation,
            actorId: principal.actorId,
            input: { reviewId: command.reviewId, input: yield* Shared.toJsonObject(input) },
          },
          Mandates.MandateExecution,
          Effect.gen(function* () {
            yield* requireMandatesEnabled(transaction, scope);

            const mandate = yield* lockedMandate(transaction, scope, input.mandateId);

            if (mandate.granteeId !== principal.actorId) return yield* failure("Forbidden");

            if (mandate.digest !== input.mandateDigest) return yield* failure("StaleDependency");

            if (mandate.revocation !== null || !mandate.current)
              return yield* failure("ApprovalRequired");

            const retained = yield* Shared.decode(MandateBody, mandate.body);
            const terms = retained.terms;

            // The grantor's authority is current, not as it was at grant.
            const grantorBasis = yield* collectPostingActorBasis(
              transaction,
              scope,
              mandate.grantorId,
              "approve_change",
            );

            const review = yield* readCurrentReview(
              transaction,
              scope,
              command.reviewId,
              input.digest,
            );

            const draft = review.draftSnapshot;
            const counterpartyId = draft.content.counterpartyId;

            const named = (yield* Db.readMandateCounterparty(
              transaction,
              scope.bookId,
              mandate.id,
              counterpartyId,
            ))[0];

            const current = (yield* Db.readCurrentCounterparty(
              transaction,
              scope.bookId,
              counterpartyId,
            ))[0];

            const gross = draft.totals.grossMinor;
            const consumed = sum(mandate.consumedGross);

            if (
              !terms.profiles.includes(review.profile) ||
              named === undefined ||
              named.revision !== draft.content.counterpartyRevision ||
              current?.currentRevision !== named.revision ||
              draft.content.currency !== terms.currency ||
              gross === null ||
              BigInt(gross) <= 0n ||
              BigInt(gross) > BigInt(terms.perEventLimitMinor) ||
              consumed + BigInt(gross) > BigInt(terms.aggregateLimitMinor) ||
              mandate.consumedEvents + 1 > terms.maxEvents
            )
              return yield* failure("ApprovalRequired");

            const approval = yield* recordApproval(transaction, {
              scope,
              reviewId: command.reviewId,
              reviewDigest: review.digest,
              approverId: mandate.grantorId,
              // The approval is the grantor's: current membership, admission and
              // responsibility, with the authentication of the grant gesture. The
              // mandate and the executing grantee are recorded beside it.
              authorityBasis: {
                ...grantorBasis,
                authentication: retained.grantBasis.authentication ?? null,
                basis: "mandate",
                mandate: { id: mandate.id, digest: mandate.digest },
                executor: yield* collectPostingPrincipalBasis(
                  transaction,
                  scope,
                  principal,
                  "execute_change",
                ),
              },
              receipt: Shared.receipt(command.idempotencyKey, operation, principal.actorId),
            });

            const acceptance = yield* executeAcceptanceInTransaction(transaction, principal, {
              scope,
              reviewId: command.reviewId,
              idempotencyKey: command.idempotencyKey,
              operation,
              input: {
                version: 1,
                digest: review.digest,
                approvalId: approval.id,
                acknowledgeSyntheticOnly: true,
              },
              approverId: mandate.grantorId,
            });

            const ordinal = mandate.consumedEvents + 1;

            yield* Db.insertConsumption(transaction, {
              bookId: scope.bookId,
              mandateId: mandate.id,
              ordinal,
              reviewId: command.reviewId,
              approvalId: approval.id,
              acceptanceId: acceptance.id,
              grossMinor: gross,
            });

            const result = yield* Shared.decode(Mandates.MandateExecution, {
              mandateId: mandate.id,
              ordinal,
              grossMinor: gross,
              remainingGrossMinor: (
                BigInt(terms.aggregateLimitMinor) -
                consumed -
                BigInt(gross)
              ).toString(),
              remainingEvents: terms.maxEvents - ordinal,
              acceptance: yield* Shared.toJsonObject(acceptance),
            });

            return { receipt: yield* Shared.toJsonObject(result), result: result };
          }),
        );
      }),
    );
  },
);
