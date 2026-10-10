import * as Documents from "@open-erp/contracts/document-signatures";
import {
  assertSignerSetComplete,
  completeSignature,
  prepareSignatureIntent,
} from "@open-erp/domain/document-signatures";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { RequestEnvironment } from "../../runtime/environment";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
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
import type { Transaction } from "../../db/transaction";
import { authorize } from "../authority";

export const prepareDocumentManifest = (
  token: string,
  command: Command<typeof Documents.PrepareDocumentManifest.Type>,
) =>
  recordCommand(
    token,
    command,
    "document_manifests",
    Documents.DocumentManifest,
    "prepare_document_manifest",
    null,
    (transaction) =>
      Effect.gen(function* () {
        const input = command.input;

        if (input.purpose !== "annual_report_signing") return yield* failure("UnsupportedProfile");

        const basis = yield* validatedBasis(
          transaction,
          command.scope,
          input.artifactId,
          input.validationId,
        );

        const governance = yield* requireGovernance(transaction, command.scope, input.governanceId);

        if (governance.input.fiscalYearId !== basis.final.fiscalYearId)
          return yield* failure("StaleDependency");

        return {
          id: newId("document_manifest"),
          artifactId: basis.artifact.id,
          finalId: basis.final.id,
          presentationId: basis.presentation.id,
          fiscalYearId: basis.final.fiscalYearId,
          legalEntityRevision: governance.input.legalEntityRevision,
          purpose: input.purpose,
          modelDigest: basis.final.summary.modelDigest,
          artifactHash: basis.hash,
          artifactLength: basis.length,
          presentationDigest: basis.presentation.digest,
          consentText: input.consentText,
          consentTextHash: `sha256:${yield* sha256Hex(input.consentText)}`,
          requiredSigners: governance.input.requiredSigners.map((signer) => ({ ...signer })),
          policyRelease: input.policyRelease,
          validationId: basis.validation.id,
          validationDigest: basis.validation.digest,
          governanceId: governance.id,
          governanceDigest: governance.digest,
          artifactRelations: [
            {
              artifactId: basis.artifact.id,
              relationship: "signed_original",
              contentHash: basis.hash,
            },
          ],
          environment: "synthetic-loopback",
        };
      }),
  );

function domainManifest(manifest: typeof Documents.DocumentManifest.Type) {
  return {
    manifestId: manifest.id,
    bookId: manifest.scope.bookId,
    legalEntityRevision: manifest.legalEntityRevision,
    purpose: manifest.purpose,
    modelDigest: manifest.modelDigest,
    artifactDigest: manifest.artifactHash,
    artifactLength: manifest.artifactLength,
    displayRepresentationDigest: manifest.presentationDigest,
    requiredSigners: manifest.requiredSigners,
    policyRelease: manifest.policyRelease,
  };
}

function currentlyEligible(
  evidence: typeof Documents.RetainedSignatureEvidence.Type | null,
  authorityCurrent: boolean,
) {
  return authorityCurrent && evidence?.technicalResult === "valid";
}

export function currentManifest(
  transaction: Transaction,
  scope: Scope,
  manifest: typeof Documents.DocumentManifest.Type,
) {
  return Effect.gen(function* () {
    const governance = yield* currentGovernance(transaction, scope, manifest.governanceId);

    if (!governance.current || governance.governance.digest !== manifest.governanceDigest)
      return false;

    for (const signer of manifest.requiredSigners)
      if (!(yield* participantCurrent(transaction, scope, signer.signerId))) return false;

    yield* validatedBasis(transaction, scope, manifest.artifactId, manifest.validationId);

    return true;
  });
}

