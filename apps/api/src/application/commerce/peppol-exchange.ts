import * as Contracts from "@open-erp/contracts/peppol-exchange";
import * as Domain from "@open-erp/domain/peppol-exchange";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/commerce/peppol-exchange";
import * as PostingDb from "../../db/posting";
import { requireHumanSession } from "../../db/human-actor";
import type { Transaction } from "../../db/transaction";
import { sourceDigest } from "../../adapters/storage/retained-objects";
import { decode, requireTableAccess, toJsonObject, withBook, type Scope } from "./support";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";
import { bindingSubject, partyDigest, readPeppolDocument, renderPeppol } from "./peppol-document";
import { accessPoint, readBinding, currentBinding } from "./peppol-context";

export { receivePeppolEnvelope, getPeppolInbound } from "./peppol-inbound";

type Command<A> = { readonly scope: Scope; readonly idempotencyKey: string; readonly input: A };

type ArtifactCommand<A> = Command<A> & { readonly artifactId: string };

function capture(tx: Transaction, scope: Scope, input: typeof Contracts.Prepare.Type) {
  return Effect.gen(function* () {
    const document = yield* readPeppolDocument(tx, scope, input.document);
    const sender = yield* readBinding(tx, scope, input.senderBindingId);
    const recipient = yield* readBinding(tx, scope, input.recipientBindingId);
    yield* currentBinding(tx, scope, sender);
    yield* currentBinding(tx, scope, recipient);

    if (
      sender.role !== "sender" ||
      recipient.role !== "recipient" ||
      sender.providerAccount !== recipient.providerAccount ||
      sender.partyDigest !== (yield* partyDigest(document.seller)) ||
      recipient.partyDigest !== (yield* partyDigest(document.buyer)) ||
      sender.subjectKey !== (yield* bindingSubject(document, "sender")) ||
      recipient.subjectKey !== (yield* bindingSubject(document, "recipient"))
    )
      return yield* failure("InvalidJournal");

    return { document, sender, recipient };
  });
}

export const registerPeppolBinding = Effect.fn("peppol.registerBinding")(function* (
  token: string,
  command: Command<typeof Contracts.RegisterBinding.Type>,
) {
  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_register_binding",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Binding,
    );

    if (request.previous) return request.previous;
    yield* PostingDb.lockBookForUpdate(tx, command.scope);
    yield* requireTableAccess(tx, Db.tables, true);
    const source = yield* readPeppolDocument(tx, command.scope, command.input.document);
    const party = command.input.role === "sender" ? source.seller : source.buyer;

    if (
      party.countryCode !== "SE" ||
      party.registrationId?.replaceAll("-", "") !== command.input.participantId ||
      (command.input.role === "sender" && command.input.paymentAccountReference === null) ||
      (command.input.role === "recipient" && command.input.buyerReference === null) ||
      (yield* PostingDb.readEvidence(tx, command.scope.bookId, command.input.evidenceId)).length ===
        0
    )
      return yield* failure("InvalidJournal");
    const subjectKey = yield* bindingSubject(source, command.input.role);

    const prior = (yield* Db.readCurrentBinding(
      tx,
      command.scope.bookId,
      command.input.role,
      subjectKey,
    ))[0];

    const previous = prior ? yield* decode(Contracts.Binding, prior.body) : null;

    const body = {
      ...command.input,
      id: newId("peppol_binding"),
      scope: command.scope,
      subjectKey,
      partyDigest: yield* partyDigest(party),
      revision: (BigInt(previous?.revision ?? "0") + 1n).toString(),
      createdBy: principal.actorId,
      createdAt: yield* isoNow(tx),
    };

    const binding = yield* decode(Contracts.Binding, { ...body, digest: yield* digest(body) });
    yield* Db.insertBinding(tx, command.scope.bookId, {
      ...binding,
      body: yield* toJsonObject(binding),
    });
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "peppol_register_binding",
      principal.actorId,
      yield* toJsonObject(binding),
    );

    return binding;
  });
});

