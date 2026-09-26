import * as Accounting from "@open-erp/contracts/accounting";
import * as Deadlines from "@open-erp/contracts/deadlines";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand, versionedDigest } from "../posting";
import { decode, toJsonObject, unsupported, withBook } from "../commerce/support";
import * as Db from "../../db/deadlines";
import * as LinkDb from "../../db/fulfillment";
import * as Basis from "./fulfillment-basis";
import { requireDeadlineAccess } from "./deadlines";
import type { Transaction } from "../../db/transaction";

type Scope = typeof Accounting.Scope.Type;

type Reference = typeof Deadlines.FulfillmentReference.Type;

type Deadline = typeof Deadlines.Deadline.Type;

type Environment = typeof Deadlines.FulfillmentEnvironment.Type;

type OutcomeKind = typeof Deadlines.OutcomeKind.Type;

type Witness = typeof Deadlines.FulfillmentWitness.Type;

type Family = typeof Deadlines.RuleFamily.Type;

type Verification = typeof Deadlines.FulfillmentVerification.Type;

type OwnedReference = Extract<
  Reference,
  { kind: "local_prepared_artifact" } | { kind: "submitted_attempt" }
>;

type Resolved = LinkDb.ArtifactOwnerRow | LinkDb.DeliveryAttemptRow | undefined;

const DeadlineSchema = Deadlines.Deadline;

const FulfillmentSchema = Deadlines.FulfillmentLink;

const ReferenceSchema = Deadlines.FulfillmentReference;

const ResultSchema = Deadlines.FulfillmentResult;

const FulfillmentListSchema = Deadlines.FulfillmentList;

function decodeList<A>(schema: Schema.Decoder<ReadonlyArray<A>>, value: unknown) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

// A deadline is a per-family, per-period deliverable. Both registered artifact
// owners reach a report snapshot, so both attest the exact reporting period.

const artifactFamilies = {
  accountant_review_artifact: "statements",
  sie_transaction_artifact: "statements",
} as const;

const attemptFamilies = { ar_legal_delivery_attempt: "legal_ar" } as const;

const environmentLimitation =
  "The environment is asserted by the reference, not attested by its owner.";

const attemptLimitation =
  "A dispatch attempt evidences delivery to a recipient, never authority acceptance.";

function requireLinkAccess(transaction: Transaction, write: boolean) {
  const readTables = [...LinkDb.fulfillmentReadTables];
  const insertTables = new Set<string>(LinkDb.fulfillmentInsertTables);

  return Effect.gen(function* () {
    const rows = yield* LinkDb.readFulfillmentAccess(transaction);

    if (rows.length !== readTables.length) return yield* unsupported();

    if (rows.some((row) => !row.canSelect)) return yield* unsupported();

    if (!write) return;

    if (rows.some((row) => insertTables.has(row.tableName) && !row.canInsert)) {
      return yield* unsupported();
    }
  });
}

function witness(owner: string, family: Family, resolved: Resolved, digest: boolean): Witness {
  return {
    owner,
    outcomeConfirmed: false,
    periodConfirmed: false,
    familyConfirmed: resolved !== undefined,
    revisionConfirmed: resolved !== undefined,
    environmentConfirmed: false,
    digestConfirmed: digest,
    observedPeriodId: resolved?.periodId ?? null,
    observedFamily: family,
    observedRevision: resolved?.revision ?? null,
    limitations: [environmentLimitation],
  };
}

function readResolved(transaction: Transaction, bookId: string, reference: Reference) {
  if (reference.kind === "local_prepared_artifact") {
    return reference.owner === "accountant_review_artifact"
      ? LinkDb.readReviewArtifact(transaction, bookId, reference.artifactId)
      : LinkDb.readSieArtifact(transaction, bookId, reference.artifactId);
  }

  if (reference.kind === "submitted_attempt") {
    return LinkDb.readDeliveryAttempt(transaction, bookId, reference.attemptId);
  }

  return Effect.succeed([]);
}

