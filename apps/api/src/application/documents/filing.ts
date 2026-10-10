import * as Filing from "@open-erp/contracts/filing-lifecycle";
import * as Documents from "@open-erp/contracts/document-signatures";
import {
  advanceSubmissionState,
  linkCorrection,
  prepareSubmission,
  type SubmissionState,
} from "@open-erp/domain/filing-lifecycle";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { RequestEnvironment } from "../../runtime/environment";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { requireInsertAccess, toJsonObject, withBook, type Scope } from "../commerce/support";
import {
  artifactBasis,
  currentGovernance,
  insert,
  list,
  participantCurrent,
  read,
  recordCommand,
  requireGovernance,
  seal,
  synthetic,
  validatedBasis,
  type Command,
} from "./support";
import { reviewedAdoption } from "./adoption";
import { manifestView } from "./signatures";
import type { Transaction } from "../../db/transaction";
import { authorize } from "../authority";

export function filingView(transaction: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const intent = yield* read(transaction, scope, "filing_intents", id, Filing.FilingIntent);

    const authorization =
      (yield* list(transaction, scope, "filing_authorizations", Filing.FilingAuthorization))
        .filter((item) => item.intentId === id)
        .at(-1) ?? null;

    const attempt =
      (yield* list(transaction, scope, "filing_attempts", Filing.FilingAttempt)).find(
        (item) => item.intentId === id,
      ) ?? null;

    const observations = (yield* list(
      transaction,
      scope,
      "filing_observations",
      Filing.FilingObservation,
    )).filter((item) => item.intentId === id);

    const state: SubmissionState =
      observations.at(-1)?.state ??
      (attempt ? "upload_admitted" : authorization ? "authorized" : "prepared");

    const current = yield* currentGovernance(transaction, scope, intent.input.governanceId);
    const signed = yield* manifestView(transaction, scope, intent.input.manifestId);

    const eligibleNow =
      current.current &&
      current.governance.digest === intent.governanceDigest &&
      current.governance.input.certifierIds.includes(intent.certifierId) &&
      signed.complete &&
      (yield* participantCurrent(transaction, scope, intent.certifierId));

    const fulfilled =
      state === "registered_if_required" ||
      (state === "received" && intent.input.requiredOutcome === "received");

    return {
      intent,
      authorization,
      attempt,
      observations,
      state,
      fulfilled,
      eligibleNow,
      qualification: "synthetic_only",
    } satisfies typeof Filing.FilingView.Type;
  });
}