export const preparePeppolArtifact = Effect.fn("peppol.prepareArtifact")(function* (
  token: string,
  command: Command<typeof Contracts.Prepare.Type>,
) {
  const initial = yield* withBook(token, command.scope, false, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_prepare_artifact",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Artifact,
    );

    if (request.previous) return { kind: "replayed" as const, artifact: request.previous };
    yield* requireTableAccess(tx, Db.tables, false);

    return { kind: "captured" as const, basis: yield* capture(tx, command.scope, command.input) };
  });

  if (initial.kind === "replayed") return initial.artifact;

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

  const provider = yield* accessPoint();

  const validation = yield* Effect.tryPromise({
    try: () => provider.validate({ ...rendered, releaseSha256: Contracts.releaseSha256 }),
    catch: () => failure("Unavailable"),
  });

  const retained = yield* withBook(token, command.scope, false, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_prepare_artifact",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Artifact,
    );

    if (request.previous) return { kind: "prepared" as const, artifact: request.previous };
    yield* PostingDb.lockBookForUpdate(tx, command.scope);
    yield* requireTableAccess(tx, Db.tables, true);
    const current = yield* capture(tx, command.scope, command.input);

    if ((yield* digest(current)) !== (yield* digest(initial.basis)))
      return yield* failure("StaleDependency");
    yield* Db.insertValidation(
      tx,
      command.scope.bookId,
      newId("peppol_validation"),
      candidate,
      yield* toJsonObject({
        xml: rendered.xml,
        xmlSha256: hash,
        sourceDigest: current.document.digest,
        expected: rendered.expected,
        validation,
        createdAt: yield* isoNow(tx),
      }),
    );

    if (validation.outcome !== "passed")
      return {
        kind: "refused" as const,
        unavailable: validation.outcome === "ValidationUnavailable",
      };

    if (
      validation.xmlSha256 !== hash ||
      validation.releaseSha256 !== Contracts.releaseSha256 ||
      validation.networkResolution !== "disabled" ||
      validation.networkAccessPointQualification !== "not-established" ||
      (yield* digest(validation.semantic ?? null)) !== (yield* digest(rendered.expected))
    )
      return { kind: "refused" as const, unavailable: false };
    const id = `peppol_artifact_${candidate.slice(0, 40)}`;
    const prior = (yield* Db.readArtifact(tx, command.scope.bookId, id))[0];

    const body = {
      id,
      scope: command.scope,
      input: command.input,
      documentDigest: current.document.digest,
      sender: current.sender,
      recipient: current.recipient,
      ...rendered,
      rendererVersion: "ubl21-se-domestic-25-v1",
      xmlSha256: hash,
      validation,
      createdBy: principal.actorId,
      createdAt: yield* isoNow(tx),
    };

    const artifact = prior
      ? yield* decode(Contracts.Artifact, prior.body)
      : yield* decode(Contracts.Artifact, { ...body, digest: yield* digest(body) });

    if (!prior)
      yield* Db.insertArtifact(tx, command.scope.bookId, {
        id,
        kind: command.input.document.kind,
        sourceId: command.input.document.id,
        senderId: current.sender.id,
        recipientId: current.recipient.id,
        xmlSha256: hash,
        body: yield* toJsonObject(artifact),
      });
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "peppol_prepare_artifact",
      principal.actorId,
      yield* toJsonObject(artifact),
    );

    return { kind: "prepared" as const, artifact };
  });

  if (retained.kind === "refused")
    return yield* failure(retained.unavailable ? "Unavailable" : "InvalidJournal");

  return retained.artifact;
});

function readArtifact(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readArtifact(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.Artifact, row.body);
  });
}

function currentArtifact(tx: Transaction, scope: Scope, artifact: typeof Contracts.Artifact.Type) {
  return Effect.gen(function* () {
    const current = yield* capture(tx, scope, artifact.input);

    if (
      current.document.digest !== artifact.documentDigest ||
      current.sender.digest !== artifact.sender.digest ||
      current.recipient.digest !== artifact.recipient.digest
    )
      return yield* failure("StaleDependency");
  });
}

function messageForArtifact(
  artifact: typeof Contracts.Artifact.Type,
): typeof Contracts.ProviderMessage.Type {
  return {
    providerAccount: artifact.sender.providerAccount,
    providerKey: `peppol_${artifact.id}`,
    artifactId: artifact.id,
    documentId: artifact.expected.documentId,
    documentHash: artifact.xmlSha256,
    senderParticipant: artifact.sender.participantId,
    recipientParticipant: artifact.recipient.participantId,
    senderBindingDigest: artifact.sender.digest,
    recipientBindingDigest: artifact.recipient.digest,
    releaseSha256: Contracts.releaseSha256,
    expected: artifact.expected,
    xml: artifact.xml,
  };
}