function verifyOwned(input: {
  readonly obligation: Deadline;
  readonly reference: OwnedReference;
  readonly resolved: Resolved;
}): Verification {
  const reference = input.reference;

  const family =
    reference.kind === "local_prepared_artifact"
      ? artifactFamilies[reference.owner]
      : attemptFamilies[reference.owner];

  const basis = input.obligation.statutory_basis;
  const base = witness(reference.owner, family, input.resolved, false);

  if (input.resolved === undefined) {
    return Basis.verification(
      "mismatch",
      "the_referenced_record_does_not_exist_in_this_book",
      base,
    );
  }

  const observed = {
    ...base,
    familyConfirmed: basis !== null && basis.family === family,
    digestConfirmed: input.resolved.digest === reference.digest,
    revisionConfirmed:
      reference.kind === "local_prepared_artifact"
        ? input.resolved.revision === reference.revision
        : true,
  };

  if (!observed.digestConfirmed) {
    return Basis.verification(
      "mismatch",
      "the_retained_artifact_digest_does_not_match_the_reference",
      observed,
    );
  }

  if (!observed.revisionConfirmed) {
    return Basis.verification(
      "mismatch",
      "the_retained_artifact_revision_does_not_match_the_reference",
      observed,
    );
  }

  if (!observed.familyConfirmed || basis === null) {
    return Basis.verification(
      "mismatch",
      "the_reference_owner_family_does_not_match_the_obligation_basis_family",
      observed,
    );
  }

  if (basis.periodId !== input.resolved.periodId) {
    return Basis.verification(
      "mismatch",
      "the_reference_period_does_not_match_the_obligation_period",
      observed,
    );
  }

  const scoped = { ...observed, periodConfirmed: true };

  if (reference.kind === "local_prepared_artifact") {
    return Basis.verification(
      "satisfied",
      "the_retained_artifact_is_this_obligation_period_deliverable",
      { ...scoped, outcomeConfirmed: true },
    );
  }

  const attempt = input.resolved;

  if ("reconciliationOutcome" in attempt && attempt.reconciliationOutcome === null) {
    return Basis.verification(
      "pending",
      "the_provider_outcome_of_this_attempt_is_not_observed_yet",
      scoped,
    );
  }

  const outcome = "reconciliationOutcome" in attempt ? attempt.reconciliationOutcome : null;

  if (outcome !== "provider_accepted") {
    return Basis.verification(
      "mismatch",
      `the_provider_did_not_accept_this_attempt_${outcome ?? "unknown"}`,
      scoped,
    );
  }

  return Basis.verification(
    "satisfied",
    "the_provider_accepted_the_dispatch_of_this_exact_artifact",
    { ...scoped, outcomeConfirmed: true, limitations: [environmentLimitation, attemptLimitation] },
  );
}

export function verifyReference(input: {
  readonly obligation: Deadline;
  readonly requiredEnvironment: Environment;
  readonly requiredOutcome: OutcomeKind;
  readonly reference: Reference;
  readonly resolved: Resolved;
}): Verification {
  const reference = input.reference;

  if (!Basis.environmentMatches(input.requiredEnvironment, reference)) {
    return {
      state: "mismatch",
      reason: `the_reference_environment_${reference.environment}_is_not_the_obligation_environment`,
      witness: { ...Basis.unattestedWitness(), limitations: [environmentLimitation] },
    };
  }

  if (!Basis.outcomePredicateSatisfied(input.requiredOutcome, reference)) {
    return {
      state: "mismatch",
      reason: `a_${reference.kind}_reference_does_not_evidence_the_required_${input.requiredOutcome}_outcome`,
      witness: {
        ...Basis.unattestedWitness(),
        owner: reference.kind,
        limitations: ["A reference evidences only the outcome its own owner retains."],
      },
    };
  }

  if (reference.kind === "local_prepared_artifact" || reference.kind === "submitted_attempt") {
    return verifyOwned({
      obligation: input.obligation,
      reference,
      resolved: input.resolved,
    });
  }

  return Basis.openWitness(
    reference.kind === "authority_outcome"
      ? "no_authority_outcome_owner_is_released_to_confirm_this_receipt"
      : "a_reviewed_external_observation_is_a_reported_note_and_not_verified_evidence",
  );
}