export const prepareFilingIntent = (
  token: string,
  command: Command<typeof Filing.PrepareFiling.Type>,
) =>
  recordCommand(
    token,
    command,
    "filing_intents",
    Filing.FilingIntent,
    "prepare_filing_intent",
    null,
    (transaction) =>
      Effect.gen(function* () {
        const input = command.input;
        const adoption = yield* reviewedAdoption(transaction, command.scope, input.adoptionId);
        const governance = yield* requireGovernance(transaction, command.scope, input.governanceId);
        const signed = yield* manifestView(transaction, command.scope, input.manifestId);
        const manifest = signed.manifest;

        if (
          manifest.purpose !== "annual_report_signing" ||
          !signed.complete ||
          governance.digest !== manifest.governanceDigest
        )
          return yield* failure("StaleDependency");

        const copy = yield* validatedBasis(
          transaction,
          command.scope,
          input.copyArtifactId,
          input.copyValidationId,
        );

        if (
          adoption.manifestId !== manifest.id ||
          adoption.manifestDigest !== manifest.digest ||
          adoption.fiscalYearId !== manifest.fiscalYearId
        )
          return yield* failure("StaleDependency");

        const equivalent =
          copy.final.summary.modelDigest === manifest.modelDigest &&
          copy.presentation.digest === manifest.presentationDigest &&
          copy.final.fiscalYearId === manifest.fiscalYearId;

        const population = (yield* list(
          transaction,
          command.scope,
          "filing_intents",
          Filing.FilingIntent,
        )).filter((intent) => intent.fiscalYearId === manifest.fiscalYearId);

        const states: SubmissionState[] = [];

        for (const prior of population) {
          const view = yield* filingView(transaction, command.scope, prior.id);

          if (view.state !== "rejected" && view.state !== "correction_requested")
            return yield* failure("AlreadyPosted");
          states.push(view.state);
        }

        const id = newId("filing_intent");

        if (input.predecessorIntentId !== null) {
          const predecessor = yield* filingView(
            transaction,
            command.scope,
            input.predecessorIntentId,
          );

          const correction = linkCorrection({
            rejectedIntentId: predecessor.intent.id,
            rejectedState: predecessor.state,
            newReportRevision: copy.final.id,
            newIntentId: id,
            acceptedBefore: predecessor.observations.some(
              (observation) =>
                observation.state === "received" || observation.state === "registered_if_required",
            ),
          });

          if (
            Result.isFailure(correction) ||
            predecessor.intent.fiscalYearId !== manifest.fiscalYearId ||
            predecessor.intent.manifestDigest === manifest.digest ||
            predecessor.intent.copyArtifactHash === copy.hash
          )
            return yield* failure("StaleDependency");
        } else if (population.length > 0) return yield* failure("StaleDependency");

        const prepared = prepareSubmission(id, {
          obligationId: `annual_${manifest.fiscalYearId}`,
          entityId: command.scope.entityId,
          fiscalYearId: manifest.fiscalYearId,
          reportComplete: true,
          originalSignaturesValid: signed.complete,
          adoptionFactsPresent: true,
          copyEquivalent: equivalent,
          activeSubmissionStates: states,
          certifierEligible: governance.input.certifierIds.includes(input.certifierId),
          reportRevision: copy.final.id,
          copyArtifactHash: copy.hash,
          providerProfileVersion: "synthetic-filing-v1",
          environment: "test",
          predecessorIntentId: input.predecessorIntentId,
        });

        if (Result.isFailure(prepared)) return yield* failure("StaleDependency");

        return {
          id,
          input: yield* toJsonObject(input),
          manifestDigest: manifest.digest,
          copyArtifactHash: copy.hash,
          copyArtifactLength: copy.length,
          copyValidationDigest: copy.validation.digest,
          modelDigest: manifest.modelDigest,
          presentationDigest: manifest.presentationDigest,
          fiscalYearId: manifest.fiscalYearId,
          governanceDigest: governance.digest,
          adoptionDate: adoption.adoptedOn,
          adoptionId: adoption.id,
          adoptionDigest: adoption.digest,
          certifierId: input.certifierId,
          environment: "synthetic-loopback",
          providerProfile: "synthetic-filing-v1",
          correlation: `file_${id}`,
          signatureEvidenceIds: signed.signatures
            .filter((evidence) => evidence.technicalResult === "valid")
            .map((evidence) => evidence.id),
        };
      }),
  );

export const authorizeFiling = (
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
) =>
  recordCommand(
    token,
    command,
    "filing_authorizations",
    Filing.FilingAuthorization,
    "authorize_filing",
    "authorize_filing",
    (transaction, principal) =>
      Effect.gen(function* () {
        const view = yield* filingView(transaction, command.scope, command.id);

        if (
          view.intent.digest !== command.input.digest ||
          !view.eligibleNow ||
          view.attempt !== null
        )
          return yield* failure("StaleDependency");
        const now = yield* isoNow(transaction);

        return {
          id: newId("filing_authorization"),
          intentId: view.intent.id,
          intentDigest: view.intent.digest,
          actorId: principal.actorId,
          expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
        };
      }),
  );

export const getFiling = (token: string, command: { readonly scope: Scope; readonly id: string }) =>
  withBook(token, command.scope, false, function* (transaction) {
    return yield* filingView(transaction, command.scope, command.id);
  });