function currentApproval(
  tx: Transaction,
  scope: Scope,
  artifact: typeof Contracts.Artifact.Type,
  approvalId: string,
) {
  return Effect.gen(function* () {
    const row = (yield* Db.readApproval(tx, scope.bookId, artifact.id, approvalId))[0];

    if (!row) return yield* failure("ApprovalRequired");
    const approval = yield* decode(Contracts.Approval, row.body);

    if (
      approval.digest !== artifact.digest ||
      approval.actorId === artifact.createdBy ||
      Date.parse(approval.expiresAt) <= Date.parse(yield* isoNow(tx)) ||
      (yield* PostingDb.readOperatorMembership(tx, scope.bookId, approval.actorId)).length === 0 ||
      (yield* PostingDb.readActorAdmission(tx, approval.actorId))[0]?.enabled !== true
    )
      return yield* failure("ApprovalRequired");

    return approval;
  });
}

function recordSubmission(
  tx: Transaction,
  scope: Scope,
  attempt: typeof Contracts.Attempt.Type,
  approval: typeof Contracts.Approval.Type,
  executorId: string,
  commandKey: string,
  kind: (typeof Contracts.SubmissionAdmission.Type)["kind"],
  absence: typeof Contracts.NotSubmitted.Type | null,
) {
  return Effect.gen(function* () {
    const body = {
      id: newId("peppol_submission"),
      attemptId: attempt.id,
      artifactId: attempt.artifactId,
      approval,
      executorId,
      admittedAt: yield* isoNow(tx),
      providerKey: attempt.providerKey,
      messageDigest: yield* digest(attempt.message),
      kind,
      absence,
    };

    yield* Db.insertSubmission(tx, scope.bookId, {
      ...body,
      approvalId: approval.id,
      commandKey,
      body: yield* toJsonObject(body),
    });
  });
}

function admitAbsentSubmission(
  token: string,
  command: ArtifactCommand<typeof Contracts.Dispatch.Type>,
  attempt: typeof Contracts.Attempt.Type,
  status: typeof Contracts.NotSubmitted.Type,
) {
  return withBook(token, command.scope, false, function* (tx, principal) {
    yield* PostingDb.lockBookForUpdate(tx, command.scope);
    const artifact = yield* readArtifact(tx, command.scope, attempt.artifactId);
    const stored = yield* readAttempt(tx, command.scope, attempt.id);
    const prior = yield* attemptView(tx, command.scope, stored);

    if (
      status.providerAccount !== stored.message.providerAccount ||
      status.providerKey !== stored.providerKey ||
      command.input.digest !== artifact.digest ||
      stored.artifactDigest !== artifact.digest ||
      (yield* digest(stored.message)) !== (yield* digest(messageForArtifact(artifact)))
    )
      return yield* failure("InvalidJournal");

    if (prior.externalMessageId !== null) return yield* failure("IdempotencyConflict");
    const approval = yield* currentApproval(tx, command.scope, artifact, command.input.approvalId);
    yield* currentArtifact(tx, command.scope, artifact);
    yield* recordSubmission(
      tx,
      command.scope,
      stored,
      approval,
      principal.actorId,
      command.idempotencyKey,
      "confirmed_absence_retry",
      status,
    );

    return stored.message;
  });
}

export const approvePeppolExchange = Effect.fn("peppol.approve")(function* (
  token: string,
  command: ArtifactCommand<typeof Contracts.Approve.Type>,
) {
  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    yield* requireHumanSession(principal);

    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_approve",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Approval,
    );

    if (request.previous) return request.previous;
    yield* PostingDb.lockBookForUpdate(tx, command.scope);
    const artifact = yield* readArtifact(tx, command.scope, command.artifactId);

    if (artifact.digest !== command.input.digest) return yield* failure("StaleDependency");

    if (artifact.createdBy === principal.actorId) return yield* failure("ApprovalRequired");
    yield* currentArtifact(tx, command.scope, artifact);
    const now = yield* isoNow(tx);

    const approval = yield* decode(Contracts.Approval, {
      id: newId("peppol_approval"),
      artifactId: artifact.id,
      digest: artifact.digest,
      actorId: principal.actorId,
      expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
      createdAt: now,
    });

    yield* Db.insertApproval(tx, command.scope.bookId, {
      ...approval,
      body: yield* toJsonObject(approval),
    });
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "peppol_approve",
      principal.actorId,
      yield* toJsonObject(approval),
    );

    return approval;
  });
});