export const listFulfillments = Effect.fn("deadlines.listFulfillments")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireLinkAccess(transaction, false);

    if (
      (yield* Db.readObligation(transaction, command.scope.bookId, command.id, false)).length === 0
    ) {
      return yield* failure("NotFound");
    }

    const rows = yield* LinkDb.listFulfillments(transaction, command.scope.bookId, command.id);

    return yield* decodeList(
      FulfillmentListSchema,
      rows.map((row) => row.body),
    );
  });
});

export const linkFulfillment = Effect.fn("deadlines.linkFulfillment")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; reference: Reference },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject({ id: command.id, reference: command.reference });

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "deadline_fulfillment_link",
        principal.actorId,
        payload,
        ResultSchema,
      );

      if (request.previous) return request.previous;
      yield* requireLinkAccess(transaction, true);
      yield* requireDeadlineAccess(transaction, true);

      const reference = yield* decode(ReferenceSchema, command.reference);
      const current = () => Db.readProjection(transaction, command.scope.bookId, command.id);

      if (
        (yield* Db.readObligation(transaction, command.scope.bookId, command.id, true)).length === 0
      ) {
        return yield* failure("NotFound");
      }

      const obligation = yield* decode(DeadlineSchema, (yield* current())[0]!.body);
      const requiredEnvironment = obligation.required_environment;

      if (requiredEnvironment === null || obligation.statutory_basis === null) {
        return yield* failure("MissingEvidence");
      }

      const referenceDigest = yield* versionedDigest(yield* toJsonObject(reference));

      const existing = (yield* LinkDb.readFulfillmentByReference(
        transaction,
        command.scope.bookId,
        command.id,
        referenceDigest,
      ))[0];

      // The same reference linked twice is the same evidence, not a new claim.
      if (existing) {
        return yield* decode(ResultSchema, {
          fulfillment: existing.body,
          obligation: (yield* current())[0]!.body,
        });
      }

      const resolved = (yield* readResolved(transaction, command.scope.bookId, reference))[0];

      const verification = verifyReference({
        obligation,
        requiredEnvironment,
        requiredOutcome: obligation.outcome_kind,
        reference,
        resolved,
      });

      const recordedAt = yield* isoNow(transaction);

      const unsealed = yield* toJsonObject({
        id: newId("deadline_fulfillment"),
        scope: command.scope,
        obligationId: command.id,
        obligationRevision: obligation.revision,
        outcomeKind: obligation.outcome_kind,
        reference,
        referenceDigest,
        environment: reference.environment,
        verification,
        recordedBy: principal.actorId,
        recordedAt,
      });

      const link = yield* decode(FulfillmentSchema, {
        ...unsealed,
        digest: yield* versionedDigest(unsealed),
      });

      const identity = Basis.referenceIdentity(reference);

      yield* LinkDb.insertFulfillment(transaction, {
        bookId: command.scope.bookId,
        id: link.id,
        obligationId: command.id,
        obligationRevision: String(obligation.revision),
        referenceDigest,
        outcomeKind: obligation.outcome_kind,
        referenceKind: reference.kind,
        reference: yield* toJsonObject(reference),
        environment: reference.environment,
        verification: verification.state,
        reason: verification.reason,
        witness: yield* toJsonObject(verification.witness),
        recordedBy: principal.actorId,
        recordedAt,
        digest: link.digest,
        body: yield* toJsonObject(link),
      });
      yield* Db.insertActivity(transaction, {
        bookId: command.scope.bookId,
        obligationId: command.id,
        id: newId("deadline_activity"),
        action: "record_outcome",
        reference: identity,
        outcomeKind: obligation.outcome_kind,
        recordedBy: principal.actorId,
        recordedAt,
      });

      if (verification.state === "satisfied") {
        yield* Db.recordOutcome(
          transaction,
          command.scope.bookId,
          command.id,
          identity,
          recordedAt,
        );
      }

      const result = yield* decode(ResultSchema, {
        fulfillment: link,
        obligation: (yield* current())[0]!.body,
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "deadline_fulfillment_link",
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