export const prepareDocumentSignature = (
  token: string,
  command: Command<typeof Documents.PrepareSignatureIntent.Type>,
) =>
  recordCommand(
    token,
    command,
    "document_signature_intents",
    Documents.DocumentSignatureIntent,
    "prepare_document_signature",
    "prepare_document_signature",
    (transaction, principal) =>
      Effect.gen(function* () {
        const manifest = yield* read(
          transaction,
          command.scope,
          "document_manifests",
          command.input.manifestId,
          Documents.DocumentManifest,
        );

        if (principal.actorId !== command.input.signerId) return yield* failure("Forbidden");

        if (!(yield* currentManifest(transaction, command.scope, manifest)))
          return yield* failure("StaleDependency");

        const existing = (yield* list(
          transaction,
          command.scope,
          "document_signature_intents",
          Documents.DocumentSignatureIntent,
        )).find(
          (intent) =>
            intent.manifestId === manifest.id && intent.signerId === command.input.signerId,
        );

        if (existing) return yield* failure("AlreadyPosted");
        const id = newId("signature_intent");

        const prepared = prepareSignatureIntent({
          intentId: id,
          manifest: domainManifest(manifest),
          manifestDigest: manifest.digest,
          contentImmutable: true,
          requiredValidationDone: true,
          expectedSigner: command.input.signerId,
          signerRoleQualified: manifest.requiredSigners.some(
            (signer) => signer.signerId === command.input.signerId,
          ),
          displayAgreesWithManifest: true,
          consentTextHash: manifest.consentTextHash,
          providerEnvironment: manifest.environment,
          signingProfile: "synthetic_signature",
          requestDigest: yield* digest({
            manifestDigest: manifest.digest,
            signerId: command.input.signerId,
          }),
        });

        if (Result.isFailure(prepared)) return yield* failure("Forbidden");
        const now = yield* isoNow(transaction);

        return {
          id,
          manifestId: manifest.id,
          manifestDigest: prepared.success.manifestDigest,
          signerId: command.input.signerId,
          purpose: manifest.purpose,
          consentTextHash: manifest.consentTextHash,
          correlation: `sign_${id}`,
          environment: manifest.environment,
          expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
        };
      }),
  );

export function signatureView(transaction: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const intent = yield* read(
      transaction,
      scope,
      "document_signature_intents",
      id,
      Documents.DocumentSignatureIntent,
    );

    const manifest = yield* read(
      transaction,
      scope,
      "document_manifests",
      intent.manifestId,
      Documents.DocumentManifest,
    );

    const attempt =
      (yield* list(
        transaction,
        scope,
        "document_signature_attempts",
        Documents.SignatureAttempt,
      )).find((item) => item.intentId === id) ?? null;

    const evidence =
      (yield* list(
        transaction,
        scope,
        "document_signature_evidence",
        Documents.RetainedSignatureEvidence,
      )).find((item) => item.intentId === id) ?? null;

    const observations = (yield* list(
      transaction,
      scope,
      "document_signature_observations",
      Documents.SignatureObservation,
    )).filter((item) => item.attemptId === attempt?.id);

    const state = evidence
      ? evidence.technicalResult === "valid"
        ? "complete"
        : "invalid"
      : (observations.at(-1)?.state ?? "prepared");

    const eligibleNow = currentlyEligible(
      evidence,
      yield* currentManifest(transaction, scope, manifest),
    );

    return {
      intent,
      attempt,
      evidence,
      observations,
      state,
      eligibleNow,
    } satisfies typeof Documents.SignatureIntentView.Type;
  });
}