export function readAttempt(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readAttempt(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.Attempt, row.body);
  });
}

function attemptView(tx: Transaction, scope: Scope, attempt: typeof Contracts.Attempt.Type) {
  return Effect.gen(function* () {
    const observations = yield* Effect.forEach(
      yield* Db.readOutcomes(tx, scope.bookId, attempt.id),
      (row) => decode(Contracts.ProviderOutcome, row.body),
    );

    const delivered = observations.findLast((row) => row.outcome === "recipient_delivered");
    const accepted = observations.findLast((row) => row.outcome === "transport_accepted");
    const latest = delivered ?? accepted ?? observations.at(-1);

    return {
      ...attempt,
      outcome: latest?.outcome ?? attempt.outcome,
      externalMessageId: latest?.externalMessageId ?? attempt.externalMessageId,
    };
  });
}

function recordOutcome(
  token: string,
  scope: Scope,
  attempt: typeof Contracts.Attempt.Type,
  outcome: typeof Contracts.ProviderOutcome.Type,
) {
  return withBook(token, scope, false, function* (tx) {
    yield* PostingDb.lockBookForUpdate(tx, scope);
    const stored = yield* readAttempt(tx, scope, attempt.id);
    const message = stored.message;
    const prior = yield* attemptView(tx, scope, stored);

    if (
      outcome.providerAccount !== message.providerAccount ||
      outcome.providerKey !== message.providerKey ||
      outcome.artifactId !== message.artifactId ||
      outcome.documentId !== message.documentId ||
      outcome.documentHash !== message.documentHash ||
      outcome.senderParticipant !== message.senderParticipant ||
      outcome.recipientParticipant !== message.recipientParticipant ||
      outcome.releaseSha256 !== message.releaseSha256 ||
      (prior.externalMessageId !== null && prior.externalMessageId !== outcome.externalMessageId)
    )
      return yield* failure("InvalidJournal");
    yield* Db.insertOutcome(
      tx,
      scope.bookId,
      newId("peppol_outcome"),
      stored.id,
      yield* toJsonObject(outcome),
    );

    return yield* attemptView(tx, scope, stored);
  });
}