export const filingHistory = (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) =>
  withBook(token, command.scope, false, function* (transaction) {
    const items: Array<typeof Filing.FilingView.Type> = [];

    for (const intent of yield* list(
      transaction,
      command.scope,
      "filing_intents",
      Filing.FilingIntent,
    ))
      if (intent.fiscalYearId === command.id)
        items.push(yield* filingView(transaction, command.scope, intent.id));

    return { scope: command.scope, fiscalYearId: command.id, items };
  });

type FilingDisposition = Pick<typeof Filing.FilingObservation.Type, "state" | "quarantined">;

function normalize(
  view: typeof Filing.FilingView.Type,
  provider: typeof Filing.FilingProviderResult.Type | null,
  verified: boolean,
  action: "upload" | "certify" | "collect" | "retain",
): FilingDisposition {
  if (provider === null) {
    if (view.state === "upload_admitted" || view.state === "upload_outcome_unknown")
      return { state: "upload_outcome_unknown", quarantined: false };

    return { state: action === "certify" ? "outcome_unknown" : view.state, quarantined: false };
  }

  const receipt = provider.payload;

  const matches =
    verified &&
    receipt.entityId === view.intent.scope.entityId &&
    receipt.fiscalYearId === view.intent.fiscalYearId &&
    receipt.artifactHash === view.intent.copyArtifactHash &&
    receipt.intentId === view.intent.id &&
    receipt.attemptId === view.attempt?.id &&
    receipt.correlation === view.intent.correlation &&
    receipt.environment === view.intent.environment;

  if (!matches) return { state: "needs_review", quarantined: true };
  let observation: import("@open-erp/domain/filing-lifecycle").NormalizedObservation;

  if (receipt.status === "uploaded") observation = "copy_reference";
  else if (receipt.status === "submitted") observation = "submitted";
  else if (receipt.status === "received") observation = "provider_received";
  else if (receipt.status === "registered") observation = "provider_registered";
  else if (receipt.status === "rejected") observation = "provider_rejected";
  else if (receipt.status === "correction_requested") observation = "correction_demanded";
  else observation = "unmapped_status";

  const retained = view.observations.some(
    (observation) =>
      observation.provider?.payload.receiptId === receipt.receiptId &&
      observation.provider.signature === provider.signature &&
      observation.technicalVerified &&
      !observation.quarantined,
  );

  if (retained) return { state: view.state, quarantined: false };
  const next = advanceSubmissionState(view.state, observation);

  if (Result.isFailure(next)) return { state: "needs_review", quarantined: true };

  if (next.success === "copy_uploaded") {
    const awaiting = advanceSubmissionState(next.success, "certification_awaiting");

    return {
      state: Result.isSuccess(awaiting) ? awaiting.success : "needs_review",
      quarantined: false,
    };
  }

  return { state: next.success, quarantined: false };
}