export function manifestView(transaction: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const manifest = yield* read(
      transaction,
      scope,
      "document_manifests",
      id,
      Documents.DocumentManifest,
    );

    const signatures = (yield* list(
      transaction,
      scope,
      "document_signature_evidence",
      Documents.RetainedSignatureEvidence,
    )).filter(
      (evidence) => evidence.manifestId === id && evidence.manifestDigest === manifest.digest,
    );

    const governanceCurrent = yield* currentManifest(transaction, scope, manifest);

    const coverage = signatures.map(
      (evidence) =>
        ({
          evidenceId: evidence.id,
          intentId: evidence.intentId,
          manifestId: evidence.manifestId,
          manifestDigest: evidence.manifestDigest,
          providerOrderRef: evidence.provider.payload.orderRef,
          signedPayloadDigest: evidence.provider.payload.manifestDigest,
          actualSigner: evidence.provider.payload.signerId,
          technicalResult: evidence.technicalResult,
          usageEligibility: currentlyEligible(evidence, governanceCurrent)
            ? "eligible"
            : "ineligible",
          purpose: evidence.provider.payload.purpose,
        }) satisfies import("@open-erp/domain/document-signatures").SignatureEvidence,
    );

    const complete = assertSignerSetComplete({
      manifest: domainManifest(manifest),
      manifestDigest: manifest.digest,
      evidence: coverage,
    });

    const missingSignerIds = manifest.requiredSigners
      .filter(
        (signer) =>
          !coverage.some(
            (evidence) =>
              evidence.actualSigner === signer.signerId &&
              evidence.technicalResult === "valid" &&
              evidence.usageEligibility === "eligible",
          ),
      )
      .map((signer) => signer.signerId);

    const basis = yield* artifactBasis(transaction, scope, manifest.artifactId);

    return {
      displayArtifact: {
        artifactId: basis.artifact.id,
        xhtml: basis.artifact.xhtml,
        contentHash: basis.hash,
        sizeBytes: basis.artifact.sizeBytes,
      },
      manifest,
      signatures,
      missingSignerIds,
      complete: Result.isSuccess(complete) && governanceCurrent,
      governanceCurrent,
    };
  });
}

export const getDocumentSignatureManifest = (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) =>
  withBook(token, command.scope, false, (transaction) =>
    (function* () {
      return yield* manifestView(transaction, command.scope, command.id);
    })(),
  );

export const getDocumentSignatureIntent = (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) =>
  withBook(token, command.scope, false, (transaction) =>
    (function* () {
      return yield* signatureView(transaction, command.scope, command.id);
    })(),
  );