export const dispatchPeppolExchange = Effect.fn("peppol.dispatch")(function* (
  token: string,
  command: ArtifactCommand<typeof Contracts.Dispatch.Type>,
) {
  const admitted = yield* withBook(token, command.scope, false, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_dispatch",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Attempt,
    );

    if (request.previous) return { attempt: request.previous, isNew: false };
    yield* PostingDb.lockBookForUpdate(tx, command.scope);
    const artifact = yield* readArtifact(tx, command.scope, command.artifactId);

    if (artifact.digest !== command.input.digest) return yield* failure("StaleDependency");
    const prior = (yield* Db.readAttemptByArtifact(tx, command.scope.bookId, artifact.id))[0];

    if (prior) {
      const attempt = yield* decode(Contracts.Attempt, prior.body);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "peppol_dispatch",
        principal.actorId,
        yield* toJsonObject(attempt),
      );

      return { attempt, isNew: false };
    }

    const approval = yield* currentApproval(tx, command.scope, artifact, command.input.approvalId);
    yield* currentArtifact(tx, command.scope, artifact);
    const providerKey = `peppol_${artifact.id}`;

    const retained = yield* Effect.forEach(
      yield* Db.readAttemptByProviderKey(tx, command.scope.bookId, providerKey),
      (item) => decode(Contracts.Attempt, item.body),
    );

    const admission = Domain.admitDispatch({
      attemptId: newId("peppol_attempt"),
      documentId: artifact.expected.documentId,
      documentHash: `sha256:${artifact.xmlSha256}`,
      expectedDocumentHash: `sha256:${artifact.xmlSha256}`,
      expectedBuyer: artifact.expected.buyerParticipant,
      actualBuyer: artifact.recipient.participantId,
      recipientBinding: artifact.recipient.digest,
      providerKey,
      validationAvailable: artifact.validation.outcome === "passed",
      retainedAttempts: retained.map((item) => ({
        attemptId: item.id,
        documentId: item.message.documentId,
        documentHash: `sha256:${item.message.documentHash}`,
        recipientBinding: item.message.recipientBindingDigest,
        providerKey: item.providerKey,
        outcome: item.outcome,
      })),
    });

    if (Result.isFailure(admission))
      return yield* failure("IdempotencyConflict", admission.failure);

    const message = messageForArtifact(artifact);

    const body = {
      id: admission.success.attemptId,
      scope: command.scope,
      artifactId: artifact.id,
      artifactDigest: artifact.digest,
      approvalId: approval.id,
      admittedBy: principal.actorId,
      admittedAt: yield* isoNow(tx),
      message,
      providerKey,
      outcome: "unknown",
      externalMessageId: null,
      paid: false,
      posted: false,
    };

    const attempt = yield* decode(Contracts.Attempt, { ...body, digest: yield* digest(body) });
    yield* Db.insertAttempt(tx, command.scope.bookId, {
      ...attempt,
      body: yield* toJsonObject(attempt),
    });
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "peppol_dispatch",
      principal.actorId,
      yield* toJsonObject(attempt),
    );

    yield* recordSubmission(
      tx,
      command.scope,
      attempt,
      approval,
      principal.actorId,
      command.idempotencyKey,
      "first_submission",
      null,
    );

    return { attempt, isNew: true };
  });

  const provider = yield* accessPoint();

  const status = yield* Effect.tryPromise({
    try: () =>
      admitted.isNew
        ? provider.submit(admitted.attempt.message)
        : provider.status(admitted.attempt.providerKey),
    catch: () => failure("Unavailable"),
  });

  if ("kind" in status) {
    const message = yield* admitAbsentSubmission(token, command, admitted.attempt, status);

    const outcome = yield* Effect.tryPromise({
      try: () => provider.submit(message),
      catch: () => failure("Unavailable"),
    });

    return yield* recordOutcome(token, command.scope, admitted.attempt, outcome);
  }

  return yield* recordOutcome(token, command.scope, admitted.attempt, status);
});

export const collectPeppolOutcome = Effect.fn("peppol.collect")(function* (
  token: string,
  command: Command<Record<string, never>> & { readonly attemptId: string },
) {
  const captured = yield* withBook(token, command.scope, false, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_collect",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Attempt,
    );

    if (request.previous) return { kind: "replayed" as const, attempt: request.previous };

    return {
      kind: "captured" as const,
      attempt: yield* readAttempt(tx, command.scope, command.attemptId),
    };
  });

  if (captured.kind === "replayed") return captured.attempt;
  const provider = yield* accessPoint();

  const outcome = yield* Effect.tryPromise({
    try: () => provider.status(captured.attempt.providerKey),
    catch: () => failure("Unavailable"),
  });

  if ("kind" in outcome) {
    if (
      outcome.providerAccount !== captured.attempt.message.providerAccount ||
      outcome.providerKey !== captured.attempt.providerKey
    )
      return yield* failure("InvalidJournal");

    return yield* failure("Unavailable");
  }

  const projected = yield* recordOutcome(token, command.scope, captured.attempt, outcome);

  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_collect",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.Attempt,
    );

    if (request.previous) return request.previous;
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "peppol_collect",
      principal.actorId,
      yield* toJsonObject(projected),
    );

    return projected;
  });
});

export const getPeppolBinding = Effect.fn("peppol.getBinding")(function* (
  token: string,
  scope: Scope,
  id: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    return yield* readBinding(tx, scope, id);
  });
});

export const getPeppolArtifact = Effect.fn("peppol.getArtifact")(function* (
  token: string,
  scope: Scope,
  id: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    return yield* readArtifact(tx, scope, id);
  });
});

export const getPeppolAttempt = Effect.fn("peppol.getAttempt")(function* (
  token: string,
  scope: Scope,
  id: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    const attempt = yield* readAttempt(tx, scope, id);

    return {
      attempt: yield* attemptView(tx, scope, attempt),
      submissions: yield* Effect.forEach(yield* Db.readSubmissions(tx, scope.bookId, id), (row) =>
        decode(Contracts.SubmissionAdmission, row.body),
      ),
      observations: yield* Effect.forEach(yield* Db.readOutcomes(tx, scope.bookId, id), (row) =>
        decode(Contracts.ProviderOutcome, row.body),
      ),
    };
  });
});
