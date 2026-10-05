import * as Contracts from "@open-erp/contracts/peppol-exchange";
import * as Effect from "effect/Effect";
import * as Db from "../../db/commerce/peppol-exchange";
import * as PostingDb from "../../db/posting";
import { sourceDigest } from "../../adapters/storage/retained-objects";
import { accessPoint, currentBinding, readBinding } from "./peppol-context";
import { decode, toJsonObject, withBook, type Scope } from "./support";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";
import { retainSource } from "../source-retention";
import { recordSupplierExtraction } from "../purchases/inbox";

type ReceiveCommand = {
  readonly scope: Scope;
  readonly idempotencyKey: string;
  readonly input: typeof Contracts.Receive.Type;
};

export const receivePeppolEnvelope = Effect.fn("peppol.receive")(function* (
  token: string,
  command: ReceiveCommand,
) {
  const captured = yield* withBook(token, command.scope, true, function* (tx, principal) {
    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_receive",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.InboundReceipt,
    );

    if (request.previous) return { kind: "replayed" as const, receipt: request.previous };
    const binding = yield* readBinding(tx, command.scope, command.input.bindingId);
    yield* currentBinding(tx, command.scope, binding);

    if (binding.role !== "sender") return yield* failure("Forbidden");

    return { kind: "captured" as const, binding, actorId: principal.actorId };
  });

  if (captured.kind === "replayed") return captured.receipt;
  const provider = yield* accessPoint();

  const envelope = yield* Effect.tryPromise({
    try: () => provider.receive(command.input.transportMessageId),
    catch: () => failure("Unavailable"),
  });

  const bytes = new TextEncoder().encode(envelope.xml);
  const contentHash = yield* sourceDigest(bytes);

  if (
    bytes.byteLength > 1048576 ||
    envelope.providerAccount !== captured.binding.providerAccount ||
    envelope.transportMessageId !== command.input.transportMessageId ||
    envelope.recipientParticipant !== captured.binding.participantId ||
    envelope.expected.buyerParticipant !== envelope.recipientParticipant ||
    envelope.expected.sellerParticipant !== envelope.senderParticipant ||
    envelope.xmlSha256 !== contentHash.slice(7)
  )
    return yield* failure("InvalidJournal");

  const preflight = yield* withBook(token, command.scope, true, function* (tx, principal) {
    yield* PostingDb.lockBookForUpdate(tx, command.scope);
    yield* currentBinding(tx, command.scope, captured.binding);

    const prior = (yield* Db.readInboundIdentity(
      tx,
      command.scope.bookId,
      envelope.providerAccount,
      envelope.recipientParticipant,
      envelope.transportMessageId,
    ))[0];

    if (!prior) return { kind: "new" as const };

    if (prior.contentHash !== contentHash) {
      yield* Db.insertIncident(
        tx,
        command.scope.bookId,
        newId("peppol_incident"),
        prior.id,
        contentHash,
        yield* toJsonObject({
          envelope,
          contentHash,
          observedBy: principal.actorId,
          observedAt: yield* isoNow(tx),
        }),
      );

      return { kind: "incident" as const };
    }

    const receipt = yield* decode(Contracts.InboundReceipt, prior.body);

    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_receive",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.InboundReceipt,
    );

    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "peppol_receive",
      principal.actorId,
      yield* toJsonObject(receipt),
    );

    return { kind: "replayed" as const, receipt };
  });

  if (preflight.kind === "incident") return yield* failure("IdempotencyConflict");

  if (preflight.kind === "replayed") return preflight.receipt;

  const validation = yield* Effect.tryPromise({
    try: () =>
      provider.validate({
        xml: envelope.xml,
        releaseSha256: Contracts.releaseSha256,
        expected: envelope.expected,
      }),
    catch: () => failure("Unavailable"),
  });

  yield* withBook(token, command.scope, true, function* (tx) {
    yield* Db.insertValidation(
      tx,
      command.scope.bookId,
      newId("peppol_validation"),
      contentHash,
      yield* toJsonObject({ envelope, contentHash, validation, createdAt: yield* isoNow(tx) }),
    );
  });

  if (validation.outcome !== "passed")
    return yield* failure(
      validation.outcome === "ValidationUnavailable" ? "Unavailable" : "InvalidJournal",
    );

  if (
    validation.xmlSha256 !== envelope.xmlSha256 ||
    validation.releaseSha256 !== Contracts.releaseSha256 ||
    validation.networkResolution !== "disabled" ||
    validation.networkAccessPointQualification !== "not-established" ||
    (yield* digest(validation.semantic ?? null)) !== (yield* digest(envelope.expected))
  )
    return yield* failure("InvalidJournal");
  const childKey = (yield* digest({ command, actorId: captured.actorId })).slice(7);

  const occurrence = yield* retainSource(token, {
    scope: command.scope,
    idempotencyKey: `peppol_source_${childKey}`,
    input: {
      destination: "supplier_inbox",
      sourceSystem: "peppol_local_ap_v1",
      sourceAccountId: `${envelope.providerAccount}:${envelope.recipientParticipant}`,
      occurrenceKey: envelope.transportMessageId,
      sourceRevision: "1",
      filename: `${contentHash.slice(7)}.xml`,
      mediaType: "application/xml",
      contentBase64: Buffer.from(bytes).toString("base64"),
    },
  });

  if (occurrence.sha256 !== contentHash) return yield* failure("IdempotencyConflict");

  const fields: ReadonlyArray<readonly [string, string, string]> = [
    ["invoiceNumber", envelope.expected.documentId, "/cbc:ID"],
    ["currency", envelope.expected.currency, "/cbc:DocumentCurrencyCode"],
    [
      "netMinor",
      envelope.expected.exclusiveMinor,
      "/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount",
    ],
    ["taxMinor", envelope.expected.taxMinor, "/cac:TaxTotal/cbc:TaxAmount"],
    ["grossMinor", envelope.expected.payableMinor, "/cac:LegalMonetaryTotal/cbc:PayableAmount"],
    [
      "supplierParticipant",
      envelope.senderParticipant,
      "/cac:AccountingSupplierParty/cac:Party/cbc:EndpointID",
    ],
  ];

  const assertions = fields.map(([field, value, sourceLocation]) => ({
    field,
    value,
    sourceLocation,
    sourceHash: occurrence.sha256,
    origin: "SOURCE" as const,
  }));

  yield* recordSupplierExtraction(token, {
    scope: command.scope,
    occurrenceId: occurrence.id,
    idempotencyKey: `peppol_extraction_${childKey}`,
    input: {
      parserVersion: "peppol_ubl21_source_v1",
      status: "suggested",
      suggestions: assertions.map(({ field, value, sourceLocation }) => ({
        field,
        value,
        sourceLocation,
        confidence: 1,
      })),
      diagnostics: ["SOURCE assertions require ordinary human invoice review."],
    },
  });

  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    yield* PostingDb.lockBookForUpdate(tx, command.scope);

    const request = yield* replay(
      tx,
      command.scope,
      command.idempotencyKey,
      "peppol_receive",
      principal.actorId,
      yield* toJsonObject(command),
      Contracts.InboundReceipt,
    );

    if (request.previous) return request.previous;
    yield* currentBinding(tx, command.scope, captured.binding);

    const prior = (yield* Db.readInboundIdentity(
      tx,
      command.scope.bookId,
      envelope.providerAccount,
      envelope.recipientParticipant,
      envelope.transportMessageId,
    ))[0];

    if (prior) {
      if (prior.contentHash !== contentHash) return yield* failure("IdempotencyConflict");
      const receipt = yield* decode(Contracts.InboundReceipt, prior.body);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "peppol_receive",
        principal.actorId,
        yield* toJsonObject(receipt),
      );

      return receipt;
    }

    const businessIdentity = yield* digest({
      providerAccount: envelope.providerAccount,
      sellerParticipant: envelope.senderParticipant,
      documentType: envelope.expected.documentType,
      documentId: envelope.expected.documentId,
      currency: envelope.expected.currency,
    });

    const duplicateCandidate =
      (yield* Db.readInboundBusiness(tx, command.scope.bookId, businessIdentity)).length > 0;

    const body = {
      id: newId("peppol_inbound"),
      scope: command.scope,
      providerAccount: envelope.providerAccount,
      transportMessageId: envelope.transportMessageId,
      recipientParticipant: envelope.recipientParticipant,
      businessIdentity,
      occurrence,
      duplicateCandidate,
      assertions,
      validation,
      posted: false,
      paid: false,
      approved: false,
      createdAt: yield* isoNow(tx),
    };

    const receipt = yield* decode(Contracts.InboundReceipt, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertInbound(tx, command.scope.bookId, {
      id: receipt.id,
      provider: envelope.providerAccount,
      participant: envelope.recipientParticipant,
      message: envelope.transportMessageId,
      contentHash,
      business: businessIdentity,
      occurrenceId: occurrence.id,
      body: yield* toJsonObject(receipt),
    });
    yield* saveCommand(
      tx,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "peppol_receive",
      principal.actorId,
      yield* toJsonObject(receipt),
    );

    return receipt;
  });
});

export const getPeppolInbound = Effect.fn("peppol.getInbound")(function* (
  token: string,
  scope: Scope,
  id: string,
) {
  return yield* withBook(token, scope, false, function* (tx) {
    const row = (yield* Db.readInbound(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");

    return yield* decode(Contracts.InboundReceipt, row.body);
  });
});