function signatureOperation(
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
  action: "start" | "collect" | "retain",
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
        yield* authorize(
          principal,
          retention ? "retain_signature_observation" : "operate_document_signature",
        );
        yield* synthetic(transaction, command.scope);
        yield* requireInsertAccess(transaction, [
          "document_signature_attempts",
          "document_signature_evidence",
          "document_signature_observations",
          "command_receipts",
        ]);
        const operation = `${action}_document_signature`;

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          { id: command.id, input: yield* toJsonObject(command.input) },
          Documents.SignatureAttempt,
        );

        const view = yield* signatureView(transaction, command.scope, command.id);

        if (command.input.digest !== view.intent.digest) return yield* failure("StaleDependency");

        if (!retention && principal.actorId !== view.intent.signerId)
          return yield* failure("Forbidden");

        if (view.evidence !== null) {
          if (view.attempt === null) return yield* failure("StaleDependency");

          if (!request.previous)
            yield* saveCommand(
              transaction,
              command.scope,
              command.idempotencyKey,
              request.expected,
              operation,
              principal.actorId,
              yield* toJsonObject(view.attempt),
            );

          return { view, principal, attempt: view.attempt };
        }

        const manifest = yield* read(
          transaction,
          command.scope,
          "document_manifests",
          view.intent.manifestId,
          Documents.DocumentManifest,
        );

        if (!retention && !(yield* currentManifest(transaction, command.scope, manifest)))
          return yield* failure("StaleDependency");

        if (
          !view.attempt &&
          Date.parse(view.intent.expiresAt) <= Date.parse(yield* isoNow(transaction))
        )
          return yield* failure("StaleDependency");
        let attempt = view.attempt;

        if (!attempt) {
          if (action !== "start") return yield* failure("StaleDependency");
          attempt = yield* seal(
            transaction,
            command.scope,
            Documents.SignatureAttempt,
            operation,
            principal.actorId,
            command.idempotencyKey,
            {
              id: newId("signature_attempt"),
              intentId: view.intent.id,
              intentDigest: view.intent.digest,
              correlation: view.intent.correlation,
            },
          );
          yield* insert(transaction, "document_signature_attempts", attempt);
        }

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

        return { view, principal, attempt };
      },
      "update",
    );

    if (admitted.view.evidence !== null || admitted.attempt === null) return admitted.view;

    const displayed = yield* withBook(token, command.scope, !retention, function* (transaction) {
      return yield* manifestView(transaction, command.scope, admitted.view.intent.manifestId);
    });

    const provider = yield* Effect.tryPromise({
      try: () =>
        adapter.signature(
          action === "retain" ? "collect" : action,
          admitted.view.intent,
          displayed.manifest,
          displayed.displayArtifact.xhtml,
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
        yield* authorize(
          principal,
          retention ? "retain_signature_observation" : "operate_document_signature",
        );

        if (principal.actorId !== admitted.principal.actorId) return yield* failure("Forbidden");
        yield* requireInsertAccess(transaction, [
          "document_signature_evidence",
          "document_signature_observations",
        ]);
        const view = yield* signatureView(transaction, command.scope, command.id);

        if (view.evidence) return view;
        const attempt = view.attempt;

        if (!attempt || attempt.id !== admitted.attempt?.id)
          return yield* failure("StaleDependency");
        const payload = provider?.payload;

        const completion =
          payload && provider
            ? completeSignature({
                evidenceId: newId("verified_signature"),
                intent: {
                  intentId: view.intent.id,
                  manifestId: view.intent.manifestId,
                  manifestDigest: view.intent.manifestDigest,
                  expectedSigner: view.intent.signerId,
                  purpose: view.intent.purpose,
                  consentTextHash: view.intent.consentTextHash,
                  providerEnvironment: view.intent.environment,
                  requestDigest: view.intent.digest,
                },
                completion: {
                  orderRef: payload.orderRef,
                  expectedOrderRef: `order_${view.intent.correlation}`,
                  environment: payload.environment,
                  expectedEnvironment: view.intent.environment,
                  signedDigest: payload.manifestDigest,
                  actualSigner: payload.signerId,
                  chainVerified:
                    verified &&
                    payload.intentId === view.intent.id &&
                    payload.correlation === view.intent.correlation &&
                    payload.purpose === view.intent.purpose &&
                    payload.consentTextHash === view.intent.consentTextHash,
                  statusOk: provider.status === "complete",
                },
                retainedEvidence: [],
                signerPermittedNow: view.eligibleNow,
              })
            : null;

        const valid = completion !== null && Result.isSuccess(completion);

        const state =
          provider === null
            ? "start_unknown"
            : provider.status === "pending"
              ? "pending"
              : valid
                ? "complete"
                : "invalid";

        if (provider !== null && provider.status === "complete") {
          const manifest = yield* read(
            transaction,
            command.scope,
            "document_manifests",
            view.intent.manifestId,
            Documents.DocumentManifest,
          );

          const eligible = valid && (yield* currentManifest(transaction, command.scope, manifest));

          const evidence = yield* seal(
            transaction,
            command.scope,
            Documents.RetainedSignatureEvidence,
            "retain_document_signature",
            principal.actorId,
            command.idempotencyKey,
            {
              id: newId("signature_evidence"),
              intentId: view.intent.id,
              manifestId: view.intent.manifestId,
              manifestDigest: view.intent.manifestDigest,
              attemptId: attempt.id,
              provider,
              payloadHash: yield* digest(provider.payload),
              technicalResult: valid ? "valid" : "invalid",
              usageEligibility: eligible ? "eligible" : "ineligible",
              verifierVersion: "synthetic-ed25519-v1",
              verificationKey: adapter.verificationKey,
            },
          );

          yield* insert(transaction, "document_signature_evidence", evidence);
        }

        const last = view.observations.at(-1);

        if (
          last?.state !== state ||
          (provider !== null && last.provider?.signature !== provider.signature)
        ) {
          const observation = yield* seal(
            transaction,
            command.scope,
            Documents.SignatureObservation,
            "observe_document_signature",
            principal.actorId,
            command.idempotencyKey,
            { id: newId("signature_observation"), attemptId: attempt.id, state, provider },
          );

          yield* insert(transaction, "document_signature_observations", observation);
        }

        return yield* signatureView(transaction, command.scope, command.id);
      },
      "update",
    );
  });
}

export const startDocumentSignature = (
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
) => signatureOperation(token, command, "start");

export const collectDocumentSignature = (
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
) => signatureOperation(token, command, "collect");

export const retainDocumentSignature = (
  token: string,
  command: Command<typeof Documents.ExactDocumentCommand.Type> & { readonly id: string },
) => signatureOperation(token, command, "retain");