function filingOperation(
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
  action: "upload" | "certify" | "collect" | "retain",
) {
  return Effect.gen(function* () {
    const environment = yield* RequestEnvironment;
    const adapter = environment.bindings.DOCUMENT_DELIVERY;
    const retention = action === "retain";

    if (retention && token !== environment.bindings.OPENERP_PREPARATION_TOKEN)
      return yield* failure("Forbidden");

    if (!adapter) return yield* failure("Unavailable");

    const admitted = yield* withBook(
      token,
      command.scope,
      !retention,
      function* (transaction, principal) {
        yield* authorize(principal, retention ? "retain_filing_observation" : "operate_filing");
        yield* synthetic(transaction, command.scope);
        yield* requireInsertAccess(transaction, [
          "filing_attempts",
          "filing_observations",
          "command_receipts",
        ]);
        const operation = `${action}_filing`;

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          { id: command.id, input: yield* toJsonObject(command.input) },
          Filing.FilingAttempt,
        );

        const view = yield* filingView(transaction, command.scope, command.id);

        if (view.intent.digest !== command.input.digest) return yield* failure("StaleDependency");

        if (action === "certify" && principal.actorId !== view.intent.certifierId)
          return yield* failure("Forbidden");

        if (!view.eligibleNow && action !== "collect" && action !== "retain")
          return yield* failure("StaleDependency");

        const copy = yield* artifactBasis(
          transaction,
          command.scope,
          view.intent.input.copyArtifactId,
        );

        if (
          copy.hash !== view.intent.copyArtifactHash ||
          copy.length !== view.intent.copyArtifactLength
        )
          return yield* failure("StaleDependency");
        let attempt = view.attempt;

        if (attempt === null) {
          if (action !== "upload") return yield* failure("StaleDependency");
          const authorization = view.authorization;

          if (
            !authorization ||
            authorization.intentDigest !== view.intent.digest ||
            Date.parse(authorization.expiresAt) <= Date.parse(yield* isoNow(transaction))
          )
            return yield* failure("Forbidden");
          attempt = yield* seal(
            transaction,
            command.scope,
            Filing.FilingAttempt,
            operation,
            principal.actorId,
            command.idempotencyKey,
            {
              id: newId("filing_attempt"),
              intentId: view.intent.id,
              intentDigest: view.intent.digest,
              authorizationId: authorization.id,
              correlation: view.intent.correlation,
            },
          );
          yield* insert(transaction, "filing_attempts", attempt);
        }

        if (
          action === "certify" &&
          view.state !== "awaiting_authority_certification" &&
          view.state !== "submitted_pending"
        )
          return yield* failure("StaleDependency");

        if (
          action === "upload" &&
          view.state !== "prepared" &&
          view.state !== "authorized" &&
          view.state !== "upload_admitted" &&
          view.state !== "upload_outcome_unknown" &&
          view.state !== "awaiting_authority_certification"
        )
          return yield* failure("StaleDependency");

        if (!request.previous)
          yield* saveCommand(
            transaction,
            command.scope,
            command.idempotencyKey,
            request.expected,
            operation,
            principal.actorId,
            yield* toJsonObject(attempt),
          );

        return { view, attempt, actorId: principal.actorId, xhtml: copy.artifact.xhtml };
      },
      "update",
    );

    const provider = yield* Effect.tryPromise({
      try: () =>
        adapter.filing(
          action === "retain" ? "collect" : action,
          admitted.view.intent,
          admitted.attempt,
          admitted.xhtml,
        ),
      catch: () => failure("Unavailable"),
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    const verified =
      provider === null
        ? false
        : yield* Effect.tryPromise({
            try: () => adapter.verify(provider.keyId, provider.payload, provider.signature),
            catch: () => failure("Unavailable"),
          });

    return yield* withBook(
      token,
      command.scope,
      !retention,
      function* (transaction, principal) {
        yield* authorize(principal, retention ? "retain_filing_observation" : "operate_filing");

        if (principal.actorId !== admitted.actorId) return yield* failure("Forbidden");
        yield* requireInsertAccess(transaction, ["filing_observations"]);
        const view = yield* filingView(transaction, command.scope, command.id);

        if (view.attempt?.id !== admitted.attempt.id) return yield* failure("StaleDependency");
        const normalized = normalize(view, provider, verified, action);
        const last = view.observations.at(-1);

        if (last?.state !== normalized.state || last?.provider?.signature !== provider?.signature) {
          const observation = yield* seal(
            transaction,
            command.scope,
            Filing.FilingObservation,
            "observe_filing",
            principal.actorId,
            command.idempotencyKey,
            {
              id: newId("filing_observation"),
              intentId: view.intent.id,
              attemptId: admitted.attempt.id,
              state: normalized.state,
              provider,
              quarantined: normalized.quarantined,
              technicalVerified: verified,
              verificationKey: adapter.verificationKey,
            },
          );

          yield* insert(transaction, "filing_observations", observation);
        }

        return yield* filingView(transaction, command.scope, command.id);
      },
      "update",
    );
  });
}

export const uploadFiling = (
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
) => filingOperation(token, command, "upload");

export const certifyFiling = (
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
) => filingOperation(token, command, "certify");

export const collectFiling = (
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
) => filingOperation(token, command, "collect");

export const retainFilingObservation = (
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
) => filingOperation(token, command, "retain");
